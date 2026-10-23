import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hunk } from '../../src/shared/types';
import {
  CHIPS_ARROW_WIDTH,
  CHIPS_FIT,
  CHIPS_REVEAL_MARGIN,
  CHIPS_THUMB_MIN,
  chipBulkLabel,
  chipCategories,
  chipMenuLabel,
  chipMenuPlacement,
  chipsEnds,
  chipsIndicator,
  chipsPageLeft,
  chipsRevealLeft,
  chipsView,
  chipsWheelLeft,
  chipTitle,
  sameChipsView,
  WHEEL_LINE_PX,
  type ChipsRow,
  type ChipsWheel
} from '../../src/shared/ui/chips';

/* polish.6: the category chips are one row that scrolls sideways when they do
   not fit. An up-and-down wheel turned over it scrolls it sideways, other
   wheels are left to the browser, and a chip the keyboard reaches comes wholly
   into view. polish.10: the row is in the toolbar, its chips compact, with a
   menu each; it draws no scrollbar, and while the chips overflow, ‹ and › over
   its ends page it and a 2 px line under it shows where it is. */

const wheel = (over: Partial<ChipsWheel> = {}): ChipsWheel => ({
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  shiftKey: false,
  ctrlKey: false,
  ...over
});

/** Thirteen categories in the smallest window at 100%, as measured: 1794 px of chips in 480. */
const ROW: ChipsRow = { scrollLeft: 0, scrollWidth: 1794, clientWidth: 480 };

describe('an up-and-down wheel over the chips (polish.6)', () => {
  it('scrolls the row sideways, down and right going right', () => {
    expect(chipsWheelLeft(wheel(), ROW)).toBe(100);
    expect(chipsWheelLeft(wheel({ deltaY: -100 }), { ...ROW, scrollLeft: 300 })).toBe(200);
  });

  it('stops at either end, and leaves the wheel alone once there', () => {
    const max = ROW.scrollWidth - ROW.clientWidth;
    expect(chipsWheelLeft(wheel({ deltaY: 500 }), { ...ROW, scrollLeft: max - 50 })).toBe(max);
    expect(chipsWheelLeft(wheel(), { ...ROW, scrollLeft: max })).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaY: -100 }), ROW)).toBeNull();
  });

  it('counts a wheel in lines or pages', () => {
    expect(chipsWheelLeft(wheel({ deltaY: 3, deltaMode: 1 }), ROW)).toBe(3 * WHEEL_LINE_PX);
    expect(chipsWheelLeft(wheel({ deltaY: 1, deltaMode: 2 }), ROW)).toBe(ROW.clientWidth);
  });

  it('leaves the wheel to the browser when the chips fit', () => {
    expect(chipsWheelLeft(wheel(), { scrollLeft: 0, scrollWidth: 874, clientWidth: 874 })).toBeNull();
  });

  it('leaves Ctrl and the wheel to zoom, and Shift and the wheel or a sideways wheel to the browser', () => {
    expect(chipsWheelLeft(wheel({ ctrlKey: true }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ shiftKey: true }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 100, deltaY: 0 }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 60, deltaY: 40 }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 40, deltaY: 60 }), ROW)).toBe(60);
  });

  it('never takes the row past its ends, and moves it only the way the wheel turns', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.constantFrom(0, 1, 2),
        (clientWidth, extra, at, deltaY, deltaMode) => {
          // The bound is the row's own, scrollWidth - clientWidth, as the
          // function computes it: in floating point (clientWidth + extra) -
          // clientWidth can sit a few ulps from `extra`, which once failed this
          // property on about one seed in a hundred (seed 11, pinned below).
          const scrollWidth = clientWidth + extra;
          const max = scrollWidth - clientWidth;
          const row = { clientWidth, scrollWidth, scrollLeft: at * max };
          const left = chipsWheelLeft(wheel({ deltaY, deltaMode }), row);
          if (left === null) return;
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left).toBeLessThanOrEqual(max);
          expect(Math.sign(left - row.scrollLeft)).toBe(Math.sign(deltaY));
        }
      )
    );
  });

  it('holds on the rounding case that once failed the property (fast-check seed 11)', () => {
    const clientWidth = 15.93968089542875;
    const extra = 0.5000000000803535;
    const row = { clientWidth, scrollWidth: clientWidth + extra, scrollLeft: 0 };
    const left = chipsWheelLeft(wheel({ deltaY: 0.01250000000200884, deltaMode: 1 }), row);
    expect(left).not.toBeNull();
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(row.scrollWidth - row.clientWidth);
  });
});

