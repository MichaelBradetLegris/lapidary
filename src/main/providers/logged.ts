import { loggableErrorFields, type FieldValue } from '../../shared/diagnostics/redact';
import type { ModelInfo, RateLimitInfo, ReviewRequest, RuntimeStatus } from '../../shared/ipc';
import { chapterStats } from '../../shared/text/stats';
import { failureSetupEvent, nextLastFailure, type LastFailure } from '../../shared/ui/setup';
import { toAppError } from '../errors';
import type { Logger } from '../log';
import type {
  ProviderHooks,
  ProviderResult,
  ProviderTestHooks,
  ProviderTestResult,
  ReviewProvider
} from './types';

/**
 * A provider whose calls are logged (PLAN 11.3 m, hardening.3b), and which
 * remembers its last runtime status and its last failure, so diagnostics can
 * say what the last check found without running another (hardening.5).
 *
 * This is the only place a runtime check, a model list or a review is
 * logged, and only as counts and short facts:
 *
 * - `ai.runtime`: what the check found, the fields Copy diagnostics shows
 *   (`runtimeFields`, setup.4's `claudeDiagnostics`), never the account
 *   email, the key's last four characters or the status message;
 * - `ai.models`: how many models were listed;
 * - `ai.review.start`, `ai.review.done`, `ai.review.failed`: the provider,
 *   model and effort, the chapter's size in words, characters and
 *   paragraphs, the guidelines' size in characters, how many suggestions
 *   and comments came back, tokens, cost and time; a failure through the
 *   error policy (`loggableErrorFields`), which keeps only the code of an
 *   error that quotes the reply.
 *
 * Never the chapter's text, the prompt, the guidelines, the reply or a key.
 * A failed runtime check or model list is logged once, by the IPC envelope
 * (`ipc.failed`, ipcEnvelope.ts); a review's failure is logged here instead.
 *
 * The last failure follows the renderer's (`nextLastFailure`, setup.5): set
 * by a review or connection test that fails, cleared by one that goes
 * through, and read against each runtime check. Electron-free.
 */

export interface LoggedProvider extends ReviewProvider {
  /** the status the last runtime check returned, or null before the first */
  lastRuntime(): RuntimeStatus | null;
  /** the last failure that says something about setup, or null */
  lastFailure(): LastFailure | null;
}

export interface LoggingDeps {
  log: Logger['log'];
  /** milliseconds, for durations; `Date.now` unless a test says otherwise */
  now?: () => number;
}

/**
 * What `ai.runtime` logs of a runtime status: the fields Copy diagnostics
 * shows (`claudeDiagnostics`), and for OpenAI where the key came from. Never
 * `email`, `keyLast4`, `message` (it can carry what a probe said) or
 * `checkedAt` (the line has its own time).
 */
export function runtimeFields(status: RuntimeStatus): Record<string, FieldValue> {
  return {
    provider: status.provider,
    state: status.state,
    ...(status.credential ? { credential: status.credential } : {}),
    ...(status.cliVersion ? { cliVersion: status.cliVersion } : {}),
    ...(status.minCliVersion ? { minCliVersion: status.minCliVersion } : {}),
    ...(status.executablePath ? { executable: status.executablePath } : {}),
    ...(status.authMethod ? { authMethod: status.authMethod } : {}),
    ...(status.subscriptionType ? { plan: status.subscriptionType } : {}),
    ...(status.planWarning ? { planWarning: true } : {}),
    ...(status.apiKeySource ? { apiKeySource: status.apiKeySource } : {}),
    ...(status.keySource ? { keySource: status.keySource } : {})
  };
}

/** What `ai.review.start` logs of a request: sizes, never the text. */
export function reviewRequestFields(request: ReviewRequest): Record<string, FieldValue> {
  const stats = chapterStats(request.text);
  return {
    provider: request.provider,
    model: request.model.trim() || 'default',
    effort: request.effort,
    words: stats.words,
    chars: stats.characters,
    paragraphs: stats.paragraphs,
    guidelinesChars: request.guidelines.length
  };
}

/**
 * Token counts from a reply's usage, in either provider's shape: OpenAI's
 * `input_tokens` and `output_tokens`, or Claude Code's `modelUsage`, whose
 * figures per model are added up. Nothing when neither is there.
 */
