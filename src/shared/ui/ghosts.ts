/**
 * Where each ghost has to stop (Phase 5b item 2, `ui.2`). Pure geometry: no DOM
 * types here. `src/renderer/state/ghosts.ts` measures the rows once the layout
 * has settled and applies what this returns.
 *
 * A ghost is absolutely positioned above its own words and is as wide as its
 * text, on one line. Two things can be in its way, and neither is known before
 * layout, since both depend on where the line broke: the next ghost on the same
 * line, and the right edge of the prose. A long inserted sentence ran far past
 * that edge and gave the manuscript pane a horizontal scrollbar (`ui.2`). So a
 * ghost that would run into either is given a max width and clipped with an
 * ellipsis. The full text is still in the tooltip and in the suggestions list.
 */

/** Breathing room between one ghost and the next. */
export const GHOST_GAP = 10;

/** Below this a clipped ghost says nothing at all, so none is cut narrower. */
export const GHOST_MIN_WIDTH = 22;

/** Two rows are on the same line when their tops agree to within this many pixels. */
export const GHOST_LINE_TOLERANCE = 3;

/** One ghost row as laid out: the ghost and the x that trails it. */
export interface GhostRow {
  top: number;
  left: number;
  right: number;
  /** What follows the ghost in its row (the gap and the x), which keeps its room. */
  trailing: number;
}

/**
 * The max width for each row's ghost, in the order given, or null where the row
 * fits as it is. A row stops `GHOST_GAP` short of the next ghost on its line,
 * and at `edge`, the right edge of the prose. Its ghost gets what is left after
 * the trailing x, but never less than `GHOST_MIN_WIDTH`.
 */
export function ghostMaxWidths(rows: readonly GhostRow[], edge: number): (number | null)[] {
  const result: (number | null)[] = rows.map(() => null);

  // Group into lines first, then order each line from left to right, so a row
  // whose top is a pixel higher than its left-hand neighbour's still comes after it.
  const byTop = rows.map((row, index) => ({ row, index })).sort((a, b) => a.row.top - b.row.top);
  const lines: (typeof byTop)[] = [];
  for (const entry of byTop) {
    const line = lines[lines.length - 1];
    const first = line?.[0];
    if (line && first && Math.abs(entry.row.top - first.row.top) <= GHOST_LINE_TOLERANCE) line.push(entry);
    else lines.push([entry]);
  }

  for (const line of lines) {
    line.sort((a, b) => a.row.left - b.row.left);
    line.forEach((current, i) => {
      const next = line[i + 1];
      const limit = next ? Math.min(edge, next.row.left - GHOST_GAP) : edge;
      if (current.row.right <= limit) return;
      const available = limit - current.row.left - current.row.trailing;
      result[current.index] = Math.max(GHOST_MIN_WIDTH, Math.floor(available));
    });
  }
  return result;
}