describe('a chip the keyboard reaches comes wholly into view (polish.6)', () => {
  it('leaves a chip already in view where it is', () => {
    expect(chipsRevealLeft(ROW, { left: 12, right: 120 })).toBeNull();
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 300 }, { left: 400, right: 700 })).toBeNull();
  });

  it('brings in a chip cut off at the right edge, with the row padding beside it', () => {
    // "grammar 3" as measured in the smallest window: 439.6 to 518.5 in a 480 px row.
    expect(chipsRevealLeft(ROW, { left: 439.6, right: 518.5 })).toBeCloseTo(
      518.5 + CHIPS_REVEAL_MARGIN - 480,
      6
    );
  });

  it('brings in a chip cut off at the left edge', () => {
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 500 }, { left: 450, right: 560 })).toBe(
      450 - CHIPS_REVEAL_MARGIN
    );
  });

  it('shows the start of a chip wider than the row, and never goes past either end', () => {
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 900 }, { left: 300, right: 900 })).toBe(
      300 - CHIPS_REVEAL_MARGIN
    );
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 0 }, { left: 1700, right: 1782 })).toBe(1794 - 480);
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 900 }, { left: 5, right: 80 })).toBe(0);
  });

  it('always leaves the chip wholly in view when the row has room for it', () => {
    fc.assert(
      fc.property(
        // Room for the widest chip between the two margins, the arrows' since polish.10.
        fc.double({ min: 2 * CHIPS_REVEAL_MARGIN + 90, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 90, noNaN: true }),
        (clientWidth, extra, at, where, width) => {
          const scrollWidth = clientWidth + extra;
          const row = { clientWidth, scrollWidth, scrollLeft: at * extra };
          const left = CHIPS_REVEAL_MARGIN + where * (scrollWidth - 2 * CHIPS_REVEAL_MARGIN - width);
          const chip = { left, right: left + width };
          const next = chipsRevealLeft(row, chip) ?? row.scrollLeft;
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThanOrEqual(extra + 1e-9);
          expect(chip.left).toBeGreaterThanOrEqual(next - 1e-6);
          expect(chip.right).toBeLessThanOrEqual(next + clientWidth + 1e-6);
        }
      )
    );
  });

  it('keeps a chip brought in clear of the arrow over that end (polish.10)', () => {
    expect(CHIPS_REVEAL_MARGIN).toBe(CHIPS_ARROW_WIDTH + 6);
    // Cut off under the right arrow of the smallest window's 434 px row: it comes in clear of it.
    const row = { scrollLeft: 0, scrollWidth: 958, clientWidth: 434 };
    const left = chipsRevealLeft(row, { left: 400, right: 482 });
    expect(left).not.toBeNull();
    expect(482 - (left ?? 0)).toBeCloseTo(434 - CHIPS_REVEAL_MARGIN, 9);
  });
});

