import { restoreText } from '../text/eol';
import type { BaseSide, Hunk, Review } from '../types';

/** Which of the two texts the hunk's decision asks for right now. */
export function desiredSide(hunk: Pick<Hunk, 'status'>): BaseSide {
  return hunk.status === 'accepted' ? 'replacement' : 'original';
}

/** Hunks that participate in composition: anchored, sorted, non-overlapping. */
export function activeHunks(hunks: readonly Hunk[]): Hunk[] {
  return hunks.filter((h) => h.anchor !== 'stale').sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface OverlapProblem {
  earlier: string;
  later: string;
}

/** Returns the pairs that break the no-overlap invariant. Empty means healthy. */
export function findOverlaps(hunks: readonly Hunk[]): OverlapProblem[] {
  const sorted = activeHunks(hunks);
  const problems: OverlapProblem[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    if (curr.start < prev.end) problems.push({ earlier: prev.id, later: curr.id });
  }
  return problems;
}

/**
 * True when a hunk's decision asks for words the base does not hold over its
 * span: the side it wants is not the side the base holds, and the two sides
 * differ. A hunk whose two sides read the same, which a rewrite to the file's
 * own words leaves behind (`editSuggestion`), changes nothing whatever its
 * decision, so it never counts and compose always copies the base for it.
 */
export function changesBase(hunk: Pick<Hunk, 'status' | 'baseSide' | 'original' | 'replacement'>): boolean {
  return desiredSide(hunk) !== hunk.baseSide && hunk.original !== hunk.replacement;
}

/**
 * The words a hunk's decision puts over its span. The base slice is copied
 * whenever the decision changes nothing (`changesBase`), so drift between
 * `base.text` and a hunk's recorded strings can never silently rewrite
 * untouched prose.
 */
export function decidedText(base: string, hunk: Hunk): string {
  if (!changesBase(hunk)) return base.slice(hunk.start, hunk.end);
  return desiredSide(hunk) === 'replacement' ? hunk.replacement : hunk.original;
}

/**
 * Base text plus hunk decisions to output text. Pure: the same base and the same
 * statuses always give the same string (CLAUDE.md rule 5).
 */
export function composeText(base: string, hunks: readonly Hunk[]): string {
  let out = '';
  let cursor = 0;
  for (const hunk of activeHunks(hunks)) {
    if (hunk.start < cursor) continue; // overlapping leftover: the earlier hunk wins
    out += base.slice(cursor, hunk.start);
    out += decidedText(base, hunk);
    cursor = hunk.end;
  }
  return out + base.slice(cursor);
}

/** Composed text for the review, still LF-normalized. */
export function composeReview(review: Review): string {
  return composeText(review.base.text, review.hunks);
}

/** Composed text with the file's original EOL, BOM and trailing newline restored. */
export function composeForFile(review: Review): string {
  return restoreText(composeReview(review), review.base);
}

export interface CommitResult {
  text: string;
  hunks: Hunk[];
}

/**
 * Fold the current decisions into the base: the composed text becomes the new
 * base and every hunk's offsets and `baseSide` are moved onto it. Used right
 * after a successful save so that reopening the review is a no-op.
 *
 * `composeText(commit(base, hunks).text, commit(base, hunks).hunks)` equals
 * `composeText(base, hunks)`.
 */
export function commitDecisions(base: string, hunks: readonly Hunk[]): CommitResult {
  const sorted = activeHunks(hunks);
  const byId = new Map<string, Hunk>();
  let out = '';
  let cursor = 0;
  let delta = 0;

  for (const hunk of sorted) {
    if (hunk.start < cursor) {
      byId.set(hunk.id, { ...hunk, anchor: 'stale' });
      continue;
    }
    out += base.slice(cursor, hunk.start);
    const span = decidedText(base, hunk);
    const newStart = hunk.start + delta;
    out += span;
    delta += span.length - (hunk.end - hunk.start);
    byId.set(hunk.id, { ...hunk, start: newStart, end: newStart + span.length, baseSide: desiredSide(hunk) });
    cursor = hunk.end;
  }

  const text = out + base.slice(cursor);
  const next = hunks.map((h) => byId.get(h.id) ?? h);
  return { text, hunks: next };
}

/**
 * How many anchored hunks decide something the chapter file does not say yet:
 * an accepted change not saved, or a saved change since turned back. Zero means
 * the file on disk already reads exactly like the page. A hunk whose two sides
 * are the same never counts, whatever its decision (`changesBase`).
 */
export function unsavedDecisionCount(hunks: readonly Hunk[]): number {
  return hunks.filter((h) => h.anchor !== 'stale' && changesBase(h)).length;
}

/** Counts for the status bar. */
export function decisionCounts(hunks: readonly Hunk[]): {
  pending: number;
  accepted: number;
  dismissed: number;
  stale: number;
} {
  let pending = 0;
  let accepted = 0;
  let dismissed = 0;
  let stale = 0;
  for (const h of hunks) {
    if (h.anchor === 'stale') {
      stale += 1;
      continue;
    }
    if (h.status === 'accepted') accepted += 1;
    else if (h.status === 'dismissed') dismissed += 1;
    else pending += 1;
  }
  return { pending, accepted, dismissed, stale };
}
