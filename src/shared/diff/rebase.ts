import { paragraphIndexAt, splitParagraphs, type Paragraph } from '../text/paragraphs';
import type { AnchorQuality, BaseSide, Hunk, Review, ReviewBase, ReviewComment } from '../types';
import { resolveOverlaps } from './anchor';
import { cleanOccurrences, fuzzyFind, isCleanMatch, occurrences } from './fuzzy';

export interface RebaseStats {
  /** hunks that found a home in the new text */
  anchored: number;
  /** hunks that could not be found and dropped out of the inline view */
  stale: number;
  /** hunks whose decision was flipped to match what is now on disk */
  adopted: number;
  /** comments that lost their paragraph */
  orphanedComments: number;
}

export interface RebaseResult {
  review: Review;
  stats: RebaseStats;
}

export interface RebaseOptions {
  /** how far either side of the old offset to look before widening the search */
  window?: number;
  /** characters of surrounding text used to re-anchor a zero-length hunk */
  contextChars?: number;
  maxDistanceRatio?: number;
}

const DEFAULTS = { window: 400, contextChars: 48, maxDistanceRatio: 0.2 };

interface Found {
  start: number;
  end: number;
  side: BaseSide;
  anchor: AnchorQuality;
}

/**
 * Move an existing review onto a new version of the file (plan section 4.5).
 *
 * Each hunk looks first for the text it expects to occupy its span, then for the
 * other side, because the author may have applied or undone the change by hand
 * in Obsidian. When the disk disagrees with the recorded decision, the disk wins
 * and the decision is flipped to match, so saving can never silently revert an
 * edit made outside the app.
 */
export function rebaseReview(
  review: Review,
  nextBase: ReviewBase,
  options: RebaseOptions = {}
): RebaseResult {
  const opts = { ...DEFAULTS, ...options };
  const oldText = review.base.text;
  const newText = nextBase.text;
  const oldParagraphs = splitParagraphs(oldText);
  const newParagraphs = splitParagraphs(newText);

  const present = new Set(review.hunks.map((h) => h.id));

  let adopted = 0;
  const moved: Hunk[] = review.hunks.map((hunk) => {
    /* A suggestion the author's own edit swallowed stays off the page. Its words
       often still exist inside the edit that replaced them, so re-anchoring it
       would put two hunks over the same span and undo a decision the author
       already made (item 3b). */
    if (hunk.supersededBy && present.has(hunk.supersededBy)) {
      return { ...hunk, anchor: 'stale', start: 0, end: 0 };
    }
    const found = locate(oldText, newText, hunk, opts);
    if (!found) {
      return { ...hunk, anchor: 'stale', start: 0, end: 0 };
    }
    let status = hunk.status;
    if (found.side !== hunk.baseSide) {
      status =
        found.side === 'replacement' ? 'accepted' : hunk.status === 'accepted' ? 'pending' : hunk.status;
      if (status !== hunk.status) adopted += 1;
    }
    return {
      ...hunk,
      start: found.start,
      end: found.end,
      baseSide: found.side,
      anchor: found.anchor,
      status,
      paragraph: paragraphIndexAt(newParagraphs, found.start)
    };
  });

  const hunks = resolveOverlaps(moved);

  let orphanedComments = 0;
  const comments: ReviewComment[] = review.comments.map((comment) => {
    const next = remapComment(comment, oldParagraphs, newParagraphs, newText);
    if (comment.paragraph !== null && next.paragraph === null) orphanedComments += 1;
    return next;
  });

  const stale = hunks.filter((h) => h.anchor === 'stale').length;

  return {
    review: {
      ...review,
      base: { ...nextBase },
      updatedAt: new Date().toISOString(),
      hunks,
      comments
    },
    stats: { anchored: hunks.length - stale, stale, adopted, orphanedComments }
  };
}

interface Candidate {
  start: number;
  end: number;
  side: BaseSide;
  clean: boolean;
  /** how many equally clean places this text occurs in */
  siblings: number;
  /** characters of surrounding text that still agree with the old file */
  context: number;
  distance: number;
  preferred: boolean;
}

/** How much text either side of a hunk is compared when ranking candidates. */
const CONTEXT_CHARS = 40;

/**
 * Best candidate first. Word-boundary matches always win; then the one whose
 * surroundings still look like the old file, which is what saves short common
 * words such as "of" from anchoring onto an unrelated occurrence; then the one
 * that moved least; and finally the side the hunk expected.
 */
function betterCandidate(a: Candidate, b: Candidate): number {
  if (a.clean !== b.clean) return a.clean ? -1 : 1;
  if (a.context !== b.context) return b.context - a.context;
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.preferred !== b.preferred) return a.preferred ? -1 : 1;
  return a.start - b.start;
}

