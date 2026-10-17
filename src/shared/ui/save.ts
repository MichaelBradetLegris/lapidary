/**
 * What Save to chapter, Ctrl+S, leaving a chapter and closing the window say
 * and do, decided without React or Electron (apply.2, PLAN 11.3 i), and what
 * the two review dialogs offer when the page has changes the chapter file does
 * not (apply.20).
 *
 * The toolbar button, the status bar, the Ctrl+S key, the leave prompt, the
 * close prompt, the review dialogs' save-first choices and main's native
 * fallback boxes all take their words and their rules from here, so every
 * state has a test. One count drives them all:
 * `unsavedDecisionCount`, the decisions the chapter file does not contain yet.
 * That count includes a saved change the author has since turned back, so
 * nothing here calls them "accepted changes"; they are changes not saved to the
 * chapter. The app's name comes from `APP_NAME` (C.21).
 *
 * Pure (CLAUDE.md rule 4): the main process imports it for the close guard.
 */

import { APP_NAME } from '../branding';
import { unsavedDecisionCount } from '../diff/compose';
import type { CloseGuardState } from '../ipc';
import { samePath } from '../paths';
import { chapterName } from '../review';
import type { Review } from '../types';
import type { ConfirmChoice } from './confirm';

/* ------------------------------------------------------------------ */
/* Shared wording                                                       */
/* ------------------------------------------------------------------ */

