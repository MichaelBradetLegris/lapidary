/**
 * The matching half of the Ctrl+F find bar (plan 7, item 11). The renderer walks
 * the prose text nodes and asks this module where the matches are, so the search
 * itself never touches the DOM and never changes hunk offsets.
 */

/** Every start offset of `query` in `text`, case-insensitively, including overlaps. */
export function indexesOf(text: string, query: string): number[] {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    found.push(at);
    from = at + 1;
  }
  return found;
}

/** Wrap around in both directions; -1 when there is nothing to step through. */
export function stepIndex(current: number, count: number, delta: number): number {
  if (count <= 0) return -1;
  return (((current + delta) % count) + count) % count;
}

/** "3 of 12", "No matches", or '' when the box is empty. */
export function matchLabel(index: number, count: number, query: string): string {
  if (query.length === 0) return '';
  if (count === 0) return 'No matches';
  return `${index + 1} of ${count}`;
}
