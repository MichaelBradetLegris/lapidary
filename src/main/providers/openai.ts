import type { ClientOptions, OpenAI } from 'openai';
import type { ReviewRequest } from '../../shared/ipc';
import type { ReviewOutput } from '../../shared/prompt/schema';
import type { ErrorCode } from '../../shared/types';
import { estimateTokens, toOpenAiEffort } from '../../shared/ai/openai';
import { parseOpenAiText, toStrictJsonSchema } from '../../shared/ai/openaiReply';
import { replyLimitMessage, type ReplyLimitFacts } from '../../shared/ai/replyLimit';
import { renderChapter } from '../../shared/prompt/chapter';
import { reviewOutputJsonSchema } from '../../shared/prompt/schema';
import { buildSystemPrompt } from '../../shared/prompt/system';
import { chapterName } from '../../shared/review';
import { getDevSwitches } from '../devSwitches';
import { fail, type AppFailure } from '../errors';
import type { ProviderHooks } from './types';

/**
 * A review's request to OpenAI's Responses API, and the reading of its
 * streamed answer: the official `openai` package, the strict structured
 * output, `store: false` and `stream: true` (PLAN 5.0). The ChatGPT provider
 * (chatgpt.ts, codex.3) sends it with the Sign in with ChatGPT access token
 * as the bearer; it is OpenAI's one route since codex.6 took out the
 * provider that sent it on an OpenAI API key.
 *
 * Everything here is shape: the same system prompt and the same numbered
 * chapter Claude gets, the same zod schema on the way back, so the anchoring,
 * hunks and comments downstream cannot tell the providers apart. No
 * credential is kept here: the bearer comes with each call.
 */

/** The name the API requires for a json_schema format. Letters, digits, dashes. */
const SCHEMA_NAME = 'manuscript_review';

const STRICT_SCHEMA = toStrictJsonSchema(reviewOutputJsonSchema);

/** What the client is built with besides the bearer. */
export interface ClientDeps {
  /** tests point the client at a local mock; the app leaves it to the dev switch */
  baseUrl?: () => string | undefined;
  /** the SDK's retries on 429, 5xx and dropped connections; OpenAI's example for the ChatGPT route sets none */
  maxRetries: number;
}

/** Where a request goes, always, unless a development build points it at the mock. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * The client's options, every one that could move the bearer stated outright.
 *
 * Left out, the SDK fills `baseURL`, `organization` and `project` from
 * OPENAI_BASE_URL, OPENAI_ORG_ID and OPENAI_PROJECT_ID, and an admin key from
 * OPENAI_ADMIN_KEY. A variable left in someone's shell would then send the
 * sign-in's token to another server. Only the development switch
 * `MANUSCRIPT_REVIEW_OPENAI_BASE_URL` (src/main/devSwitches.ts), which a
 * packaged build ignores, or a test's injected URL may change the address. A
 * packaged build also turns the SDK's own console logging off.
 */
export function clientOptions(deps: ClientDeps, bearer: string): ClientOptions {
  const switches = getDevSwitches();
  return {
    apiKey: bearer,
    baseURL: deps.baseUrl?.() ?? switches.openAiBaseUrl ?? OPENAI_BASE_URL,
    organization: null,
    project: null,
    adminAPIKey: null,
    maxRetries: deps.maxRetries,
    timeout: 10 * 60 * 1000,
    ...(switches.packaged ? { logLevel: 'off' as const } : {})
  };
}

/**
 * The review's request (5.0, 5.8): the system prompt as `instructions`, the
 * numbered chapter as `input`, the strict schema as `text.format`, the
 * effort as `reasoning.effort`, `store: false` and `stream: true`. A ChatGPT
 * review sends `input` as a list of messages (`inputAsMessages`), as OpenAI's
 * page on that route asks: the chapter as the one user message.
 */
export function reviewRequestBody(
  request: ReviewRequest,
  model: string,
  inputAsMessages = false
): OpenAI.Responses.ResponseCreateParamsStreaming {
  const chapter = renderChapter(request.text, chapterName(request.sourcePath) || 'chapter');
  return {
    model,
    instructions: buildSystemPrompt(request.guidelines),
    input: inputAsMessages ? [{ role: 'user', content: chapter }] : chapter,
    reasoning: { effort: toOpenAiEffort(request.effort) },
    text: {
      format: { type: 'json_schema', name: SCHEMA_NAME, schema: STRICT_SCHEMA, strict: true }
    },
    // Nothing about this chapter needs to live on OpenAI's side.
    store: false,
    stream: true
  };
}

/** What a stream's own failures are called, in the codes of the provider that sent it. */
export interface StreamCodes {
  /** the failure a `response.failed` event stands for */
  failed: (error: { code?: string | null; message?: string | null } | null | undefined) => AppFailure;
  /** the code of a reply that ended `incomplete` */
  incomplete: ErrorCode;
}

/**
 * Read a review's stream to its end: the text as it comes, which drives the
 * progress label with an estimated count, then the usage and the model once
 * `response.completed` arrives; an `incomplete` or `failed` response is kept
 * as the failure to throw once the stream has been drained.
 */
