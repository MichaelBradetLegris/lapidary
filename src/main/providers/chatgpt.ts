import { APIConnectionError, APIError, APIUserAbortError, OpenAI } from 'openai';
import {
  CHATGPT_LIMITS_UNKNOWN,
  chatGptModelOptions,
  chatGptModelToSend,
  readChatGptLimits,
  readChatGptModels,
  usageLimitNotice,
  type ChatGptModel
} from '../../shared/ai/chatgpt';
import { replyLimitMessage, type ReplyLimitFacts } from '../../shared/ai/replyLimit';
import type { ChatGptStatus, ModelInfo, RateLimitInfo, ReviewRequest, RuntimeStatus } from '../../shared/ipc';
import {
  CHATGPT_REVIEW_FAILURES,
  DATA_SETTINGS_GATE_TEXT,
  NO_ENCRYPTION_TEXT,
  notSignedInText,
  unsupportedRequestText
} from '../../shared/ui/chatgpt';
import { chapterStats } from '../../shared/text/stats';
import type { AccessTokenOptions } from '../chatgpt';
import { REQUEST_TIMEOUT_MS, type Fetch } from '../chatgpt/oauth';
import { getDevSwitches } from '../devSwitches';
import { AppFailure, fail } from '../errors';
import {
  OPENAI_BASE_URL,
  checkedReply,
  clientOptions,
  readReplyStream,
  reviewRequestBody,
  type ChapterFacts,
  type ReplyCodes,
  type StreamCodes,
  type StreamedReply
} from './openai';
import type { ProviderHooks, ProviderResult, ReviewProvider } from './types';

/**
 * ChatGPT, on the author's ChatGPT plan (codex.3, PLAN 5.8): the same
 * streamed `store: false` Responses request the API key's provider makes
 * (`reviewRequestBody`, `readReplyStream`, openai.ts), sent to OpenAI's API
 * with the access token of Sign in with ChatGPT (codex.2) as the bearer, as
 * OpenAI's page on models and inference for open-source apps gives it
 * (Appendix A). The differences are OpenAI's: `input` is a list of
 * messages, the model list is the one the sign-in allows, in its own shape,
 * an access token is renewed when it has ended or a request is refused with
 * a 401, the plan's limits come with the answers, and the errors are the
 * plan's. Nothing is billed per token, so a review has no cost.
 *
 * The token is asked for at call time (`ChatGptSession.accessToken`, in
 * src/main/chatgpt) and never kept here, logged or sent to the page. The
 * client names the app as nothing but itself: the SDK's own headers, no
 * header or parameter that names another client (CLAUDE.md rule 6's
 * spirit; the Sign in with ChatGPT terms' line on impersonation).
 */

/** What the provider needs of the sign-in: the page's status, and the bearer at call time. */
export interface ChatGptSession {
  status(): Promise<ChatGptStatus>;
  accessToken(options?: AccessTokenOptions): Promise<string>;
}

export interface ChatGptProviderDeps {
  session: () => ChatGptSession;
  /** tests point the provider at the local mock; the app leaves it to the dev switch */
  baseUrl?: () => string | undefined;
  /** for the model list, which is not in the SDK's shape */
  fetch?: Fetch;
  /** the SDK's retries; OpenAI's example for this route sets none */
  maxRetries?: number;
  now?: () => Date;
}

/** The SDK retries nothing here: OpenAI's own example for this route sets `max_retries=0`. */
const CHATGPT_MAX_RETRIES = 0;

const CHATGPT_STREAM_CODES: StreamCodes = {
  failed: (error) => streamFailure(error),
  incomplete: 'chatgpt-failed'
};

const CHATGPT_REPLY_CODES: ReplyCodes = { closed: 'chatgpt-server', invalidOutput: 'chatgpt-invalid-output' };

/** The plan's usage errors, by OpenAI's codes (its page on errors and recovery, Appendix A). */
const USAGE_LIMIT = 'subscription_sharing_usage_limit_exceeded';
const USAGE_UNAVAILABLE = new Set([
  'subscription_sharing_usage_unavailable',
  'subscription_sharing_user_unavailable'
]);