describe('the chips, one per category in the text (polish.10)', () => {
  const hunk = (
    category: Hunk['category'],
    anchor: Hunk['anchor'] = 'exact'
  ): Pick<Hunk, 'anchor' | 'category'> => (category === undefined ? { anchor } : { anchor, category });

  it('counts each category of a suggestion in the text, the most first, then by name', () => {
    expect(
      chipCategories([
        hunk('typo'),
        hunk('grammar'),
        hunk('typo'),
        hunk('awkward'),
        hunk('grammar'),
        hunk('spelling', 'stale'),
        hunk(undefined),
        hunk('punctuation', 'fuzzy'),
        hunk('tense', 'ambiguous')
      ])
    ).toEqual([
      ['grammar', 2],
      ['typo', 2],
      ['awkward', 1],
      ['other', 1],
      ['punctuation', 1],
      ['tense', 1]
    ]);
    expect(chipCategories([])).toEqual([]);
    expect(chipCategories([hunk('spelling', 'stale')])).toEqual([]);
  });

  it('names the menu, its items and what a click does', () => {
    expect(chipBulkLabel('accept', 'punctuation')).toBe('Accept all punctuation');
    expect(chipBulkLabel('dismiss', 'word-choice')).toBe('Dismiss all word-choice');
    expect(chipMenuLabel('typo')).toBe('Accept or dismiss all typo');
    expect(chipTitle(false)).toBe(
      'Hide these. Right-click, or press the menu key, for Accept all and Dismiss all.'
    );
    expect(chipTitle(true)).toBe(
      'Show these. Right-click, or press the menu key, for Accept all and Dismiss all.'
    );
  });

  it('opens the menu under the chip, and keeps it in the window', () => {
    expect(chipMenuPlacement({ left: 321, bottom: 31 }, 160, 1424)).toEqual({ left: 321, top: 35 });
    // Near the right edge it moves left, to 4 px from the edge.
    expect(chipMenuPlacement({ left: 800, bottom: 31 }, 160, 884)).toEqual({ left: 720, top: 35 });
    // Never past the left edge.
    expect(chipMenuPlacement({ left: -30, bottom: 31 }, 160, 884)).toEqual({ left: 4, top: 35 });
    expect(chipMenuPlacement({ left: 10, bottom: 31 }, 900, 884)).toEqual({ left: 4, top: 35 });
  });
});

