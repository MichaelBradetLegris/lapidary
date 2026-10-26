import { unsavedDecisionCount } from '../../shared/diff/compose';
import { isOpenTarget, leavePrompt, type LeaveState, type LeaveTarget } from '../../shared/ui/save';
import { settleFullEditForReview } from './modes';
import { pendingSave, type SaveOptions, type SaveOutcome } from './saveChapter';
import { changedParagraphCount, fullEditChanged, isLocked, useApp, type AppState } from './store';

/*
 * Leaving the chapter or review on screen (apply.7, PLAN 11.3 i and 7.7): a
 * chapter from the list, the chapter New chapter has just made, or another
 * review of the open chapter from History or the review selector. When the
 * page holds changes the chapter file does not, or paragraph boxes with typed
 * text, leaving the chapter asks first: Save first, Keep for later (focused)
 * or Cancel. Keep for later needs nothing more: decisions are kept in the
 * review and boxes in the chapter's drafts file, both written before anything
 * else is read (App's flushes), and the boxes come back whenever a review of
 * the chapter is on screen again (apply.16).
 *
 * Another review of the open chapter is never asked about (apply.26): the
 * chapter opens with the review last on screen, so nothing is left where the
 * author would not find it, and the boxes go with the author (C.53). Full
 * edit is the exception (rr.5): the other review opens in Full edit too, as
 * the mode is the window's, but afresh, since its box holds the whole body as
 * this review composes it and could not go back over another review whose
 * decisions differ anywhere (the rr.2 review found what was typed set aside,
 * with a card saying the chapter had changed, which it had not). So, when
 * something is typed in it, the question a switch out of Full edit asks comes
 * first: Apply first, in this review, Discard or Cancel
 * (`settleFullEditForReview`). From `rr.2`'s review until `rr.5` it was
 * refused instead, with "Finish or cancel Full edit first.".
 *
 * Main is reached only through `LeaveDeps`, so this module needs neither the
 * DOM nor the preload bridge and is tested in node.
 */

export interface LeaveDeps {
  /** Save to chapter, waited for (`useSaveChapter`) */
  save: (options: SaveOptions) => Promise<SaveOutcome>;
}

/** What the leave prompt needs to know about the page. */
export function leaveStateOf(state: Pick<AppState, 'review' | 'drafts' | 'aiBusyPath'>): LeaveState {
  const review = state.review;
  return {
    chapter: review?.sourcePath ? review.sourcePath : null,
    unsavedDecisions: review ? unsavedDecisionCount(review.hunks) : 0,
    changedParagraphs: changedParagraphCount(state.drafts),
    ...(fullEditChanged(state.drafts) ? { fullEdit: true } : {}),
    locked: isLocked(state),
    reviewId: review?.id ?? null
  };
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
  const prompt = leavePrompt(leaveStateOf(state), target);
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
 *   the open chapter, or the review on screen in History or the selector,
 *   never asks and reloads nothing);
 * - `stay`: Cancel, a save that did not get there, or a later click took over.
 */
export type LeaveDecision = 'go' | 'here' | 'stay';

/** Bumped by every click that opens something; only the newest goes ahead. */
let leaveSeq = 0;

/**
 * Before another chapter or review replaces the one on screen: let a save
 * under way end first, so its review is not read back in the middle of being
 * recorded (apply.3), then ask (`confirmLeave`) when another chapter is
 * clicked. Another review while Full edit holds typed text asks first what
 * becomes of it (`settleFullEditForReview`, rr.5). Of several clicks made
 * while a save runs or a question is open, only the last goes ahead.
 */
export async function beforeLeaving(target: LeaveTarget, deps: LeaveDeps): Promise<LeaveDecision> {
  const ticket = ++leaveSeq;
  const latest = (): boolean => ticket === leaveSeq;
  await pendingSave();
  if (!latest()) return 'stay';
  const state = useApp.getState();
  if (isOpenTarget(leaveStateOf(state), target)) return 'here';
  if (target.kind === 'review') {
    if (!(await settleFullEditForReview())) return 'stay';
    if (latest()) return 'go';
    // A later click took over: the Full edit held for this one opens again
    // on the review still on screen (rr.5).
    const onScreen = useApp.getState().review;
    if (onScreen) useApp.getState().openPendingFullEdit(onScreen.id);
    return 'stay';
  }
  if (!(await confirmLeave(target, deps))) return 'stay';
  return latest() ? 'go' : 'stay';
}
