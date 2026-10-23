/**
 * Margin marks (PLAN 11.7, `small.8`): a bar in the rail beside each line that
 * holds a pending small change, and an arrowhead beside the line where the
 * focused suggestion starts, whatever its size.
 *
 * The left edge is where the eye goes back to on every line, and where
 * proofreaders and change bars put their marks. A small change is only as wide
 * as a comma in the line; its bar is a target 11 by 39 CSS px outside the
 * prose. Decided small changes get no bar, so a worked chapter goes quiet.
 *
 * The marks are placed by CSS anchor positioning: the change's live text is
 * named as an anchor (`markAnchorName`) and the mark, a child of the
 * paragraph, takes its top from it, which follows reflow, zoom and font
 * loading with no measuring pass. Pure (CLAUDE.md rule 4).
 */

import type { RenderSegment } from '../render';
import type { Hunk } from '../types';
import { chipHidden, type RowChip } from './chips';
import { isSmallChange } from './small';

export interface MarginMark {
  /** a bar for a pending small change; the arrowhead for the focused suggestion */
  kind: 'bar' | 'focus';
  hunk: Hunk;
  /** the index of the change's segment in its block, for `markAnchorName` */
  index: number;
}

/**
 * The marks for one block's segments, in order. Focus wins over a bar: the
 * focused change gets the arrowhead only. A stale change is never in the line,
 * and a suggestion whose chip the filter hides is never marked (`chipHidden`).
 */
export function marginMarks(
  segments: readonly RenderSegment[],
  focusedId: string | null,
  hidden: readonly RowChip[] = []
): MarginMark[] {
  const marks: MarginMark[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind !== 'hunk') return;
    const { hunk } = segment;
    if (hunk.anchor === 'stale' || chipHidden(hunk, hidden)) return;
    if (hunk.id === focusedId) marks.push({ kind: 'focus', hunk, index });
    else if (hunk.status === 'pending' && isSmallChange(hunk)) marks.push({ kind: 'bar', hunk, index });
  });
  return marks;
}

/**
 * The anchor name of a block's segment, a dashed ident: "--mark-p12-3". A
 * block key is escaped to letters, digits and hyphens, every other character
 * (the underscore included) as "_<hex>_", so two keys never share a name and
 * any key gives a name CSS accepts.
 */
export function markAnchorName(blockKey: string, index: number): string {
  const safe = [...blockKey]
    .map((ch) => (/^[A-Za-z0-9-]$/.test(ch) ? ch : `_${(ch.codePointAt(0) ?? 0).toString(16)}_`))
    .join('');
  return `--mark-${safe}-${index}`;
}
