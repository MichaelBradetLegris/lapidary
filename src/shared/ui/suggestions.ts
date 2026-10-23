/**
 * Ordering and one-line summaries for the suggestions list in the right panel
 * (plan 7, items 4 and 5), and since polish.12 its heading, each row's tag and
 * how a row's buttons show its decision. Pure so the list is testable without
 * a DOM.
 */

import { decisionCounts } from '../diff/compose';
import type { Hunk, HunkStatus } from '../types';
import { chipHidden, chipKeyOf, YOU_CHIP, type ChipKey } from './chips';
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
  hiddenCategories: readonly ChipKey[] = []
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

/** The tag at the left of a row in the list (polish.12). */
export interface RowTag {
  /** the chip the suggestion is under, whose colour the tag takes (`cat-<key>`) */
  key: ChipKey;
  /** the tag's words, which app.css writes in capitals: "grammar", "word-choice", "you" */
  text: string;
  /** its tooltip: whose words they are, for the author's own and for a suggestion they reworded */
  title: string | null;
  /** what a screen reader hears for it, first in the row's name: the category, or "you" */
  spoken: string;
}

/**
 * A row's tag (polish.12), in place of the category's dot: the name of the
 * chip its suggestion is counted under (`chipKeyOf`), in that chip's colour,
 * so the list and the chips agree. The author's own edits are tagged "you",
 * as they were before polish.12. A model's suggestion the author reworded
 * keeps its category's chip, and so its tag; that the words are now the
 * author's is in the tag's tooltip and in what a screen reader hears, where
 * before the tag was "you" and the chip the category (C.107).
 */
export function rowTag(hunk: Pick<Hunk, 'source' | 'category' | 'edited'>): RowTag {
  const key = chipKeyOf(hunk);
  if (key === YOU_CHIP) return { key, text: 'you', title: 'Your own words', spoken: 'you' };
  const reworded = hunk.edited === true;
  return {
    key,
    text: key,
    title: reworded ? 'Reworded by you' : null,
    spoken: reworded ? `${key}, reworded by you` : key
  };
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

/** The toggle beside the list's heading (polish.12), and its tooltip. */
export const SHOW_STATES_LABEL = 'Show states';
export const SHOW_STATES_TITLE = 'Write ACCEPTED or DISMISSED on the rows you have decided';

/**
 * A row's name for a screen reader (polish.12): its tag, its change as
 * `summaryLine` gives it, and its decision, which is spoken whether or not
 * Show states writes it on the row: "grammar, began → begun, accepted".
 */
export function rowLabel(hunk: Hunk): string {
  const status = hunk.status === 'pending' ? '' : hunk.status;
  return [rowTag(hunk).spoken, summaryLine(hunk), status].filter(Boolean).join(', ');
}
