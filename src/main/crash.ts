import { createErrorFilter, createRateCap } from '../shared/diagnostics/errorFilter';
import { RENDERER_LOG_FIELDS } from '../shared/diagnostics/pageError';
import { loggableErrorFields, type FieldValue } from '../shared/diagnostics/redact';
import type { AppNotice, RendererErrorKind } from '../shared/ipc';
import { MAIN_ERROR_NOTICE, rendererGoneBox, type RendererGoneBox } from '../shared/ui/crash';
import type { LogLevel } from './log';

/**
 * Crash handling, main side (hardening.4; PLAN 7.7, 11.3 a and m).
 *
 * - An error nothing caught in main (`uncaughtException`) is logged and
 *   leaves a card in the window (`app:notice`, Show diagnostics), at most one
 *   a minute; the app carries on, as Node does once the event has a listener.
 *   A promise rejected with no handler (`unhandledRejection`) is only logged.
 *   Repeats of the same error are dropped for a minute (`createErrorFilter`)
 *   and at most 30 lines a minute are written.
 * - The page's own unexpected errors arrive as `log:renderer` requests
 *   (`createRendererLog`): only the fields main knows are kept, and at most
 *   30 lines a minute are written, so a page that throws on every frame
 *   cannot fill the log.
 * - When the page's process goes (`render-process-gone`), `createWindow`'s one
 *   handler tells the close guard first (`onRendererGone`), then
 *   `afterRendererGone` offers Reload window or Quit in a native box, unless
 *   the app is quitting, the session is ending, the process exited cleanly,
 *   or a close under way now goes ahead (7.7).
 *
 * No electron import: the process, the log, the window and the box come in as
 * dependencies, so test/main/crash.test.ts drives every branch.
 */