/** A `response.failed` event of a review on the plan: a usage limit reached mid-review, or any other failure. */
function streamFailure(
  error: { code?: string | null; message?: string | null } | null | undefined
): AppFailure {
  const code = error?.code ?? undefined;
  if (code === USAGE_LIMIT)
    return fail('chatgpt-usage-limit', CHATGPT_REVIEW_FAILURES.usageLimitDuring, code);
  if (code !== undefined && USAGE_UNAVAILABLE.has(code)) {
    return fail('chatgpt-server', CHATGPT_REVIEW_FAILURES.usageUnavailable, code);
  }
  return fail(
    'chatgpt-failed',
    `OpenAI could not finish the review: ${error?.message ?? 'the model failed to answer'}`,
    code
  );
}

/** Whether OpenAI refused the bearer: a 401, from the SDK or from a plain request. */
function unauthorized(err: unknown): boolean {
  return (
    (err instanceof APIError && err.status === 401) || (err instanceof RefusedAnswer && err.status === 401)
  );
}

/** A plain request's answer with an error status, as the SDK's APIError would carry it. */
class RefusedAnswer extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super(`status ${status}`);
  }
}

export function createChatGptProvider(deps: ChatGptProviderDeps): ReviewProvider {
  const now = deps.now ?? ((): Date => new Date());
  const doFetch: Fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = (): string => deps.baseUrl?.() ?? getDevSwitches().openAiBaseUrl ?? OPENAI_BASE_URL;

  /**
   * Run `work` with the bearer, and once more with a renewed one when OpenAI
   * refuses it with a 401, which a token ended early, or revoked, gets. A
   * second 401 is the request's own failure.
   */
  async function withToken<T>(
    signal: AbortSignal | undefined,
    work: (token: string) => Promise<T>
  ): Promise<T> {
    const session = deps.session();
    const token = await session.accessToken(signal ? { signal } : {});
    try {
      return await work(token);
    } catch (err) {
      if (!unauthorized(err) || signal?.aborted) throw err;
      const renewed = await session.accessToken({ ...(signal ? { signal } : {}), rejected: token });
      return work(renewed);
    }
  }

  async function runtime(): Promise<RuntimeStatus> {
    const status = await deps.session().status();
    const base = deps.baseUrl?.() ?? getDevSwitches().openAiBaseUrl;
    const dev = base ? { message: `Using a development endpoint: ${base}` } : {};
    if (status.signedIn) {
      return { provider: 'chatgpt', state: 'ready', ...(status.plan ? { plan: status.plan } : {}), ...dev };
    }
    return {
      provider: 'chatgpt',
      state: 'not-signed-in',
      message: status.encryptionAvailable ? notSignedInText('signed-out') : NO_ENCRYPTION_TEXT
    };
  }

  /** The list the sign-in allows, from `GET /models` with the bearer (OpenAI's page on models and inference). */
  async function listModels(signal?: AbortSignal): Promise<ChatGptModel[]> {
    return withToken(signal, async (token) => {
      let response: Response;
      try {
        response = await doFetch(`${baseUrl().replace(/\/+$/, '')}/models`, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        throw fail('chatgpt-server', CHATGPT_REVIEW_FAILURES.modelsNoAnswer);
      }
      const json = jsonOf(await response.text());
      if (!response.ok) {
        const error =
          typeof json === 'object' && json !== null
            ? (json as { error?: { code?: unknown } }).error
            : undefined;
        throw new RefusedAnswer(response.status, typeof error?.code === 'string' ? error.code : null);
      }
      const models = readChatGptModels(json);
      if (models === null) throw fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.modelsMalformed);
      return models;
    });
  }

  async function models(): Promise<ModelInfo[]> {
    try {
      return chatGptModelOptions(await listModels());
    } catch (err) {
      throw mapChatGptError(err, 'list the models');
    }
  }

  /** The model to send: the author's choice, else the list's default; fails when the list has none. */
  async function resolveModel(requested: string, signal: AbortSignal): Promise<string> {
    if (requested.trim().length > 0) return requested.trim();
    const model = chatGptModelToSend(requested, await listModels(signal));
    if (model === null) throw fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.noModels);
    return model;
  }

  /** One streamed call with this bearer; the limits its answer carries go to the status bar. */
  async function streamOnce(
    token: string,
    model: string,
    request: ReviewRequest,
    hooks: ProviderHooks,
    onTokens: (tokens: number) => void,
    facts: ChapterFacts,
    noticed: (info: RateLimitInfo) => void
  ): Promise<StreamedReply> {
    const api = new OpenAI(
      clientOptions(
        {
          ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}),
          maxRetries: deps.maxRetries ?? CHATGPT_MAX_RETRIES
        },
        token
      )
    );
    const { data: stream, response } = await api.responses
      .create(reviewRequestBody(request, model, true), { signal: hooks.signal })
      .withResponse();
    const limits = readChatGptLimits((name) => response.headers.get(name), now());
    if (limits) noticed(limits);
    hooks.onProgress('thinking');
    return readReplyStream(stream, model, onTokens, facts, CHATGPT_STREAM_CODES);
  }

  async function review(request: ReviewRequest, hooks: ProviderHooks): Promise<ProviderResult> {
    // The gate (5.7 item 7): no sign-in is not signed in, and the box goes before the first review.
    const status = await deps.session().status();
    if (!status.signedIn) throw fail('chatgpt-not-signed-in', notSignedInText('signed-out'));
    if (!status.dataSettingsConfirmed) throw fail('chatgpt-data-settings', DATA_SETTINGS_GATE_TEXT);

    const started = Date.now();
    let tokens = 0;
    const onTokens = (count: number): void => {
      tokens = count;
      hooks.onProgress('streaming', tokens);
    };
    let notice: RateLimitInfo | null = null;
    const noticed = (info: RateLimitInfo): void => {
      notice = info;
      hooks.onRateLimit?.(info);
    };

    hooks.onProgress('starting');
    const facts: ChapterFacts = { words: chapterStats(request.text).words, effort: request.effort };
    try {
      let model = request.model.trim();
      let reply: StreamedReply;
      try {
        model = await resolveModel(request.model, hooks.signal);
        reply = await withToken(hooks.signal, (token) =>
          streamOnce(token, model, request, hooks, onTokens, facts, noticed)
        );
      } catch (err) {
        if (hooks.signal.aborted || err instanceof APIUserAbortError)
          throw fail('cancelled', 'Review cancelled.');
        const failure = mapChatGptError(err, 'review the chapter', { ...facts, who: model || 'the model' });
        if (failure.code === 'chatgpt-usage-limit') {
          noticed(usageLimitNotice(limitsOf(err, now())));
        }
        throw failure;
      }
      // A limit reached during the reply: the answer's headers name it when they said it was reached.
      if (reply.problem instanceof AppFailure && reply.problem.code === 'chatgpt-usage-limit') {
        noticed(usageLimitNotice(notice));
      }
      const parsed = checkedReply(reply, hooks, tokens, CHATGPT_REPLY_CODES);
      // A review that went through with no limits in its answer clears an earlier "limit reached".
      if (notice === null) noticed({ ...CHATGPT_LIMITS_UNKNOWN });
      return {
        output: parsed.output,
        raw: parsed.raw,
        model: reply.model,
        ...(reply.usage === undefined ? {} : { usage: reply.usage }),
        durationMs: Date.now() - started,
        ...(notice ? { rateLimit: notice } : {})
      };
    } finally {
      hooks.onProgress('done', tokens);
    }
  }

  return { id: 'chatgpt', label: 'ChatGPT', runtime, models, review };
}

