/**
 * Ordering and one-line summaries for the suggestions list in the right panel
 * (plan 7, items 4 and 5), and since polish.12 its heading, each row's tag and
 * how a row's buttons show its decision; since polish.14 the tag's three
 * letters, which the legend lists. Pure so the list is testable without a DOM.
 */

import { decisionCounts } from '../diff/compose';
import { CHANGE_CATEGORIES, type Hunk, type HunkStatus } from '../types';
import { chipHidden, chipKeyOf, YOU_CHIP, type ChipKey, type RowChip } from './chips';
import { compareHunks } from './navigate';
import { sideText } from './small';

export interface SuggestionGroups {
  /** every anchored hunk the filter chips leave visible, in document order */
  inline: Hunk[];
  /** hunks that never found their place; shown in their own section */
  stale: Hunk[];
}

/**
 * Split the review's hunks into the list the panel shows. The inline group is
 * sorted as the page draws the changes and the keys step through them
 * (`compareHunks`: start, end, id), so the list reads in the same order as the
 * manuscript, and the suggestions of a hidden chip drop out of it
 * (`chipHidden`; the author's own edits are under You since polish.11). Stale
 * hunks ignore the filter: they are the ones the author most needs to see,
 * and they carry no position to sort by.
 */
export function groupSuggestions(
  hunks: readonly Hunk[],
  hiddenCategories: readonly RowChip[] = []
): SuggestionGroups {
  const inline = hunks
    .filter((h) => h.anchor !== 'stale' && !chipHidden(h, hiddenCategories))
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

/**
 * The list's heading (polish.12), in the comments' form: "Suggestions (12 of
 * 19 decided)", decided meaning accepted or dismissed, so it cannot be read
 * as 12 left of 19; "Suggestions (19)" while none is decided, and
 * "Suggestions (0)" with none. It counts the rows under it, `groupSuggestions`'
 * inline group, so a hidden chip's suggestions are out of both numbers as
 * they are out of the list.
 */
export function suggestionsHeading(rows: readonly Hunk[]): string {
  const { pending, accepted, dismissed } = decisionCounts(rows);
  const decided = accepted + dismissed;
  const total = pending + decided;
  return decided === 0 ? `Suggestions (${total})` : `Suggestions (${decided} of ${total} decided)`;
}

/**
 * The three letters of each row's tag (polish.14), so every tag is as wide as
 * the next and the rows' words start in one column: one for each change
 * category and YOU for the author's own edits. The legend lists them
 * (`TAG_KEYS`), with the names a chip gives them.
 */
export const TAG_ABBREVIATIONS: Readonly<Record<ChipKey, string>> = {
  spelling: 'SPE',
  typo: 'TYP',
  homophone: 'HOM',
  grammar: 'GRM',
  agreement: 'AGR',
  tense: 'TEN',
  punctuation: 'PUN',
  'word-choice': 'WRD',
  redundancy: 'RED',
  awkward: 'AWK',
  consistency: 'CON',
  formatting: 'FMT',
  other: 'OTH',
  [YOU_CHIP]: 'YOU'
};

/** Every tag, in the chips' order: the categories, then YOU (polish.14, the legend's list). */
export const TAG_KEYS: readonly ChipKey[] = [...CHANGE_CATEGORIES, YOU_CHIP];

/** What a tag stands for, as the legend names it: the category as its chip writes it, or "your own edits". */
export function tagName(key: ChipKey): string {
  return key === YOU_CHIP ? 'your own edits' : key;
}

/** The tag at the left of a row in the list (polish.12, three letters since polish.14). */
export interface RowTag {
  /** the chip the suggestion is under, whose colour the tag takes (`cat-<key>`) */
  key: ChipKey;
  /** the tag's three letters (`TAG_ABBREVIATIONS`): "GRM", "WRD", "YOU" */
  text: string;
  /**
   * its tooltip, the name in full: "Grammar", "Grammar, reworded by you", and
   * for the author's own edits "Your own words"
   */
  title: string;
  /** what a screen reader hears for it, first in the row's name: the category, or "you" */
  spoken: string;
}

/**
 * A row's tag (polish.12), in place of the category's dot: the chip its
 * suggestion is counted under (`chipKeyOf`), in that chip's colour, so the
 * list and the chips agree, written since polish.14 in three letters of fixed
 * width, its name in full as its tooltip and in what a screen reader hears.
 * The author's own edits are tagged YOU, as they were before polish.12. A
 * model's suggestion the author reworded keeps its category's chip, and so
 * its tag; that the words are now the author's is in the tag's tooltip and in
 * what a screen reader hears, where before the tag was "you" and the chip the
 * category (C.107).
 */
export function rowTag(hunk: Pick<Hunk, 'source' | 'category' | 'edited'>): RowTag {
  const key = chipKeyOf(hunk);
  const text = TAG_ABBREVIATIONS[key];
  if (key === YOU_CHIP) return { key, text, title: 'Your own words', spoken: 'you' };
  const spoken = hunk.edited === true ? `${key}, reworded by you` : key;
  return { key, text, title: spoken.charAt(0).toUpperCase() + spoken.slice(1), spoken };
}

/** A row's three buttons, left to right. */
export type RowButton = 'edit' | 'accept' | 'dismiss';

/**
 * How a row's button looks (polish.12): `plain` as every button of a pending
 * row; `on` for the button of the row's decision, the accepted ✓ in a
 * stronger green and the dismissed ✕ in red, both drawn bolder; `faded` for
 * the other two buttons of a decided row, so the decision reads at a glance.
 */
export type RowButtonLook = 'plain' | 'on' | 'faded';

export function rowButtonLook(status: HunkStatus, button: RowButton): RowButtonLook {
  if (status === 'pending') return 'plain';
  const own = status === 'accepted' ? 'accept' : 'dismiss';
  return button === own ? 'on' : 'faded';
}

/**
 * The tooltip of a dismissed row's ✕, which stays an ✕ in red rather than
 * turning into an undo arrow (polish.12), so it says what a click does.
 */
export const DISMISSED_TITLE = 'Dismissed. Click to put it back';

/**
 * A row's name for a screen reader (polish.12): its tag, its change as
 * `summaryLine` gives it, and its decision: "grammar, began → begun,
 * accepted". The row shows the decision by its buttons alone since
 * polish.17, which took away the ACCEPTED or DISMISSED that Show states
 * wrote on it; the name still says it in words.
 */
export function rowLabel(hunk: Hunk): string {
  const status = hunk.status === 'pending' ? '' : hunk.status;
  return [rowTag(hunk).spoken, summaryLine(hunk), status].filter(Boolean).join(', ');
}