type LogFn = (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/** At most one card a minute for main's own errors. */
export const NOTICE_INTERVAL_MS = 60_000;

/** At most this many lines a minute, for main's errors and, apart, for the page's. */
export const LINES_PER_MINUTE = 30;

const MINUTE_MS = 60_000;

export interface MainErrorDeps {
  log: LogFn;
  /** ask the window for a card (`sendNotice`) */
  notice: (notice: AppNotice) => void;
  now?: () => number;
}

export interface MainErrorHandlers {
  /** `uncaughtException`: logged, with a card at most once a minute */
  uncaught(err: unknown, origin?: string): void;
  /** `unhandledRejection`: logged only */
  rejection(reason: unknown): void;
}

export function createMainErrorHandlers(deps: MainErrorDeps): MainErrorHandlers {
  const now = deps.now ?? ((): number => Date.now());
  const filter = createErrorFilter({ now });
  const cap = createRateCap({ limit: LINES_PER_MINUTE, windowMs: MINUTE_MS, now });
  let lastNotice = Number.NEGATIVE_INFINITY;

  /** Whether this error is written: not a repeat, and not past the cap, which is said once. */
  function admit(kind: string, fields: Record<string, FieldValue>): boolean {
    if (!filter.accept(kind, fields)) return false;
    const taken = cap.take();
    if (taken === 'first-drop') deps.log('warn', 'main.errors-capped', { limit: LINES_PER_MINUTE });
    return taken === 'pass';
  }

  /* Nothing here may throw: a listener of `uncaughtException` that throws
     ends the process. */
  return {
    uncaught(err, origin) {
      try {
        const fields = loggableErrorFields(err);
        if (!admit('uncaught', fields)) return;
        deps.log('error', 'main.uncaught', { ...(origin ? { origin } : {}), ...fields });
        const at = now();
        if (at - lastNotice < NOTICE_INTERVAL_MS) return;
        lastNotice = at;
        deps.notice(MAIN_ERROR_NOTICE);
      } catch {
        /* the log and the card are best effort */
      }
    },
    rejection(reason) {
      try {
        const fields = loggableErrorFields(reason);
        if (!admit('rejection', fields)) return;
        deps.log('warn', 'main.rejection', fields);
      } catch {
        /* the log is best effort */
      }
    }
  };
}

/** The part of `process` the handlers listen on. */
export interface CrashProcess {
  on(event: 'uncaughtException', listener: (err: Error, origin: string) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/**
 * Listen for main's own unexpected errors (11.3 a, step 5: in `start()`, once
 * the log is open). With a listener, Node no longer ends the process on an
 * uncaught exception, and Electron shows no error box of its own.
 */
export function installCrashHandlers(proc: CrashProcess, deps: MainErrorDeps): MainErrorHandlers {
  const handlers = createMainErrorHandlers(deps);
  proc.on('uncaughtException', (err, origin) => handlers.uncaught(err, origin));
  proc.on('unhandledRejection', (reason) => handlers.rejection(reason));
  return handlers;
}

/* ------------------------------------------------------------------ */
/* The page's lines (`log:renderer`)                                    */
/* ------------------------------------------------------------------ */

/** The event and level each kind of page error is logged as. */
export const RENDERER_EVENTS: Readonly<Record<RendererErrorKind, { event: string; level: LogLevel }>> = {
  error: { event: 'renderer.error', level: 'error' },
  rejection: { event: 'renderer.rejection', level: 'warn' },
  render: { event: 'renderer.render-failed', level: 'error' },
  'render-uncaught': { event: 'renderer.render-uncaught', level: 'error' }
};

export type RendererLogResult = 'logged' | 'capped' | 'refused';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

const isScalar = (value: unknown): value is FieldValue =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/**
 * `log:renderer`: one line from the page, logged as its kind's event with only
 * the fields in `RENDERER_LOG_FIELDS` that hold a scalar; the logger scrubs
 * them and cuts them short as it writes them (11.3 m). A payload of another
 * shape is refused, unlogged. Past 30 lines in a minute nothing more is
 * written until the minute has room again, and `renderer.log-capped` says so
 * once. The page drops repeats itself; this is the backstop.
 */
export function createRendererLog(deps: {
  log: LogFn;
  now?: () => number;
}): (payload: unknown) => RendererLogResult {
  const cap = createRateCap({
    limit: LINES_PER_MINUTE,
    windowMs: MINUTE_MS,
    ...(deps.now ? { now: deps.now } : {})
  });
  return (payload) => {
    if (!isPlainObject(payload) || !isPlainObject(payload['fields'])) return 'refused';
    const kind = payload['kind'];
    if (typeof kind !== 'string' || !Object.hasOwn(RENDERER_EVENTS, kind)) return 'refused';
    const { event, level } = RENDERER_EVENTS[kind as RendererErrorKind];
    const taken = cap.take();
    if (taken === 'first-drop') deps.log('warn', 'renderer.log-capped', { limit: LINES_PER_MINUTE });
    if (taken !== 'pass') return 'capped';
    const sent = payload['fields'];
    const fields: Record<string, FieldValue> = {};
    for (const key of RENDERER_LOG_FIELDS) {
      const value = sent[key];
      if (Object.hasOwn(sent, key) && isScalar(value)) fields[key] = value;
    }
    deps.log(level, event, fields);
    return 'logged';
  };
}

/* ------------------------------------------------------------------ */
/* The page's process has gone (`render-process-gone`)                  */
/* ------------------------------------------------------------------ */

/** The part of Electron's `RenderProcessGoneDetails` the handler reads. */
export interface GoneDetails {
  reason: string;
  exitCode: number;
}

/**
 * What comes after the page's process has gone. Only `offer` shows the box:
 * - `closing`: a close was under way, and now goes ahead (`onRendererGone`
 *   returned true, 7.7);
 * - `quitting`: the app is quitting (`isQuitting`);
 * - `session-end`: Windows is ending the session (`isSessionEnding`);
 * - `clean-exit`: the process ended as asked, not by a fault;
 * - `no-window`: the window has gone too.
 */
export type GoneOutcome = 'offer' | 'closing' | 'quitting' | 'session-end' | 'clean-exit' | 'no-window';

export function goneOutcome(
  details: GoneDetails,
  facts: { closing: boolean; quitting: boolean; sessionEnding: boolean; windowGone: boolean }
): GoneOutcome {
  if (facts.windowGone) return 'no-window';
  if (facts.closing) return 'closing';
  if (facts.quitting) return 'quitting';
  if (facts.sessionEnding) return 'session-end';
  if (details.reason === 'clean-exit') return 'clean-exit';
  return 'offer';
}

/** `dialog.showMessageBox`'s options for the box, apart from the signal. */
export interface GoneBoxOptions {
  type: 'warning';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}

/**
 * Reload window first and the default, and Escape or the box's own close
 * button reload too: a window whose page has gone shows nothing, so only a
 * deliberate Quit ends the app.
 */
export function goneBoxOptions(box: RendererGoneBox): GoneBoxOptions {
  return {
    type: 'warning',
    title: box.title,
    message: box.message,
    detail: box.detail,
    buttons: [box.reloadLabel, box.quitLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}

/** The button `dialog.showMessageBox` reports: 1 is Quit; anything else reloads. */
export function goneAnswer(response: number): 'reload' | 'quit' {
  return response === 1 ? 'quit' : 'reload';
}

export interface RendererGoneDeps<W> {
  /** the close guard's flags (src/main/closeGuard.ts) */
  guard: { isQuitting(): boolean; isSessionEnding(): boolean };
  /** show the box over `win` and resolve with the button pressed (`dialog.showMessageBox`) */
  showBox(win: W, options: GoneBoxOptions): Promise<number>;
  /** a new page in the window: `webContents.reload()` */
  reload(win: W): void;
  /** `app.quit()` */
  quit(): void;
  isDestroyed(win: W): boolean;
  log: LogFn;
}

/**
 * After the page's process has gone and the close guard has been told
 * (`closing` is what `onRendererGone` returned): log it, then, when nothing
 * else is under way, ask Reload window or Quit. Resolves with the answer
 * acted on, or null when nothing was asked or the answer came too late: the
 * window gone meanwhile, or the app quitting. A box that fails to open
 * reloads, since a window with no page shows nothing.
 */
export function createRendererGoneHandler<W>(
  deps: RendererGoneDeps<W>
): (win: W, details: GoneDetails, closing: boolean) => Promise<'reload' | 'quit' | null> {
  return async (win, details, closing) => {
    const outcome = goneOutcome(details, {
      closing,
      quitting: deps.guard.isQuitting(),
      sessionEnding: deps.guard.isSessionEnding(),
      windowGone: deps.isDestroyed(win)
    });
    deps.log(outcome === 'clean-exit' ? 'info' : 'warn', 'renderer.gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      outcome
    });
    if (outcome !== 'offer') return null;

    let answer: 'reload' | 'quit';
    try {
      answer = goneAnswer(await deps.showBox(win, goneBoxOptions(rendererGoneBox(details.reason))));
    } catch (err) {
      deps.log('warn', 'renderer.gone-box-failed', loggableErrorFields(err));
      answer = 'reload';
    }
    if (deps.isDestroyed(win) || deps.guard.isQuitting()) return null;
    deps.log('info', 'renderer.gone-answer', { answer });
    if (answer === 'reload') deps.reload(win);
    else deps.quit();
    return answer;
  };
}
