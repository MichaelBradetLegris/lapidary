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
import { samePath } from '../paths';
import { PROVIDER_NAMES, type Review } from '../types';

/**
 * A review's date as History shows it: the computer's own date and time
 * format, or the stored text when it is not a readable time. The review
 * selector (`reviewPicker`) and the questions that name a review by its date
 * use the same words, so the author can find the one they mean in History.
 */
export function historyWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

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

/* ------------------------------------------------------------------ */
/* The review selector at the top of the side panel (apply.26)           */
/* ------------------------------------------------------------------ */

/**
 * One review in the selector: History's date, then the provider (or the kind,
 * "manual" or "file", for a review no model wrote), the model when there is
 * one, and the pending count when there is one, as a History row shows them.
 */
export function reviewChoiceLabel(choice: {
  createdAt: string;
  generatorKind: ReviewSummary['generatorKind'];
  provider?: ReviewSummary['provider'] | undefined;
  model?: string | undefined;
  pendingCount: number;
}): string {
  const parts = [
    historyWhen(choice.createdAt),
    choice.provider ? PROVIDER_NAMES[choice.provider] : choice.generatorKind
  ];
  if (choice.model) parts.push(choice.model);
  if (choice.pendingCount > 0) parts.push(`${choice.pendingCount} pending`);
  return parts.join(' · ');
}

/** The warning mark's tooltip when the review on screen is not the newest. */
export function notNewestText(newestCreatedAt: string): string {
  return `Not the newest review. The newest is from ${historyWhen(newestCreatedAt)}.`;
}

/** What the selector shows when the chapter has no review yet. */
export const NO_REVIEWS_YET = 'No reviews yet';

export interface ReviewChoice {
  /** the review file's path; '' for the review on screen before it is first written */
  value: string;
  label: string;
  createdAt: string;
}

export interface ReviewPicker {
  /** newest first, by `createdAt`; empty while the chapter has no review */
  choices: ReviewChoice[];
  /** the value of the review on screen */
  selected: string;
  /** the warning mark's tooltip, or null when the review on screen is the newest */
  notNewest: string | null;
}

/**
 * The selector at the very top of the side panel (apply.26): the open
 * chapter's reviews as History lists them, newest first, with the one on screen
 * selected and counted from the page (`historyCounts`), and a warning when that
 * one is not the newest by `createdAt`. Choosing another switches to it.
 *
 * `history` is History as last read, which can still be another chapter's for
 * a moment after a chapter opens, so only the entries of the review's own
 * chapter count. The review on screen is listed even when History does not
 * have it yet: a new review before its first write, or before History is read
 * again. A chapter with no review shows the empty review the page opened it
 * with, which is no review at all, so the selector then has no choices.
 */
export function reviewPicker(
  history: readonly ReviewSummary[],
  reviewPath: string | null,
  review: Pick<Review, 'sourcePath' | 'createdAt' | 'generator' | 'hunks'>
): ReviewPicker {
  const own = history.filter((entry) => samePath(entry.sourcePath, review.sourcePath, true));
  const choices: ReviewChoice[] = own.map((entry) => ({
    value: entry.path,
    label: reviewChoiceLabel({
      ...entry,
      pendingCount: historyCounts(entry, reviewPath, review).pendingCount
    }),
    createdAt: entry.createdAt
  }));
  let selected = own.find((entry) => historyCounts(entry, reviewPath, review).onScreen)?.path;
  if (selected === undefined) {
    const blank = reviewPath === null && review.generator.kind === 'file' && review.hunks.length === 0;
    if (blank && own.length === 0) return { choices: [], selected: '', notNewest: null };
    selected = reviewPath ?? '';
    choices.push({
      value: selected,
      label: reviewChoiceLabel({
        createdAt: review.createdAt,
        generatorKind: review.generator.kind,
        provider: review.generator.provider,
        model: review.generator.model,
        pendingCount: decisionCounts(review.hunks).pending
      }),
      createdAt: review.createdAt
    });
  }
  choices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const newest = choices[0];
  const onScreen = choices.find((choice) => choice.value === selected);
  const notNewest =
    newest && onScreen && newest.createdAt.localeCompare(onScreen.createdAt) > 0
      ? notNewestText(newest.createdAt)
      : null;
  return { choices, selected, notNewest };
}
