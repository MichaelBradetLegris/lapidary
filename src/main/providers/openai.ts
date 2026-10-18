import { APIConnectionError, APIError, APIUserAbortError, OpenAI, type ClientOptions } from 'openai';
import type { ModelInfo, ReviewRequest, RuntimeStatus } from '../../shared/ipc';
import {
  defaultOpenAiModel,
  estimateTokens,
  toOpenAiEffort,
  usableModels,
  type OpenAiModel
} from '../../shared/ai/openai';
import { parseOpenAiText, toStrictJsonSchema } from '../../shared/ai/openaiReply';
import { estimateCostUsd } from '../../shared/ai/pricing';
import { renderChapter } from '../../shared/prompt/chapter';
import { reviewOutputJsonSchema } from '../../shared/prompt/schema';
import { buildSystemPrompt } from '../../shared/prompt/system';
import { chapterName } from '../../shared/review';
import { getDevSwitches } from '../devSwitches';
import { fail } from '../errors';
import { CONNECTION_TEST_PROMPT, CONNECTION_TEST_SYSTEM_PROMPT } from './connectionTest';
import type {
  ProviderHooks,
  ProviderResult,
  ProviderTestHooks,
  ProviderTestResult,
  ReviewProvider
} from './types';

/**
 * The OpenAI provider: the Responses API with strict structured outputs, on an
 * API key the author pastes into Settings.
 *
 * The key is read from `src/main/secrets.ts` at call time and never kept here.
 * Everything else in this file is shape: the same system prompt and the same
 * numbered chapter Claude gets, the same zod schema on the way back, so the
 * anchoring, hunks and comments downstream cannot tell the two apart.
 */

/** The name the API requires for a json_schema format. Letters, digits, dashes. */
const SCHEMA_NAME = 'manuscript_review';

const STRICT_SCHEMA = toStrictJsonSchema(reviewOutputJsonSchema);

/** How the key reaches this module, so nothing here caches a credential. */
export interface OpenAiDeps {
  /** the key for this call, or null when there is none */
  key: () => Promise<string | null>;
  /** where the key came from, for the runtime status */
  status: () => Promise<{ configured: boolean; source: 'stored' | 'environment' | 'none'; last4: string }>;
  /** tests point the provider at a local mock; the app leaves it to the dev switch */
  baseUrl?: () => string | undefined;
  /** SDK retries on 429, 5xx and dropped connections; tests set 0 to stay fast */
  maxRetries?: number;
}

/** Where the key goes, always, unless a development build points it at the mock. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/**
 * The client's options, every one that could move the key stated outright.
 *
 * Left out, the SDK fills `baseURL`, `organization` and `project` from
 * OPENAI_BASE_URL, OPENAI_ORG_ID and OPENAI_PROJECT_ID, and an admin key from
 * OPENAI_ADMIN_KEY. A variable left in someone's shell would then send the
 * stored key to another server or bill another project. Only the development
 * switch `MANUSCRIPT_REVIEW_OPENAI_BASE_URL` (src/main/devSwitches.ts), which a
 * packaged build ignores, or a test's injected URL may change the address. A
 * packaged build also turns the SDK's own console logging off.
 */
export function clientOptions(deps: Pick<OpenAiDeps, 'baseUrl' | 'maxRetries'>, key: string): ClientOptions {
  const switches = getDevSwitches();
  return {
    apiKey: key,
    baseURL: deps.baseUrl?.() ?? switches.openAiBaseUrl ?? OPENAI_BASE_URL,
    organization: null,
    project: null,
    adminAPIKey: null,
    // One retry: a copyedit is a long call and the author is watching it.
    maxRetries: deps.maxRetries ?? 1,
    timeout: 10 * 60 * 1000,
    ...(switches.packaged ? { logLevel: 'off' as const } : {})
  };
}

