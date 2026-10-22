import { create } from 'zustand';
import type { ChangeCategory } from '../../shared/types';

/**
 * The category chip the focus was last on (polish.10, PLAN 7): the Actions
 * menu lists Accept all and Dismiss all for its category, beside the chip's
 * own menu. A chip's toggle sets it as it takes the focus, by Tab or a click.
 * It is kept while the focus stays in the toolbar, so Tab or a click can take
 * it from the chip to Actions, and forgotten once the focus goes anywhere
 * else in the page (`toolbarFocusLeft`). A window that loses the focus keeps
 * it, as the focus comes back to the same place. No DOM here, so it is tested
 * in node.
 */
export const useChipFocus = create<{ category: ChangeCategory | null }>(() => ({ category: null }));

/** A chip took the focus. */
export function chipFocused(category: ChangeCategory): void {
  useChipFocus.setState({ category });
}

/**
 * The toolbar's `onBlur`: the focus left something in it, for something else
 * in the toolbar (`intoToolbar` true), something elsewhere in the page (false)
 * or nothing (null), as when a click lands on what takes no focus, or the
 * window itself loses the focus (`windowFocused` false then). The chip is
 * forgotten unless the focus stayed in the toolbar or the window lost it.
 */
export function toolbarFocusLeft(intoToolbar: boolean | null, windowFocused: boolean): void {
  if (intoToolbar === true) return;
  if (intoToolbar === null && !windowFocused) return;
  if (useChipFocus.getState().category !== null) useChipFocus.setState({ category: null });
}
