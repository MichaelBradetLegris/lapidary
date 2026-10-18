import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GHOST_GAP,
  GHOST_LINE_TOLERANCE,
  GHOST_MIN_WIDTH,
  ghostMaxWidths,
  type GhostRow
} from '../../src/shared/ui/ghosts';

/* ui.2 (found by the M5 review): a long inserted sentence's ghost was laid out
   on one line and gave the manuscript pane a horizontal scrollbar. A ghost now
   stops at the right edge of the prose, clipped as a ghost that would run into
   the next one on its line already was (Phase 5b item 2). The measuring is in
   src/renderer/state/ghosts.ts and checked in test/renderer/ghosts.test.ts. */

const EDGE = 700;
const TRAILING = 18;

/** A row on the line at `top`, from `left`, holding a ghost `ghost` px wide and the x. */
function row(left: number, ghost: number, top = 100): GhostRow {
  return { top, left, right: left + ghost + TRAILING, trailing: TRAILING };
}

describe('ghostMaxWidths (ui.2)', () => {
  it('leaves alone a ghost that fits', () => {
    expect(ghostMaxWidths([row(100, 200)], EDGE)).toEqual([null]);
  });

  it('lets a row end exactly at the edge', () => {
    expect(ghostMaxWidths([row(100, EDGE - 100 - TRAILING)], EDGE)).toEqual([null]);
  });

  it('stops a long ghost at the right edge of the prose, leaving room for its x', () => {
    // A 40-word insertion halfway along a line: about 1,000 px of ghost.
    const [width] = ghostMaxWidths([row(303, 1000)], EDGE);
    expect(width).toBe(EDGE - 303 - TRAILING);
    expect(303 + (width ?? 0) + TRAILING).toBeLessThanOrEqual(EDGE);
  });

  it('rounds down, so a clipped row never ends past the edge by a fraction', () => {
    expect(ghostMaxWidths([row(100.6, 900)], EDGE)).toEqual([Math.floor(EDGE - 100.6 - TRAILING)]);
  });

  it('still clips a ghost that would run into the next one on its line', () => {
    const widths = ghostMaxWidths([row(100, 300), row(250, 80)], EDGE);
    expect(widths).toEqual([250 - GHOST_GAP - 100 - TRAILING, null]);
  });

  it('clips the last ghost on a line at the edge and the one before it at its neighbour', () => {
    const widths = ghostMaxWidths([row(100, 300), row(250, 900)], EDGE);
    expect(widths).toEqual([250 - GHOST_GAP - 100 - TRAILING, EDGE - 250 - TRAILING]);
  });

  it('takes the nearer of the next ghost and the edge', () => {
    expect(ghostMaxWidths([row(100, 900), row(EDGE + GHOST_GAP + 5, 10)], EDGE)[0]).toBe(
      EDGE - 100 - TRAILING
    );
    expect(ghostMaxWidths([row(100, 900), row(EDGE - 50, 10)], EDGE)[0]).toBe(
      EDGE - 50 - GHOST_GAP - 100 - TRAILING
    );
  });

  it('never cuts a ghost narrower than the minimum, even at the very edge', () => {
    expect(ghostMaxWidths([row(EDGE - 4, 300)], EDGE)).toEqual([GHOST_MIN_WIDTH]);
    expect(ghostMaxWidths([row(100, 300), row(105, 10)], EDGE)[0]).toBe(GHOST_MIN_WIDTH);
  });

  it('does not compare rows on different lines', () => {
    const widths = ghostMaxWidths([row(100, 300, 100), row(150, 100, 140)], EDGE);
    expect(widths).toEqual([null, null]);
  });

  it('treats tops within the tolerance as one line, whichever is higher', () => {
    // The right-hand row sits a pixel higher; it is still the left one's neighbour.
    const widths = ghostMaxWidths([row(100, 300, 100), row(250, 80, 100 - GHOST_LINE_TOLERANCE)], EDGE);
    expect(widths).toEqual([250 - GHOST_GAP - 100 - TRAILING, null]);
  });

  it('answers in the order the rows were given', () => {
    const rows = [row(250, 900, 140), row(100, 50, 100), row(100, 900, 140)];
    expect(ghostMaxWidths(rows, EDGE)).toEqual([
      EDGE - 250 - TRAILING,
      null,
      250 - GHOST_GAP - 100 - TRAILING
    ]);
  });

  it('keeps every row inside the edge and clear of its neighbour whenever it can (property)', () => {
    const lineArb = fc.array(
      fc.record({ left: fc.integer({ min: 0, max: 680 }), ghost: fc.integer({ min: 1, max: 2000 }) }),
      { minLength: 1, maxLength: 6 }
    );
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 4 }), (lines) => {
        const rows: GhostRow[] = lines.flatMap((line, n) => line.map((r) => row(r.left, r.ghost, 40 * n)));
        const widths = ghostMaxWidths(rows, EDGE);
        expect(widths).toHaveLength(rows.length);
        rows.forEach((r, i) => {
          const width = widths[i] ?? null;
          const ghost = r.right - r.left - r.trailing;
          const end = r.left + (width ?? ghost) + r.trailing;
          const neighbours = rows.filter((o) => o !== r && o.top === r.top && o.left > r.left);
          const nextLeft = Math.min(Infinity, ...neighbours.map((o) => o.left));
          const limit = Math.min(EDGE, nextLeft - GHOST_GAP);
          if (width === null) {
            expect(r.right).toBeLessThanOrEqual(limit);
          } else {
            expect(width).toBeGreaterThanOrEqual(GHOST_MIN_WIDTH);
            // Only the minimum may leave a clipped row past its limit.
            if (width > GHOST_MIN_WIDTH) {
              expect(width).toBeLessThan(ghost);
              expect(end).toBeLessThanOrEqual(limit);
            }
          }
        });
      })
    );
  });
});