/** A body as JSON, or null when there was none or it was not JSON. */
function jsonOf(body: string): unknown {
  try {
    return body.length > 0 ? (JSON.parse(body) as unknown) : null;
  } catch {
    return null;
  }
}

/** The limits a refusal's headers carry, when it carried any. */
function limitsOf(err: unknown, now: Date): RateLimitInfo | null {
  const headers: unknown = err instanceof APIError ? err.headers : undefined;
  return headers instanceof Headers ? readChatGptLimits((name) => headers.get(name), now) : null;
}

/** A parameter name OpenAI's refusal gives, kept only when it is one. */
function paramOf(err: { param?: unknown }): string | null {
  return typeof err.param === 'string' ? err.param : null;
}

/**
 * A failure of a request on the plan, in words the author can act on, from
 * OpenAI's codes for this route (its page on errors and recovery, Appendix
 * A, read 2026-10-24): the plan's usage limit (`chatgpt-usage-limit`, with
 * Manage usage on its card), usage that is not available just now, an
 * account that is not eligible, a part of the request the route does not
 * take (structured output named on its own, the open question of codex.3),
 * a sign-in OpenAI still refuses after it was renewed, and the plain HTTP
 * cases as the API key's provider words them. OpenAI's own words, and the
 * request id, stay in `detail`, which is never logged.
 */
