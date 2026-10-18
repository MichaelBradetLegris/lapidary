import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { ApiEventMap, CloseGuardState, CloseStatus, FlushReason } from '../shared/ipc';
import {
  needsAttention,
  unresponsiveDetail,
  type UnresponsiveBox,
  type UnresponsiveStage
} from '../shared/ui/save';
import { bringForward } from './foreground';
import type { LogLevel } from './log';

/**
 * The close guard, main side (apply.8; PLAN 7.7, 11.3 i, and Appendix C
 * "Closing the window is a handshake with the page" and "Shutdown is never
 * blocked").
 *
 * Closing the window must never lose what the page holds, and a page that
 * hangs must never keep the window open. So main decides at the window's
 * `close` event, from the last `CloseGuardState` the page pushed
 * (`app:guard-state`), rather than by asking the page then, which a page that
 * has stopped responding could not answer:
 *
 * - The close goes through at once, with no IPC, when it is allowed (Restart
 *   now's `allowNextClose`, or a close the page has agreed to), when the page
 *   is gone, once the session is ending, or when nothing is at risk
 *   (`needsAttention`), which includes a page that has pushed nothing since it
 *   loaded.
 * - A reload is a new page. When a new document replaces the page in the same
 *   window (the main frame's `did-navigate`: the dev server's reload, Ctrl+R
 *   in development, Reload window after a crash), the guard forgets what the
 *   old page pushed, as it does for a new window, and a close under way ends
 *   without closing, since its request went to a document that is no longer
 *   there and the author is looking at the page they reloaded. Not
 *   `did-start-navigation`: it also fires for a navigation that `will-navigate`
 *   then refuses, which leaves the page where it was.
 * - Otherwise it is held (`preventDefault`), the window comes forward, and the
 *   page is asked once (`app:close-requested`). It has 3 s to say it has the
 *   request (`received`) and 10 s more to put a question on screen
 *   (`prompting`). When it misses either, or the author closes again before a
 *   question is up, a native box offers Wait and Close anyway
 *   (`unresponsiveDetail`). Wait leaves the page its time, and another close
 *   opens the box again; Close anyway destroys the window. A box the page
 *   answers late is taken away through its AbortSignal.
 * - The page's decision (`app:close-decision`) closes the window on the next
 *   tick, or goes on with the quit when the close came from one; false keeps
 *   the window and forgets the quit.
 *
 * Shutdown is never blocked: `query-session-end` and `session-end` only ask
 * the page to write what it holds (`app:flush`), and after `session-end` every
 * close goes through at once.
 *
 * No electron import: the window, the native box and `app.quit` come in as
 * dependencies, so every branch is tested with fake timers
 * (test/main/closeGuard.test.ts). `src/main/ipc.ts` builds the app's one guard
 * and `createWindow` attaches the window to it.
 */

/** How long the page has to say it has a close request (`received`). */
export const ACK_TIMEOUT_MS = 3_000;

/** How long after `received` the page has to put its question on screen (`prompting`). */
export const FINISHING_TIMEOUT_MS = 10_000;

/** The part of a window's `close` event the guard uses. */
export interface CloseEventLike {
  preventDefault(): void;
}

/** The page's side of a window, where the guard's two events go. */
export interface GuardContents {
  send(channel: string, payload: unknown): void;
  /** A new document replaced the page in the main frame: a reload. Not emitted for a navigation that was refused. */
  on(event: 'did-navigate', listener: () => void): unknown;
}

