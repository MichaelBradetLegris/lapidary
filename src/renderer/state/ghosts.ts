import { ghostEdge, ghostMaxWidths } from '../../shared/ui/ghosts';

/**
 * Keeping ghosts out of each other's way and inside the pane (Phase 5b item 2,
 * `ui.2`).
 *
 * A ghost is absolutely positioned above its own words and is as wide as its
 * text, so two suggestions close together on the same line can overlap even
 * though the words below them do not, and a long inserted sentence runs past
 * the pane and gives it a horizontal scrollbar. There is no CSS answer to
 * either: both depend on where the line broke, which only the layout knows.
 *
 * So the ghosts are measured once the layout has settled, and any ghost that
 * would run into the next one on its line, or past the room its row has (the
 * pane's side padding, or the gap before the margin column), is given a max
 * width and clipped with an ellipsis (`ghostEdge` and `ghostMaxWidths` in
 * `src/shared/ui/ghosts.ts` decide how much). The full text is still in the
 * tooltip and in the suggestions list, which is where the author reads a long
 * suggestion anyway. Clipping changes no geometry that the prose depends on, so
 * this cannot loop.
 */
export function clipGhosts(prose: HTMLElement | null): void {
  if (!prose) return;
  const rows = [...prose.querySelectorAll<HTMLElement>('.hunk__above')].map((row) => ({
    row,
    ghost: row.querySelector<HTMLElement>('.hunk__ghost')
  }));
  for (const { row, ghost } of rows) {
    if (ghost) ghost.style.maxWidth = '';
    row.classList.remove('hunk__above--clipped');
  }
  if (rows.length === 0) return;

  // Every measurement first, in one layout, then every change.
  const measured: { row: HTMLElement; ghost: HTMLElement; rect: DOMRect; trailing: number }[] = [];
  for (const { row, ghost } of rows) {
    if (!ghost) continue;
    const rect = row.getBoundingClientRect();
    if (rect.width === 0) continue;
    // The row also holds the x after the ghost, which always keeps its room
    // (round 4, item 2), so the ghost gets what is left after it.
    measured.push({ row, ghost, rect, trailing: rect.width - ghost.getBoundingClientRect().width });
  }
  // The pane clips at its padding box (`overflow-x: clip`), so a row may reach
  // into its side padding but not past it, nor into the margin column's notes.
  const pane = prose.closest<HTMLElement>('.pane') ?? prose;
  const margin = pane.querySelector<HTMLElement>('.gutter');
  const edge = ghostEdge({
    paneRight:
      pane.getBoundingClientRect().right - (parseFloat(getComputedStyle(pane).borderRightWidth) || 0),
    marginLeft: margin ? margin.getBoundingClientRect().left : null
  });

  const widths = ghostMaxWidths(
    measured.map(({ rect, trailing }) => ({ top: rect.top, left: rect.left, right: rect.right, trailing })),
    edge
  );
  measured.forEach(({ row, ghost }, i) => {
    const width = widths[i];
    if (width === null || width === undefined) return;
    ghost.style.maxWidth = `${width}px`;
    row.classList.add('hunk__above--clipped');
  });
}
