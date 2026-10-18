/**
 * The rules that make a dialog behave as one (ui.1): when Escape closes it,
 * and where the focus goes when it closes. Pure, so they are tested in node;
 * the hooks that apply them are in `src/renderer/state/dialog.ts`.
 */

/** The toolbar's Settings button, where the focus goes when Settings closes and where it was is gone. */
export const SETTINGS_BUTTON_SELECTOR = '[data-opens="settings"]';

/** The parts of a keydown event the Escape rule reads. */
export interface DialogKey {
  key: string;
  isComposing: boolean;
  defaultPrevented: boolean;
}

/**
 * Whether a key closes the dialog: Escape, unless a question is open over it,
 * which takes Escape for itself, or has already answered it when its listener
 * ran first (`defaultPrevented`); unless it was pressed in another dialog
 * (`inOtherDialog`), which is that dialog's to answer; or unless it ends an
 * IME composition. The suggestion editor is no longer such a dialog: it sits
 * under every dialog and is inert while one is open (ui.1 review), so no key
 * reaches it then.
 */
export function dialogTakesEscape(event: DialogKey, questionOpen: boolean, inOtherDialog: boolean): boolean {
  return (
    event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && !questionOpen && !inOtherDialog
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

/** What the focus can be handed back to; an `HTMLElement` in the page. */
export interface Focusable {
  readonly isConnected: boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

/**
 * Where the focus goes when a dialog closes: back where it was when it opened,
 * if that is still on the page, else the fallback, such as the toolbar button
 * that opens the dialog. Settings opened from Review with AI's Open Settings
 * finds the focus on nothing (`body`), since that button went with its dialog.
 */
export function focusReturnTarget<T extends Focusable>(
  previous: T | null,
  body: unknown,
  fallback: T | null
): T | null {
  if (previous && previous !== body && previous.isConnected) return previous;
  return fallback?.isConnected ? fallback : null;
}