/** The parts of a BrowserWindow the guard uses. */
export interface GuardWindow {
  on(event: 'close', listener: (event: CloseEventLike) => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
  on(event: 'query-session-end', listener: () => void): unknown;
  on(event: 'session-end', listener: () => void): unknown;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  restore(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
  flashFrame(flag: boolean): void;
  /** close as the title bar's X does, which emits `close` */
  close(): void;
  /** close without emitting `close` and without waiting for the page */
  destroy(): void;
  readonly webContents: GuardContents;
}

/** The native box's two buttons. A box taken away, or one that failed to open, counts as Wait. */
export type BoxAnswer = 'wait' | 'close';

/** Who may let the next close through without the page being asked. */
export type CloseAllowance =
  /** Restart now, after the page has asked its own question (`prepareToLeaveApp('update')`, `release.8b`) */
  'update';

export interface CloseGuardDeps<W extends GuardWindow> {
  /**
   * Show the native box over `win` (`messageBoxOptions`) and resolve with the
   * button pressed. An aborted `signal` takes the box away, which resolves as
   * Wait, as Electron's `dialog.showMessageBox` does with its cancel button.
   */
  showBox(win: W, box: UnresponsiveBox, signal: AbortSignal): Promise<BoxAnswer>;
  /** `app.quit()` */
  quit(): void;
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
  /**
   * A quiet test window (dev.1, src/main/foreground.ts): brought forward
   * without the foreground, and its taskbar button never flashes.
   */
  quietWindow(): boolean;
}

export interface CloseGuard<W extends GuardWindow> {
  /**
   * Guard this window's close from now on. A new window starts with nothing
   * known about its page, and so does each page that loads in it later.
   */
  attach(win: W): void;
  /** `app:guard-state`: what a close would put at risk now. A page that pushes one is there. */
  setState(state: CloseGuardState): void;
  /** `app:close-status`: how far the page has got with the close request. */
  onStatus(status: CloseStatus): void;
  /** `app:close-decision`: true closes the window, or goes on quitting; false keeps it. */
  onDecision(close: boolean): void;
  /**
   * Let the next close through without asking the page (11.3 i and n:
   * `allowNextClose('update')` before the installer quits the app). Takes over
   * a close already under way. The returned function takes the allowance back,
   * for an install that failed and left the app running.
   */
  allowNextClose(reason: CloseAllowance): () => void;
  /**
   * The page's process has gone (`render-process-gone`). It holds nothing more
   * that could be saved, so no close waits for it until a page pushes a state
   * again. True when a close or a quit was under way and now goes ahead, so
   * the caller offers nothing else for the window.
   */
  onRendererGone(): boolean;
  /** `before-quit`: the app is quitting, not only closing its window. Awaits nothing. */
  onBeforeQuit(): void;
  /** The one quitting flag: set by `before-quit`, cleared when the author keeps the window. */
  isQuitting(): boolean;
}

/** `dialog.showMessageBox`'s options for the native box, apart from the signal. */
export interface NativeBoxOptions {
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
 * The native box (PLAN 11.3 i): Wait first and the default, and Escape or the
 * box's own close button answer Wait too, so only a deliberate click on Close
 * anyway closes without the page. `noLink` keeps Windows from drawing the two
 * labels as command links.
 */
export function messageBoxOptions(box: UnresponsiveBox): NativeBoxOptions {
  return {
    type: 'warning',
    title: box.title,
    message: box.message,
    detail: box.detail,
    buttons: [box.waitLabel, box.closeLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  };
}

/** The button `dialog.showMessageBox` reports: 1 is Close anyway; anything else waits, a box taken away included. */
export function boxAnswer(response: number): BoxAnswer {
  return response === 1 ? 'close' : 'wait';
}

/** How far a close the guard holds has got. */
type Stage =
  | 'idle'
  /** `app:close-requested` sent, waiting for `received` */
  | 'requested'
  /** the page has the request, waiting for its question */
  | 'received'
  /** a question is on screen, waiting for the author */
  | 'prompting';

export function createCloseGuard<W extends GuardWindow>(deps: CloseGuardDeps<W>): CloseGuard<W> {
  let win: W | null = null;
  /** the last state the page on screen pushed; null until it pushes one */
  let state: CloseGuardState | null = null;
  let stage: Stage = 'idle';
  /** the page's process has gone, until a new page loads or a page pushes a state */
  let gone = false;
  /** the session is ending (Windows sent `session-end`); nothing holds a close after that */
  let sessionEnding = false;
  let quitting = false;
  /** why the next close may go through without asking, if it may */
  let allowance: CloseAllowance | 'decided' | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** the open native box; aborting it takes the box away */
  let box: AbortController | null = null;
  /** the taskbar button was set flashing for this close */
  let flashing = false;

  const liveWindow = (): W | null => (win && !win.isDestroyed() ? win : null);

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function dismissBox(): void {
    const open = box;
    box = null;
    open?.abort();
  }

  /** Stop holding a close: no timer, no box, no flashing. */
  function settle(): void {
    stage = 'idle';
    clearTimer();
    dismissBox();
    if (flashing) {
      flashing = false;
      liveWindow()?.flashFrame(false);
    }
  }

  /**
   * Bring the window forward: restored, shown and focused. When it was not in
   * front, its taskbar button flashes too, because Windows often refuses the
   * focus to a window in the background, and a close can come from the
   * taskbar while another window is in front. A quiet test window is only
   * restored and shown: it asks for no attention at all (dev.1).
   */
  function reveal(target: W): void {
    const inFront = target.isFocused();
    const quiet = deps.quietWindow();
    bringForward(target, quiet);
    if (!inFront && !quiet) {
      target.flashFrame(true);
      flashing = true;
    }
  }

  function sendToPage<E extends 'app:close-requested' | 'app:flush'>(
    target: W,
    channel: E,
    payload: ApiEventMap[E]
  ): boolean {
    try {
      target.webContents.send(channel, payload);
      return true;
    } catch (err) {
      deps.log('warn', 'close.send-failed', { channel, ...loggableErrorFields(err) });
      return false;
    }
  }

  /** In `ms`, unless the page answers first, the box for `boxStage`. */
  function arm(ms: number, boxStage: UnresponsiveStage): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      openBox(boxStage);
    }, ms);
  }

  /** The native box, in the words of the last state the page pushed. One at a time. */
  function openBox(boxStage: UnresponsiveStage): void {
    const target = liveWindow();
    if (!target || box) return;
    clearTimer();
    reveal(target);
    const controller = new AbortController();
    box = controller;
    deps.log('warn', 'close.unresponsive', { stage: boxStage });
    let shown: Promise<BoxAnswer>;
    try {
      shown = deps.showBox(target, unresponsiveDetail(boxStage, state), controller.signal);
    } catch (err) {
      shown = Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    void shown.then(
      (pressed) => boxAnswered(controller, boxStage, pressed),
      (err: unknown) => {
        deps.log('warn', 'close.box-failed', loggableErrorFields(err));
        boxAnswered(controller, boxStage, 'wait');
      }
    );
  }

  function boxAnswered(controller: AbortController, boxStage: UnresponsiveStage, pressed: BoxAnswer): void {
    // Taken away because the page answered after all, or the close ended: the box said nothing.
    if (controller.signal.aborted) return;
    if (box === controller) box = null;
    deps.log('info', 'close.box-answer', { stage: boxStage, answer: pressed });
    // Wait leaves the page its time; no timer brings the box back, another close does.
    if (pressed === 'close') closeAnyway();
  }

  /**
   * Close anyway: the window goes without waiting for the page. `destroy`,
   * because `close` would wait for a page that may not answer; and the app
   * quits too when that was what the author asked for.
   */
  function closeAnyway(): void {
    const target = liveWindow();
    settle();
    allowance = null;
    target?.destroy();
    if (quitting) deps.quit();
  }

  /**
   * On the next tick, so the reply to the page's request goes out first:
   * close the window, or go on with the quit, which closes it. `stillWanted`
   * is asked then, since a close may have gone through meanwhile.
   */
  function closeSoon(stillWanted: () => boolean): void {
    setTimeout(() => {
      if (!stillWanted()) return;
      if (quitting) deps.quit();
      else liveWindow()?.close();
    }, 0);
  }

  function onClose(event: CloseEventLike): void {
    const target = liveWindow();
    if (!target) return;
    if (allowance !== null) {
      deps.log('info', 'close.allowed', { reason: allowance });
      allowance = null;
      settle();
      return;
    }
    if (gone || sessionEnding || !needsAttention(state)) {
      settle();
      return;
    }
    if (stage === 'idle') {
      // A page that cannot be reached cannot be asked, and holds nothing that could still be saved.
      if (!sendToPage(target, 'app:close-requested', { quitting })) return;
      event.preventDefault();
      stage = 'requested';
      reveal(target);
      deps.log('info', 'close.asked', { quitting });
      arm(ACK_TIMEOUT_MS, 'no-answer');
      return;
    }
    // A repeated close. Before the page's question is up it opens the box at
    // once; with a box or the question on screen, the window only comes forward.
    event.preventDefault();
    if (stage === 'requested' && !box) openBox('no-answer');
    else if (stage === 'received' && !box) openBox('finishing');
    else reveal(target);
  }

  function onStatus(status: CloseStatus): void {
    if (status === 'received') {
      if (stage !== 'requested') return;
      // The page is there after all, so a "not responding" box no longer tells the truth.
      dismissBox();
      stage = 'received';
      arm(FINISHING_TIMEOUT_MS, 'finishing');
      return;
    }
    if (status === 'prompting') {
      if (stage !== 'requested' && stage !== 'received') return;
      clearTimer();
      dismissBox();
      stage = 'prompting';
    }
  }

  function onDecision(close: boolean): void {
    if (close !== true) {
      // Anything but a plain true keeps the window.
      if (stage !== 'idle') deps.log('info', 'close.decided', { close: false });
      settle();
      quitting = false;
      return;
    }
    // Restart now's own question (`prepareToLeaveApp('update')`) answers with no close under way.
    if (stage === 'idle') return;
    deps.log('info', 'close.decided', { close: true });
    settle();
    allowance = 'decided';
    closeSoon(() => allowance === 'decided');
  }

  function allowNextClose(reason: CloseAllowance): () => void {
    settle();
    allowance = reason;
    deps.log('info', 'close.allow-next', { reason });
    return () => {
      if (allowance === reason) allowance = null;
    };
  }

  function onRendererGone(): boolean {
    const underWay = stage !== 'idle';
    gone = true;
    settle();
    if (!underWay || !liveWindow()) return false;
    // The author asked to close, and the page that was asked is gone: nothing
    // more can be saved, so the window does what they asked.
    deps.log('warn', 'close.page-gone', { quitting });
    closeSoon(() => gone);
    return true;
  }

  function onSessionEnd(reason: FlushReason): void {
    deps.log('info', 'close.session-end', { reason });
    const target = liveWindow();
    if (target && !gone) sendToPage(target, 'app:flush', { reason });
    if (reason === 'session-end') {
      sessionEnding = true;
      settle();
    }
  }

  /**
   * A new document has replaced the page in the window: a reload. What the
   * old page pushed is no longer on screen, so it is forgotten, as for a new
   * window, and until the new page pushes, a close goes through at once. A
   * close under way ends without closing, its box, timers and flashing with
   * it, and so does the quit it came from, as when the page answers false:
   * the request went to the old document, which can no longer answer, and the
   * reload came after the close, so the author is looking at the page they
   * reloaded. The next close is asked of the new page. The allowance stays,
   * since it is the window's: Restart now's, or a close the old page agreed
   * to on the tick before.
   */
  function onNewPage(): void {
    const underWay = stage !== 'idle';
    settle();
    state = null;
    gone = false;
    if (!underWay) return;
    deps.log('info', 'close.page-replaced', { quitting });
    quitting = false;
  }

  function attach(next: W): void {
    settle();
    win = next;
    state = null;
    gone = false;
    allowance = null;
    next.webContents.on('did-navigate', () => {
      if (win === next) onNewPage();
    });
    next.on('close', (event) => {
      if (win === next) onClose(event);
    });
    next.on('closed', () => {
      if (win !== next) return;
      settle();
      win = null;
      state = null;
      allowance = null;
    });
    next.on('query-session-end', () => {
      if (win === next) onSessionEnd('query-session-end');
    });
    next.on('session-end', () => {
      if (win === next) onSessionEnd('session-end');
    });
  }

  return {
    attach,
    setState: (next) => {
      state = next;
      gone = false;
    },
    onStatus,
    onDecision,
    allowNextClose,
    onRendererGone,
    onBeforeQuit: () => {
      quitting = true;
    },
    isQuitting: () => quitting
  };
}
