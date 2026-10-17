/**
 * Keeping two ghosts on one line out of each other's way (item 2).
 *
 * A ghost is absolutely positioned above its own words and is as wide as its
 * text, so two suggestions close together on the same line can overlap even
 * though the words below them do not. There is no CSS answer to that: it
 * depends on where the line broke, which only the layout knows.
 *
 * So the ghosts are measured once the layout has settled, and any ghost that
 * would run into the next one on the same line is given a max width and clipped
 * with an ellipsis. The full text is still in the tooltip and in the suggestions
 * list, which is where the author reads a long suggestion anyway. Clipping
 * changes no geometry that the prose depends on, so this cannot loop.
 */

/** Breathing room between one ghost and the next. */
const GAP = 10;

/** Below this a clipped ghost says nothing at all, so it is not worth clipping. */
const MIN_WIDTH = 22;

/** Same line when the tops agree to within this many pixels. */
const LINE_TOLERANCE = 3;

export function clipGhosts(prose: HTMLElement | null): void {
  if (!prose) return;
  const rows = [...prose.querySelectorAll<HTMLElement>('.hunk__above')];
  for (const row of rows) {
    const ghost = row.querySelector<HTMLElement>('.hunk__ghost');
    if (ghost) ghost.style.maxWidth = '';
    row.classList.remove('hunk__above--clipped');
  }
  if (rows.length < 2) return;

  const measured = rows
    .map((row) => ({ row, rect: row.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0)
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

  for (let i = 0; i < measured.length - 1; i += 1) {
    const current = measured[i];
    const next = measured[i + 1];
    if (!current || !next) continue;
    if (Math.abs(current.rect.top - next.rect.top) > LINE_TOLERANCE) continue;
    if (current.rect.right + GAP <= next.rect.left) continue;

    const ghost = current.row.querySelector<HTMLElement>('.hunk__ghost');
    if (!ghost) continue;
    // The row also holds the x after the ghost, which always keeps its room
    // now (round 4, item 2), so the ghost gets what is left after it.
    const trailing = current.rect.width - ghost.getBoundingClientRect().width;
    const available = next.rect.left - GAP - current.rect.left - trailing;
    ghost.style.maxWidth = `${Math.max(MIN_WIDTH, Math.round(available))}px`;
    current.row.classList.add('hunk__above--clipped');
  }
}
