/**
 * The counts shown for a review in History and in the Review with AI dialog's
 * "Last reviewed" line (apply.5, PLAN 6.4 and 7).
 *
 * `ReviewSummary` counts a review as it was last written, and History is read
 * only when a chapter or a History entry opens, after Save to chapter and after
 * a new review. The review on screen is counted from the page instead, as the
 * chapter list's open row is (`chapterListMarks`) and as the status bar is, so
 * all three say the same number while the author decides.
 *
 * Pure (CLAUDE.md rule 4), so every case has a test without a DOM.
 */

import { decisionCounts } from '../diff/compose';
import type { ReviewSummary } from '../ipc';
import type { Review } from '../types';

export interface HistoryCounts {
  /** this entry is the review on screen: the row History highlights */
  onScreen: boolean;
  /** suggestions in the review, the author's own edits and those that lost their place included */
  hunkCount: number;
  /** suggestions still pending, not counting those that lost their place; History's badge shows above 0 */
  pendingCount: number;
}

/**
 * `reviewPath` is the file the review on screen was loaded from or last written
 * to, null while it has never been written; `review` is the review on screen.
 * Only the entry at that very path is counted from the page.
 */
export function historyCounts(
  entry: Pick<ReviewSummary, 'path' | 'hunkCount' | 'pendingCount'>,
  reviewPath: string | null,
  review: Pick<Review, 'hunks'> | null
): HistoryCounts {
  const onScreen = reviewPath !== null && entry.path === reviewPath;
  if (onScreen && review) {
    return {
      onScreen,
      hunkCount: review.hunks.length,
      pendingCount: decisionCounts(review.hunks).pending
    };
  }
  return { onScreen, hunkCount: entry.hunkCount, pendingCount: entry.pendingCount };
}
