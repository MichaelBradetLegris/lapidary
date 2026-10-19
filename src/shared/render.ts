import { activeHunks } from './diff/compose';
import type { Paragraph } from './text/paragraphs';
import type { Hunk } from './types';
import { isSmallText, whitespaceName } from './ui/small';

/**
 * A run of a block: plain text, or one suggestion. A suggestion's
 * `flushBefore` and `flushAfter` say that its neighbour on that side is too
 * close to reach over: another suggestion, or plain text shorter than two
 * code points, as a single space between two suggestions is (11.7,
 * `small.4`). The capsule and the hit zone under small text pull back to the
 * suggestion's own edge there, so neither covers a touching suggestion.
 */
export type RenderSegment =
  | { kind: 'text'; text: string }
  | { kind: 'hunk'; hunk: Hunk; text: string; flushBefore: boolean; flushAfter: boolean };

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
    segments.push({
      kind: 'hunk',
      hunk,
      text: base.slice(hunk.start, hunk.end),
      flushBefore: false,
      flushAfter: false
    });
    cursor = hunk.end;
  }
  if (cursor < end) segments.push({ kind: 'text', text: base.slice(cursor, end) });
  return segments.map((segment, i) =>
    segment.kind === 'hunk'
      ? { ...segment, flushBefore: crowds(segments[i - 1]), flushAfter: crowds(segments[i + 1]) }
      : segment
  );
}

/** A neighbour a suggestion's capsule must not reach over: another suggestion, or text under 2 characters. */
function crowds(neighbour: RenderSegment | undefined): boolean {
  if (!neighbour) return false;
  return neighbour.kind === 'hunk' || [...neighbour.text].length < 2;
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

/** A small side of a change in its box (the keycap): the character, or the name of what cannot be seen. */
export interface GhostKey {
  text: string;
  /** a name, such as "space", drawn in small caps */
  name: boolean;
}

/**
 * What the ghost row shows, in order: the role label ("was", "added", or an
 * arrow), the "delete" tag of a deletion still on offer, then the ghost's own
 * text, or, when that text is small, a box holding it (11.7, `small.4`).
 */
export interface GhostContent {
  role: GhostRole;
  label: 'was' | 'added' | 'arrow';
  tag: 'delete' | null;
  key: GhostKey | null;
  /** the ghost's text when it has no box; empty with a box, after "added" and after "delete" */
  text: string;
}

function keyFor(text: string): GhostKey {
  const name = whitespaceName(text);
  return name ? { text: name, name: true } : { text, name: false };
}

/**
 * The ghost row's content. A small ghost goes in a box, whitespace by its
 * name: "-> [,]", "WAS [-]", "-> [SPACE]". An accepted insertion has no
 * original to show, so it reads "ADDED", with what was added in a box when
 * that is small ("ADDED [,]"). A deletion still on offer reads "-> DELETE",
 * and when what it takes out cannot be seen, its name follows in a box
 * ("-> DELETE [SPACE]"). Anything bigger is shown as it is, as before.
 */
export function ghostContent(hunk: Hunk): GhostContent {
  const { live, ghost, role } = hunkFaces(hunk);
  if (role === 'original') {
    if (ghost.length === 0) {
      return {
        role,
        label: 'added',
        tag: null,
        key: live.length > 0 && isSmallText(live) ? keyFor(live) : null,
        text: ''
      };
    }
    return isSmallText(ghost)
      ? { role, label: 'was', tag: null, key: keyFor(ghost), text: '' }
      : { role, label: 'was', tag: null, key: null, text: ghost };
  }
  if (ghost.length === 0) {
    const name = whitespaceName(live);
    return { role, label: 'arrow', tag: 'delete', key: name ? { text: name, name: true } : null, text: '' };
  }
  return isSmallText(ghost)
    ? { role, label: 'arrow', tag: null, key: keyFor(ghost), text: '' }
    : { role, label: 'arrow', tag: null, key: null, text: ghost };
}
