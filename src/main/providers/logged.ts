import { loggableErrorFields, type FieldValue } from '../../shared/diagnostics/redact';
import type {
  ConnectionTestResult,
  ModelInfo,
  RateLimitInfo,
  ReviewRequest,
  RuntimeStatus
} from '../../shared/ipc';
import { chapterStats } from '../../shared/text/stats';
import { failureSetupEvent, nextLastFailure, testSetupEvent, type LastFailure } from '../../shared/ui/setup';
import { toAppError } from '../errors';
import type { Logger } from '../log';
import type { ProviderHooks, ProviderResult, ReviewProvider } from './types';

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
 *   email or the status message;
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
 * The last runtime and the last failure move as the renderer's do (useAi.ts,
 * `nextLastFailure`, setup.5), from what the page is told: a review's failure
 * as the envelope words it, a connection test from the answer
 * `testConnection` gives (`noteTest`, called by the `ai:test` handler: inside
 * the provider a test that runs out of time ends as cancelled, and one that
 * throws something unforeseen as `unknown`, where the page is told the test
 * failed), and a check that throws as the error status the page puts in its
 * place. The renderer keeps Claude's only; this keeps one for each provider.
 * Electron-free.
 */

export interface LoggedProvider extends ReviewProvider {
  /** the status the last runtime check returned, or null before the first */
  lastRuntime(): RuntimeStatus | null;
  /** the last failure that says something about setup, or null */
  lastFailure(): LastFailure | null;
  /**
   * A connection test of this provider finished with `result`, the answer
   * `testConnection` gave the page: move the last failure as the renderer
   * does (`testSetupEvent`), and keep the test's usage notice.
   */
  noteTest(result: ConnectionTestResult): void;
}

export interface LoggingDeps {
  log: Logger['log'];
  /** milliseconds, for durations; `Date.now` unless a test says otherwise */
  now?: () => number;
}

/**
 * What `ai.runtime` logs of a runtime status: the fields Copy diagnostics
 * shows (`claudeDiagnostics`), and ChatGPT's plan. Never `email`, `message`
 * (it can carry what a probe said) or `checkedAt` (the line has its own time).
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
    // ChatGPT's plan, as the sign-in named it (codex.3); never the account.
    ...(status.plan ? { plan: status.plan } : {}),
    ...(status.planWarning ? { planWarning: true } : {}),
    ...(status.apiKeySource ? { apiKeySource: status.apiKeySource } : {})
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
 * Claude Code's input figures for one model: `inputTokens` counts only the
 * part of the prompt that was not cached, and the cached part, most of a
 * review's prompt, comes apart as read from and written to the cache.
 */
const CLAUDE_INPUT_FIELDS = ['inputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'] as const;

/**
 * Token counts from a reply's usage, in either provider's shape: the
 * Responses API's `input_tokens` and `output_tokens` (ChatGPT's), or Claude
 * Code's `modelUsage`, whose figures per model are added up. `inputTokens` is
 * the whole prompt, cached or not, for both: `input_tokens` already holds its
 * cached tokens, and Claude Code's cached ones are added in. Nothing when
 * neither is there.
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
    for (const field of CLAUDE_INPUT_FIELDS) {
      const count = model[field];
      if (typeof count === 'number') {
        inputTokens += count;
        found = true;
      }
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
    ...(result.fallbackNote ? { fallback: true } : {})
  };
}

export function withLogging(provider: ReviewProvider, deps: LoggingDeps): LoggedProvider {
  const { log } = deps;
  const now = deps.now ?? Date.now;
  let lastRuntime: RuntimeStatus | null = null;
  let lastFailure: LastFailure | null = null;
  // The last usage notice, read with a review's failure as the review's card reads it (setup.9).
  let lastRateLimit: RateLimitInfo | null = null;

  const noteRateLimit =
    (forward?: (info: RateLimitInfo) => void) =>
    (info: RateLimitInfo): void => {
      lastRateLimit = info;
      forward?.(info);
    };

  /** A runtime check finished, or threw and stands as the error status the page shows for it. */
  function checked(status: RuntimeStatus): void {
    lastRuntime = status;
    lastFailure = nextLastFailure(lastFailure, { type: 'check', runtime: status });
  }

  async function runtime(): Promise<RuntimeStatus> {
    const started = now();
    let status: RuntimeStatus;
    try {
      status = await provider.runtime();
    } catch (err) {
      // useAi's check puts this in place of a status; the envelope logs the failure.
      checked({ provider: provider.id, state: 'error', message: toAppError(err).message });
      throw err;
    }
    checked(status);
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
      lastFailure = nextLastFailure(lastFailure, { type: 'success' });
      return result;
    } catch (err) {
      // As the envelope words it for the page; a cancel says nothing about setup.
      const error = toAppError(err);
      const cancelled = error.code === 'cancelled';
      log(cancelled ? 'info' : 'warn', 'ai.review.failed', {
        provider: provider.id,
        ...loggableErrorFields(err),
        durationMs: now() - started
      });
      if (!cancelled) {
        lastFailure = nextLastFailure(
          lastFailure,
          failureSetupEvent(error.code, error.message, lastRateLimit, lastRuntime)
        );
      }
      throw err;
    }
  }

  // The test's outcome is logged as `ai.test` by its handler (ipc.ts), which also calls this.
  function noteTest(result: ConnectionTestResult): void {
    if (result.rateLimit) lastRateLimit = result.rateLimit;
    const event = testSetupEvent(result, lastRuntime);
    if (event) lastFailure = nextLastFailure(lastFailure, event);
  }

  return {
    id: provider.id,
    label: provider.label,
    runtime,
    models,
    review,
    ...(provider.test ? { test: provider.test.bind(provider) } : {}),
    lastRuntime: () => lastRuntime,
    lastFailure: () => lastFailure,
    noteTest
  };
}
