import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { CloseAllowance } from './closeGuard';
import type { LogLevel } from './log';

/**
 * Restart now, main's half (`release.8b`, PLAN 11.3 n and 7.7). The page has
 * already refused while a review runs, asked its close question
 * (`prepareToLeaveApp('update')`, which writes its waiting decisions and
 * paragraph boxes first) and put up its overlay before it sends
 * `update:install`. Main then, in this order:
 *
 * 1. `allowNextClose('update')`: the close the quit brings goes through
 *    without asking the page again, and takes over a close under way;
 * 2. `abortAll()`: anything still talking to Claude Code or OpenAI stops;
 * 3. `writesSettled(2000)`: a chapter save, review save, new chapter or
 *    settings write still in main gets up to 2 s to end, and the install goes
 *    ahead when one has not;
 * 4. `stopWatching()`: the manuscript watcher lets go of the folder;
 * 5. `quitAndInstall()`, which is `autoUpdater.quitAndInstall(false, true)`:
 *    the installer starts with its progress window, the app quits on the next
 *    turn of the event loop, and the installer opens it again when it is done.
 *    Nothing is awaited after it: the NSIS installer stops every process under
 *    the install folder about 1.3 s after it starts.
 *
 * When the install cannot start, the allowance is taken back (the function
 * `allowNextClose` returned, `apply.8`), the watcher starts again, and the
 * caller shows the error card: the app goes on as it was.
 *
 * No electron import, so test/main/updateInstall.test.ts drives every step.
 */

/** How long Restart now lets main's own writes end before the install goes ahead regardless. */
export const INSTALL_WRITES_WAIT_MS = 2_000;

export interface UpdateInstallDeps {
  /** `closeGuard.allowNextClose`; the function it returns takes the allowance back */
  allowNextClose(reason: CloseAllowance): () => void;
  /** `abortAll` from providers/controllers.ts */
  abortAll(): number;
  /** `writesSettled` from writes.ts: true once main's writes have ended, false when the time ran out */
  writesSettled(timeoutMs: number): Promise<boolean>;
  stopWatching(): void;
  /** watch the manuscript folder again, after an install that did not start */
  resumeWatching(): void;
  /** start the installer and quit; throws when the installer cannot be started */
  quitAndInstall(): void;
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

/**
 * `started`: the installer is starting and the app is about to quit, and
 * `takeBack` withdraws the allowance should the installer fail after all.
 * Otherwise the install could not start, for `error`, and the allowance is
 * already back.
 */
export type UpdateInstallOutcome =
  { started: true; takeBack: () => void } | { started: false; error: unknown };

export async function runUpdateInstall(deps: UpdateInstallDeps): Promise<UpdateInstallOutcome> {
  const takeBack = deps.allowNextClose('update');
  let stopped = false;
  try {
    const aborted = deps.abortAll();
    const settled = await deps.writesSettled(INSTALL_WRITES_WAIT_MS);
    if (!settled) deps.log('warn', 'update.install.writes-pending', { waitedMs: INSTALL_WRITES_WAIT_MS });
    deps.stopWatching();
    stopped = true;
    deps.log('info', 'update.install', { aborted, writesSettled: settled });
    deps.quitAndInstall();
    return { started: true, takeBack };
  } catch (err) {
    takeBack();
    if (stopped) deps.resumeWatching();
    deps.log('error', 'update.install.failed', loggableErrorFields(err));
    return { started: false, error: err };
  }
}
