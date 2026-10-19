import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  normalizeSplit,
  SPLIT_KEYS,
  SPLIT_MIN_ROWS,
  SPLIT_ROW_PX,
  SPLIT_STEP_PX,
  SPLIT_USUAL_SHARE,
  splitAria,
  splitHeight,
  splitKeyAction,
  splitMax,
  splitMin,
  splitMovable,
  splitMove,
  splitRoom,
  splitShare,
  splitTakesKey,
  splitTravel,
  type SplitMeasure,
  type SplitRoom
} from '../../src/shared/ui/split';

/* ui.6: the handle between the side panel's list and the region below. The
   page measures; these are the rules it applies. */

/** The default window at 100% as measured (1424x901 inside): the usual split, 34 suggestions. */
const DEFAULT_WINDOW: SplitMeasure = {
  total: 568.11,
  list: 312.45,
  row: 22,
  listChrome: 37,
  lowerChrome: 20,
  handle: 7
};

const room = (over: Partial<SplitRoom> = {}): SplitRoom => ({ ...splitRoom(DEFAULT_WINDOW), ...over });

const element = (classes: string[], attributes: Record<string, string> = {}) => ({
  classList: { contains: (c: string) => classes.includes(c) },
  getAttribute: (name: string) => attributes[name] ?? null
});

/* The height under the box (CSS px, at 100%, Chapter 01 with 13 categories)
   in the smallest window, 900 by 600 (884x561 inside), with the filter chips
   on two rows and the status bar on two, as measured; and with the chips on
   one row, or on one row with a one-row status bar (C.49's panels less the
   selector, the box and the footer). */
const SMALLEST_TWO_ROWS = 180.11;
const SMALLEST_CHIPS_ONE_ROW = 209.11;
const SMALLEST_ONE_ROW_EACH = 228.11;

