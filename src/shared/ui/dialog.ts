/**
 * The rules that make a dialog behave as one (ui.1, ui.4): when Escape closes
 * it, what is inert while it is open, and where the focus goes when it
 * closes. Pure, so they are tested in node; the hooks that apply them are in
 * `src/renderer/state/dialog.ts`, and App applies `shellInert`.
 */

/** The toolbar's Settings button, where the focus goes when Settings closes and where it was is gone. */
export const SETTINGS_BUTTON_SELECTOR = '[data-opens="settings"]';

/**
 * The toolbar's Review menu button, the same for Review with AI and Submit
 * manual review, which its With AI and Manual open (ui.4, `polish.7`).
 */
export const REVIEW_BUTTON_SELECTOR = '[data-opens="review"]';

/** The + in the chapter list's header, the same for New chapter (ui.4). */
export const NEW_CHAPTER_BUTTON_SELECTOR = '[data-opens="new-chapter"]';

/** The update card's button (`NotificationCards`): Download, Restart now or Open the release page. */
export const UPDATE_CARD_BUTTON_SELECTOR = '.note--update .note__action';

/**
 * Where the focus goes when Restart now's overlay goes, should the Restart now
 * that was pressed, the card's or About's, have gone (release.9 review): the
 * box of a dialog open under it, which can only be About, else the update
 * card's button, else the toolbar's Settings. Tried in this order
 * (`firstFound`), not the page's, where the toolbar comes first.
 */
export const UPDATE_OVERLAY_FOCUS_FALLBACK: readonly string[] = [
  '.app-shell__dialogs .modal',
  UPDATE_CARD_BUTTON_SELECTOR,
  SETTINGS_BUTTON_SELECTOR
];

/**
 * The first of `selectors`, in their order, that `find` finds, or null: a
 * dialog's fallback for the focus (`useDialogFocus`), one selector or several.
 */
export function firstFound<T>(
  selectors: string | readonly string[],
  find: (selector: string) => T | null
): T | null {
  for (const selector of typeof selectors === 'string' ? [selectors] : selectors) {
    const found = find(selector);
    if (found !== null) return found;
  }
  return null;
}

/** Which of the window's two layers under a question are inert. */
export interface ShellInert {
  /** everything but the dialogs and the question */
  page: boolean;
  /** Settings, New chapter, Review with AI, Submit manual review, Diagnostics and About */
  dialogs: boolean;
}

/**
 * What is inert while a dialog or a question is open (ui.4). The page is,
 * under either, so nothing behind the backdrop can take the focus, a click or
 * a screen reader, and Tab and Shift+Tab, finding nothing else in the window,
 * go round the open dialog's controls, from the last to the first and back.
 * A question is asked over everything, a dialog included, so the dialogs are
 * inert under it too (apply.7 review). The question itself never is. Restart
 * now's overlay (`overlay`, release.9) covers the page and the dialogs while
 * the app is about to close for the installer, so both are inert under it.
 */
export function shellInert(open: { dialog: boolean; question: boolean; overlay?: boolean }): ShellInert {
  const overlay = open.overlay ?? false;
  return { page: open.dialog || open.question || overlay, dialogs: open.question || overlay };
}

/** The parts of a keydown event the Escape rule reads. */
export interface DialogKey {
  key: string;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/** What can be open over a dialog and keep Escape from it. */
export interface OverDialog {
  /** a question (`confirmSpec`) */
  question: boolean;
  /** Restart now's overlay (`updateOverlay`, release.9) */
  overlay: boolean;
}

/**
 * Whether a key closes the dialog: Escape, unless a question is open over it,
 * which takes Escape for itself, or has already answered it when its listener
 * ran first (`defaultPrevented`); unless Restart now's overlay covers it,
 * under which the dialog is inert and stays as it is, so it is still there
 * should the install fail (release.9 review: the overlay is not a
 * `role="dialog"`, so `inOtherDialog` does not see it); unless it was pressed
 * in another dialog (`inOtherDialog`), which is that dialog's to answer; or
 * unless it ends an IME composition. The suggestion editor is no longer such
 * a dialog: it sits under every dialog and is inert while one is open (ui.1
 * review), so no key reaches it then.
 */
export function dialogTakesEscape(event: DialogKey, over: OverDialog, inOtherDialog: boolean): boolean {
  return (
    event.key === 'Escape' &&
    !event.isComposing &&
    !event.defaultPrevented &&
    !over.question &&
    !over.overlay &&
    !inOtherDialog
  );
}

/** The `role="dialog"` element a key was pressed in, as the rule reads it; an `Element` in the page. */
export interface DialogOwner {
  contains(node: unknown): boolean;
}

/**
 * Whether a key was pressed in a dialog other than the one whose box is `box`:
 * `owner` is the nearest `role="dialog"` around where it was pressed, or null
 * when it was pressed outside every dialog. A dialog's own backdrop holds its
 * box, so a key pressed anywhere in the dialog is its own; one pressed in
 * another dialog, such as a question asked over it, is not. With no box to
 * compare, any dialog is another.
 */
export function inOtherDialog(owner: DialogOwner | null, box: unknown): boolean {
  return owner !== null && !(box !== null && box !== undefined && owner.contains(box));
}

/**
 * Where the focus was as a dialog opens, to be handed back there when it
 * closes: what has it now (`active`), unless that is in the dialog itself
 * (`inDialog`), when it is what was noted before (`noted`). A development
 * run's StrictMode opens each dialog twice, with a pretend close between,
 * and the second time the focus is already in the dialog, put there the first
 * time. Noting it then made the dialog's own box the place to hand the focus
 * back to, which has gone by the time the dialog closes, so in a development
 * window every dialog handed the focus to its fallback (found by the release.9
 * review fix). A dialog opened for real never holds the focus before it has
 * taken it: none uses `autoFocus`.
 */
export function focusBeforeOpening<T>(active: T | null, inDialog: boolean, noted: T | null): T | null {
  return inDialog ? noted : active;
}

/** What the focus can be handed back to; an `HTMLElement` in the page. */
export interface Focusable {
  readonly isConnected: boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

/**
 * Where the focus goes when a dialog closes: back where it was when it opened,
 * if that is still on the page, else the fallback, such as the toolbar button
 * that opens the dialog. Settings opened from a button that went with its
 * dialog, as Review with AI's Open Settings did until codex.6 took out the
 * OpenAI key's row, finds the focus on nothing (`body`).
 */
export function focusReturnTarget<T extends Focusable>(
  previous: T | null,
  body: unknown,
  fallback: T | null
): T | null {
  if (previous && previous !== body && previous.isConnected) return previous;
  return fallback?.isConnected ? fallback : null;
}
