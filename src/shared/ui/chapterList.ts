/**
 * The marks beside a chapter in the chapter list (apply.5, PLAN 7): the unsaved
 * dot before its name and the badge after it.
 *
 * A chapter that is not open is marked from its current review as last written,
 * the one it opens with, which main summarises (`ReviewSummary`). The open
 * chapter is marked from the review on screen instead, so its dot comes and
 * goes with each decision, as the toolbar's does, and its badge counts what is
 * still pending rather than what was pending when the list was last read.
 *
 * Pure (CLAUDE.md rule 4), so every case has a test without a DOM.
 */

import { decisionCounts, unsavedDecisionCount } from '../diff/compose';
import type { ReviewSummary } from '../ipc';
import type { Review } from '../types';
import { unsavedDotLabel } from './save';

export interface ChapterListMarks {
  /** changes the chapter file does not have yet; the dot shows above 0 */
  unsaved: number;
  /** the dot's tooltip and spoken name, "1 change is not saved to the chapter yet."; empty without a dot */
  dotLabel: string;
  /**
   * The badge: null for a chapter with no review, 0 for the tick (reviewed,
   * nothing pending), otherwise the number of suggestions still pending.
   */
  pending: number | null;
}

/**
 * `summary` is the chapter's entry in `reviews:index`, if it has one; `open` is
 * the review on screen when this chapter is the open one, and null otherwise.
 * An open chapter whose review has nothing in it yet and has never been written
 * (a chapter opened for the first time) has no badge, as before it opened.
 */
export function chapterListMarks(
  summary: Pick<ReviewSummary, 'unsavedCount' | 'pendingCount'> | undefined,
  open: Pick<Review, 'hunks' | 'comments'> | null
): ChapterListMarks {
  if (open) {
    const unsaved = unsavedDecisionCount(open.hunks);
    const reviewed = summary !== undefined || open.hunks.length > 0 || open.comments.length > 0;
    return {
      unsaved,
      dotLabel: unsavedDotLabel(unsaved),
      pending: reviewed ? decisionCounts(open.hunks).pending : null
    };
  }
  const unsaved = summary?.unsavedCount ?? 0;
  return {
    unsaved,
    dotLabel: unsavedDotLabel(unsaved),
    pending: summary ? summary.pendingCount : null
  };
}
