import { unsavedDecisionCount } from '../../shared/diff/compose';
import { historyWhen } from '../../shared/ui/history';
import {
  manualBuildPrompt,
  notSavedLines,
  replaceReviewPrompt,
  reviewWithoutPrompt
} from '../../shared/ui/save';
import type { SaveOptions, SaveOutcome } from './saveChapter';
import { useApp } from './store';

/*
 * No stranded decisions (apply.20). A new review, from Review with AI or from
 * Submit manual review, is made from the chapter file and replaces the review
 * on screen. Changes the file does not have yet would stay behind in the old
 * review, out of sight in History, so both dialogs lead with saving them
 * first, and going on without them takes an answer to a question that says
 * where they stay (`reviewWithoutPrompt`, `manualBuildPrompt` in
 * `src/shared/ui/save.ts`).
 *
 * Main is reached only through the `save` the caller passes (App's
 * `useSaveChapter`), so this module needs neither the DOM nor the preload
 * bridge and is tested in node.
 *
 * A save that leaves the file without the changes says why on cards in the
 * corner of the manuscript pane, under the dialog's backdrop, where they
 * cannot be read or closed while the dialog is open. So the dialog is handed
 * what they said (`onNotSaved`, `notSavedLines`) and shows it itself (apply.20
 * review).
 */

/** Save to chapter, waited for. */
export type SaveFn = (options: SaveOptions) => Promise<SaveOutcome>;

/**
 * Whether a save left the chapter file reading like the page, so a review
 * made from the file now includes every change: `saved` or
 * `nothing-to-save`. A save that was cancelled, blocked or failed has put a
 * card on screen saying why, and nothing starts.
 */
export function fileReadsLikePage(outcome: SaveOutcome): boolean {
  return outcome === 'saved' || outcome === 'nothing-to-save';
}

/**
 * Save to chapter, waited for, and what the cards it put up said when it left
 * the file unlike the page: the text of every card that appeared, or replaced
 * one with the same key, while it ran, in order. Empty after a save that
 * reached the file.
 */
async function saveSaying(save: SaveFn): Promise<{ outcome: SaveOutcome; said: string[] }> {
  const before = new Set(useApp.getState().notifications.map((n) => n.id));
  const outcome = await save({ applyDrafts: 'ask' });
  if (fileReadsLikePage(outcome)) return { outcome, said: [] };
  const said = useApp
    .getState()
    .notifications.filter((n) => !before.has(n.id))
    .map((n) => n.text);
  return { outcome, said };
}

/** History's date for the review on screen, for the questions to say where its changes stay. */
function onScreenFrom(): string | null {
  const review = useApp.getState().review;
  return review ? historyWhen(review.createdAt) : null;
}

function unsavedOnScreen(): number {
  const review = useApp.getState().review;
  return review ? unsavedDecisionCount(review.hunks) : 0;
}

export interface ReviewStartDeps {
  save: SaveFn;
  /** start the review, from the review on screen as it is then (App's `startReview`) */
  start: () => void;
  /** false once the author has closed the dialog, so a save that ends after that starts nothing */
  stillWanted: () => boolean;
  /**
   * what the dialog shows inside itself when the save left the file without
   * the changes (`notSavedLines`; empty when the save said nothing), called
   * only while the dialog is still open
   */
  onNotSaved?: (lines: string[]) => void;
}

/**
 * Review with AI's "Save N changes, then review": Save to chapter, then start
 * the review once the file reads like the page. The review on screen then
 * stands on the bytes just written (`markSaved`), so the review starts from
 * the saved text. A save that did not get there starts nothing, and the
 * dialog is told why. Resolves true when the review was started.
 */
export async function saveThenReview(deps: ReviewStartDeps): Promise<boolean> {
  const { outcome, said } = await saveSaying(deps.save);
  if (!deps.stillWanted()) return false;
  if (!fileReadsLikePage(outcome)) {
    deps.onNotSaved?.(notSavedLines('review', said));
    return false;
  }
  deps.start();
  return true;
}

/**
 * Review with AI's "Review without them": ask first (Cancel focused), then
 * start from the chapter file as it is. With nothing unsaved by the time it
 * is pressed, it starts without asking. Resolves true when the review was
 * started.
 */
export async function reviewWithoutSaving(
  deps: Omit<ReviewStartDeps, 'save' | 'onNotSaved'>
): Promise<boolean> {
  const n = unsavedOnScreen();
  if (n > 0) {
    const ok = await useApp.getState().askConfirm(reviewWithoutPrompt(n, onScreenFrom()));
    if (!ok || !deps.stillWanted()) return false;
  }
  deps.start();
  return true;
}

export interface ManualBuildDeps {
  save: SaveFn;
  /**
   * build the review from the pasted text against the review on screen as it
   * is then, so after Save its base is the saved chapter
   */
  build: () => void;
  /** false once the author has closed Submit manual review */
  stillWanted: () => boolean;
  /** as `ReviewStartDeps.onNotSaved`, in the words for a build */
  onNotSaved?: (lines: string[]) => void;
}

/**
 * Submit manual review's Build review. With changes not saved to the chapter
 * it asks `manualBuildPrompt`'s question: Save then build (focused) saves and
 * builds only once the file reads like the page (when it does not, the dialog
 * is told why), Build without them builds from the file as it is, Cancel
 * builds nothing. With decisions that are all in the file, or only
 * dismissed, it asks the older "Replace the open review?"; with none it
 * builds at once. Resolves true when it built.
 */
export async function buildManualReview(deps: ManualBuildDeps): Promise<boolean> {
  const state = useApp.getState();
  const review = state.review;
  if (!review) return false;
  const n = unsavedDecisionCount(review.hunks);
  if (n > 0) {
    const choice = await state.askChoice(manualBuildPrompt(n, onScreenFrom()));
    if (choice === 'cancel') return false;
    if (choice === 'confirm') {
      const { outcome, said } = await saveSaying(deps.save);
      if (!fileReadsLikePage(outcome)) {
        if (deps.stillWanted()) deps.onNotSaved?.(notSavedLines('build', said));
        return false;
      }
    }
  } else {
    const decided = review.hunks.filter((h) => h.status !== 'pending').length;
    if (decided > 0 && !(await state.askConfirm(replaceReviewPrompt(decided)))) return false;
  }
  if (!deps.stillWanted()) return false;
  deps.build();
  return true;
}
