import { isFullScreenAction } from '../shared/ui/fullScreen';
import { fail } from './errors';
import type { LogLevel } from './log';

/**
 * The window's full screen (polish.23, PLAN section 7, Full screen). The page
 * asks for it (`window:full-screen`): F11 and the toolbar's button toggle it,
 * Escape leaves it, and a page that has just loaded reads it. Main puts the
 * window in the system's full screen with `BrowserWindow.setFullScreen` and
 * tells the page every time the window enters or leaves it, however that
 * came about (`window:full-screen-changed`), so the button and the page's
 * class follow. The state is the window's own: nothing keeps it in settings,
 * and the window is created without it, so a start is never full screen.
 *
 * A quiet test window (`dev.1`, C.61) never covers the author's screen: under
 * `MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW` the window is never put in full screen.
 * Main keeps the state itself and tells the page as it would, so a check reads
 * the toggle through `window:full-screen`'s answers, the log and the page's
 * class while the window stays as it was.
 *
 * No electron import, so test/main/fullScreen.test.ts drives it with a fake
 * window. `src/main/ipc.ts` builds the app's one and `createWindow` attaches
 * the window to it.
 */

/** The parts of a BrowserWindow full screen uses. */
export interface FullScreenWindow {
  isFullScreen(): boolean;
  setFullScreen(flag: boolean): void;
  isDestroyed(): boolean;
  on(event: 'enter-full-screen' | 'leave-full-screen' | 'closed', listener: () => void): unknown;
  readonly webContents: { send(channel: string, payload: unknown): void };
}

export interface FullScreenDeps {
  /** a quiet test window (dev.1): the state is kept here and never put on the window */
  quietWindow(): boolean;
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface FullScreen<W extends FullScreenWindow> {
  /** Follow this window from now on; it starts out of full screen. */
  attach(win: W): void;
  /**
   * `window:full-screen`: do what `action` asks of the attached window and
   * answer with where it was asked to stand, or with false when no window is
   * open. Anything but `toggle`, `leave` or `current` is refused.
   */
  act(action: unknown): boolean;
}

export function createFullScreen<W extends FullScreenWindow>(deps: FullScreenDeps): FullScreen<W> {
  let win: W | null = null;
  /** a quiet window's full screen, which the window itself never takes */
  let standIn = false;

  const isOn = (w: W): boolean => (deps.quietWindow() ? standIn : w.isFullScreen());

  const tell = (w: W, fullScreen: boolean): void => {
    if (!w.isDestroyed()) w.webContents.send('window:full-screen-changed', { fullScreen });
  };

  /** Enter or leave; the window's own event tells the page, or main does for a quiet one. */
  function set(w: W, on: boolean): boolean {
    if (isOn(w) === on) return on;
    const quiet = deps.quietWindow();
    deps.log('info', 'window.full-screen', { on, quiet });
    if (quiet) {
      standIn = on;
      tell(w, on);
    } else {
      w.setFullScreen(on);
    }
    return on;
  }

  return {
    attach(next) {
      win = next;
      standIn = false;
      next.on('enter-full-screen', () => {
        if (win === next) tell(next, true);
      });
      next.on('leave-full-screen', () => {
        if (win === next) tell(next, false);
      });
      next.on('closed', () => {
        if (win !== next) return;
        win = null;
        standIn = false;
      });
    },
    act(action) {
      if (!isFullScreenAction(action)) {
        throw fail(
          'invalid-input',
          'The window:full-screen request was refused, because its action is not toggle, leave or current. Nothing was done.'
        );
      }
      const w = win !== null && !win.isDestroyed() ? win : null;
      if (w === null) return false;
      if (action === 'toggle') return set(w, !isOn(w));
      if (action === 'leave') return set(w, false);
      return isOn(w);
    }
  };
}
