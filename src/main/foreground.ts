import type { DevSwitches } from './devSwitches';

/**
 * How the window comes on screen and forward, and the quiet test window
 * (`dev.1`, PLAN Appendix C "Quiet test windows").
 *
 * The window takes the foreground when it first shows (C.36), when a second
 * launch finds it running (C.40), and when a close has to ask the page (7.7).
 * A verification run on the author's machine must not do that to whatever the
 * author is working in. Under the development switch
 * `MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW` (`npm run dev:clean -- --quiet`):
 *
 * - the window is shown with `showInactive()`, never `show()`, and nothing
 *   calls `focus()` or `moveTop()`. On Windows `showInactive()` is
 *   `SW_SHOWNOACTIVATE`, which also restores a minimised window, so a second
 *   launch and a close still restore and show it, without the foreground;
 *   `restore()` would activate it. A window first shown this way keeps its
 *   place in the z-order, so a launcher that pushed it to the bottom while it
 *   was still hidden never sees it in front; a minimised one comes back on top
 *   of the others, though not in the foreground;
 * - Chromium's native occlusion calculation is off and so is background
 *   throttling, so a window covered by the author's own windows keeps
 *   rendering: its page stays visible, and the animation frames and timers
 *   a test driver waits on keep coming.
 *
 * A packaged build ignores the switch (src/main/devSwitches.ts). Every
 * call that shows or focuses the window is in this file, which
 * test/main/devSwitches.test.ts checks. No electron import, so the rules are
 * unit-tested directly.
 */

/** The parts of a BrowserWindow this file uses. */
export interface FrontWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
}

/** Chromium's feature that marks a wholly covered window hidden, which stops its frames. */
export const OCCLUSION_FEATURE = 'CalculateNativeWinOcclusion';

/** Switches for Chromium's command line, appended at module scope, before `ready`. */
export function chromiumSwitches(switches: Pick<DevSwitches, 'quietWindow'>): [string, string][] {
  return switches.quietWindow ? [['disable-features', OCCLUSION_FEATURE]] : [];
}

/** `webPreferences.backgroundThrottling`: off for a quiet window, so a covered page keeps its timers and frames. */
export function backgroundThrottling(switches: Pick<DevSwitches, 'quietWindow'>): boolean {
  return !switches.quietWindow;
}

/** The window's first show, on first paint, page load or the timer (C.36). */
export function showWindow(win: Pick<FrontWindow, 'show' | 'showInactive'>, quiet: boolean): void {
  if (quiet) win.showInactive();
  else win.show();
}

/**
 * Restore, show and focus the window: a second launch (C.40) and a close that
 * asks the page (7.7). A quiet window is restored and shown, without the
 * foreground.
 */
export function bringForward(win: FrontWindow, quiet: boolean): void {
  if (quiet) {
    win.showInactive();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
