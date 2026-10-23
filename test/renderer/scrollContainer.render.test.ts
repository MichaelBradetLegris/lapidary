import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollContainerTo } from '../../src/renderer/state/scroll';

/* polish.10: ‹ and › page the category chips' row sideways through the app's
   one scroll helper, which took a sideways axis for them (`scrollContainerTo`,
   PLAN 7). The tests run without a DOM, so the scroller is a stand-in holding
   its two positions, and the window's reduced-motion query and the animation
   frames are stubbed. (polish.10 review: a sideways write that went to
   scrollTop passed every other test.) Nothing is rendered here, but the file
   is type-checked with the renderer's project (tsconfig.web.json), as a
   `.render.test.ts` is, because scroll.ts is written against the DOM's types. */

function scroller(): HTMLElement {
  return { scrollTop: 40, scrollLeft: 0 } as unknown as HTMLElement;
}

function reducedMotion(reduce: boolean): void {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: reduce && query === '(prefers-reduced-motion: reduce)' })
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollContainerTo, sideways for the chips (polish.10)', () => {
  it('moves scrollLeft at once with reduced motion, and leaves scrollTop alone', () => {
    reducedMotion(true);
    const row = scroller();
    scrollContainerTo(row, 300, 'left');
    expect(row.scrollLeft).toBe(300);
    expect(row.scrollTop).toBe(40);
  });

  it('animates scrollLeft to where it was asked, frame by frame, and never touches scrollTop', () => {
    reducedMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => frames.push(frame));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const row = scroller();
    scrollContainerTo(row, 300, 'left');
    // Nothing moves before the first frame.
    expect(row.scrollLeft).toBe(0);
    frames.shift()?.(performance.now() + 50);
    expect(row.scrollLeft).toBeGreaterThan(0);
    expect(row.scrollLeft).toBeLessThan(300);
    expect(row.scrollTop).toBe(40);
    frames.shift()?.(performance.now() + 10_000);
    expect(row.scrollLeft).toBe(300);
    expect(row.scrollTop).toBe(40);
    // Landed: no frame asked for after the last.
    expect(frames).toHaveLength(0);
  });

  it('scrolls up and down when no axis is given, as every other scroll of the app does', () => {
    reducedMotion(true);
    const box = scroller();
    scrollContainerTo(box, 120);
    expect(box.scrollTop).toBe(120);
    expect(box.scrollLeft).toBe(0);
  });
});
