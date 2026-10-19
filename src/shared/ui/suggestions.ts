/**
 * Ordering and one-line summaries for the suggestions list in the right panel
 * (plan 7, items 4 and 5). Pure so the list order is testable without a DOM.
 */

import type { ChangeCategory, Hunk } from '../types';
import { compareHunks } from './navigate';
import { sideText } from './small';

export interface SuggestionGroups {
  /** every anchored hunk the filter chips leave visible, in document order */
  inline: Hunk[];
  /** hunks that never found their place; shown in their own section */
  stale: Hunk[];
}

/** The category a hunk is filtered and coloured by; diff hunks carry none. */
export function categoryOf(hunk: Hunk): ChangeCategory {
  return hunk.category ?? 'other';
}

/**
 * Split the review's hunks into the list the panel shows. The inline group is
 * sorted as the page draws the changes and the keys step through them
 * (`compareHunks`: start, end, id), so the list reads in the same order as the
 * manuscript, and hidden categories drop out of it. Stale hunks ignore the filter: they are the
 * ones the author most needs to see, and they carry no position to sort by.
 */
export function groupSuggestions(
  hunks: readonly Hunk[],
  hiddenCategories: readonly ChangeCategory[] = []
): SuggestionGroups {
  const hidden = new Set(hiddenCategories);
  const inline = hunks
    .filter((h) => h.anchor !== 'stale' && !hidden.has(categoryOf(h)))
    .slice()
    .sort(compareHunks);
  const stale = hunks.filter((h) => h.anchor === 'stale');
  return { inline, stale };
}

/** Collapse newlines and runs of spaces so a quote fits on one row. */
export function flatten(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  const flat = flatten(text);
  if (flat.length === 0) return '(nothing)';
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`;
}

/** One side, as `sideText` names it, else flattened and clipped. */
function side(text: string, max: number): string {
  const named = sideText(text);
  return named === text ? clip(text, max) : named;
}

/**
 * "began → begun" for a row in the list. Both sides are clipped separately so
 * the suggested text never disappears behind a long original. A side that
 * cannot be seen, or small punctuation, is named: "- (hyphen) → (space)"
 * (11.7, small.5), and "(nothing)" is kept for the empty string.
 */
export function summaryLine(hunk: Hunk, max = 64): string {
  const half = Math.max(6, Math.floor((max - 3) / 2));
  return `${side(hunk.original, half)} → ${side(hunk.replacement, half)}`;
}
