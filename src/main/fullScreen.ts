import { loggableErrorFields } from '../shared/diagnostics/redact';
import {
  DEFAULT_FOCUS_HOLD_SECONDS,
  type FocusHoldSeconds,
  type FocusModeState
} from '../shared/ui/focusMode';
import { isFullScreenAction, type FullScreenChange, type FullScreenState } from '../shared/ui/fullScreen';
import { fail } from './errors';
import { refocus } from './foreground';
import type { LogLevel } from './log';

/**
 * The window's full screen (polish.23, PLAN section 7, Full screen) and focus
 * mode (focus.1, section 7, Focus mode). The page asks for it
 * (`window:full-screen`): F11 and the toolbar's button toggle it, Escape
 * leaves it, and a page that has just loaded reads it. Main puts the window
 * in the system's full screen with `BrowserWindow.setFullScreen` and tells the
 * page every time the window enters or leaves it, however that came about
 * (`window:full-screen-changed`), so the button and the page's class follow.
 * The state is the window's own: nothing keeps it in settings, and the window
 * is created without it, so a start is never full screen.
 *
 * Focus mode. With Settings' Focus mode box ticked (read from the settings as
 * they are loaded and saved, `setFocusSettings`), `toggle` into full screen
 * enters focus mode as well: the window is made a kiosk window
 * (`setKiosk`) kept on top (`setAlwaysOnTop`, above the taskbar), and when it
 * loses the focus it is brought back to the front `REFOCUS_DELAY_MS` later,
 * at most once every `REFOCUS_GAP_MS` (`refocus` in foreground.ts), unless it
 * has the focus back already or a box or a picker of the app's own is open
 * over it, which disables it. That is all the app does about Alt+Tab: Electron
 * cannot block it, the Windows key or Ctrl+Alt+Del, and nothing here tries.
 * In focus mode `toggle` and `leave` keep the window as it is (the page shows
 * the hold instead), and only `release`, which the page sends once F11 or
 * Escape has been held for the time set, leaves it: kiosk, on top and full
 * screen go together. Main also leaves focus mode on its own (`leaveFocus`)
 * when the page's process goes, when the page stops answering (the window's
 * `unresponsive`, and the close guard's native box), when the app quits and
 * when the window closes, so a window can never be left holding the screen.
 * Should something other than main take the window out of full screen in
 * focus mode, main puts it back and tells the page to show the hold
 * (`kept`), once every `KEEP_GAP_MS`; a second time within that, it leaves
 * focus mode instead rather than fight.
 *
 * A quiet test window (`dev.1`, C.61) never covers the author's screen: under
 * `MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW` the window is never put in full screen,
 * made a kiosk window or kept on top, and is never brought forward. Main keeps
 * the state itself and tells the page as it would, so a check reads the
 * toggle and focus mode through `window:full-screen`'s answers, the log and
 * the page while the window stays as it was; focus mode then runs with the
 * page's overlay and timing alone.
 *
 * No electron import, so test/main/fullScreen.test.ts drives it with a fake
 * window. `src/main/ipc.ts` builds the app's one and `createWindow` attaches
 * the window to it.
 */

/** How long after the window loses the focus in focus mode it is brought back. */
export const REFOCUS_DELAY_MS = 150;

/** The least time between two refocuses, so they come at most about three times a second. */
export const REFOCUS_GAP_MS = 300;

/** Within this time of putting the window back in full screen, a second leave ends focus mode instead. */
export const KEEP_GAP_MS = 2_000;

/** The level focus mode keeps the window on top at: above the taskbar on Windows. */
export const ON_TOP_LEVEL = 'screen-saver';

/** The parts of a BrowserWindow full screen and focus mode use. */
export interface FullScreenWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  setKiosk(flag: boolean): void;
  setAlwaysOnTop(flag: boolean, level?: typeof ON_TOP_LEVEL): void;
  isFocused(): boolean;
  /** false while a modal box or picker of the app's own is open over the window */
  isEnabled(): boolean;
  focus(): void;
  isDestroyed(): boolean;
  on(
    event: 'enter-full-screen' | 'leave-full-screen' | 'blur' | 'focus' | 'unresponsive' | 'closed',
    listener: () => void
  ): unknown;
  readonly webContents: { send(channel: string, payload: unknown): void };
}