describe('the setting (11.3 d)', () => {
  it('keeps a share strictly between 0 and 1, and anything else is the usual split', () => {
    expect(normalizeSplit(0.4)).toBe(0.4);
    expect(normalizeSplit(0.000001)).toBe(0.000001);
    for (const bad of [0, 1, -0.2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0.4', null, undefined, {}]) {
      expect(normalizeSplit(bad)).toBeNull();
    }
  });
});

describe('the limits', () => {
  it('keeps three rows in view on each side of the handle', () => {
    expect(SPLIT_MIN_ROWS).toBe(3);
    const r = splitRoom(DEFAULT_WINDOW);
    // The list: its padding, heading and the space under it, then three rows.
    expect(r.min).toBe(37 + 3 * 22);
    // Below: the handle, the region's padding, and three rows of it.
    expect(r.gap).toBe(7 + 20 + 3 * 22);
    expect(r.current).toBe(312.45);
    expect(splitMin(r)).toBe(r.min);
    expect(splitMax(r)).toBeCloseTo(568.11 - 93, 6);
    expect(splitTravel(r)).toBeCloseTo(568.11 - 196, 6);
  });

  it('measures rows from the list, with 22 px when it has none', () => {
    expect(SPLIT_ROW_PX).toBe(22);
    expect(splitRoom({ ...DEFAULT_WINDOW, row: 30 }).min).toBe(37 + 90);
  });

  it('draws a share as app.css does, the least winning should the limits cross', () => {
    const r = room();
    expect(splitHeight(0.5, r)).toBeCloseTo(284.055, 6);
    expect(splitHeight(0.01, r)).toBe(r.min);
    expect(splitHeight(0.99, r)).toBeCloseTo(splitMax(r), 6);
    // Just short of both minimums: the list keeps its three rows, under 55%.
    const short = room({ total: 191 });
    expect(splitMax(short)).toBe(short.min);
    expect(splitHeight(0.9, short)).toBe(short.min);
    expect(splitHeight(0.01, short)).toBe(short.min);
  });

  it('never gives the list more than the usual split, 55%, in a panel too short for three rows each side (C.59)', () => {
    expect(SPLIT_USUAL_SHARE).toBe(0.55);
    // The smallest window at 100% with the chips and the status bar on two rows each.
    const r = room({ total: SMALLEST_TWO_ROWS, current: 0.55 * SMALLEST_TWO_ROWS });
    expect(r.total).toBeLessThan(r.min + r.gap);
    expect(splitMin(r)).toBeCloseTo(99.06, 2);
    expect(splitMax(r)).toBe(splitMin(r));
    expect(splitTravel(r)).toBe(0);
    // A split set to favour the comments, or the list: the same line as the
    // usual split under a full list, so the region below keeps its 54 px.
    for (const share of [0.01, 0.18, 0.55, 0.84, 0.99]) {
      expect(splitHeight(share, r)).toBeCloseTo(0.55 * SMALLEST_TWO_ROWS, 6);
    }
    // The handle has nowhere to go.
    expect(splitMove(r, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(splitMove(r, Number.POSITIVE_INFINITY)).toBeNull();
    expect(splitMove(r, r.current + SPLIT_STEP_PX)).toBeNull();
  });

  it('moves the handle by the height less both minimums, and not at all in a shorter panel', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 40, max: 3000, noNaN: true }),
        fc.double({ min: 0.000001, max: 0.999999, noNaN: true }),
        (total, share) => {
          const r = room({ total });
          const usualFull = SPLIT_USUAL_SHARE * total;
          expect(splitTravel(r)).toBeCloseTo(Math.max(0, total - r.min - r.gap), 6);
          const height = splitHeight(share, r);
          if (total >= r.min + r.gap) {
            // Room for both: three rows each side, whatever the split.
            expect(height).toBeGreaterThanOrEqual(r.min - 1e-9);
            expect(total - height).toBeGreaterThanOrEqual(r.gap - 1e-9);
          } else {
            // Not: the region below never has less than the usual split leaves it under a full list.
            expect(height).toBeLessThanOrEqual(usualFull + 1e-9);
            expect(height).toBeCloseTo(Math.min(r.min, usualFull), 6);
          }
        }
      )
    );
  });

  it('is a control only where it can move an arrow step (C.59)', () => {
    expect(splitMovable(room())).toBe(true);
    expect(splitMovable(room({ total: 196 + SPLIT_STEP_PX }))).toBe(true);
    expect(splitMovable(room({ total: 196 + SPLIT_STEP_PX - 0.01 }))).toBe(false);
    // The smallest window at 100%: only with the chips and the status bar on one row each.
    expect(splitTravel(room({ total: SMALLEST_ONE_ROW_EACH }))).toBeCloseTo(32.11, 6);
    expect(splitMovable(room({ total: SMALLEST_ONE_ROW_EACH }))).toBe(true);
    expect(splitTravel(room({ total: SMALLEST_CHIPS_ONE_ROW }))).toBeCloseTo(13.11, 6);
    expect(splitMovable(room({ total: SMALLEST_CHIPS_ONE_ROW }))).toBe(false);
    expect(splitMovable(room({ total: SMALLEST_TWO_ROWS }))).toBe(false);
    // C.49's smallest panel with two regions, 356 px, leaves 133 under the box.
    expect(splitMovable(room({ total: 133 }))).toBe(false);
  });

  it('turns a height into a share and back to within a hundredth of a pixel', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 200, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (total, t) => {
          const r = room({ total });
          const height = r.min + t * (splitMax(r) - r.min);
          const share = splitShare(height, r);
          expect(share).toBeGreaterThan(0);
          expect(share).toBeLessThan(1);
          expect(Math.abs(splitHeight(share, r) - height)).toBeLessThan(0.01);
        }
      )
    );
  });
});

describe('moving the handle', () => {
  it('follows the pointer between the limits', () => {
    const r = room();
    expect(splitMove(r, 200)).toBe(200);
    expect(splitMove(r, 10)).toBe(r.min);
    expect(splitMove(r, 2000)).toBeCloseTo(splitMax(r), 6);
  });

  it('does not move for less than half a pixel, or the other way', () => {
    const r = room();
    expect(splitMove(r, r.current)).toBeNull();
    expect(splitMove(r, r.current + 0.3)).toBeNull();
    // A short list under the usual split, under its least: up leaves it, down grows it.
    const short = room({ current: 59 });
    expect(splitMove(short, 30)).toBeNull();
    expect(splitMove(short, Number.NEGATIVE_INFINITY)).toBeNull();
    expect(splitMove(short, 70)).toBe(short.min);
    // A list over its most: down leaves it, up brings it within.
    const tall = room({ current: 500 });
    expect(splitMove(tall, 520)).toBeNull();
    expect(splitMove(tall, 490)).toBeCloseTo(splitMax(tall), 6);
  });

  it('never leaves the limits and never moves against the pointer', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 700, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        (current, target) => {
          const r = room({ current });
          const next = splitMove(r, target);
          if (next === null) return;
          expect(next).toBeGreaterThanOrEqual(r.min);
          expect(next).toBeLessThanOrEqual(splitMax(r));
          expect(Math.sign(next - current)).toBe(Math.sign(target - current));
          expect(Math.abs(next - current)).toBeGreaterThanOrEqual(0.5);
        }
      )
    );
  });
});