export function createOpenAiProvider(deps: OpenAiDeps): ReviewProvider {
  async function client(): Promise<OpenAI> {
    const key = await deps.key();
    if (!key) {
      throw fail(
        'openai-no-key',
        'No OpenAI API key. Paste one into Settings, or set OPENAI_API_KEY before starting the app.'
      );
    }
    return new OpenAI(clientOptions(deps, key));
  }

  async function runtime(): Promise<RuntimeStatus> {
    const status = await deps.status();
    const base = deps.baseUrl?.() ?? getDevSwitches().openAiBaseUrl;
    if (!status.configured) {
      return {
        provider: 'openai',
        state: 'not-signed-in',
        keySource: 'none',
        message: 'No OpenAI API key yet. Add one in Settings.'
      };
    }
    return {
      provider: 'openai',
      state: 'ready',
      keySource: status.source,
      keyLast4: status.last4,
      apiKeySource: status.source === 'environment' ? 'OPENAI_API_KEY' : 'Settings',
      ...(base ? { message: `Using a development endpoint: ${base}` } : {})
    };
  }

  async function models(): Promise<ModelInfo[]> {
    const api = await client();
    const listed: OpenAiModel[] = [];
    try {
      for await (const model of api.models.list()) {
        listed.push({ id: model.id, created: model.created });
      }
    } catch (err) {
      throw mapOpenAiError(err, 'list the models');
    }
    const usable = usableModels(listed);
    const fallback = defaultOpenAiModel(listed);
    return usable.map((model) => ({
      value: model.id,
      label: model.id === fallback ? `${model.id} (default)` : model.id,
      ...(model.id === fallback ? { isDefault: true } : {}),
      ...(model.created ? { description: new Date(model.created * 1000).toISOString().slice(0, 10) } : {})
    }));
  }

  /** The model to send: the author's choice, or the newest gpt-5 the key can see. */
  async function resolveModel(api: OpenAI, requested: string, signal?: AbortSignal): Promise<string> {
    if (requested.trim().length > 0) return requested.trim();
    const listed: OpenAiModel[] = [];
    try {
      for await (const model of api.models.list(signal ? { signal } : undefined)) {
        listed.push({ id: model.id, created: model.created });
      }
    } catch {
      // A key that cannot list models can often still answer, so guess rather than fail.
      return 'gpt-5';
    }
    return defaultOpenAiModel(listed) ?? 'gpt-5';
  }

  /** One streamed call, reduced to what the review needs. Throws mapped errors. */
  async function streamReply(
    api: OpenAI,
    model: string,
    request: ReviewRequest,
    hooks: ProviderHooks,
    onTokens: (tokens: number) => void
  ): Promise<StreamedReply> {
    const reply: StreamedReply = { text: '', usage: undefined, model, completed: false, problem: null };

    const stream = await api.responses.create(
      {
        model,
        instructions: buildSystemPrompt(request.guidelines),
        input: renderChapter(request.text, chapterName(request.sourcePath) || 'chapter'),
        reasoning: { effort: toOpenAiEffort(request.effort) },
        text: {
          format: { type: 'json_schema', name: SCHEMA_NAME, schema: STRICT_SCHEMA, strict: true }
        },
        // Nothing about this chapter needs to live on OpenAI's side.
        store: false,
        stream: true
      },
      { signal: hooks.signal }
    );

    hooks.onProgress('thinking');

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
          const reason = event.response.incomplete_details?.reason ?? 'the response was cut short';
          reply.problem = fail(
            'openai-failed',
            `OpenAI stopped before finishing (${reason}). Try a shorter chapter or a lower effort.`
          );
          break;
        }
        case 'response.failed': {
          reply.problem = fail(
            'openai-failed',
            `OpenAI could not finish the review: ${event.response.error?.message ?? 'the model failed to answer'}`,
            event.response.error?.code ?? undefined
          );
          break;
        }
        default:
          break;
      }
    }
    return reply;
  }

  async function review(request: ReviewRequest, hooks: ProviderHooks): Promise<ProviderResult> {
    const api = await client();
    const started = Date.now();
    let tokens = 0;
    const onTokens = (count: number): void => {
      tokens = count;
      hooks.onProgress('streaming', tokens);
    };

    hooks.onProgress('starting');
    try {
      const model = await resolveModel(api, request.model);

      let reply: StreamedReply;
      try {
        reply = await streamReply(api, model, request, hooks, onTokens);
      } catch (err) {
        if (hooks.signal.aborted || err instanceof APIUserAbortError) {
          throw fail('cancelled', 'Review cancelled.');
        }
        throw mapOpenAiError(err, 'review the chapter');
      }

      // An abort can also end the stream quietly rather than by throwing.
      if (hooks.signal.aborted) throw fail('cancelled', 'Review cancelled.');
      if (reply.problem) throw reply.problem;
      if (!reply.completed) {
        throw fail(
          'openai-server',
          'The connection to OpenAI closed before the review was finished. Try again.'
        );
      }

      hooks.onProgress('parsing', tokens);
      const parsed = parseOpenAiText(reply.text);
      if (!parsed.ok || !parsed.value) {
        const problem = (parsed.problem ?? 'unknown problem').slice(0, 160);
        throw fail(
          'openai-invalid-output',
          `${reply.model} answered but the response did not match the expected shape (${problem}). Try again, or pick another model.`,
          parsed.problem
        );
      }

      const counts = tokenCounts(reply.usage);
      const cost = counts ? estimateCostUsd(reply.model, counts) : null;
      return {
        output: parsed.value,
        raw: parsed.raw,
        model: reply.model,
        ...(reply.usage === undefined ? {} : { usage: reply.usage }),
        ...(cost === null ? {} : { costUsd: cost, costEstimated: true }),
        durationMs: Date.now() - started
      };
    } finally {
      hooks.onProgress('done', tokens);
    }
  }

  /**
   * Test the connection (setup.8): one plain, unstreamed request with the
   * test's system prompt, to the model a review would use when none is
   * chosen. Any answer counts; a refused key, a rate limit or a dead server
   * throws as it would for a review. The time limit belongs to the caller.
   */
  async function test(hooks: ProviderTestHooks): Promise<ProviderTestResult> {
    const api = await client();
    try {
      const model = await resolveModel(api, '', hooks.signal);
      const response = await api.responses.create(
        {
          model,
          instructions: CONNECTION_TEST_SYSTEM_PROMPT,
          input: CONNECTION_TEST_PROMPT,
          store: false
        },
        { signal: hooks.signal }
      );
      return { model: response.model || model };
    } catch (err) {
      if (hooks.signal.aborted || err instanceof APIUserAbortError)
        throw fail('cancelled', 'Test cancelled.');
      throw mapOpenAiError(err, 'answer the test');
    }
  }

  return { id: 'openai', label: 'OpenAI', runtime, models, review, test };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface StreamedReply {
  text: string;
  usage: unknown;
  /** the model that answered, which the API reports as a dated snapshot */
  model: string;
  /** true once response.completed arrived; a stream that just stops is not an answer */
  completed: boolean;
  /** a failure the stream reported in-band, thrown once the stream is drained */
  problem: Error | null;
}