export interface FullScreenDeps {
  /** a quiet test window (dev.1): the state is kept here and never put on the window */
  quietWindow(): boolean;
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

/** The settings focus mode reads as the window goes full screen. */
export interface FocusSettings {
  focusMode: boolean;
  focusHoldSeconds: FocusHoldSeconds;
}

/**
 * Why focus mode ended: the page's hold (`release`), or main on its own when
 * the page's process went, the page stopped answering, the close guard showed
 * its native box, the app quit, the window closed, or the window left full
 * screen a second time within `KEEP_GAP_MS`.
 */
export type FocusLeaveReason =
  'hold' | 'renderer-gone' | 'unresponsive' | 'close-box' | 'quit' | 'closed' | 'left-full-screen';

export interface FullScreen<W extends FullScreenWindow> {
  /** Follow this window from now on; it starts out of full screen and out of focus mode. */
  attach(win: W): void;
  /**
   * `window:full-screen`: do what `action` asks of the attached window and
   * answer with where it was asked to stand and whether it is in focus mode,
   * or with neither when no window is open. Anything but `toggle`, `leave`,
   * `current` or `release` is refused.
   */
  act(action: unknown): FullScreenState;
  /** The Focus mode setting and its hold time, as last loaded or saved; read when the window goes full screen. */
  setFocusSettings(settings: FocusSettings): void;
  /** Whether the window is in focus mode, so the close guard asks the page about every close. */
  focusMode(): boolean;
  /** Leave focus mode, and full screen with it, on main's own word; nothing when not in it. */
  leaveFocus(reason: Exclude<FocusLeaveReason, 'hold' | 'closed' | 'left-full-screen'>): void;
}

export function createFullScreen<W extends FullScreenWindow>(deps: FullScreenDeps): FullScreen<W> {
  let win: W | null = null;
  /** a quiet window's full screen, which the window itself never takes */
  let standIn = false;
  /** focus mode, with the hold time it was entered with; null when not in it */
  let focus: FocusModeState | null = null;
  let settings: FocusSettings = { focusMode: false, focusHoldSeconds: DEFAULT_FOCUS_HOLD_SECONDS };
  /** the state the page was last told, so a change is told once */
  let told: string | null = null;
  let refocusTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefocusAt = Number.NEGATIVE_INFINITY;
  /** refocuses since focus mode was entered, for the log line that ends it */
  let refocused = 0;
  let lastKeptAt = Number.NEGATIVE_INFINITY;

  const live = (): W | null => (win !== null && !win.isDestroyed() ? win : null);
  const isOn = (w: W): boolean => (deps.quietWindow() ? standIn : w.isFullScreen());
  const stateOf = (w: W, fullScreen = isOn(w)): FullScreenState => ({ fullScreen, focus });

  /**
   * Tell the page where the window stands, once per change; `kept` is always
   * told. The window's own events pass where it is going: on Windows Electron
   * sends them before the window has changed, so `isFullScreen()` still says
   * where it was.
   */
  function tell(w: W, fullScreen = isOn(w), kept = false): void {
    if (w.isDestroyed()) return;
    const state = stateOf(w, fullScreen);
    const key = JSON.stringify(state);
    if (!kept && key === told) return;
    told = key;
    const payload: FullScreenChange = kept ? { ...state, kept: true } : state;
    try {
      w.webContents.send('window:full-screen-changed', payload);
    } catch (err) {
      // A page that has gone hears nothing; the next page asks where the window stands.
      deps.log('warn', 'window.full-screen-send-failed', loggableErrorFields(err));
    }
  }

  function clearRefocus(): void {
    if (refocusTimer !== null) clearTimeout(refocusTimer);
    refocusTimer = null;
  }

  /** Enter or leave; the window's own event tells the page, or main does for a quiet one. */
  function set(w: W, on: boolean): boolean {
    if (isOn(w) === on) return on;
    const quiet = deps.quietWindow();
    deps.log('info', 'window.full-screen', { on, quiet });
    if (quiet) {
      standIn = on;
      tell(w);
    } else {
      w.setFullScreen(on);
    }
    return on;
  }

  /** Full screen in focus mode: kiosk and on top, but never for a quiet window. */
  function enterFocus(w: W): void {
    focus = { holdSeconds: settings.focusHoldSeconds };
    refocused = 0;
    lastKeptAt = Number.NEGATIVE_INFINITY;
    const quiet = deps.quietWindow();
    deps.log('info', 'window.focus-mode', { on: true, quiet, holdSeconds: focus.holdSeconds });
    set(w, true);
    if (!quiet) {
      w.setKiosk(true);
      w.setAlwaysOnTop(true, ON_TOP_LEVEL);
    }
    tell(w);
  }

  /**
   * Leave focus mode, then full screen, and tell the page; `w` is null once
   * the window has gone. Inside the window's own `leave-full-screen`
   * (`afterEvent`), the window's calls wait for the event to end, so none is
   * made while Electron is still leaving.
   */
  function endFocus(w: W | null, reason: FocusLeaveReason, afterEvent = false): void {
    if (focus === null) return;
    focus = null;
    clearRefocus();
    const quiet = deps.quietWindow();
    deps.log('info', 'window.focus-mode', { on: false, quiet, reason, refocused });
    if (w === null) return;
    const undo = (): void => {
      if (w.isDestroyed()) return;
      if (!quiet) {
        w.setAlwaysOnTop(false);
        w.setKiosk(false);
      }
      set(w, false);
      tell(w);
    };
    if (afterEvent) setTimeout(undo, 0);
    else undo();
  }

  /** The window lost the focus: in focus mode it comes back, a moment later. */
  function blurred(w: W): void {
    if (focus === null || deps.quietWindow() || refocusTimer !== null) return;
    const wait = Math.max(REFOCUS_DELAY_MS, lastRefocusAt + REFOCUS_GAP_MS - Date.now());
    refocusTimer = setTimeout(() => {
      refocusTimer = null;
      if (win !== w || focus === null || w.isDestroyed()) return;
      // Back already, or a box or a picker of the app's own is open over it.
      if (w.isFocused() || !w.isEnabled()) return;
      lastRefocusAt = Date.now();
      refocused += 1;
      refocus(w, deps.quietWindow());
    }, wait);
  }

  /**
   * The window left full screen: told, or in focus mode put back once, or
   * focus mode ended. A quiet window's state is main's own, so its window's
   * events say nothing.
   */
  function left(w: W): void {
    if (deps.quietWindow()) return;
    if (focus === null) {
      tell(w, false);
      return;
    }
    const now = Date.now();
    if (now - lastKeptAt < KEEP_GAP_MS) {
      endFocus(w, 'left-full-screen', true);
      return;
    }
    lastKeptAt = now;
    deps.log('info', 'window.focus-mode-kept');
    // After the event, not inside it: the window is still leaving.
    setTimeout(() => {
      if (win !== w || focus === null || w.isDestroyed() || w.isFullScreen()) return;
      w.setFullScreen(true);
      w.setKiosk(true);
      w.setAlwaysOnTop(true, ON_TOP_LEVEL);
      tell(w, true, true);
    }, 0);
  }

  return {
    attach(next) {
      clearRefocus();
      win = next;
      standIn = false;
      focus = null;
      told = null;
      next.on('enter-full-screen', () => {
        if (win === next && !deps.quietWindow()) tell(next, true);
      });
      next.on('leave-full-screen', () => {
        if (win === next) left(next);
      });
      next.on('blur', () => {
        if (win === next) blurred(next);
      });
      next.on('focus', () => {
        if (win === next) clearRefocus();
      });
      next.on('unresponsive', () => {
        if (win === next) endFocus(next, 'unresponsive');
      });
      next.on('closed', () => {
        if (win !== next) return;
        endFocus(null, 'closed');
        win = null;
        standIn = false;
        told = null;
      });
    },
    act(action) {
      if (!isFullScreenAction(action)) {
        throw fail(
          'invalid-input',
          'The window:full-screen request was refused, because its action is not toggle, leave, current or release. Nothing was done.'
        );
      }
      const w = live();
      if (w === null) return { fullScreen: false, focus: null };
      if (action === 'current') return stateOf(w);
      if (action === 'release') {
        if (focus !== null) endFocus(w, 'hold');
        return stateOf(w, set(w, false));
      }
      // In focus mode only the hold leaves: the page shows it, and the window stays.
      if (focus !== null) return stateOf(w);
      if (action === 'leave' || isOn(w)) return stateOf(w, set(w, false));
      if (!settings.focusMode) return stateOf(w, set(w, true));
      enterFocus(w);
      return stateOf(w, true);
    },
    setFocusSettings(next) {
      settings = { focusMode: next.focusMode, focusHoldSeconds: next.focusHoldSeconds };
    },
    focusMode: () => focus !== null && live() !== null,
    leaveFocus(reason) {
      endFocus(live(), reason);
    }
  };
}
