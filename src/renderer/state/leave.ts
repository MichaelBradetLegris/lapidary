import { unsavedDecisionCount } from '../../shared/diff/compose';
import type { ReviewSummary } from '../../shared/ipc';
import { samePath } from '../../shared/paths';
import { historyWhen } from '../../shared/ui/history';
import {
  currentReviewId,
  isOpenTarget,
  leavePrompt,
  type LeaveState,
  type LeaveTarget
} from '../../shared/ui/save';
import type { Review } from '../../shared/types';
import { pendingSave, type SaveOptions, type SaveOutcome } from './saveChapter';
import { changedParagraphCount, isLocked, useApp, type AppState } from './store';

/*
 * Leaving the chapter or review on screen (apply.7, PLAN 11.3 i and 7.7): a
 * chapter from the list, the chapter New chapter has just made, or a review
 * from History. When the page holds changes the chapter file does not, or
 * paragraph boxes with typed text, the leave prompt asks first: Save first,
 * Keep for later (focused) or Cancel. Keep for later needs nothing more:
 * decisions are kept in the review and boxes in the chapter's drafts file,
 * both written before anything else is read (App's flushes), and the boxes
 * come back whenever a review of the chapter is on screen again (apply.16).
 *
 * Main is reached only through `LeaveDeps`, so this module needs neither the
 * DOM nor the preload bridge and is tested in node.
 */

export interface LeaveDeps {
  /** Save to chapter, waited for (`useSaveChapter`) */
  save: (options: SaveOptions) => Promise<SaveOutcome>;
  /** History as last read, for the date of a review the chapter will not open with */
  history: () => readonly ReviewSummary[];
}

/** What the leave prompt needs to know about the page. */
export function leaveStateOf(state: Pick<AppState, 'review' | 'drafts' | 'aiBusyPath'>): LeaveState {
  const review = state.review;
  return {
    chapter: review?.sourcePath ? review.sourcePath : null,
    unsavedDecisions: review ? unsavedDecisionCount(review.hunks) : 0,
    changedParagraphs: changedParagraphCount(state.drafts),
    locked: isLocked(state),
    reviewId: review?.id ?? null
  };
}

/**
 * History's date for the review on screen when the chapter would open with
 * another one (`currentReviewId`), so the prompt can say where its decisions
 * wait; null when it is the review the chapter opens with. Only History
 * entries of this chapter count: History still lists the chapter left for a
 * moment after another one opens.
 */
export function olderReviewFrom(
  review: Pick<Review, 'id' | 'sourcePath' | 'createdAt' | 'decidedAt'> | null,
  history: readonly ReviewSummary[]
): string | null {
  if (!review?.sourcePath) return null;
  const own = history.filter((entry) => samePath(entry.sourcePath, review.sourcePath, true));
  const current = currentReviewId(own, review);
  return current !== null && current !== review.id ? historyWhen(review.createdAt) : null;
}

/**
 * Ask before `target` replaces what is on screen, and save when the author
 * chooses Save first (PLAN 11.3 i). True to go ahead: nothing needed asking,
 * Keep for later, or a save that left the chapter file reading like the page
 * (`saved` or `nothing-to-save`). False to stay: Cancel, Escape, a question
 * that replaced this one, or a save that did not get there, whose card says
 * why. Paragraph boxes are applied without a second question, since Save
 * first already said "Apply and save first".
 */
export async function confirmLeave(target: LeaveTarget, deps: LeaveDeps): Promise<boolean> {
  const state = useApp.getState();
  const prompt = leavePrompt(leaveStateOf(state), target, {
    olderReviewFrom: olderReviewFrom(state.review, deps.history())
  });
  if (!prompt) return true;
  const choice = await state.askChoice(prompt);
  if (choice === 'alt') return true;
  if (choice === 'cancel') return false;
  const outcome = await deps.save({ applyDrafts: 'apply' });
  return outcome === 'saved' || outcome === 'nothing-to-save';
}

/**
 * What to do with a click that opens `target`:
 * - `go`: open it, after the waiting writes are flushed;
 * - `here`: it is what is on screen already, so only flush (11.3 i: re-clicking
 *   the open chapter never asks and reloads nothing);
 * - `stay`: Cancel, a save that did not get there, or a later click took over.
 */
export type LeaveDecision = 'go' | 'here' | 'stay';

/** Bumped by every click that opens something; only the newest goes ahead. */
let leaveSeq = 0;

/**
 * Before another chapter or review replaces the one on screen: let a save
 * under way end first, so its review is not read back in the middle of being
 * recorded (apply.3), then ask (`confirmLeave`). Of several clicks made while
 * a save runs or a question is open, only the last goes ahead.
 */
export async function beforeLeaving(target: LeaveTarget, deps: LeaveDeps): Promise<LeaveDecision> {
  const ticket = ++leaveSeq;
  const latest = (): boolean => ticket === leaveSeq;
  await pendingSave();
  if (!latest()) return 'stay';
  if (isOpenTarget(leaveStateOf(useApp.getState()), target)) return 'here';
  if (!(await confirmLeave(target, deps))) return 'stay';
  return latest() ? 'go' : 'stay';
}
