import { WHOLE_DRAFT_KEY } from '../../shared/ui/drafts';
import {
  FULL_EDIT_WAIT_FOR_REVIEW,
  FULL_EDIT_WAIT_FOR_SAVE,
  boxesBeforeFullEditPrompt,
  boxesBeforePreviewPrompt,
  discardFullEditPrompt,
  fullEditAppliedText,
  fullEditOtherReviewPrompt,
  leaveFullEditPrompt,
  type Mode
} from '../../shared/ui/modes';
import { hoverCancel } from './hover';
import { FULL_EDIT_CARD, changedParagraphCount, currentMode, fullEditDraft, isLocked, useApp } from './store';

/*
 * The Mode select (rr.2, PLAN section 7): Main, Full edit and Preview, the
 * window's own and never kept in the settings. The window starts in Main,
 * and another chapter or review opens in the mode in use (rr.5, the store's
 * `setReview`). Full edit is open while its box is (`fullEditDraft`); Main
 * and Preview are the store's `viewMode`. Switching with something typed and
 * not applied asks first, as leaving the chapter does (`shared/ui/modes.ts`
 * has the questions): nothing typed is ever thrown away unasked.
 *
 * It reaches nothing but the store, so it is tested in node. The cards it
 * shows when Full edit could not go ahead share the store's `FULL_EDIT_CARD`.
 */

/**
 * Apply the open paragraph boxes, closing those left as they opened, as Save
 * to chapter does before it writes. False, with each refusal in a card, when
 * any could not be applied.
 */
function applyBoxes(): boolean {
  const app = useApp.getState;
  for (const draft of Object.values(app().drafts)) {
    if (!draft.whole && draft.text === draft.initial) app().cancelDraft(draft.key);
  }
  const { blocked } = app().commitAllDrafts();
  for (const message of blocked) app().notify('warn', message);
  return blocked.length === 0;
}

/**
 * Full edit's Done, or Ctrl+Enter in its box: what was typed becomes the
 * author's own hunks, as a paragraph box's Done makes them, and the window
 * goes back to Main, with a card saying what changed. False when it could not
 * be applied, the box left open as it is and a card saying why.
 */
export function finishFullEdit(): boolean {
  const state = useApp.getState();
  const outcome = state.commitDraft(WHOLE_DRAFT_KEY);
  if (outcome.status === 'blocked') {
    state.notify('warn', outcome.message, FULL_EDIT_CARD);
    return false;
  }
  if (outcome.status === 'applied') state.notify('info', fullEditAppliedText(outcome), 'edit');
  return true;
}

/**
 * Full edit's Cancel, or Escape in its box: back to Main, after asking when
 * something was typed (`discardFullEditPrompt`, Keep editing focused). True
 * once Full edit is closed; the answer counts only for the box as it still
 * is, since a save may have applied it while the question was open.
 */
export async function cancelFullEdit(): Promise<boolean> {
  const state = useApp.getState();
  const draft = fullEditDraft(state.drafts);
  if (!draft) return true;
  if (draft.text !== draft.initial) {
    const discard = await state.askConfirm(discardFullEditPrompt());
    const now = fullEditDraft(useApp.getState().drafts);
    if (!now) return true;
    if (!discard || now.initial !== draft.initial) return false;
  }
  useApp.getState().cancelDraft(WHOLE_DRAFT_KEY);
  return true;
}

/**
 * Before another review of the chapter, from History or the review selector,
 * replaces the one on screen while Full edit is open (rr.5). The other review
 * opens in Full edit too (the mode is the window's), afresh: the box holds
 * the body as this review composes it, so it goes with this review, and with
 * nothing typed it goes without a question. With typed text it asks as a
 * switch out of Full edit does (`fullEditOtherReviewPrompt`): Apply first,
 * which does what Done does in this review, where the changes stay; Discard;
 * or Cancel. True to go on, the window held in Full edit with no box while
 * the other review loads (`holdFullEdit`); false to stay, after Cancel or a
 * Done that could not apply, whose card says why. The answer counts only for
 * the box as it still is, since a save may have applied it while the
 * question was open.
 */
