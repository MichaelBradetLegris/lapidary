import type { ReadingRange } from '../../shared/ui/navigate';
import { easeOutCubic, retarget, scrollDuration, type ScrollBlock } from '../../shared/ui/scroll';

/**
 * Every scroll the app makes on the author's behalf goes through here (round 4,
 * item 3): to a focused suggestion, a find match, a commented paragraph, or a
 * paragraph opened for editing. The timing lives in `shared/ui/scroll.ts`.
 *
 * A new scroll on the same scroller cancels the one in flight and starts from
 * wherever the page is at that moment, so rapid j/k or Enter in the find bar
 * always lands on the last thing asked for. Whether a box needs a scroll at all
 * is judged where the scroll in flight will leave it, not where it is mid-way
 * (`retarget`).
 */

const inFlight = new WeakMap<HTMLElement, number>();
/** Where each scroll in flight will stop. */
const landing = new WeakMap<HTMLElement, number>();

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Animate a scroller to an absolute `scrollTop`, or, with `axis` 'left', to an
 * absolute `scrollLeft`, as the category chips' ‹ and › do (polish.10).
 */
export function scrollContainerTo(container: HTMLElement, to: number, axis: 'top' | 'left' = 'top'): void {
  const previous = inFlight.get(container);
  if (previous !== undefined) cancelAnimationFrame(previous);
  inFlight.delete(container);
  landing.delete(container);

  const read = (): number => (axis === 'top' ? container.scrollTop : container.scrollLeft);
  const write = (value: number): void => {
    if (axis === 'top') container.scrollTop = value;
    else container.scrollLeft = value;
  };
  const from = read();
  const distance = to - from;
  const duration = reducedMotion() ? 0 : scrollDuration(distance);
  if (duration === 0) {
    write(to);
    return;
  }

  const started = performance.now();
  const frame = (now: number): void => {
    const t = (now - started) / duration;
    write(from + distance * easeOutCubic(t));
    if (t < 1) {
      inFlight.set(container, requestAnimationFrame(frame));
    } else {
      inFlight.delete(container);
      landing.delete(container);
    }
  };
  inFlight.set(container, requestAnimationFrame(frame));
  // Where a vertical scroll will stop, for `scrollRectIntoView`.
  if (axis === 'top') landing.set(container, to);
}

/** The manuscript scroller, or whatever scrolls the element if it lives elsewhere. */
function scrollerOf(element: Element): HTMLElement | null {
  const center = element.closest('.center');
  if (center instanceof HTMLElement) return center;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** Scroll a box, given in viewport coordinates, into place inside a scroller. */
export function scrollRectIntoView(
  container: HTMLElement,
  rect: Pick<DOMRect, 'top' | 'height'>,
  block: ScrollBlock
): void {
  const box = container.getBoundingClientRect();
  const top = retarget({
    scrollTop: container.scrollTop,
    landing: landing.get(container) ?? container.scrollTop,
    viewHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    boxTop: rect.top - box.top,
    boxHeight: rect.height,
    block
  });
  if (top !== null) scrollContainerTo(container, top);
}

/** Scroll an element into place with the app's timing instead of the browser's. */
export function scrollToElement(element: Element | null | undefined, block: ScrollBlock): void {
  if (!element) return;
  const container = scrollerOf(element);
  if (!container) return;
  scrollRectIntoView(container, element.getBoundingClientRect(), block);
}

/**
 * The base-text offsets of the paragraphs the author can see in `scroller`,
 * from their `data-start` and `data-end`, or null when none is in view. j, k
 * and their Shift forms start from here when the focus is off screen (11.7,
 * small.9). A paragraph partly in view counts.
 */
export function readingRange(scroller: Element | null): ReadingRange | null {
  if (!(scroller instanceof HTMLElement)) return null;
  const box = scroller.getBoundingClientRect();
  let start = Infinity;
  let end = -Infinity;
  for (const para of scroller.querySelectorAll<HTMLElement>('[data-start][data-end]')) {
    const rect = para.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom) continue;
    start = Math.min(start, Number(para.dataset['start']));
    end = Math.max(end, Number(para.dataset['end']));
  }
  return start <= end ? { start, end } : null;
}

/**
 * Keep the focused suggestion's row in view in the side panel's list (panel.1),
 * in the list region or, in a short window, the panel's one scroller. It does
 * not move when it is already wholly in view, so a click on the first or last
 * visible row never slides the list under the pointer; one partly or wholly out
 * of view comes in with a small margin. The suggestion's details are in a box
 * of fixed height above the list (ui.5), which no focus moves, so only the row
 * is followed.
 */
export function followFocus(row: Element | null | undefined): void {
  scrollToElement(row, 'if-needed');
}

/**
 * Give a button the focus without letting the browser scroll to it, then
 * bring it into view in `scroller` only when it is not wholly in view
 * already: the Setup screen's Done, at the foot of a page that can be taller
 * than the window, once the sign-in has succeeded (setup.19 review). A page
 * that shows Done keeps still, the status card that says so where it was;
 * one that does not comes up just far enough to show it, with the app's
 * margin and timing (`scrollRectIntoView`, 'if-needed'), so the focus never
 * lands where the author cannot see it.
 */
export function focusInView(
  element: HTMLElement | null | undefined,
  scroller: HTMLElement | null | undefined
): void {
  if (!element) return;
  element.focus({ preventScroll: true });
  if (scroller) scrollRectIntoView(scroller, element.getBoundingClientRect(), 'if-needed');
}