export async function readReplyStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  model: string,
  onTokens: (tokens: number) => void,
  facts: ChapterFacts,
  codes: StreamCodes
): Promise<StreamedReply> {
  const reply: StreamedReply = { text: '', usage: undefined, model, completed: false, problem: null };
  for await (const event of stream) {
    switch (event.type) {
      case 'response.output_text.delta': {
        reply.text += event.delta;
        // Exact counts arrive with the final response; until then the label
        // needs something that moves (shared/ai/openai.ts).
        onTokens(estimateTokens(reply.text.length));
        break;
      }
      case 'response.completed': {
        reply.completed = true;
        reply.usage = event.response.usage;
        reply.model = event.response.model || model;
        if (reply.text.length === 0) reply.text = outputTextOf(event.response);
        if (event.response.usage?.output_tokens) onTokens(event.response.usage.output_tokens);
        break;
      }
      case 'response.incomplete': {
        reply.problem = incompleteFailure(event.response, model, facts, codes.incomplete);
        break;
      }
      case 'response.failed': {
        reply.problem = codes.failed(event.response.error);
        break;
      }
      default:
        break;
    }
  }
  return reply;
}

/** The codes of a finished stream's failures: the connection closed early, or a reply of the wrong shape. */
export interface ReplyCodes {
  /** the stream ended without `response.completed` */
  closed: ErrorCode;
  /** the reply did not match the schema; its message names the model, never the reply */
  invalidOutput: ErrorCode;
}

/**
 * A drained stream, checked and parsed: cancelled when the review was, the
 * stream's own failure, a stream that closed before `response.completed`,
 * or a reply that does not match the schema, else the parsed output. Says
 * "parsing" to the progress label first.
 */
export function checkedReply(
  reply: StreamedReply,
  hooks: Pick<ProviderHooks, 'signal' | 'onProgress'>,
  tokens: number,
  codes: ReplyCodes
): { output: ReviewOutput; raw: unknown } {
  // An abort can also end the stream quietly rather than by throwing.
  if (hooks.signal.aborted) throw fail('cancelled', 'Review cancelled.');
  if (reply.problem) throw reply.problem;
  if (!reply.completed) {
    throw fail(codes.closed, 'The connection to OpenAI closed before the review was finished. Try again.');
  }
  hooks.onProgress('parsing', tokens);
  const parsed = parseOpenAiText(reply.text);
  if (!parsed.ok || !parsed.value) {
    const problem = (parsed.problem ?? 'unknown problem').slice(0, 160);
    throw fail(
      codes.invalidOutput,
      `${reply.model} answered but the response did not match the expected shape (${problem}). Try again, or pick another model.`,
      parsed.problem
    );
  }
  return { output: parsed.value, raw: parsed.raw };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The chapter's words and the review's effort, which word a reply that ran out of room (files.10). */
export type ChapterFacts = Pick<ReplyLimitFacts, 'words' | 'effort'>;

/** The fields of an incomplete response read here. */
interface IncompleteResponse {
  model?: string;
  incomplete_details?: { reason?: string } | null;
  max_output_tokens?: number | null;
  usage?: { output_tokens?: number } | null;
}

/**
 * A response that ended `incomplete` (files.10), under the provider's `code`.
 * At `max_output_tokens` the reply was cut off at the model's output limit,
 * which the app never sets, so the limit is the model's own and the tokens
 * the reply had used when it stopped are that limit; the words are
 * `replyLimitMessage`'s. A content filter, or any other reason, says what
 * stopped it. OpenAI's reason stays in `detail`.
 */
export function incompleteFailure(
  response: IncompleteResponse,
  model: string,
  facts: ChapterFacts,
  code: ErrorCode
): AppFailure {
  const who = response.model || model;
  const reason = response.incomplete_details?.reason;
  if (reason === 'max_output_tokens') {
    const maxTokens = response.max_output_tokens ?? response.usage?.output_tokens;
    return fail(
      code,
      replyLimitMessage('output', { ...facts, who, ...(maxTokens ? { maxTokens } : {}) }),
      reason
    );
  }
  if (reason === 'content_filter') {
    return fail(
      code,
      `OpenAI's content filter stopped the reply from ${who} before it was finished, so no suggestions came back. Try again, or choose another model.`,
      reason
    );
  }
  return fail(
    code,
    `OpenAI stopped the reply from ${who} before it was finished (${reason ?? 'no reason given'}), so no suggestions came back. Try again.`,
    reason
  );
}

export interface StreamedReply {
  text: string;
  usage: unknown;
  /** the model that answered, as the answer names it */
  model: string;
  /** true once response.completed arrived; a stream that just stops is not an answer */
  completed: boolean;
  /** a failure the stream reported in-band, thrown once the stream is drained */
  problem: Error | null;
}

/**
 * The assembled text of a response. `output_text` is the convenience field; the
 * walk over `output` is the fallback for a response that does not carry one.
 */
export function outputTextOf(response: unknown): string {
  if (typeof response !== 'object' || response === null) return '';
  const shape = response as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
  };
  if (typeof shape.output_text === 'string' && shape.output_text.length > 0) return shape.output_text;
  if (!Array.isArray(shape.output)) return '';
  let text = '';
  for (const item of shape.output) {
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && typeof part.text === 'string') text += part.text;
    }
  }
  return text;
}
