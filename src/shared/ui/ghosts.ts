/**
 * Where each ghost has to stop (Phase 5b item 2, `ui.2`). Pure geometry: no DOM
 * types here. `src/renderer/state/ghosts.ts` measures the rows once the layout
 * has settled and applies what this returns.
 *
 * A ghost is absolutely positioned above its own words and is as wide as its
 * text, on one line. Two things can be in its way, and neither is known before
 * layout, since both depend on where the line broke: the next ghost on the same
 * line, and the edge of the room the row has (`ghostEdge`). A long inserted
 * sentence ran far past the pane and gave the manuscript a horizontal scrollbar
 * (`ui.2`). So a ghost that would run into either is given a max width and
 * clipped with an ellipsis. The full text is still in the tooltip and in the
 * suggestions list.
 */

/** Breathing room between one ghost and the next, or the margin column. */
export const GHOST_GAP = 10;

/**
 * Below this a clipped ghost says nothing at all, so none is cut narrower. A
 * ghost with a key (the keycap of a small change, 11.7) is never cut short of
 * the key's right edge instead.
 */
export const GHOST_MIN_WIDTH = 22;

/** Two rows are on the same line when their tops agree to within this many pixels. */
export const GHOST_LINE_TOLERANCE = 3;

/**
 * Room kept between a row and the pane's edge, where the pane clips, so the x
 * never sits on that edge or against the position strip beside it.
 */
export const GHOST_EDGE_MARGIN = 6;

/** One ghost row as laid out: the ghost and the x that trails it. */
export interface GhostRow {
  top: number;
  left: number;
  right: number;
  /** What follows the ghost in its row (the gap and the x), which keeps its room. */
  trailing: number;
  /** The right edge of the ghost's key, from the ghost's left edge, when it has one. */
  keyEnd?: number;
}

/** What bounds the rows on the right, as laid out. */
export interface GhostBounds {
  /** The right edge of the pane's padding box: the pane clips anything past it. */
  paneRight: number;
  /** The left edge of the margin column, or null while it is not shown. */
  marginLeft: number | null;
}

/**
 * How far right a ghost row may reach. Not the edge of the prose's text: a
 * one-word suggestion near the end of a line ran a little past it into the
 * pane's side padding, which makes no scrollbar, and cutting it there turned
 * "watermill" into "water..." (`ui.2` review). So the row may use that padding,
 * up to `GHOST_EDGE_MARGIN` short of the pane's edge, and stops `GHOST_GAP`
 * short of the margin column when there is one, whose notes it would cover.
 */
export function ghostEdge({ paneRight, marginLeft }: GhostBounds): number {
  const pane = paneRight - GHOST_EDGE_MARGIN;
  return marginLeft === null ? pane : Math.min(pane, marginLeft - GHOST_GAP);
}

/**
 * The max width for each row's ghost, in the order given, or null where the row
 * fits as it is. A row stops `GHOST_GAP` short of the next ghost on its line,
 * and at `edge`, the furthest it may reach (`ghostEdge`). Its ghost gets what is
 * left after the trailing x, rounded down, but never less than `GHOST_MIN_WIDTH`,
 * or, for a ghost with a key, never so little that the key is cut (small.7).
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
      const least = current.row.keyEnd === undefined ? GHOST_MIN_WIDTH : Math.ceil(current.row.keyEnd);
      result[current.index] = Math.max(least, Math.floor(available));
    });
  }
  return result;
}
