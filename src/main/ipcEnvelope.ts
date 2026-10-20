import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { IpcResult, RequestChannel } from '../shared/ipc';
import { toAppError } from './errors';
import { checkPayload } from './ipcGuard';
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
 * Before the handler runs, the payload is checked (`checkPayload`,
 * ipcGuard.ts, hardening.8): a channel that takes nothing is sent nothing,
 * any other a plain object, and no path field holds a NUL. A payload refused
 * there never reaches the handler, and is logged for every channel, a
 * review's too, since `withLogging` never sees it.
 *
 * No electron import, so test/main/loggedProvider.test.ts and
 * test/main/ipcGuard.test.ts drive it.
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
    checkPayload(channel, payload);
  } catch (err) {
    return failed(channel, err, log);
  }
  try {
    return { ok: true, value: await handler(payload) };
  } catch (err) {
    return FAILURES_LOGGED_ELSEWHERE.has(channel)
      ? { ok: false, error: toAppError(err) }
      : failed(channel, err, log);
  }
}

/** The page's answer to a failure, logged as `ipc.failed`. */
function failed(channel: RequestChannel, err: unknown, log: Logger['log']): IpcResult<unknown> {
  const error = toAppError(err);
  // A failure with words of its own is one the app foresaw; one without is a fault.
  log(error.code === 'unknown' ? 'error' : 'warn', 'ipc.failed', { channel, ...loggableErrorFields(err) });
  return { ok: false, error };
}
