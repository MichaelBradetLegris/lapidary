/**
 * What a bulk action would actually do, in words and in ids (plan 7, item 8).
 * Every bulk button asks for confirmation first, and the modal quotes the exact
 * count from here, so the rule that decides the count lives in one tested place.
 */

import type { Hunk, HunkStatus } from '../types';
import { chipKeyOf, YOU_CHIP, type ChipKey } from './chips';
import { NOTHING_UNTIL_SAVE } from './saveHint';

export type BulkAction = 'accept' | 'dismiss' | 'reset';

export interface BulkPlan {
  action: BulkAction;
  /** undefined means every chip; else one chip's, a category or the author's own edits (polish.11) */
  category?: ChipKey;
  /** the status the affected hunks move to */
  status: HunkStatus;
  ids: string[];
  count: number;
  title: string;
  /** the sentence that spells out what is left alone */
  body: string;
  confirmLabel: string;
  /** what to say instead of opening a modal when nothing would change */
  emptyNote: string;
}

/** Accept and dismiss only ever move pending suggestions; reset undoes decisions. */
function affects(hunk: Hunk, action: BulkAction): boolean {
  if (hunk.anchor === 'stale') return false;
  if (action === 'reset') return hunk.status !== 'pending';
  return hunk.status === 'pending';
}

const VERB: Record<BulkAction, string> = {
  accept: 'Accept',
  dismiss: 'Dismiss',
  reset: 'Reset'
};

const NEXT_STATUS: Record<BulkAction, HunkStatus> = {
  accept: 'accepted',
  dismiss: 'dismissed',
  reset: 'pending'
};

/**
 * Accept all says, on a line of its own, that accepting writes nothing yet
 * (apply.12): a first-time author pressing it may expect the chapter to change.
 * The You chip's questions say "Edits" where the others say "Suggestions"
 * (polish.11).
 */
function body(action: BulkAction, things: string): string {
  if (action === 'accept') return `${things} you already dismissed are not changed.\n${NOTHING_UNTIL_SAVE}`;
  if (action === 'dismiss') return `${things} you already accepted are not changed.`;
  return 'This clears every accept and dismiss. Nothing is written to the chapter.';
}

/** The question's title and the note for nothing to do: for every suggestion, a category's, or your edits. */
function words(
  action: BulkAction,
  key: ChipKey | undefined,
  count: number
): { title: string; emptyNote: string } {
  const s = count === 1 ? '' : 's';
  if (key === YOU_CHIP) {
    return action === 'reset'
      ? {
          title: `Return your ${count} edit${s} to pending?`,
          emptyNote: 'None of your edits has a decision to reset.'
        }
      : {
          title: `${VERB[action]} your ${count} pending edit${s}?`,
          emptyNote: `You have no pending edits to ${action}.`
        };
  }
  const scope = key ? `${key} ` : '';
  return action === 'reset'
    ? {
        title: `Return ${count} ${scope}suggestion${s} to pending?`,
        emptyNote: `There are no ${scope}decisions to reset.`
      }
    : {
        title: `${VERB[action]} ${count} pending ${scope}suggestion${s}?`,
        emptyNote: `There are no pending ${scope}suggestions to ${action}.`
      };
}

/**
 * Work out the affected hunks and the exact wording of the confirmation.
 * A plan with `count === 0` is still returned so the caller can say so instead
 * of opening a modal that would do nothing. `category` is a chip's
 * (`chipKeyOf`): a category of the model's, or You, the author's own edits.
 */
export function bulkPlan(hunks: readonly Hunk[], action: BulkAction, category?: ChipKey): BulkPlan {
  const targets = hunks.filter(
    (h) => affects(h, action) && (category === undefined || chipKeyOf(h) === category)
  );
  return {
    action,
    ...(category ? { category } : {}),
    status: NEXT_STATUS[action],
    ids: targets.map((h) => h.id),
    count: targets.length,
    ...words(action, category, targets.length),
    body: body(action, category === YOU_CHIP ? 'Edits' : 'Suggestions'),
    confirmLabel: VERB[action]
  };
}