describe('the arrows and the line, while the chips overflow (polish.10)', () => {
  /** The smallest window at 100% with thirteen categories, as measured: 958 px of chips in 434. */
  const SMALL: ChipsRow = { scrollLeft: 0, scrollWidth: 958, clientWidth: 434 };
  const max = SMALL.scrollWidth - SMALL.clientWidth;
  const FITS: ChipsRow = { scrollLeft: 0, scrollWidth: 974, clientWidth: 974 };

  it('shows no arrow and no line while the chips fit', () => {
    expect(chipsEnds(FITS)).toEqual({ start: false, end: false });
    expect(chipsIndicator(FITS, 974)).toBeNull();
    expect(chipsPageLeft(FITS, 1)).toBeNull();
    // Less than a pixel over, as zoom can leave, counts as fitting.
    expect(chipsEnds({ ...FITS, scrollWidth: 974.6 })).toEqual({ start: false, end: false });
    expect(chipsIndicator({ ...FITS, scrollWidth: 974.6 }, 974)).toBeNull();
  });

  it('shows › at the start, both between, and ‹ at the end', () => {
    expect(chipsEnds(SMALL)).toEqual({ start: false, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: 200 })).toEqual({ start: true, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: max })).toEqual({ start: true, end: false });
    // A fractional position within a pixel of an end is at it.
    expect(chipsEnds({ ...SMALL, scrollLeft: 0.4 })).toEqual({ start: false, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: max - 0.4 })).toEqual({ start: true, end: false });
  });

  it('pages by the row less the room kept at each end, and stops at the ends', () => {
    const step = SMALL.clientWidth - 2 * CHIPS_REVEAL_MARGIN;
    expect(chipsPageLeft(SMALL, 1)).toBe(step);
    expect(chipsPageLeft({ ...SMALL, scrollLeft: step }, 1)).toBe(max);
    expect(chipsPageLeft({ ...SMALL, scrollLeft: max }, 1)).toBeNull();
    expect(chipsPageLeft({ ...SMALL, scrollLeft: max }, -1)).toBe(max - step);
    expect(chipsPageLeft(SMALL, -1)).toBeNull();
    // A row narrower than both margins still moves.
    expect(chipsPageLeft({ scrollLeft: 0, scrollWidth: 958, clientWidth: 40 }, 1)).toBe(CHIPS_REVEAL_MARGIN);
  });

  it('draws the thumb as the share in view, where the row stands', () => {
    const share = (434 * 434) / 958;
    expect(chipsIndicator(SMALL, 434)).toEqual({ left: 0, width: share });
    const end = chipsIndicator({ ...SMALL, scrollLeft: max }, 434);
    expect((end?.left ?? 0) + (end?.width ?? 0)).toBeCloseTo(434, 9);
    expect(chipsIndicator({ ...SMALL, scrollLeft: max / 2 }, 434)?.left).toBeCloseTo((434 - share) / 2, 9);
    // Never shorter than its least, however many chips.
    expect(chipsIndicator({ scrollLeft: 0, scrollWidth: 50_000, clientWidth: 100 }, 100)?.width).toBe(
      CHIPS_THUMB_MIN
    );
  });

  it('gives the view as the row stands: the arrows and the thumb on a line as wide as the row', () => {
    expect(chipsView(FITS)).toEqual(CHIPS_FIT);
    expect(chipsView(SMALL)).toEqual({ start: false, end: true, thumb: chipsIndicator(SMALL, 434) });
    expect(chipsView({ ...SMALL, scrollLeft: 200 })).toEqual({
      start: true,
      end: true,
      thumb: chipsIndicator({ ...SMALL, scrollLeft: 200 }, 434)
    });
    expect(chipsView({ ...SMALL, scrollLeft: max })).toMatchObject({ start: true, end: false });
  });

  it('keeps the view it has only for one that draws the same (polish.10 review)', () => {
    const at = (scrollLeft: number) => chipsView({ ...SMALL, scrollLeft });
    expect(sameChipsView(CHIPS_FIT, chipsView(FITS))).toBe(true);
    expect(sameChipsView(at(200), at(200))).toBe(true);
    // Within half a pixel of the thumb's place it draws the same.
    expect(sameChipsView(at(200), at(200.3))).toBe(true);
    // The row overflowing, either arrow, or the thumb a pixel on: drawn again.
    expect(sameChipsView(CHIPS_FIT, at(0))).toBe(false);
    expect(sameChipsView(at(0), at(200))).toBe(false);
    expect(sameChipsView(at(200), at(max))).toBe(false);
    const view = at(200);
    const thumb = view.thumb ?? { left: 0, width: 0 };
    expect(sameChipsView(view, { ...view, thumb: { ...thumb, left: thumb.left + 1 } })).toBe(false);
    expect(sameChipsView(view, { ...view, thumb: { ...thumb, width: thumb.width + 1 } })).toBe(false);
    expect(sameChipsView(view, { ...view, thumb: null })).toBe(false);
    expect(sameChipsView(view, { ...view, start: false })).toBe(false);
    expect(sameChipsView(view, { ...view, end: false })).toBe(false);
  });

  it('keeps the thumb on the line, and moves it the way the row scrolls', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 3000, noNaN: true }),
        (clientWidth, extra, a, b, width) => {
          const scrollWidth = clientWidth + extra;
          const max = scrollWidth - clientWidth;
          const at = (t: number): ChipsRow => ({ clientWidth, scrollWidth, scrollLeft: t * max });
          const one = chipsIndicator(at(Math.min(a, b)), width);
          const two = chipsIndicator(at(Math.max(a, b)), width);
          if (max < 1) {
            expect(one).toBeNull();
            expect(chipsEnds(at(a))).toEqual({ start: false, end: false });
            return;
          }
          for (const thumb of [one, two]) {
            expect(thumb).not.toBeNull();
            expect(thumb?.left ?? -1).toBeGreaterThanOrEqual(0);
            expect((thumb?.left ?? 0) + (thumb?.width ?? 0)).toBeLessThanOrEqual(width + 1e-6);
            expect(thumb?.width ?? 0).toBeGreaterThan(0);
          }
          expect(two?.left ?? 0).toBeGreaterThanOrEqual((one?.left ?? 0) - 1e-9);
          // An arrow shows at each end with chips out of sight that way.
          const ends = chipsEnds(at(a));
          expect(ends.start || ends.end).toBe(true);
        }
      )
    );
  });
});