/** "1 change", "3 changes": the one noun for what Save to chapter writes. */
export function changeCount(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`;
}

/** What a Save with nothing to write says, and the Save button's tooltip then (apply.3). */
export const CHAPTER_MATCHES_PAGE = 'The chapter already matches the page.';

/** The card Ctrl+S shows from inside a paragraph box (PLAN 11.1, Ctrl+S). */
export const PRESS_DONE_FIRST =
  'This paragraph is still open. Press Done or Ctrl+Enter to apply it, then save.';

/**
 * The card Ctrl+S shows while the suggestion editor is open (PLAN 11.1,
 * Ctrl+S). Its words are in no hunk until its own Save, so saving now would
 * write the chapter without them.
 */
export const PRESS_EDITOR_SAVE_FIRST =
  'The suggestion you are editing is still open. Press its Save button or Ctrl+Enter first, then save to the chapter.';

const SAVE_ONLY = 'The chapter file changes only when you press Save to chapter.';

function countLine(n: number): string {
  return `${changeCount(n)} ${n === 1 ? 'is' : 'are'} not saved to the chapter yet.`;
}

/**
 * Where the decisions wait until Save. `olderReviewFrom` is set when the review
 * on screen is not the one the chapter opens with, so the author is told where
 * to find them again. The line says "another review", not "a newer" one: the
 * chapter opens with the review last decided in (`currentReviewId`), and History
 * dates reviews by creation, so that review can carry the earlier date.
 */
function keptLine(olderReviewFrom: string | null | undefined): string {
  if (olderReviewFrom) {
    return `Your decisions are kept in the review from ${olderReviewFrom}. The chapter opens with another review, so reopen this one from History. ${SAVE_ONLY}`;
  }
  return `Your decisions are kept in this review. ${SAVE_ONLY}`;
}

/**
 * Where open paragraph boxes come back (apply.7). Boxes belong to the chapter,
 * not to a review (C.53): after a close or a move to another chapter they open
 * again when the chapter does, on whichever of its reviews is on screen. A
 * review opened from History is that review, so they open there at once, each
 * where its paragraph reads as it did, and a box whose paragraph does not has
 * its text set aside in a .txt (`placeDrafts`, apply.16).
 */
function paragraphLine(p: number, intoReview = false): string {
  if (intoReview) {
    return p === 1
      ? 'The paragraph you are editing is kept as you left it. It opens for editing again in the review you are opening if the paragraph reads the same there; if not, what you typed is set aside in a text file you can open.'
      : `The ${p} paragraphs you are editing are kept as you left them. Each opens for editing again in the review you are opening if its paragraph reads the same there; if not, what you typed in it is set aside in a text file you can open.`;
  }
  return p === 1
    ? 'The paragraph you are editing is kept as you left it and opens for editing again when you come back to this chapter.'
    : `The ${p} paragraphs you are editing are kept as you left them and open for editing again when you come back to this chapter.`;
}

const RUNNING_LINE = 'The review that is running will stop, and its result will be lost.';
const DIALOG_LINE = 'The text you typed in the open dialog will be lost.';

/* ------------------------------------------------------------------ */
/* The Save button and the status bar                                   */
/* ------------------------------------------------------------------ */

export interface SaveButtonInput {
  /** a chapter file is open: a review with a source path */
  hasChapter: boolean;
  /** `unsavedDecisionCount` of the review on screen */
  unsavedDecisions: number;
  /** paragraph boxes whose text differs from what they opened with */
  changedParagraphs: number;
  /** a Save to chapter is under way */
  saving: boolean;
  /** a review of this chapter is running, so the page is read-only */
  locked: boolean;
}

/** What the toolbar holds when it draws Save to chapter and the dot. */
export interface ToolbarSaveContext {
  /** the review on screen, or null when none is open */
  review: Pick<Review, 'sourcePath' | 'hunks'> | null;
  changedParagraphs: number;
  saving: boolean;
  locked: boolean;
}

/**
 * The toolbar's `SaveButtonInput` (apply.4): a chapter is open when the review
 * names a file, the count is `unsavedDecisionCount` of its hunks, and the rest
 * passes through, so a save under way and a running review both reach the
 * button. Pure, so a test can hold every field to what the toolbar knows.
 */
export function saveButtonInput(context: ToolbarSaveContext): SaveButtonInput {
  return {
    hasChapter: Boolean(context.review?.sourcePath),
    unsavedDecisions: context.review ? unsavedDecisionCount(context.review.hunks) : 0,
    changedParagraphs: context.changedParagraphs,
    saving: context.saving,
    locked: context.locked
  };
}

export interface SaveButtonState {
  label: string;
  disabled: boolean;
  /** the tooltip */
  title: string;
  /** true when the chapter name in the toolbar gets the unsaved dot */
  dot: boolean;
}

/**
 * The toolbar's Save button (apply.4): "Save 3 changes to chapter" while
 * something is not saved, plain "Save to chapter" when the file already reads
 * like the page. It stays enabled then, and a press says so
 * (`CHAPTER_MATCHES_PAGE`), because a button that turns grey for no visible
 * reason is harder to read than one that answers. `dot` puts the unsaved dot
 * before the chapter name, labelled by `unsavedDotLabel`.
 */
export function saveButtonState(input: SaveButtonInput): SaveButtonState {
  const n = input.unsavedDecisions;
  if (!input.hasChapter) {
    return { label: 'Save to chapter', disabled: true, title: 'Open a chapter to save to it.', dot: false };
  }
  const dot = n > 0;
  if (input.saving) {
    return { label: 'Saving…', disabled: true, title: 'Writing the chapter file.', dot };
  }
  const label = n > 0 ? `Save ${changeCount(n)} to chapter` : 'Save to chapter';
  if (input.locked) {
    return { label, disabled: true, title: 'Wait for the review to finish, then save.', dot };
  }
  if (input.changedParagraphs > 0) {
    const boxes =
      input.changedParagraphs === 1 ? 'the paragraph' : `the ${input.changedParagraphs} paragraphs`;
    return {
      label,
      disabled: false,
      title: `Write your decisions into the chapter file (Ctrl+S). You are asked first about ${boxes} you are editing.`,
      dot
    };
  }
  if (n > 0) {
    const what = n === 1 ? 'this change' : `these ${n} changes`;
    return { label, disabled: false, title: `Write ${what} into the chapter file (Ctrl+S).`, dot };
  }
  return { label, disabled: false, title: CHAPTER_MATCHES_PAGE, dot };
}

/**
 * The status bar's count (apply.4), beside "N pending" and "N accepted":
 * "3 not saved to chapter". Empty when the chapter matches the page, so the
 * status bar shows nothing rather than a count of zero.
 */
export function unsavedPhrase(n: number): string {
  return n > 0 ? `${n} not saved to chapter` : '';
}

/**
 * The tooltip and spoken name of the dot before the chapter name (apply.4):
 * "3 changes are not saved to the chapter yet." Empty at zero, when there is
 * no dot.
 */
export function unsavedDotLabel(n: number): string {
  return n > 0 ? countLine(n) : '';
}

/**
 * The tooltip of the status bar's "Decisions kept" time and of its count of
 * changes not saved to the chapter (apply.4). "Review saved" used to stand
 * there and read as "chapter saved".
 */
export const KEPT_TOOLTIP = `Your decisions are kept automatically in the review. ${SAVE_ONLY}`;

const twoDigits = (n: number): string => String(n).padStart(2, '0');

/**
 * "Decisions kept 14:02": when the review was last written, in local time on
 * the 24-hour clock, the HH:MM of PLAN apply.4 (backups name their files on
 * the same clock, 6.5). Without a readable time it says only "Decisions kept".
 */
export function keptPhrase(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Decisions kept';
  return `Decisions kept ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Which review the chapter opens with                                  */
/* ------------------------------------------------------------------ */

/** The fields of a review or a `ReviewSummary` that decide which one is current. */
export interface ReviewTimes {
  id: string;
  createdAt: string;
  decidedAt?: string | undefined;
}

function lastDecided(review: ReviewTimes): string {
  return review.decidedAt ?? review.createdAt;
}

/**
 * The id of the review a chapter opens with: the one with the latest
 * `decidedAt ?? createdAt`, ties going to the later `createdAt` (PLAN 6.4; the
 * same rule as `currentOf` in `src/main/reviews.ts`). `live` is the review on
 * screen, whose times are newer than the History list the renderer last
 * fetched; it replaces its own entry, or joins the list when it is not there
 * yet. Null when there are no reviews.
 *
 * The close and leave prompts use it to tell when the decisions on screen sit
 * in an older review that the chapter will not open with.
 */
export function currentReviewId(reviews: readonly ReviewTimes[], live?: ReviewTimes | null): string | null {
  const all = live
    ? reviews.some((r) => r.id === live.id)
      ? reviews.map((r) => (r.id === live.id ? live : r))
      : [...reviews, live]
    : reviews;
  let best: ReviewTimes | null = null;
  for (const review of all) {
    if (!best) {
      best = review;
      continue;
    }
    const a = lastDecided(review);
    const b = lastDecided(best);
    if (a > b || (a === b && review.createdAt > best.createdAt)) best = review;
  }
  return best ? best.id : null;
}

/* ------------------------------------------------------------------ */
/* Leaving a chapter and closing the window                              */
/* ------------------------------------------------------------------ */

/** Which of a prompt's buttons has the focus when it opens. */
export type PromptButton = ConfirmChoice;

/**
 * A three-way question in the shape the confirm dialog takes (`ConfirmSpec`,
 * apply.6), with every field filled in: confirm saves, alt leaves or closes
 * and keeps everything for later, cancel stays.
 */
export interface SavePrompt {
  title: string;
  /** one point per line, separated by "\n"; a dialog that collapses white space shows one paragraph */
  body: string;
  /** the Save choice; empty when saving is not possible now, which hides the button */
  confirmLabel: string;
  altLabel: string;
  cancelLabel: string;
  defaultButton: PromptButton;
}

export interface PromptContext {
  /**
   * Set when the review on screen is not the one the chapter opens with
   * (`currentReviewId`): its date as History shows it. "Older" follows PLAN 11.3
   * (i) and means not the current review, whichever was created first.
   */
  olderReviewFrom?: string | null;
}

/**
 * Whether closing the window needs the page at all (PLAN 11.3 i). False closes
 * at once with no IPC. Pending writes count, so the page gets to flush them,
 * though they ask nothing (`closePrompt` is null then). Null, before the page
 * has said anything, means nothing is known to be at risk.
 */
export function needsAttention(state: CloseGuardState | null): boolean {
  if (!state) return false;
  return (
    state.unsavedDecisions > 0 ||
    state.changedParagraphs > 0 ||
    state.reviewRunning ||
    state.locked ||
    state.writesPending ||
    state.dialogText
  );
}

/**
 * The question before the window closes, or null when nothing needs asking
 * (PLAN 11.3 i). "Close, keep for later" is focused whenever there is
 * something to keep, as the plan asks, even though it also stops a running
 * review and drops typed dialog text when those are listed too. When only a
 * running review or typed dialog text would be lost, the choice is "Close
 * anyway" and Cancel takes the focus, so Enter does not close in that case.
 * Saving is offered only when a chapter is open and no review of it is running.
 */
export function closePrompt(state: CloseGuardState, context: PromptContext = {}): SavePrompt | null {
  const n = state.unsavedDecisions;
  const p = state.changedParagraphs;
  const running = state.reviewRunning || state.locked;
  const keep = n > 0 || p > 0;
  if (!keep && !running && !state.dialogText) return null;

  const lines: string[] = [];
  if (n > 0) lines.push(countLine(n), keptLine(context.olderReviewFrom));
  if (p > 0) lines.push(paragraphLine(p));
  if (running) lines.push(RUNNING_LINE);
  if (state.dialogText) lines.push(DIALOG_LINE);

  const canSave = keep && state.chapter !== null && !state.locked;
  let confirmLabel = '';
  if (canSave) confirmLabel = p > 0 ? 'Apply, save and close' : `Save ${changeCount(n)} and close`;

  return {
    title: `Close ${APP_NAME}?`,
    body: lines.join('\n'),
    confirmLabel,
    altLabel: keep ? 'Close, keep for later' : 'Close anyway',
    cancelLabel: 'Cancel',
    defaultButton: keep ? 'alt' : 'cancel'
  };
}

/** What the author is about to open instead of what is on screen. */
export type LeaveTarget =
  /** a chapter from the list, or the one New chapter has just made */
  | { kind: 'chapter'; path: string }
  /** a review from History; `when` is its date as History shows it */
  | { kind: 'review'; id: string; when: string };

export interface LeaveState extends Pick<
  CloseGuardState,
  'chapter' | 'unsavedDecisions' | 'changedParagraphs' | 'locked'
> {
  /** the id of the review on screen */
  reviewId: string | null;
}

/**
 * Whether `target` is what is already on screen (PLAN 11.3 i): the open
 * chapter, or the review on screen. Opening it again asks nothing and only
 * writes what is waiting (apply.7). The chapter is compared exactly, apart
 * from separators and Unicode form: a path that differs only in case counts as
 * another, which costs a question and loses nothing. The open chapter clicked
 * while another of its reviews is on screen reaches here as the review it
 * opens with (`openedBy` in state/leave.ts), so it is not open.
 */
export function isOpenTarget(state: Pick<LeaveState, 'chapter' | 'reviewId'>, target: LeaveTarget): boolean {
  if (target.kind === 'chapter') return state.chapter !== null && samePath(target.path, state.chapter, false);
  return state.reviewId !== null && target.id === state.reviewId;
}

/**
 * The question before another chapter or another review replaces the one on
 * screen, or null when nothing needs asking (PLAN 11.3 i): nothing unsaved, a
 * review of this chapter running (the page is read-only and its decisions are
 * already written), or the target is what is already open (`isOpenTarget`),
 * which only flushes.
 */
export function leavePrompt(
  state: LeaveState,
  target: LeaveTarget,
  context: PromptContext = {}
): SavePrompt | null {
  if (isOpenTarget(state, target)) return null;
  if (state.locked) return null;
  const n = state.unsavedDecisions;
  const p = state.changedParagraphs;
  if (n === 0 && p === 0) return null;

  const lines: string[] = [];
  if (n > 0) lines.push(countLine(n), keptLine(context.olderReviewFrom));
  if (p > 0) lines.push(paragraphLine(p, target.kind === 'review'));

  let confirmLabel = '';
  if (state.chapter !== null) confirmLabel = p > 0 ? 'Apply and save first' : `Save ${changeCount(n)} first`;

  return {
    title:
      target.kind === 'chapter'
        ? `Leave ${state.chapter !== null ? chapterName(state.chapter) : 'this chapter'}?`
        : `Open the review from ${target.when}?`,
    body: lines.join('\n'),
    confirmLabel,
    altLabel: 'Keep for later',
    cancelLabel: 'Cancel',
    defaultButton: 'alt'
  };
}

/* ------------------------------------------------------------------ */
/* A new review over changes not saved to the chapter (apply.20)         */
/* ------------------------------------------------------------------ */

/*
 * A new review, from Review with AI or Submit manual review, starts from the
 * chapter file and replaces the review on screen. Changes the file does not
 * have yet would stay behind in the old review, out of sight in History, and
 * the dot in the chapter list would go, since it follows the review the
 * chapter opens with. So both dialogs lead with saving them first, and
 * starting without them takes an answer to a question that says where they
 * stay. Enter never leaves them behind: the question about reviewing without
 * them focuses Cancel, and the manual review's question focuses Save.
 */

/** "them", or "it" for one change. */
function them(n: number): string {
  return n === 1 ? 'it' : 'them';
}

/**
 * Where the changes stay when a new review replaces the one they are in:
 * "they stay in the review from <date>", and how to get back to it. `opens`
 * says when the chapter starts opening with the new review.
 */
function stayLines(n: number, reviewFrom: string | null, opens: string): { stay: string; back: string } {
  const where = reviewFrom ? `the review from ${reviewFrom}` : 'this review';
  return {
    stay: `${n === 1 ? 'it stays' : 'they stay'} in ${where}.`,
    back: `${opens}, so reopen ${reviewFrom ? 'that one' : 'this one'} from History to save ${them(n)} later.`
  };
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The Review with AI dialog's buttons for `n` changes not saved to the chapter. */
export interface ReviewStartLabels {
  /** the blue button: "Save 3 changes, then review", or "Start review" when nothing is unsaved */
  primary: string;
  /** "Review without them" (or "it"), which asks first; empty when nothing is unsaved */
  secondary: string;
}

export function reviewStartLabels(n: number): ReviewStartLabels {
  if (n <= 0) return { primary: 'Start review', secondary: '' };
  return { primary: `Save ${changeCount(n)}, then review`, secondary: `Review without ${them(n)}` };
}

/**
 * The warning above those buttons in the Review with AI dialog, or empty when
 * nothing is unsaved: the model reads the chapter file, not the page.
 */
export function reviewStartNote(n: number): string {
  if (n <= 0) return '';
  return `${countLine(n)} The review reads the chapter file, so save ${them(n)} first to have ${them(n)} included.`;
}

/**
 * The question "Review without them" asks (apply.20): reviewing the chapter
 * file as it is leaves the changes in the review on screen, `reviewFrom`
 * (History's date for it), which the chapter stops opening with. Cancel is
 * focused, so Enter does not leave them behind.
 */
export function reviewWithoutPrompt(n: number, reviewFrom: string | null): SavePrompt {
  const { stay, back } = stayLines(
    n,
    reviewFrom,
    'When the new review comes back, the chapter opens with it'
  );
  return {
    title: 'Review without saving?',
    body: [
      countLine(n),
      n === 1
        ? 'The review reads the chapter file, so it will not see this change and may suggest it again.'
        : 'The review reads the chapter file, so it will not see these changes and may suggest some of them again.',
      `${capitalised(stay)} ${back}`
    ].join('\n'),
    confirmLabel: `Review without ${them(n)}`,
    altLabel: '',
    cancelLabel: 'Cancel',
    defaultButton: 'cancel'
  };
}

/**
 * The question Build review asks in Submit manual review when the page has
 * changes not saved to the chapter (apply.20): Save then build (focused),
 * Build without them, or Cancel. The pasted text is compared with the chapter
 * file, so saving first puts the changes in what it is compared with, and
 * where the pasted text was made from the chapter without them, the new review
 * offers their old words back (seen in the window: a saved "lose" came back as
 * "lose → loose"), which the question says.
 */
export function manualBuildPrompt(n: number, reviewFrom: string | null): SavePrompt {
  const { stay, back } = stayLines(n, reviewFrom, 'The chapter then opens with the new review');
  return {
    title: 'Replace the open review?',
    body: [
      countLine(n),
      n === 1
        ? 'Your text is compared with the chapter file. Save first, and the new review starts from the chapter with this change in it; if your text does not have it, the review suggests putting the old words back.'
        : 'Your text is compared with the chapter file. Save first, and the new review starts from the chapter with these changes in it; where your text does not have them, the review suggests putting the old words back.',
      `Build without ${them(n)}, and ${stay} ${back}`
    ].join('\n'),
    confirmLabel: `Save ${changeCount(n)}, then build`,
    altLabel: `Build without ${them(n)}`,
    cancelLabel: 'Cancel',
    defaultButton: 'confirm'
  };
}

/**
 * Build review's question when everything decided is already in the chapter
 * file, or only dismissed: nothing would be left unsaved, but the decisions
 * leave the screen with the review. Worded as before apply.20.
 */
export function replaceReviewPrompt(decided: number): SavePrompt {
  return {
    title: 'Replace the open review?',
    body: `You have decided ${decided} suggestion${
      decided === 1 ? '' : 's'
    } in the review that is open. Building a review from this text replaces the working set. The old review stays in History.`,
    confirmLabel: 'Replace',
    altLabel: '',
    cancelLabel: 'Cancel',
    defaultButton: 'confirm'
  };
}

/* ------------------------------------------------------------------ */
/* Main's native boxes, when the page does not get as far as asking      */
/* ------------------------------------------------------------------ */

/**
 * `no-answer`: the page did not say it received the close request within 3 s.
 * `finishing`: it did, but has not reached its question 10 s later.
 */
export type UnresponsiveStage = 'no-answer' | 'finishing';

/** A native message box with two buttons: Wait, then Close anyway. */
export interface UnresponsiveBox {
  /** the box's window title */
  title: string;
  message: string;
  detail: string;
  waitLabel: string;
  closeLabel: string;
}

/**
 * The words of main's fallback boxes (PLAN 11.3 i), from the last state the
 * page pushed, which may be a moment old; `state` is null when it never pushed
 * one, and the box then names nothing at risk. As in the close prompt, the
 * count of changes not saved to the chapter is followed by where they are
 * kept, so Close anyway does not read as losing them: only decisions not yet
 * written to the review are at risk.
 */
export function unresponsiveDetail(stage: UnresponsiveStage, state: CloseGuardState | null): UnresponsiveBox {
  const lines: string[] = [];
  if (stage === 'finishing') lines.push('It is still writing your decisions.');
  if (state) {
    if (state.unsavedDecisions > 0) {
      lines.push(
        stage === 'no-answer'
          ? `${countLine(state.unsavedDecisions)} They are kept in the review, but decisions made just before it stopped responding may not have reached it.`
          : `${countLine(state.unsavedDecisions)} They are kept in the review, apart from decisions it is still writing.`
      );
    }
    if (state.changedParagraphs > 0 && stage === 'no-answer') {
      lines.push('Paragraph text typed just before it stopped responding may be lost.');
    }
    if (state.reviewRunning || state.locked) lines.push(RUNNING_LINE);
    if (state.dialogText) lines.push(DIALOG_LINE);
  }
  lines.push(
    stage === 'no-answer'
      ? 'Wait gives it more time. Close anyway closes the window now.'
      : 'Wait gives it more time. Close anyway closes the window now, and anything not yet written is lost.'
  );
  return {
    title: APP_NAME,
    message: stage === 'no-answer' ? `${APP_NAME} is not responding` : `${APP_NAME} is still finishing`,
    detail: lines.join('\n'),
    waitLabel: 'Wait',
    closeLabel: 'Close anyway'
  };
}

/* ------------------------------------------------------------------ */
/* Ctrl+S                                                               */
/* ------------------------------------------------------------------ */

/** The parts of a keydown event the shortcut reads. */
export interface ShortcutKey {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface SaveShortcutContext {
  /** a chapter file is open */
  hasChapter: boolean;
  /**
   * a dialog, a prompt, Settings or Setup covers the page; the suggestion
   * editor does not count, see `suggestionEditorOpen`
   */
  modalOpen: boolean;
  /** the key came from inside a paragraph box */
  inParagraphBox: boolean;
  /**
   * the suggestion editor (`EditPopover`, `store.editor`) is open, wherever the
   * focus is. It is a floating panel, not a modal, so the page behind it still
   * takes keys, and the words typed in it reach a hunk only through its Save.
   */
  suggestionEditorOpen: boolean;
  /** a review of this chapter is running */
  locked: boolean;
  /** a Save to chapter is already under way */
  saving: boolean;
  unsavedDecisions: number;
  changedParagraphs: number;
}

export type SaveShortcutAction =
  /** not the save shortcut: leave the event alone */
  | { kind: 'pass' }
  /** the save shortcut with nothing to do now: swallow it and do nothing */
  | { kind: 'ignore' }
  | { kind: 'save' }
  /** show this card instead of saving */
  | { kind: 'card'; message: string };

/**
 * Ctrl+S, or Cmd+S, runs Save to chapter (PLAN 11.1): not behind a modal, so it
 * can never cancel or answer a prompt; not on a held key's repeats; not while a
 * review of the chapter runs or a save is under way; from inside a paragraph
 * box it says to press Done first; while the suggestion editor is open it says
 * to press that editor's Save first, since saving now would write the chapter
 * without the words typed there; and with nothing to write it does nothing.
 * The S is read from `key`, or from the physical key on a layout whose S key
 * types another script, so Ctrl+S works in Cyrillic or Greek too.
 */
export function saveShortcutAction(event: ShortcutKey, context: SaveShortcutContext): SaveShortcutAction {
  const modifier = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  const key = event.key.toLowerCase();
  const isS = key === 's' || (event.code === 'KeyS' && !/^[a-z]$/.test(key));
  if (!modifier || !isS) return { kind: 'pass' };
  if (event.repeat || context.modalOpen || context.locked || context.saving || !context.hasChapter) {
    return { kind: 'ignore' };
  }
  if (context.inParagraphBox) return { kind: 'card', message: PRESS_DONE_FIRST };
  if (context.suggestionEditorOpen) return { kind: 'card', message: PRESS_EDITOR_SAVE_FIRST };
  if (context.unsavedDecisions === 0 && context.changedParagraphs === 0) return { kind: 'ignore' };
  return { kind: 'save' };
}
