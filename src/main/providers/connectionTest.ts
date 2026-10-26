import type { ConnectionTestResult, RateLimitInfo } from '../../shared/ipc';
import type { AppError, ErrorCode } from '../../shared/types';
import { AppFailure } from '../errors';
import type { ReviewProvider } from './types';

/**
 * Test the connection (setup.8, PLAN 5.6): one very small request, sent only
 * when the author asks, to see that a review would go through. The launch
 * check sends no request at all (setup.4); this one costs a little of the
 * plan, which the Setup screen says beside the button.
 *
 * The provider sends the request (`ReviewProvider.test`); this file times it,
 * gives up after 60 s, and turns whatever happened into one answer, so the
 * page is never left waiting and never has to read a thrown error. No
 * electron import: test/main/connectionTest.test.ts drives it against
 * test/helpers/fakeClaude.ts. Claude's is the one test today: ChatGPT has
 * none (codex.3), and the OpenAI API key's went with that provider (codex.6).
 */

/** How long a test may take before it is stopped. */
export const CONNECTION_TEST_TIMEOUT_MS = 60_000;

/** The test's system prompt, the same for every provider. */
export const CONNECTION_TEST_SYSTEM_PROMPT = 'Reply with the single word OK.';

/** The test's one user message. */
export const CONNECTION_TEST_PROMPT = 'This is a connection test.';

/** The code a test that failed in an unforeseen way, or ran out of time, reports for each provider. */
const FAILED: Readonly<Record<ReviewProvider['id'], ErrorCode>> = {
  claude: 'claude-failed',
  // ChatGPT has no connection test (codex.3); its code is here for a provider list that is whole.
  chatgpt: 'chatgpt-failed'
};

export interface ConnectionTestOptions {
  /** 60 s unless a test says otherwise */
  timeoutMs?: number;
  /** milliseconds, for the duration; `Date.now` unless a test says otherwise */
  now?: () => number;
  /** registers the test's controller so quitting aborts it (controllers.ts) */
  track?: (controller: AbortController) => () => void;
}

function timeoutError(provider: ReviewProvider, timeoutMs: number): AppError {
  const seconds = Math.round(timeoutMs / 1000);
  return {
    code: FAILED[provider.id],
    message: `${provider.label} did not answer within ${seconds} second${seconds === 1 ? '' : 's'}, so the test was stopped. Try again in a minute.`
  };
}

/** A failure in the provider's own words; anything else as a plain failed test, never as a file error. */
function errorOf(provider: ReviewProvider, err: unknown): AppError {
  if (err instanceof AppFailure) return err.toAppError();
  const message = err instanceof Error ? err.message : String(err);
  return { code: FAILED[provider.id], message: `The test failed: ${message}` };
}

/**
 * Run `provider`'s connection test and say how it went. Resolves, never
 * rejects: a failure is `{ok: false, error}`. After `timeoutMs` the test is
 * aborted, which ends the provider's process or request, and the answer is a
 * timeout at once rather than when that has finished.
 */
export async function testConnection(
  provider: ReviewProvider,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? CONNECTION_TEST_TIMEOUT_MS;
  const started = now();
  let rateLimit: RateLimitInfo | undefined;
  const answer = (
    fields: { ok: true; model?: string } | { ok: false; error: AppError }
  ): ConnectionTestResult => ({
    ...fields,
    durationMs: Math.max(0, now() - started),
    ...(rateLimit ? { rateLimit } : {})
  });

  if (!provider.test) {
    return answer({
      ok: false,
      error: { code: 'invalid-input', message: `${provider.label} has no connection test.` }
    });
  }

  const controller = new AbortController();
  const release = options.track?.(controller) ?? ((): void => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const running = provider.test({
    signal: controller.signal,
    onRateLimit: (info) => {
      rateLimit = info;
    }
  });

  try {
    const outcome = await Promise.race([running, outOfTime]);
    if (outcome === 'timeout') {
      controller.abort();
      // It ends on its own now, as cancelled; nobody is waiting for that.
      running.catch(() => undefined);
      return answer({ ok: false, error: timeoutError(provider, timeoutMs) });
    }
    return answer({ ok: true, ...(outcome.model ? { model: outcome.model } : {}) });
  } catch (err) {
    return answer({ ok: false, error: errorOf(provider, err) });
  } finally {
    clearTimeout(timer);
    release();
  }
}
