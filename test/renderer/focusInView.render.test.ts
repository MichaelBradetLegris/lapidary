import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusInView } from '../../src/renderer/state/scroll';

/* setup.19 review: Done takes the focus without scrolling once the ChatGPT
   sign-in has succeeded, or a check finds Claude ready, but on a page taller
   than the window (a short window, a large zoom, OpenAI's welcome up) it was
   below the fold, focused where the author could not see it. `focusInView`
   focuses it, then brings it up only when it is not wholly in view. The tests
   run without a DOM, so the Setup screen's scroller and Done are stand-ins
   that hold their boxes, the window's reduced-motion query is stubbed so a
   scroll lands at once, and the scroller's box moves its children as
   scrollTop changes, as a real one does. This file is type-checked with the
   renderer's project (tsconfig.web.json), as a `.render.test.ts` is. */

/** A scroller 500 px high from y = 40, holding a page `pageHeight` high. */
function page(pageHeight: number): HTMLElement {
  return {
    scrollTop: 0,
    clientHeight: 500,
    scrollHeight: pageHeight,
    getBoundingClientRect: () => ({ top: 40, bottom: 540, height: 500 })
  } as unknown as HTMLElement;
}

/** A button 28 px high at `offset` from the top of the page in `scroller`. */
function done(scroller: HTMLElement, offset: number): HTMLElement & { focused: unknown[] } {
  const focused: unknown[] = [];
  return {
    focused,
    focus: (options?: FocusOptions) => focused.push(options),
    getBoundingClientRect: () => {
      const top = 40 + offset - scroller.scrollTop;
      return { top, bottom: top + 28, height: 28 };
    }
  } as unknown as HTMLElement & { focused: unknown[] };
}

beforeEach(() => {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('focusInView: Done focused, and brought into view only when it is not (setup.19 review)', () => {
  it('leaves a page that shows Done where it is, the status card in view', () => {
    const scroller = page(700);
    const button = done(scroller, 400);
    focusInView(button, scroller);
    expect(button.focused).toEqual([{ preventScroll: true }]);
    expect(scroller.scrollTop).toBe(0);
  });

  it('brings Done up from below the fold of a scroller shorter than the page, just far enough', () => {
    // As the review measured at 150%: the scroller ends at 540, Done starts about 90 px below it.
    const scroller = page(800);
    const button = done(scroller, 594);
    focusInView(button, scroller);
    expect(button.focused).toEqual([{ preventScroll: true }]);
    // Done's foot 24 px above the scroller's, the app's margin, and no further.
    expect(scroller.scrollTop).toBe(594 + 28 - 500 + 24);
    const box = button.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(40);
    expect(box.bottom).toBeLessThanOrEqual(540);
  });

  it('brings up a Done half under the fold, as at 125%', () => {
    const scroller = page(560);
    const button = done(scroller, 486);
    focusInView(button, scroller);
    // 486 + 28 - 500 + 24: the margin below Done, though the page could go 60 further.
    expect(scroller.scrollTop).toBe(38);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(540);
  });

  it('focuses Done even with no scroller to move, and does nothing without a button', () => {
    const scroller = page(800);
    const button = done(scroller, 594);
    focusInView(button, null);
    expect(button.focused).toEqual([{ preventScroll: true }]);
    expect(scroller.scrollTop).toBe(0);
    expect(() => focusInView(null, scroller)).not.toThrow();
    expect(scroller.scrollTop).toBe(0);
  });
});