export async function settleFullEditForReview(): Promise<boolean> {
  const state = useApp.getState();
  const draft = fullEditDraft(state.drafts);
  if (!draft || draft.text === draft.initial) return true;
  const choice = await state.askChoice(fullEditOtherReviewPrompt());
  if (choice === 'cancel') return false;
  const now = fullEditDraft(useApp.getState().drafts);
  if (now && now.initial !== draft.initial) return false;
  if (now && choice === 'confirm' && !finishFullEdit()) return false;
  if (now && choice === 'alt') useApp.getState().cancelDraft(WHOLE_DRAFT_KEY);
  // The window stays in Full edit, with no box, until the other review is on
  // screen, rather than show Main for the moments it takes to load.
  useApp.getState().holdFullEdit();
  return true;
}

/** Why Full edit could not open now, in a card; true when it can. */
function fullEditCanOpen(): boolean {
  const state = useApp.getState();
  const why = isLocked(state)
    ? FULL_EDIT_WAIT_FOR_REVIEW
    : state.chapterSaving
      ? FULL_EDIT_WAIT_FOR_SAVE
      : null;
  if (why) state.notify('info', why, FULL_EDIT_CARD);
  return why === null;
}

/**
 * Switch the window to `target` (the Mode select). Leaving a Full edit whose
 * text changed asks Apply first, Discard or Cancel; opening Full edit with
 * paragraph boxes whose text changed asks to apply them first, as Full edit
 * holds their paragraphs too, and closes those left as they opened; leaving
 * Main for Preview with such boxes asks Keep for later, which leaves them open
 * in Main, Apply first or Cancel. True once the window shows `target`; false
 * when it stays as it was, after Cancel or a refusal whose card says why.
 */
export async function chooseMode(target: Mode): Promise<boolean> {
  const start = useApp.getState();
  if (!start.review) return false;
  const from = currentMode(start);
  if (from === target) return true;
  if (from === 'main') hoverCancel();

  if (from === 'edit') {
    const draft = fullEditDraft(start.drafts);
    if (draft && draft.text !== draft.initial) {
      const choice = await start.askChoice(leaveFullEditPrompt(target));
      if (choice === 'cancel') return false;
      // A save applies an open Full edit too; then there is nothing left to ask about.
      if (fullEditDraft(useApp.getState().drafts)) {
        if (choice === 'confirm') {
          if (!finishFullEdit()) return false;
        } else {
          useApp.getState().cancelDraft(WHOLE_DRAFT_KEY);
        }
      }
    } else if (draft) {
      useApp.getState().cancelDraft(WHOLE_DRAFT_KEY);
    }
    // With no box, the window was waiting to open Full edit on a chapter just
    // opened (rr.5): choosing Main or Preview ends the wait (`setViewMode`).
    if (target !== 'edit') useApp.getState().setViewMode(target);
    return true;
  }

  if (target === 'edit') {
    if (!fullEditCanOpen()) return false;
    const changed = changedParagraphCount(start.drafts);
    if (changed > 0 && !(await start.askConfirm(boxesBeforeFullEditPrompt(changed)))) return false;
    if (!fullEditCanOpen()) return false;
    if (Object.keys(useApp.getState().drafts).length > 0 && !applyBoxes()) return false;
    const refused = useApp.getState().openFullEdit();
    if (refused === 'locked' || refused === 'saving') fullEditCanOpen();
    return refused === null;
  }

  if (from === 'main' && target === 'preview') {
    const changed = changedParagraphCount(start.drafts);
    if (changed > 0) {
      const choice = await start.askChoice(boxesBeforePreviewPrompt(changed));
      if (choice === 'cancel') return false;
      if (choice === 'confirm' && !applyBoxes()) return false;
    }
  }
  useApp.getState().setViewMode(target);
  return true;
}
