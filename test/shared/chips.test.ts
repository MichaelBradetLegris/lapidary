import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHIPS_REVEAL_MARGIN,
  chipsRevealLeft,
  chipsWheelLeft,
  WHEEL_LINE_PX,
  type ChipsRow,
  type ChipsWheel
} from '../../src/shared/ui/chips';

/* polish.6: the category chips are one row at the top of the centre column
   that scrolls sideways when they do not fit. An up-and-down wheel turned over
   it scrolls it sideways, other wheels are left to the browser, and a chip the
   keyboard reaches comes wholly into view. */

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
        fc.double({ min: 100, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 76, noNaN: true }),
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
});
