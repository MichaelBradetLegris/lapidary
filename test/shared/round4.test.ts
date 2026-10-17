import { describe, expect, it } from 'vitest';
import { sortComments, groupComments, gutterComments } from '../../src/shared/ui/comments';
import {
  SCROLL_MAX_MS,
  SCROLL_MIN_MS,
  easeOutCubic,
  retarget,
  scrollDuration,
  scrollTarget
} from '../../src/shared/ui/scroll';
import type { ReviewComment } from '../../src/shared/types';

describe('scroll timing (round 4, item 3)', () => {
  it('does not animate a hop too small to see', () => {
    expect(scrollDuration(0)).toBe(0);
    expect(scrollDuration(2)).toBe(0);
    expect(scrollDuration(-1)).toBe(0);
  });

  it('never takes longer than the ceiling, however far it goes', () => {
    for (const d of [5_000, 50_000, 1_000_000]) expect(scrollDuration(d)).toBe(SCROLL_MAX_MS);
    expect(scrollDuration(-50_000)).toBe(SCROLL_MAX_MS);
  });

  it('is quick for a short hop and never below the floor', () => {
    expect(scrollDuration(40)).toBeGreaterThanOrEqual(SCROLL_MIN_MS);
    expect(scrollDuration(40)).toBeLessThan(SCROLL_MIN_MS + 10);
  });

  it('goes faster the further it has to go', () => {
    const speed = (d: number): number => d / scrollDuration(d);
    const distances = [50, 200, 800, 3_000, 12_000];
    for (let i = 1; i < distances.length; i += 1) {
      expect(speed(distances[i] ?? 0)).toBeGreaterThan(speed(distances[i - 1] ?? 0));
    }
  });

  it('eases out and lands exactly', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(1.5)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('where a scroll stops', () => {
  const view = { scrollTop: 1_000, viewHeight: 600, scrollHeight: 10_000 };

  it('centres a box', () => {
    expect(scrollTarget({ ...view, boxTop: 900, boxHeight: 40, block: 'center' })).toBe(1_000 + 900 - 280);
  });

  it('leaves a box that is already in view alone when asked for nearest', () => {
    expect(scrollTarget({ ...view, boxTop: 200, boxHeight: 40, block: 'nearest' })).toBe(1_000);
  });

  it('moves only as far as needed for nearest, with a margin', () => {
    expect(scrollTarget({ ...view, boxTop: -100, boxHeight: 40, block: 'nearest' })).toBe(1_000 - 124);
    expect(scrollTarget({ ...view, boxTop: 700, boxHeight: 40, block: 'nearest' })).toBe(
      1_000 + 700 + 40 - 600 + 24
    );
  });

  it('keeps the top of a box taller than the view in sight', () => {
    expect(scrollTarget({ ...view, boxTop: 700, boxHeight: 2_000, block: 'nearest' })).toBe(1_000 + 700 - 24);
  });

  it('shrinks the margin for a box that fits the view only without it', () => {
    // 580 in a view of 600 leaves 10 on each side, and the whole box shows.
    expect(scrollTarget({ ...view, boxTop: 30, boxHeight: 580, block: 'nearest' })).toBe(1_000 + 20);
    expect(scrollTarget({ ...view, boxTop: -30, boxHeight: 580, block: 'nearest' })).toBe(1_000 - 40);
  });

  /* panel.1 review: `nearest` moved a row that was wholly in view by up to its
     margin, so a click on the first or last visible row slid the list under the
     pointer, and the next click landed on its neighbour. */
  it('leaves a box wholly in view alone for if-needed, even against an edge', () => {
    expect(scrollTarget({ ...view, boxTop: 0, boxHeight: 22, block: 'nearest' })).toBe(1_000 - 24);
    expect(scrollTarget({ ...view, boxTop: 0, boxHeight: 22, block: 'if-needed' })).toBe(1_000);
    expect(scrollTarget({ ...view, boxTop: 578, boxHeight: 22, block: 'nearest' })).toBe(1_000 + 24);
    expect(scrollTarget({ ...view, boxTop: 578, boxHeight: 22, block: 'if-needed' })).toBe(1_000);
  });

  it('allows a pixel of rounding before if-needed counts a box as out of view', () => {
    expect(scrollTarget({ ...view, boxTop: -0.6, boxHeight: 22, block: 'if-needed' })).toBe(1_000);
    expect(scrollTarget({ ...view, boxTop: 578.8, boxHeight: 22, block: 'if-needed' })).toBe(1_000);
  });

  it('moves a box partly or wholly out of view for if-needed as for nearest', () => {
    for (const box of [
      { boxTop: -10, boxHeight: 22 },
      { boxTop: 590, boxHeight: 22 },
      { boxTop: 900, boxHeight: 22 },
      { boxTop: 700, boxHeight: 2_000 },
      { boxTop: 30, boxHeight: 580 }
    ]) {
      const nearest = scrollTarget({ ...view, ...box, block: 'nearest' });
      expect(nearest).not.toBe(1_000);
      expect(scrollTarget({ ...view, ...box, block: 'if-needed' })).toBe(nearest);
    }
  });

  it('brings the details region back to the details when it was scrolled away from them', () => {
    // The details sit 10 px down a region 356 px high that was scrolled to 1200.
    const region = { scrollTop: 1_200, viewHeight: 356, scrollHeight: 2_400 };
    expect(scrollTarget({ ...region, boxTop: 10 - 1_200, boxHeight: 166, block: 'if-needed' })).toBe(0);
    // Scrolled 5 px, they are still wholly in view and stay put.
    expect(
      scrollTarget({ ...region, scrollTop: 5, boxTop: 10 - 5, boxHeight: 166, block: 'if-needed' })
    ).toBe(5);
  });

  it('never asks for a position the scroller cannot reach', () => {
    expect(scrollTarget({ ...view, scrollTop: 0, boxTop: 10, boxHeight: 20, block: 'center' })).toBe(0);
    expect(scrollTarget({ ...view, scrollTop: 9_300, boxTop: 500, boxHeight: 20, block: 'center' })).toBe(
      9_400
    );
  });
});

describe('a new scroll while one is in flight (panel.1)', () => {
  const view = { viewHeight: 400, scrollHeight: 4_000, boxHeight: 22, block: 'if-needed' as const };

  it('is the same as scrollTarget when nothing is moving, or null when nothing need move', () => {
    expect(retarget({ ...view, scrollTop: 0, landing: 0, boxTop: 500 })).toBe(146);
    expect(retarget({ ...view, scrollTop: 0, landing: 0, boxTop: 300 })).toBeNull();
  });

  it('leaves the scroll in flight alone when its landing keeps the box in view', () => {
    // Moving from 0 to 146: a row at 300 now is at 154 after the landing.
    expect(retarget({ ...view, scrollTop: 0, landing: 146, boxTop: 300 })).toBeNull();
  });

  it('replaces it when the landing would carry a box in view now out of view', () => {
    // A row at 10 now would be at -136 after the landing; it is brought back.
    expect(retarget({ ...view, scrollTop: 0, landing: 146, boxTop: 10 })).toBe(0);
    expect(retarget({ ...view, scrollTop: 60, landing: 146, boxTop: 10 })).toBe(60 + 10 - 24);
  });

  it('leaves a box to a landing that brings it into view', () => {
    // Out of view now, at 450, but at 304 after the landing.
    expect(retarget({ ...view, scrollTop: 0, landing: 146, boxTop: 450 })).toBeNull();
  });
});

describe('comments in reading order (round 4, item 4)', () => {
  const c = (
    id: string,
    paragraph: number | null,
    status: ReviewComment['status'] = 'open'
  ): ReviewComment => ({
    id,
    paragraph,
    category: 'flow',
    text: id,
    status
  });
  // The order a model might send them in.
  const sent = [c('p9', 9), c('whole', null), c('p2', 2), c('p9b', 9), c('p0', 0), c('p5', 5, 'resolved')];

  it('sorts by paragraph, keeps ties in the order they came, and puts chapter-wide ones last', () => {
    expect(sortComments(sent).map((x) => x.id)).toEqual(['p0', 'p2', 'p5', 'p9', 'p9b', 'whole']);
  });

  it('keeps both sidebar lists in that order', () => {
    const groups = groupComments(sent);
    expect(groups.open.map((x) => x.id)).toEqual(['p0', 'p2', 'p9', 'p9b', 'whole']);
    expect(groups.resolved.map((x) => x.id)).toEqual(['p5']);
  });

  it('orders the margin the same way, without the chapter-wide comment', () => {
    expect(gutterComments(sent).map((x) => x.id)).toEqual(['p0', 'p2', 'p5', 'p9', 'p9b']);
  });

  it('does not change the list it was given', () => {
    const copy = [...sent];
    sortComments(sent);
    expect(sent).toEqual(copy);
  });
});
