import { useCallback } from 'react';
import { bulkPlan, type BulkAction } from '../../shared/ui/bulk';
import type { ChipKey } from '../../shared/ui/chips';
import { FINISH_FULL_EDIT_FIRST } from '../../shared/ui/modes';
import { fullEditDraft, isLocked, useApp } from './store';

/**
 * Run one bulk action behind a confirmation (item 8). Every caller, the toolbar
 * and the category chips alike, goes through this so the count in the modal and
 * the hunks that actually change can never disagree.
 */
export function useBulkAction(): (action: BulkAction, category?: ChipKey) => void {
  const askConfirm = useApp((s) => s.askConfirm);
  const applyBulk = useApp((s) => s.applyBulk);
  const notify = useApp((s) => s.notify);

  return useCallback(
    (action: BulkAction, category?: ChipKey) => {
      const state = useApp.getState();
      const review = state.review;
      if (!review || isLocked(state)) return;
      // An open paragraph editor froze its suggestions; a bulk action would
      // either skip them silently or change the page under the editor.
      if (Object.keys(state.drafts).length > 0) {
        notify(
          'info',
          fullEditDraft(state.drafts)
            ? FINISH_FULL_EDIT_FIRST
            : 'Finish or cancel the paragraphs you are editing first.',
          'bulk-drafts'
        );
        return;
      }
      const plan = bulkPlan(review.hunks, action, category);
      if (plan.count === 0) {
        notify('info', plan.emptyNote);
        return;
      }
      void askConfirm({ title: plan.title, body: plan.body, confirmLabel: plan.confirmLabel }).then((ok) => {
        if (ok) applyBulk(plan.ids, plan.status);
      });
    },
    [askConfirm, applyBulk, notify]
  );
}
