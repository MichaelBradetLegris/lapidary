/**
 * Full screen (polish.23, PLAN section 7, Full screen): the system's own,
 * `BrowserWindow.setFullScreen` in main, which the page asks for through
 * `window:full-screen` and hears about through `window:full-screen-changed`,
 * never the page's own Fullscreen API. F11 and the toolbar's button before
 * Settings put the window in full screen and back; Escape leaves it when
 * nothing else on the page takes the key. The state is the window's: it is
 * not kept in settings, and a start is never full screen.
 *
 * Pure (CLAUDE.md rule 4).
 */

/**
 * What the page asks of main (`window:full-screen`): `toggle` for F11 and the
 * button, `leave` for Escape, so a page that is behind never enters by
 * mistake, and `current` to learn where the window stands as the page loads,
 * after a reload in full screen too.
 */
export type FullScreenAction = 'toggle' | 'leave' | 'current';

export const FULL_SCREEN_ACTIONS: readonly FullScreenAction[] = ['toggle', 'leave', 'current'];

/** Whether a request names one of `FULL_SCREEN_ACTIONS`; main refuses anything else. */
export function isFullScreenAction(value: unknown): value is FullScreenAction {
  return typeof value === 'string' && (FULL_SCREEN_ACTIONS as readonly string[]).includes(value);
}

/** The key that toggles full screen, as the button's tooltip and `aria-keyshortcuts` name it. */
export const FULL_SCREEN_KEY = 'F11';

/** The button's accessible name and tooltip, by where the window stands. */
export function fullScreenButton(fullScreen: boolean): { label: string; title: string } {
  const label = fullScreen ? 'Leave full screen' : 'Full screen';
  return { label, title: `${label} (${FULL_SCREEN_KEY})` };
}

/** The class the page's shell carries while the window is in full screen. */
export const FULL_SCREEN_CLASS = 'app-shell--full-screen';

/** The parts of a keydown event the rules read. */
export interface FullScreenKey {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** held down: the system sends the key again */
  repeat: boolean;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/**
 * What else on the page takes Escape before full screen does, each of which
 * closes on it (or, for New chapter and Submit manual review, ignores it) in
 * a listener of its own or an earlier step of the keyboard bindings.
 */
export interface EscapeTakers {
  /**
   * a dialog, a question, Settings, the Setup screen, the welcome guide or
   * Restart now's overlay (`isModalOpen`)
   */
  modal: boolean;
  /** a toolbar menu, a chip's menu or the status bar's legend (`popupTakesEscape`) */
  popup: boolean;
  /** a suggestion's hover card */
  hoverCard: boolean;
  /** the find bar */
  find: boolean;
  /** the suggestion editor */
  editor: boolean;
  /** a paragraph box, or Full edit's box, open or waiting to open */
  boxes: boolean;
  /** a drawer open from a folded column */
  drawer: boolean;
}

/**
 * What F11 does: `toggle` alone, wherever the focus is, a text box and a
 * dialog included; `ignore` held down, so the window does not flicker in and
 * out; `pass` with Ctrl, Alt, Shift or the Windows key, and for every other
 * key.
 */
export function fullScreenToggle(event: FullScreenKey): 'toggle' | 'ignore' | 'pass' {
  if (event.key !== FULL_SCREEN_KEY) return 'pass';
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 'pass';
  return event.repeat ? 'ignore' : 'toggle';
}

/**
 * Whether Escape leaves full screen: only in full screen, when nothing in
 * `over` takes it, nothing has already answered it (`defaultPrevented`) and
 * it does not end an IME composition, so a reflex still works and one press
 * closes one thing.
 */
export function escapeLeavesFullScreen(
  event: FullScreenKey,
  fullScreen: boolean,
  over: EscapeTakers
): boolean {
  if (event.key !== 'Escape' || !fullScreen || event.isComposing || event.defaultPrevented) return false;
  return !(
    over.modal ||
    over.popup ||
    over.hoverCard ||
    over.find ||
    over.editor ||
    over.boxes ||
    over.drawer
  );
}
