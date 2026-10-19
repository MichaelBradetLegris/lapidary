import { nextId } from '../ids';
import { bodyStart } from '../text/obsidian';
import { findParagraph, paragraphIndexAt, type Paragraph } from '../text/paragraphs';
import type { AnchorQuality, ChangeCategory, Hunk, HunkSource } from '../types';
import { cleanOccurrences, fuzzyFind } from './fuzzy';
import { trimCommonAffixes } from './trim';

export interface ChangeInput {
  paragraph: number;
  /** text copied verbatim from that paragraph */
  before: string;
  /** '' means delete */
  after: string;
  category?: ChangeCategory;
  reason?: string;
}

export interface AnchorOptions {
  /** how many paragraphs either side to search when the stated one does not match */
  neighborRadius?: number;
  /** diff-match-patch Match_Threshold */
  fuzzyThreshold?: number;
  /** reject a fuzzy match whose edit distance ratio exceeds this */
  maxDistanceRatio?: number;
  source?: HunkSource;
  /**
   * Run on the located hunks before overlaps are resolved, so a hunk it takes
   * off the page never pushes another off as an overlap. `createAiReview`
   * passes the guard (`screenModelHunks`, `files.7`), which keeps out a
   * suggestion that would change Obsidian syntax.
   */
  screen?: (hunks: Hunk[]) => Hunk[];
}

interface Located {
  start: number;
  end: number;
  text: string;
  anchor: AnchorQuality;
}

const DEFAULTS = {
  neighborRadius: 2,
  fuzzyThreshold: 0.3,
  maxDistanceRatio: 0.2,
  source: 'claude' as HunkSource
};

/**
 * Turn Claude's change list into hunks anchored in `base`.
 *
 * Order of attack, from the plan section 4.3: exact inside the stated paragraph,
 * exact inside its neighbours, fuzzy against the whole text, then stale. The
 * span is trimmed to the differing words, no-op changes are dropped, the
 * hunks are screened when a `screen` is given, and hunks that would overlap
 * an earlier one are demoted to stale.
 */
export function anchorChanges(
  base: string,
  paragraphs: readonly Paragraph[],
  changes: readonly ChangeInput[],
  options: AnchorOptions = {}
): Hunk[] {
  const { screen, ...rest } = options;
  const opts = { ...DEFAULTS, ...rest };
  const body = bodyStart(base);
  const anchored: Hunk[] = [];
  const stale: Hunk[] = [];

  for (const change of changes) {
    const located = locate(base, paragraphs, change, opts, body);
    if (!located) {
      stale.push(makeStale(change, opts.source, 'Could not find this text in the chapter.'));
      continue;
    }

    const trimmed = trimCommonAffixes(located.text, change.after);
    if (trimmed.original === trimmed.replacement) continue;

    const start = located.start + trimmed.prefix;
    const end = located.end - trimmed.suffix;
    anchored.push({
      id: nextId('h'),
      start,
      end,
      baseSide: 'original',
      original: trimmed.original,
      replacement: trimmed.replacement,
      paragraph: paragraphIndexAt(paragraphs, start),
      ...(change.category ? { category: change.category } : {}),
      ...(change.reason ? { reason: change.reason } : {}),
      source: opts.source,
      status: 'pending',
      anchor: located.anchor
    });
  }

  return [...resolveOverlaps(screen ? screen(anchored) : anchored), ...stale];
}

/**
 * Where `change.before` is in the chapter, or null. The fuzzy search never
 * places it before `body` (`bodyStart`): in the frontmatter, or at the line
 * break that closes it (C.72).
 */
function locate(
  base: string,
  paragraphs: readonly Paragraph[],
  change: ChangeInput,
  opts: typeof DEFAULTS,
  body: number
): Located | null {
  const before = change.before;
  if (before.length === 0) return null;

  const target = findParagraph(paragraphs, change.paragraph);

  if (target) {
    const { offsets, clean } = cleanOccurrences(target.text, before);
    if (offsets.length >= 1) {
      const at = target.start + (offsets[0] ?? 0);
      const quality: AnchorQuality = offsets.length === 1 && clean ? 'exact' : 'ambiguous';
      return { start: at, end: at + before.length, text: before, anchor: quality };
    }
  }

  const neighbours: Array<{ offset: number; hits: number; clean: boolean }> = [];
  for (let d = 1; d <= opts.neighborRadius; d += 1) {
    for (const index of [change.paragraph - d, change.paragraph + d]) {
      const p = findParagraph(paragraphs, index);
      if (!p) continue;
      const { offsets, clean } = cleanOccurrences(p.text, before);
      if (offsets.length > 0) {
        neighbours.push({ offset: p.start + (offsets[0] ?? 0), hits: offsets.length, clean });
      }
    }
  }
  if (neighbours.length > 0) {
    const total = neighbours.reduce((sum, n) => sum + n.hits, 0);
    const first = neighbours[0];
    const at = first?.offset ?? 0;
    const quality: AnchorQuality = total === 1 && first?.clean === true ? 'exact' : 'ambiguous';
    return { start: at, end: at + before.length, text: before, anchor: quality };
  }

  const near = target?.start ?? 0;
  const match = fuzzyFind(base, before, near, { threshold: opts.fuzzyThreshold });
  if (match && match.ratio <= opts.maxDistanceRatio && match.text.length > 0 && match.start >= body) {
    return { start: match.start, end: match.end, text: match.text, anchor: 'fuzzy' };
  }

  return null;
}

function makeStale(change: ChangeInput, source: HunkSource, note: string): Hunk {
  const reason = change.reason ? `${change.reason} [${note}]` : note;
  return {
    id: nextId('h'),
    start: 0,
    end: 0,
    baseSide: 'original',
    original: change.before,
    replacement: change.after,
    paragraph: change.paragraph,
    ...(change.category ? { category: change.category } : {}),
    reason,
    source,
    status: 'pending',
    anchor: 'stale'
  };
}

/**
 * Hunks never overlap. The earlier one wins; the later one is kept for the side
 * panel as stale so nothing Claude said is silently thrown away.
 */
export function resolveOverlaps(hunks: readonly Hunk[]): Hunk[] {
  const sorted = [...hunks].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Hunk[] = [];
  let lastEnd = -1;
  for (const hunk of sorted) {
    if (hunk.anchor === 'stale') {
      out.push(hunk);
      continue;
    }
    if (hunk.start < lastEnd) {
      const note = 'Overlapped an earlier suggestion.';
      out.push({
        ...hunk,
        anchor: 'stale',
        start: 0,
        end: 0,
        reason: hunk.reason ? `${hunk.reason} [${note}]` : note
      });
      continue;
    }
    out.push(hunk);
    lastEnd = hunk.end;
  }
  return out;
}