export function tokenFields(usage: unknown): Record<string, number> {
  if (typeof usage !== 'object' || usage === null) return {};
  const top = usage as Record<string, unknown>;
  if (typeof top['input_tokens'] === 'number' && typeof top['output_tokens'] === 'number') {
    return { inputTokens: top['input_tokens'], outputTokens: top['output_tokens'] };
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let found = false;
  for (const value of Object.values(top)) {
    if (typeof value !== 'object' || value === null) continue;
    const model = value as Record<string, unknown>;
    if (typeof model['inputTokens'] === 'number') {
      inputTokens += model['inputTokens'];
      found = true;
    }
    if (typeof model['outputTokens'] === 'number') {
      outputTokens += model['outputTokens'];
      found = true;
    }
  }
  return found ? { inputTokens, outputTokens } : {};
}

/** What `ai.review.done` logs of a result: counts, never a suggestion's words or a comment's. */
export function reviewResultFields(result: ProviderResult): Record<string, FieldValue> {
  return {
    ...(result.model ? { model: result.model } : {}),
    changes: result.output.changes.length,
    comments: result.output.comments.length,
    ...tokenFields(result.usage),
    ...(result.costUsd === undefined ? {} : { costUsd: Math.round(result.costUsd * 10_000) / 10_000 }),
    ...(result.costEstimated ? { costEstimated: true } : {}),
    ...(result.fallbackNote ? { fallback: true } : {})
  };
}

export function withLogging(provider: ReviewProvider, deps: LoggingDeps): LoggedProvider {
  const { log } = deps;
  const now = deps.now ?? Date.now;
  let lastRuntime: RuntimeStatus | null = null;
  let lastFailure: LastFailure | null = null;
  // The last usage notice, read with a failure as the review's card reads it (setup.9).
  let lastRateLimit: RateLimitInfo | null = null;

  const noteRateLimit =
    (forward?: (info: RateLimitInfo) => void) =>
    (info: RateLimitInfo): void => {
      lastRateLimit = info;
      forward?.(info);
    };

  /** A review or connection test went through. */
  function succeeded(): void {
    lastFailure = nextLastFailure(lastFailure, { type: 'success' });
  }

  /** A review or connection test failed; a cancel says nothing. */
  function failed(err: unknown): void {
    const error = toAppError(err);
    if (error.code === 'cancelled') return;
    lastFailure = nextLastFailure(
      lastFailure,
      failureSetupEvent(error.code, error.message, lastRateLimit, lastRuntime)
    );
  }

  async function runtime(): Promise<RuntimeStatus> {
    const started = now();
    const status = await provider.runtime();
    lastRuntime = status;
    lastFailure = nextLastFailure(lastFailure, { type: 'check', runtime: status });
    log('info', 'ai.runtime', { ...runtimeFields(status), durationMs: now() - started });
    return status;
  }

  async function models(): Promise<ModelInfo[]> {
    const started = now();
    const list = await provider.models();
    log('info', 'ai.models', { provider: provider.id, count: list.length, durationMs: now() - started });
    return list;
  }

  async function review(request: ReviewRequest, hooks: ProviderHooks): Promise<ProviderResult> {
    const started = now();
    log('info', 'ai.review.start', reviewRequestFields(request));
    try {
      const result = await provider.review(request, {
        ...hooks,
        onRateLimit: noteRateLimit(hooks.onRateLimit)
      });
      log('info', 'ai.review.done', {
        provider: provider.id,
        ...reviewResultFields(result),
        durationMs: now() - started
      });
      succeeded();
      return result;
    } catch (err) {
      const cancelled = toAppError(err).code === 'cancelled';
      log(cancelled ? 'info' : 'warn', 'ai.review.failed', {
        provider: provider.id,
        ...loggableErrorFields(err),
        durationMs: now() - started
      });
      failed(err);
      throw err;
    }
  }

  // The test's outcome is logged as `ai.test` by its handler (ipc.ts); here it only moves the last failure.
  const inner = provider.test?.bind(provider);
  const test = inner
    ? async (hooks: ProviderTestHooks): Promise<ProviderTestResult> => {
        try {
          const result = await inner({ ...hooks, onRateLimit: noteRateLimit(hooks.onRateLimit) });
          succeeded();
          return result;
        } catch (err) {
          failed(err);
          throw err;
        }
      }
    : undefined;

  return {
    id: provider.id,
    label: provider.label,
    runtime,
    models,
    review,
    ...(test ? { test } : {}),
    lastRuntime: () => lastRuntime,
    lastFailure: () => lastFailure
  };
}
