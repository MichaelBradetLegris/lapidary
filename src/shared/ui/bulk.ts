/**
 * What a bulk action would actually do, in words and in ids (plan 7, item 8).
 * Every bulk button asks for confirmation first, and the modal quotes the exact
 * count from here, so the rule that decides the count lives in one tested place.
 */

import type { ChangeCategory, Hunk, HunkStatus } from '../types';
import { categoryOf } from './suggestions';

export type BulkAction = 'accept' | 'dismiss' | 'reset';

export interface BulkPlan {
  action: BulkAction;
  /** undefined means every category */
  category?: ChangeCategory;
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

const BODY: Record<BulkAction, string> = {
  accept: 'Suggestions you already dismissed are not changed.',
  dismiss: 'Suggestions you already accepted are not changed.',
  reset: 'This clears every accept and dismiss. Nothing is written to the chapter.'
};

/**
 * Work out the affected hunks and the exact wording of the confirmation.
 * A plan with `count === 0` is still returned so the caller can say so instead
 * of opening a modal that would do nothing.
 */
export function bulkPlan(hunks: readonly Hunk[], action: BulkAction, category?: ChangeCategory): BulkPlan {
  const targets = hunks.filter(
    (h) => affects(h, action) && (category === undefined || categoryOf(h) === category)
  );
  const scope = category ? `${category} ` : '';
  const noun = `${scope}suggestion${targets.length === 1 ? '' : 's'}`;
  const title =
    action === 'reset'
      ? `Return ${targets.length} ${noun} to pending?`
      : `${VERB[action]} ${targets.length} pending ${noun}?`;

  const emptyNote =
    action === 'reset'
      ? `There are no ${scope}decisions to reset.`
      : `There are no pending ${scope}suggestions to ${action}.`;

  return {
    action,
    ...(category ? { category } : {}),
    status: NEXT_STATUS[action],
    ids: targets.map((h) => h.id),
    count: targets.length,
    title,
    body: BODY[action],
    confirmLabel: VERB[action],
    emptyNote
  };
}
