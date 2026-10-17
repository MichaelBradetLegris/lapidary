import { activeHunks } from './diff/compose';
import type { Paragraph } from './text/paragraphs';
import type { Hunk } from './types';

export type RenderSegment = { kind: 'text'; text: string } | { kind: 'hunk'; hunk: Hunk; text: string };

export interface RenderBlock {
  /** stable key for React */
  key: string;
  /** paragraph indices this block covers; -1 for frontmatter */
  paragraphs: number[];
  isFrontmatter: boolean;
  start: number;
  end: number;
  segments: RenderSegment[];
}

/**
 * Lay the base text out as blocks of plain runs and hunks, ready for the review
 * pane. Every character between a block's start and end comes straight from
 * `base`, so the offsets a hunk carries stay meaningful and no Markdown is
 * converted to HTML.
 *
 * Paragraphs normally become one block each. When a hunk straddles the blank
 * line between two paragraphs, which is how a whole-paragraph deletion is
 * represented, those paragraphs merge into one block so the hunk stays whole.
 * That includes a hunk that starts inside the blank line itself, which is how
 * deleting the last paragraph of a chapter from its editor is stored (Phase 5d):
 * without it, such a hunk belongs to neither block and is never drawn.
 */
export function buildRenderBlocks(
  base: string,
  paragraphs: readonly Paragraph[],
  hunks: readonly Hunk[]
): RenderBlock[] {
  const active = activeHunks(hunks);
  const blocks: RenderBlock[] = [];

  const frontmatter = paragraphs.find((p) => p.isFrontmatter);
  if (frontmatter) {
    blocks.push({
      key: 'frontmatter',
      paragraphs: [-1],
      isFrontmatter: true,
      start: frontmatter.start,
      end: frontmatter.end,
      segments: [{ kind: 'text', text: base.slice(frontmatter.start, frontmatter.end) }]
    });
  }

  const body = paragraphs.filter((p) => !p.isFrontmatter);
  let i = 0;
  while (i < body.length) {
    const first = body[i];
    if (!first) break;
    const indices = [first.index];
    let end = first.end;

    for (;;) {
      const next = body[i + 1];
      if (!next) break;
      const reachesIn = active.some((h) => h.start < next.start && h.end > end);
      if (!reachesIn) break;
      i += 1;
      indices.push(next.index);
      end = next.end;
    }

    blocks.push({
      key: `p${first.index}`,
      paragraphs: indices,
      isFrontmatter: false,
      start: first.start,
      end,
      segments: segmentsIn(base, active, first.start, end)
    });
    i += 1;
  }

  return blocks;
}

function segmentsIn(base: string, active: readonly Hunk[], start: number, end: number): RenderSegment[] {
  const segments: RenderSegment[] = [];
  let cursor = start;
  for (const hunk of active) {
    if (hunk.start < start || hunk.end > end) continue;
    if (hunk.start < cursor) continue;
    if (hunk.start > cursor) segments.push({ kind: 'text', text: base.slice(cursor, hunk.start) });
    segments.push({ kind: 'hunk', hunk, text: base.slice(hunk.start, hunk.end) });
    cursor = hunk.end;
  }
  if (cursor < end) segments.push({ kind: 'text', text: base.slice(cursor, end) });
  return segments;
}

/**
 * Which text the ghost above the line is showing. An accepted hunk has swapped,
 * so its ghost is the original the author is replacing; otherwise the ghost is
 * the suggestion. The renderer colours and labels the two roles differently so
 * the swap can never be misread (plan 7, item 6).
 */
export type GhostRole = 'original' | 'suggestion';

export function ghostRole(hunk: Hunk): GhostRole {
  return hunk.status === 'accepted' ? 'original' : 'suggestion';
}

/** The two strings a hunk shows: what is in the line now, and the ghost above it. */
export function hunkFaces(hunk: Hunk): { live: string; ghost: string; role: GhostRole } {
  const live = hunk.status === 'accepted' ? hunk.replacement : hunk.original;
  const ghost = hunk.status === 'accepted' ? hunk.original : hunk.replacement;
  return { live, ghost, role: ghostRole(hunk) };
}
