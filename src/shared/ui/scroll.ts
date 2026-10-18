/**
 * How long a scroll to somewhere else on the page takes (round 4, item 3).
 *
 * The browser's own smooth scrolling takes longer the further it goes, which
 * made a jump from the top of a chapter to its end feel slow, and a new scroll
 * requested mid-flight could leave the page short of its target. The app now
 * animates scrolls itself: short hops are quick, long jumps go proportionally
 * faster, and nothing ever takes longer than `SCROLL_MAX_MS`.
 */

/** Even the shortest visible hop gets this long, so it reads as movement rather than a jump. */
export const SCROLL_MIN_MS = 110;

/** The ceiling. A jump across a whole chapter takes exactly this long. */
export const SCROLL_MAX_MS = 320;

/** Milliseconds added per pixel of distance before the ceiling applies. */
const MS_PER_PX = 0.12;

/** Below this many pixels the scroll happens at once; animating it would only look like jitter. */
export const SCROLL_INSTANT_PX = 2;

/**
 * Duration for a scroll of `distance` pixels, in either direction. The speed
 * (distance over duration) rises with distance, because the duration grows far
 * more slowly than the distance and then stops growing at all.
 */
export function scrollDuration(distance: number): number {
  const d = Math.abs(distance);
  if (d <= SCROLL_INSTANT_PX) return 0;
  return Math.round(Math.min(SCROLL_MAX_MS, SCROLL_MIN_MS + d * MS_PER_PX));
}

/** Fast start, gentle landing. `t` runs from 0 to 1. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/**
 * Where the scroller must stop so that a box ends up where it was asked to be.
 * `boxTop` and `boxHeight` are measured relative to the scroller's visible top;
 * the result is an absolute `scrollTop`, clamped to what the scroller can reach.
 *
 * `center` puts the box in the middle. `nearest` moves only as far as needed to
 * bring the box fully into view with a small margin, and leaves the page alone
 * when it already is, margin included: a box in view but closer to an edge than
 * the margin moves by up to the margin. The margin shrinks for a box that fits
 * the view only without it, so the whole box still shows; a box taller than the
 * view keeps its top in view, margin and all. `if-needed` leaves a box that is
 * wholly in view where it is, even against an edge, and otherwise moves as
 * `nearest` does. The side panel uses it, so a click on the first or last
 * visible row never slides the list under the pointer (panel.1).
 */
export type ScrollBlock = 'center' | 'nearest' | 'if-needed';

export function scrollTarget(args: {
  scrollTop: number;
  viewHeight: number;
  scrollHeight: number;
  boxTop: number;
  boxHeight: number;
  block: ScrollBlock;
  margin?: number;
}): number {
  const { scrollTop, viewHeight, scrollHeight, boxTop, boxHeight, block } = args;
  const wanted = args.margin ?? 24;
  const margin = boxHeight > viewHeight ? wanted : Math.min(wanted, (viewHeight - boxHeight) / 2);
  let target = scrollTop;

  if (block === 'center') {
    target = scrollTop + boxTop - (viewHeight - boxHeight) / 2;
  } else if (block === 'if-needed' && whollyInView(viewHeight, boxTop, boxHeight)) {
    return scrollTop;
  } else if (boxTop < margin) {
    target = scrollTop + boxTop - margin;
  } else if (boxTop + boxHeight > viewHeight - margin) {
    // A box taller than the view keeps its top in view rather than its bottom.
    target = scrollTop + Math.min(boxTop - margin, boxTop + boxHeight - viewHeight + margin);
  }

  const max = Math.max(0, scrollHeight - viewHeight);
  return Math.round(Math.min(max, Math.max(0, target)));
}

/**
 * `scrollTarget` for a scroller that may already be moving. `landing` is where
 * its scroll in flight will stop (its `scrollTop` when none is), and `boxTop` is
 * measured now. The box is judged where the landing will leave it, so one in
 * view now but about to be carried out still gets its scroll, and one the
 * landing brings into view is left to it. Null means no new scroll is needed.
 */
export function retarget(args: Parameters<typeof scrollTarget>[0] & { landing: number }): number | null {
  const { landing, ...rest } = args;
  const top = scrollTarget({ ...rest, scrollTop: landing, boxTop: rest.boxTop - (landing - rest.scrollTop) });
  return top === landing ? null : top;
}

/**
 * Whether a box, measured as for `scrollTarget`, is wholly inside the visible
 * part of its scroller. A pixel of slack absorbs rounding: element boxes are
 * fractional, while `clientHeight` is a whole number.
 */
export function whollyInView(viewHeight: number, boxTop: number, boxHeight: number): boolean {
  return boxTop >= -1 && boxTop + boxHeight <= viewHeight + 1;
}

/** What the key handler reads of the element a key went to: a DOM element in the app. */
export interface KeyTarget {
  classList: { contains(token: string): boolean };
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Whether ArrowDown or ArrowUp is left to the browser, to scroll the focused
 * suggestion's box (ui.5 review), rather than taken as a review key. A box
 * with more text than it shows is a Tab stop of its own between its pencil
 * and the list, as Chromium makes every scroller with nothing focusable in it,
 * so a keyboard user reaches it to read the rest; there the arrows scroll it,
 * as in any scroller, where they had moved the focus to the next suggestion
 * and sent the box back to its top. j and k still step from it. A click in the
 * box does not focus it, and a box that shows its whole text is no scroller,
 * so the arrows step through the list from everywhere else.
 */
export function arrowsScrollBox(key: string, target: KeyTarget | null): boolean {
  return (
    (key === 'ArrowDown' || key === 'ArrowUp') &&
    target !== null &&
    target.classList.contains('side__focus-body') &&
    target.scrollHeight > target.clientHeight
  );
}
