import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { IpcResult, RequestChannel } from '../shared/ipc';
import { toAppError } from './errors';
import type { Logger } from './log';

/**
 * The envelope every request from the page goes through (PLAN 11.3 m,
 * hardening.3b): the handler's answer as `{ok: true, value}`, or its failure,
 * worded for the page by `toAppError`, as `{ok: false, error}`.
 *
 * A failure is logged as `ipc.failed` with the channel and what the error
 * policy (`loggableErrorFields`) lets through, never the payload, which can
 * hold a chapter's text, the guidelines or a key. A review's failure is not
 * logged here: `withLogging` (providers/logged.ts) logs it as
 * `ai.review.failed`, with the review's counts.
 *
 * No electron import, so test/main/loggedProvider.test.ts drives it.
 */

/** Channels whose failures are logged where the work is done, not here. */
const FAILURES_LOGGED_ELSEWHERE: ReadonlySet<RequestChannel> = new Set<RequestChannel>(['ai:review']);

export async function runHandler(
  channel: RequestChannel,
  payload: unknown,
  handler: (payload: unknown) => Promise<unknown>,
  log: Logger['log']
): Promise<IpcResult<unknown>> {
  try {
    return { ok: true, value: await handler(payload) };
  } catch (err) {
    const error = toAppError(err);
    if (!FAILURES_LOGGED_ELSEWHERE.has(channel)) {
      // A failure with words of its own is one the app foresaw; one without is a fault.
      log(error.code === 'unknown' ? 'error' : 'warn', 'ipc.failed', {
        channel,
        ...loggableErrorFields(err)
      });
    }
    return { ok: false, error };
  }
}