interface UsageShape {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
}

function tokenCounts(
  usage: unknown
): { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const shape = usage as UsageShape;
  if (typeof shape.input_tokens !== 'number' || typeof shape.output_tokens !== 'number') return null;
  const cached = shape.input_tokens_details?.cached_tokens;
  return {
    inputTokens: shape.input_tokens,
    outputTokens: shape.output_tokens,
    ...(typeof cached === 'number' ? { cachedInputTokens: cached } : {})
  };
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

/**
 * HTTP status to something the author can act on. 401 points at Settings, 429
 * says the account is out of credit or too busy, 5xx and a dead network say to
 * try again.
 */
export function mapOpenAiError(err: unknown, doing: string): Error {
  if (err instanceof APIUserAbortError) return fail('cancelled', 'Review cancelled.');

  if (err instanceof APIError) {
    const detail = err.message;
    const status = typeof err.status === 'number' ? err.status : undefined;
    if (status === 401 || status === 403) {
      return fail(
        'openai-invalid-key',
        'OpenAI rejected the API key. Check it in Settings, or paste a new one.',
        detail
      );
    }
    if (status === 429) {
      return fail(
        'openai-rate-limit',
        'OpenAI is rate limiting this key, or the account is out of credit. Check your usage and try again.',
        detail
      );
    }
    if (status === 400 || status === 404 || status === 422) {
      return fail(
        'openai-failed',
        `OpenAI refused the request to ${doing}: ${detail}. The model or the effort level may not be available on this account.`
      );
    }
    if (status !== undefined && status >= 500) {
      return fail(
        'openai-server',
        `OpenAI had a server error (${status}). Wait a moment and try again.`,
        detail
      );
    }
    if (err instanceof APIConnectionError) {
      // Includes timeouts: APIConnectionTimeoutError extends it.
      return fail(
        'openai-server',
        `Could not reach OpenAI to ${doing}. Check your connection and try again.`,
        detail
      );
    }
    if (status === undefined) {
      // An `error` event inside an otherwise healthy stream arrives this way.
      return fail('openai-failed', `OpenAI stopped with an error while trying to ${doing}: ${detail}`);
    }
    return fail('openai-failed', `OpenAI refused the request (${status}): ${detail}`);
  }

  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SyntaxError) {
    return fail('openai-server', `The connection to OpenAI returned garbled data. Try again.`, message);
  }
  return fail('openai-failed', `OpenAI could not ${doing}: ${message}`);
}
