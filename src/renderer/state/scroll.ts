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

/** Animate a scroller to an absolute `scrollTop`. */
export function scrollContainerTo(container: HTMLElement, top: number): void {
  const previous = inFlight.get(container);
  if (previous !== undefined) cancelAnimationFrame(previous);
  inFlight.delete(container);
  landing.delete(container);

  const from = container.scrollTop;
  const distance = top - from;
  const duration = reducedMotion() ? 0 : scrollDuration(distance);
  if (duration === 0) {
    container.scrollTop = top;
    return;
  }

  const started = performance.now();
  const frame = (now: number): void => {
    const t = (now - started) / duration;
    container.scrollTop = from + distance * easeOutCubic(t);
    if (t < 1) {
      inFlight.set(container, requestAnimationFrame(frame));
    } else {
      inFlight.delete(container);
      landing.delete(container);
    }
  };
  inFlight.set(container, requestAnimationFrame(frame));
  landing.set(container, top);
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
