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
 * ran first (`defaultPrevented`); unless it was pressed in another dialog,
 * such as the suggestion editor, which floats above every dialog but a
 * question and closes on its own Escape; or unless it ends an IME composition.
 */
export function dialogTakesEscape(event: DialogKey, questionOpen: boolean, inOtherDialog: boolean): boolean {
  return (
    event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && !questionOpen && !inOtherDialog
  );
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
