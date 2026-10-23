import { create } from 'zustand';
import type { ChangeCategory } from '../../shared/types';

/**
 * The category chip the focus was last on (polish.10, PLAN 7): the Actions
 * menu lists Accept all and Dismiss all for its category, beside the chip's
 * own menu. A chip's toggle sets it as it takes the focus, by Tab or a click.
 * It is kept while the focus stays in the toolbar, so Tab or a click can take
 * it from the chip to Actions, and forgotten once the focus goes anywhere
 * else in the page (`toolbarFocusLeft`, from the toolbar's `onBlur` and
 * `watchToolbarFocus`). A window that loses the focus keeps it, as the focus
 * comes back to the same place. No DOM here, so it is tested in node.
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

/** A page event as `watchToolbarFocus` reads it: where it happened. */
interface PageEvent {
  readonly target: unknown;
}

/** What `watchToolbarFocus` needs of the page: `document` in the app, a stand-in in the tests. */
export interface WatchedPage {
  readonly activeElement: unknown;
  readonly body: unknown;
  hasFocus(): boolean;
  addEventListener(
    type: 'focusin' | 'pointerdown',
    listener: (event: PageEvent) => void,
    capture: boolean
  ): void;
  removeEventListener(
    type: 'focusin' | 'pointerdown',
    listener: (event: PageEvent) => void,
    capture: boolean
  ): void;
}

/**
 * The toolbar's `onBlur` misses one way out (polish.10 review). A menu open in
 * it, a chip's or Actions, closes on a press outside before the press moves
 * the focus, and so its focused item leaves the page first: Chromium blurs it
 * as it goes, but React passes on no event while it is changing the page, and
 * the focus then moves from nothing, which no element of the toolbar sees. So
 * the toolbar watches the page as well (from Toolbar, with `inToolbar` its
 * header's `contains`): a focus that arrives outside the toolbar forgets the
 * chip, and so does a press outside it once the press has moved the focus,
 * or kept it where it was, unless the focus is then in the toolbar. In the
 * capture phase, so a press that a handler stops still counts. Returns what
 * stops watching.
 */
export function watchToolbarFocus(page: WatchedPage, inToolbar: (target: unknown) => boolean): () => void {
  let settle: ReturnType<typeof setTimeout> | undefined;
  const onFocusIn = (event: PageEvent): void => {
    if (!inToolbar(event.target)) toolbarFocusLeft(false, page.hasFocus());
  };
  const onPress = (event: PageEvent): void => {
    if (inToolbar(event.target)) return;
    clearTimeout(settle);
    // After the press's own focus move, which comes once its events are sent.
    settle = setTimeout(() => {
      const active = page.activeElement;
      toolbarFocusLeft(active === null || active === page.body ? null : inToolbar(active), page.hasFocus());
    }, 0);
  };
  page.addEventListener('focusin', onFocusIn, true);
  page.addEventListener('pointerdown', onPress, true);
  return () => {
    clearTimeout(settle);
    page.removeEventListener('focusin', onFocusIn, true);
    page.removeEventListener('pointerdown', onPress, true);
  };
}