function locate(oldText: string, newText: string, hunk: Hunk, opts: typeof DEFAULTS): Found | null {
  const expectedSide: BaseSide = hunk.baseSide;
  const otherSide: BaseSide = expectedSide === 'original' ? 'replacement' : 'original';
  const expected = expectedSide === 'original' ? hunk.original : hunk.replacement;
  const other = otherSide === 'original' ? hunk.original : hunk.replacement;

  const pool = [
    ...collect(oldText, newText, expected, hunk, expectedSide, true),
    ...collect(oldText, newText, other, hunk, otherSide, false)
  ];

  if (pool.length > 0) {
    const best = pool.sort(betterCandidate)[0];
    if (best) {
      const rivals = pool.filter((c) => c.side === best.side && c.clean === best.clean).length;
      return {
        start: best.start,
        end: best.end,
        side: best.side,
        anchor: best.clean && rivals === 1 ? 'exact' : 'ambiguous'
      };
    }
  }

  if (expected.length === 0) {
    const byContext = searchByContext(oldText, newText, hunk, expectedSide, opts);
    if (byContext) return byContext;
  }
  if (other.length === 0) {
    const byContext = searchByContext(oldText, newText, hunk, otherSide, opts);
    if (byContext) return byContext;
  }

  if (expected.length > 0) {
    const match = fuzzyFind(newText, expected, hunk.start);
    if (match && match.ratio <= opts.maxDistanceRatio) {
      return { start: match.start, end: match.end, side: expectedSide, anchor: 'fuzzy' };
    }
  }

  return null;
}

/** Every place `needle` could sit in the new text, scored for ranking. */
function collect(
  oldText: string,
  haystack: string,
  needle: string,
  hunk: Hunk,
  side: BaseSide,
  preferred: boolean
): Candidate[] {
  if (needle.length === 0) return [];
  const { offsets, clean } = cleanOccurrences(haystack, needle);
  if (offsets.length === 0) return [];

  const near = hunk.start;
  // Only the nearest handful matter; a far-away duplicate rarely wins, and
  // scoring every occurrence of a common word would be wasteful.
  const sorted = [...offsets].sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).slice(0, 12);
  return sorted.map((start) => ({
    start,
    end: start + needle.length,
    side,
    clean: clean && isCleanMatch(haystack, start, needle),
    siblings: offsets.length,
    context: contextAgreement(oldText, haystack, hunk, start, start + needle.length),
    distance: Math.abs(start - near),
    preferred
  }));
}

/** How many characters either side of the candidate still match the old file. */
function contextAgreement(oldText: string, newText: string, hunk: Hunk, start: number, end: number): number {
  const oldLeft = oldText.slice(Math.max(0, hunk.start - CONTEXT_CHARS), hunk.start);
  const newLeft = newText.slice(Math.max(0, start - CONTEXT_CHARS), start);
  const oldRight = oldText.slice(hunk.end, hunk.end + CONTEXT_CHARS);
  const newRight = newText.slice(end, end + CONTEXT_CHARS);
  return commonSuffix(oldLeft, newLeft) + commonPrefix(oldRight, newRight);
}

function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

/** Re-anchor a zero-length span by the text that surrounds it. */
function searchByContext(
  oldText: string,
  newText: string,
  hunk: Hunk,
  side: BaseSide,
  opts: typeof DEFAULTS
): Found | null {
  const left = oldText.slice(Math.max(0, hunk.start - opts.contextChars), hunk.start);
  const right = oldText.slice(hunk.end, hunk.end + opts.contextChars);
  const context = left + right;
  if (context.length === 0) return null;

  const hits = occurrences(newText, context);
  if (hits.length > 0) {
    const at = nearest(hits, hunk.start) + left.length;
    return { start: at, end: at, side, anchor: hits.length === 1 ? 'exact' : 'ambiguous' };
  }

  const match = fuzzyFind(newText, context, hunk.start);
  if (match && match.ratio <= opts.maxDistanceRatio) {
    const at = Math.min(newText.length, match.start + left.length);
    return { start: at, end: at, side, anchor: 'fuzzy' };
  }

  return null;
}

function nearest(offsets: readonly number[], target: number): number {
  let best = offsets[0] ?? 0;
  for (const offset of offsets) {
    if (Math.abs(offset - target) < Math.abs(best - target)) best = offset;
  }
  return best;
}

function remapComment(
  comment: ReviewComment,
  oldParagraphs: readonly Paragraph[],
  newParagraphs: readonly Paragraph[],
  newText: string
): ReviewComment {
  if (comment.paragraph === null) return comment;
  const old = oldParagraphs.find((p) => !p.isFrontmatter && p.index === comment.paragraph);
  if (old) {
    const key = old.text.slice(0, 40);
    const hit = newParagraphs.find((p) => !p.isFrontmatter && p.text.startsWith(key));
    if (hit) return { ...comment, paragraph: hit.index };
  }
  if (comment.quote && comment.quote.length > 0) {
    const at = newText.indexOf(comment.quote);
    if (at >= 0) return { ...comment, paragraph: paragraphIndexAt(newParagraphs, at) };
  }
  return { ...comment, paragraph: null };
}