export function mapChatGptError(err: unknown, doing: string, chapter?: ReplyLimitFacts): AppFailure {
  if (err instanceof AppFailure) return err;
  if (err instanceof APIUserAbortError) return fail('cancelled', 'Review cancelled.');

  if (err instanceof RefusedAnswer) {
    return statusFailure(err.status, err.code, null, doing, `status ${err.status}`);
  }

  if (err instanceof APIError) {
    const detail = `${err.message}${err.requestID ? ` (request ${err.requestID})` : ''}`;
    const status = typeof err.status === 'number' ? err.status : undefined;
    const code = typeof err.code === 'string' ? err.code : null;
    if (
      chapter &&
      status === 400 &&
      (code === 'context_length_exceeded' || /context[ _](window|length)/i.test(err.message))
    ) {
      return fail('chatgpt-failed', replyLimitMessage('input', chapter), detail);
    }
    if (err instanceof APIConnectionError) {
      // Includes timeouts: APIConnectionTimeoutError extends it.
      return fail(
        'chatgpt-server',
        `Could not reach OpenAI to ${doing}. Check your connection and try again.`,
        detail
      );
    }
    return statusFailure(status, code, paramOf(err), doing, detail);
  }

  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof SyntaxError) {
    return fail('chatgpt-server', 'The connection to OpenAI returned garbled data. Try again.', message);
  }
  return fail('chatgpt-failed', `OpenAI could not ${doing} on your ChatGPT plan.`, message);
}

/** A refusal by its code first, as OpenAI's page lists them, then by its status. */
function statusFailure(
  status: number | undefined,
  code: string | null,
  param: string | null,
  doing: string,
  detail: string
): AppFailure {
  switch (code) {
    case USAGE_LIMIT:
      return fail('chatgpt-usage-limit', CHATGPT_REVIEW_FAILURES.usageLimit, detail);
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return fail('chatgpt-server', CHATGPT_REVIEW_FAILURES.usageUnavailable, detail);
    case 'subscription_sharing_user_not_eligible':
      return fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.notEligible, detail);
    case 'subscription_sharing_unsupported_capability':
      return /^text(\.|$)/.test(param ?? '')
        ? fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.structuredOutput, detail)
        : fail('chatgpt-failed', unsupportedRequestText(param), detail);
    case 'subscription_sharing_route_not_supported':
      return fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.routeNotSupported, detail);
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.planUseRefused, detail);
    default:
      break;
  }
  if (status === undefined) {
    // An `error` event inside an otherwise healthy stream arrives this way.
    return fail('chatgpt-failed', `OpenAI stopped with an error while trying to ${doing}.`, detail);
  }
  if (status === 401) return fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.signInNotAccepted, detail);
  if (status === 403) return fail('chatgpt-failed', CHATGPT_REVIEW_FAILURES.forbidden, detail);
  if (status === 429) {
    return fail(
      'chatgpt-server',
      `OpenAI is limiting requests from your ChatGPT sign-in just now, so it could not ${doing}. Wait a moment and try again.`,
      detail
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return fail(
      'chatgpt-failed',
      `OpenAI refused the request to ${doing} on your ChatGPT plan (status ${status}). The model or the effort level may not be available on it: choose another under Model or Effort in Review with AI.`,
      detail
    );
  }
  if (status >= 500) {
    return fail(
      'chatgpt-server',
      `OpenAI had a server error (${status}). Wait a moment and try again.`,
      detail
    );
  }
  return fail(
    'chatgpt-failed',
    `OpenAI refused the request to ${doing} on your ChatGPT plan (status ${status}).`,
    detail
  );
}