describe('the keys', () => {
  it('moves 24 px with the arrows, to the limits with Home and End, and resets with Enter', () => {
    expect(SPLIT_STEP_PX).toBe(24);
    expect(splitKeyAction({ key: 'ArrowUp' }, 200)).toEqual({ kind: 'move', target: 176 });
    expect(splitKeyAction({ key: 'ArrowDown' }, 200)).toEqual({ kind: 'move', target: 224 });
    expect(splitKeyAction({ key: 'Home' }, 200)).toEqual({ kind: 'move', target: Number.NEGATIVE_INFINITY });
    expect(splitKeyAction({ key: 'End' }, 200)).toEqual({ kind: 'move', target: Number.POSITIVE_INFINITY });
    expect(splitKeyAction({ key: 'Enter' }, 200)).toEqual({ kind: 'reset' });
    const r = room({ current: 200 });
    expect(splitMove(r, Number.NEGATIVE_INFINITY)).toBe(r.min);
    expect(splitMove(r, Number.POSITIVE_INFINITY)).toBeCloseTo(splitMax(r), 6);
  });

  it('leaves other keys, and any with Ctrl, Alt or Cmd, alone', () => {
    for (const key of ['j', 'k', 'a', ' ', 'PageDown', 'Escape', 'Tab']) {
      expect(splitKeyAction({ key }, 200)).toBeNull();
    }
    expect(splitKeyAction({ key: 'ArrowUp', ctrlKey: true }, 200)).toBeNull();
    expect(splitKeyAction({ key: 'ArrowDown', altKey: true }, 200)).toBeNull();
    expect(splitKeyAction({ key: 'Home', metaKey: true }, 200)).toBeNull();
  });

  it('keeps the arrows from the review keys only on the handle, and never j or k', () => {
    const handle = element(['side__split']);
    for (const key of SPLIT_KEYS) expect(splitTakesKey(key, handle)).toBe(true);
    expect(splitTakesKey('j', handle)).toBe(false);
    expect(splitTakesKey('k', handle)).toBe(false);
    expect(splitTakesKey('ArrowDown', element(['row__main']))).toBe(false);
    expect(splitTakesKey('ArrowDown', element(['side__focus-body']))).toBe(false);
    expect(splitTakesKey('ArrowDown', null)).toBe(false);
  });

  it('gives the arrows back to the review keys on a handle that cannot move', () => {
    const still = element(['side__split'], { 'aria-disabled': 'true' });
    for (const key of SPLIT_KEYS) expect(splitTakesKey(key, still)).toBe(false);
  });
});

describe('what a screen reader hears', () => {
  it('gives the list share and its limits as percentages', () => {
    expect(splitAria(room())).toEqual({
      valueMin: 18,
      valueMax: 84,
      valueNow: 55,
      valueText: 'Suggestions 55% of the height'
    });
  });

  it('gives one value, 55% as under the usual split, where the handle cannot move', () => {
    const short = splitAria(room({ total: SMALLEST_TWO_ROWS, current: 99.06 }));
    expect(short).toEqual({
      valueMin: 55,
      valueMax: 55,
      valueNow: 55,
      valueText: 'Suggestions 55% of the height'
    });
    // Shorter still, the least is 55%, under the list's three rows (69%):
    // a list drawn at those rows is reported in range, from 55%.
    const stale = splitAria(room({ total: 150, current: 103 }));
    expect(stale).toEqual({
      valueMin: 55,
      valueMax: 69,
      valueNow: 69,
      valueText: 'Suggestions 69% of the height'
    });
  });

  it('keeps a list under its least, or over its most, within its range', () => {
    const short = splitAria(room({ current: 59 }));
    expect(short.valueNow).toBe(10);
    expect(short.valueMin).toBe(10);
    const tall = splitAria(room({ current: 540 }));
    expect(tall.valueMax).toBe(tall.valueNow);
  });
});
