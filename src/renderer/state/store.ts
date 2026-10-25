import { create } from 'zustand';
import {
  commitDecisions,
  composeReview,
  composeText,
  findOverlaps,
  unsavedDecisionCount
} from '../../shared/diff/compose';
import {
  applyBlockEdit,
  blockSpanFor,
  editSuggestion,
  fullEditResult,
  fullEditText,
  liveTextIn,
  planBlockEdit,
  planChapterEdit,
  type BlockEditResult
} from '../../shared/edit';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { remapAfterCommit } from '../../shared/review';
import { splitParagraphs } from '../../shared/text/paragraphs';
import { chipHidden, chipKeyOf, type RowChip } from '../../shared/ui/chips';
import { WHOLE_DRAFT_KEY } from '../../shared/ui/drafts';
import { stepIndex } from '../../shared/ui/find';
import {
  FULL_EDIT_CHANGED,
  FULL_EDIT_HOLDS_PARAGRAPHS,
  FULL_EDIT_NOT_EXACT,
  FULL_EDIT_WAIT_FOR_REVIEW,
  FULL_EDIT_WAIT_FOR_SAVE,
  type Mode,
  type ViewMode
} from '../../shared/ui/modes';
import { stepFocus, type StepOptions } from '../../shared/ui/navigate';
import type { SaveShortcutContext } from '../../shared/ui/save';
import { setupLeave, type SetupFor, type SetupFrom, type SetupLanding } from '../../shared/ui/setup';
import type { UpdateStatus } from '../../shared/updates';
import { welcomeShown } from '../../shared/ui/welcome';
import type { Hunk, HunkStatus, Review, ReviewComment, Settings } from '../../shared/types';

export type NotificationTone = 'info' | 'warn' | 'error';

/* The buttons a card may carry are named in shared/ipc.ts, so main can send one too. */
import type { NotificationAction } from '../../shared/ipc';
export type { NotificationAction };

/**
 * A floating card in the top-right of the manuscript pane. Cards stack and stay
 * until the author closes one: nothing here disappears on a timer, because a
 * save error that vanished before it was read is worse than a stale card
 * (plan 7, items 1 and 12).
 */
export interface Notification {
  id: string;
  tone: NotificationTone;
  text: string;
  /**
   * Cards that describe the same recurring event share a key, and a new one
   * replaces the old. Obsidian saves on a debounce while the author types, so
   * without this a long typing session would bury the screen in reload cards.
   */
  key?: string;
  action?: NotificationAction;
  /** what the button acts on, such as the set-aside file Show the text opens (apply.16) */
  actionArg?: string;
}

/* The confirm dialog's question and answers are pure and tested in shared/ui/confirm.ts (apply.6). */
import { offeredChoice, type ConfirmChoice, type ConfirmSpec } from '../../shared/ui/confirm';
export type { ConfirmChoice, ConfirmSpec };

export interface FindState {
  open: boolean;
  query: string;
  /** index of the active match, -1 when there is none */
  index: number;
  count: number;
  /**
   * Bumped only when the author asks to go to a match: typing in the box, Enter,
   * Shift+Enter, the arrows. The pane scrolls to the active match when this
   * changes and at no other time, so accepting a suggestion while the find bar
   * is open no longer jumps back to the match (round 4, item 1). It never goes
   * back to zero, so a closed-and-reopened bar can never mistake a new request
   * for one it already served.
   */
  seek: number;
}

/** Where on screen the editor popover should point. */
export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The editor popover's job: rewriting one suggestion's replacement text
 * (item 3a). Prose itself is edited a paragraph at a time, in place (Phase 5d).
 */
export interface EditorRequest {
  kind: 'suggestion';
  hunkId: string;
  initial: string;
  anchor: AnchorRect | null;
  /**
   * the words in the box once the author has typed, `initial` until then.
   * Kept here rather than in the panel, so the Setup screen, which takes the
   * panel off the page with the rest of the main view, gives them back as
   * typed when it closes (`setup.7` review).
   */
  text?: string;
}

/** The words in the suggestion editor's box. */
export function editorText(request: EditorRequest): string {
  return request.text ?? request.initial;
}

/** What an edit did, so the caller can put the right card on screen. */
export type EditOutcome =
  { status: 'applied'; hunkId: string } | { status: 'noop' } | { status: 'blocked'; message: string };

/**
 * One paragraph open for editing in place (Phase 5d). Several can be open at
 * once. `initial` is what the page said when the box opened, which is how a
 * commit notices that the chapter changed underneath it.
 */
export interface ParagraphDraft {
  /** first paragraph index of the block, which is also the key in `drafts` */
  key: number;
  /** every paragraph index the block covers; usually just `key` */
  paragraphs: number[];
  initial: string;
  text: string;
  /** a range of `text` to select when the box first opens, e.g. a comment's quote */
  select?: { start: number; end: number };
  /**
   * Full edit's box (rr.2): the whole chapter's body, under `WHOLE_DRAFT_KEY`
   * with no paragraphs. It is never open beside a paragraph box, and while it
   * is open the window is in Full edit (`currentMode`).
   */
  whole?: true;
}

export type DraftOutcome =
  | {
      status: 'applied';
      /** new manual hunks */
      added: number;
      /** suggestions accepted because the author typed exactly their fix */
      accepted: number;
      superseded: number;
      firstHunkId: string | null;
    }
  | { status: 'noop' }
  | { status: 'blocked'; message: string };

/** True while a review of the open chapter is running (item 3 of round 3). */
export function isLocked(state: Pick<AppState, 'review' | 'aiBusyPath'>): boolean {
  const path = state.review?.sourcePath;
  return Boolean(path) && state.aiBusyPath === path;
}

/** The last write of a review's json: which file, and when. */
export interface ReviewKept {
  path: string;
  at: string;
}

/**
 * When the review on screen was last written, for the status bar's "Decisions
 * kept" (apply.4), or null. A write belongs to the file it went to, so another
 * review, or a chapter whose review has never been written (`reviewPath`
 * null), shows no time rather than one that is not its own.
 */
export function reviewKeptAt(state: Pick<AppState, 'reviewSavedAt' | 'reviewPath'>): string | null {
  const kept = state.reviewSavedAt;
  return kept !== null && state.reviewPath !== null && kept.path === state.reviewPath ? kept.at : null;
}

/**
 * The dialogs that can hold text the author typed, which closing the window
 * would lose (`CloseGuardState.dialogText`, PLAN 11.3 i). The suggestion
 * editor's words are read from its request instead (`hasDialogText`).
 */
export type DialogTextSource = 'new-chapter' | 'manual-review';

/**
 * True while any dialog holds text the author typed, the suggestion editor
 * included, whether or not it is drawn: the Setup screen leaves it off the
 * page, with its words kept (`EditorRequest.text`).
 */
export function hasDialogText(state: Pick<AppState, 'dialogText' | 'editor'>): boolean {
  const editor = state.editor;
  return (
    Object.values(state.dialogText).some(Boolean) ||
    (editor !== null && editorText(editor) !== editor.initial)
  );
}

/** True when a paragraph editor is open on this paragraph index, or Full edit, which holds them all (rr.2). */
export function inDraft(drafts: Record<number, ParagraphDraft>, paragraph: number): boolean {
  return Object.values(drafts).some((d) => d.whole === true || d.paragraphs.includes(paragraph));
}

/** Paragraph boxes whose text differs from what they opened with, Full edit's box among them (rr.2). */
export function changedParagraphCount(drafts: Record<number, ParagraphDraft>): number {
  return Object.values(drafts).filter((d) => d.text !== d.initial).length;
}

/** Full edit's box (rr.2), or null while Full edit is not open. */
export function fullEditDraft(drafts: Record<number, ParagraphDraft>): ParagraphDraft | null {
  const draft = drafts[WHOLE_DRAFT_KEY];
  return draft?.whole ? draft : null;
}

/** True while Full edit's box holds text it did not open with (rr.2). */
export function fullEditChanged(drafts: Record<number, ParagraphDraft>): boolean {
  const draft = fullEditDraft(drafts);
  return draft !== null && draft.text !== draft.initial;
}

/**
 * The mode the window shows (rr.2): Full edit while its box is open, or while
 * the chapter just opened waits to open it (`fullEditPending`, rr.5), and
 * otherwise Main or Preview, as the Mode select last left it.
 */
export function currentMode(
  state: Pick<AppState, 'drafts' | 'viewMode'> & Partial<Pick<AppState, 'fullEditPending'>>
): Mode {
  return fullEditDraft(state.drafts) || (state.fullEditPending ?? null) !== null ? 'edit' : state.viewMode;
}

/** The card's key when Full edit could not open or be applied, so a newer card replaces the last. */
export const FULL_EDIT_CARD = 'full-edit';

/** Why Full edit did not open (`openFullEdit`). */
export type FullEditRefusal = 'no-chapter' | 'locked' | 'saving' | 'boxes';

/**
 * True while a dialog, a question, Settings, the Setup screen or the welcome
 * guide covers the page (`SaveShortcutContext.modalOpen`). The welcome guide
 * shows while the settings say it is not done, unless Start or Skip closed it
 * this session (`welcomeShown`, setup.11 and its review); a state without
 * settings has none. Diagnostics counts once it is open (hardening.5), and so
 * do About and Restart now's overlay (release.9); a state that does not say
 * has them closed. The suggestion editor is a floating panel, not a modal,
 * and is not counted.
 */
export function isModalOpen(
  state: Pick<
    AppState,
    'confirmSpec' | 'settingsOpen' | 'setupOpen' | 'newChapterOpen' | 'manualReviewOpen' | 'reviewDialogOpen'
  > &
    Partial<Pick<AppState, 'settings' | 'welcomeClosed' | 'diagnosticsOpen' | 'aboutOpen' | 'updateOverlay'>>
): boolean {
  return (
    state.confirmSpec !== null ||
    state.settingsOpen ||
    state.setupOpen ||
    welcomeShown(state.settings, state.welcomeClosed) ||
    state.newChapterOpen ||
    state.manualReviewOpen ||
    state.reviewDialogOpen ||
    (state.diagnosticsOpen ?? null) !== null ||
    (state.aboutOpen ?? false) ||
    (state.updateOverlay ?? false)
  );
}

/**
 * Whether the review pane's keys (j and k, the arrows, a, u, d, e and n) act:
 * only with a review on screen, in Main, and nothing in front of the page.
 * Behind a dialog, a question, Settings, the Setup screen or the welcome guide
 * (`isModalOpen`) they changed what the author could not see: behind Review
 * with AI, a accepted the focused suggestion, which changed the dialog's
 * count and so its blue button, and e opened the suggestion editor over it
 * (apply.20 review). The suggestion editor keeps the keys for its own box,
 * and the pane is read-only while a review of the chapter runs (`isLocked`).
 * They are Main's alone (rr.2 review): Full edit and Preview show no
 * suggestion, so there they acted out of sight, a accepting a suggestion and
 * e opening the suggestion editor over Preview's page, and the arrows, taken
 * to step through the suggestions, could not scroll it.
 */
export function reviewKeysActive(
  state: Pick<
    AppState,
    | 'review'
    | 'aiBusyPath'
    | 'editor'
    | 'confirmSpec'
    | 'settingsOpen'
    | 'setupOpen'
    | 'newChapterOpen'
    | 'manualReviewOpen'
    | 'reviewDialogOpen'
    | 'drafts'
    | 'viewMode'
  > &
    Partial<
      Pick<
        AppState,
        'settings' | 'welcomeClosed' | 'diagnosticsOpen' | 'aboutOpen' | 'updateOverlay' | 'fullEditPending'
      >
    >
): boolean {
  return (
    state.review !== null &&
    state.editor === null &&
    !isModalOpen(state) &&
    !isLocked(state) &&
    currentMode(state) === 'main'
  );
}

/** What Ctrl+S needs to know about the page (`saveShortcutAction`, apply.3). */
export function saveShortcutContext(
  state: AppState,
  inParagraphBox: boolean,
  inFullEdit = false
): SaveShortcutContext {
  return {
    hasChapter: Boolean(state.review?.sourcePath),
    modalOpen: isModalOpen(state),
    inParagraphBox,
    ...(inFullEdit ? { inFullEdit: true } : {}),
    suggestionEditorOpen: state.editor !== null,
    locked: isLocked(state),
    saving: state.chapterSaving,
    unsavedDecisions: state.review ? unsavedDecisionCount(state.review.hunks) : 0,
    changedParagraphs: changedParagraphCount(state.drafts)
  };
}

/**
 * Decisions that would change the review while Save to chapter writes it are
 * held back until it is done (apply.3): the save folds into the new base
 * exactly the decisions it wrote, so one made in the meantime would be
 * recorded as saved without being in the file.
 */
function held(state: Pick<AppState, 'review' | 'aiBusyPath' | 'chapterSaving'>): boolean {
  return isLocked(state) || state.chapterSaving;
}

/** Suggestions that must not change right now: all of them during a review or a save, or those under an open editor. */
function frozen(state: AppState, hunk: Hunk): boolean {
  return held(state) || inDraft(state.drafts, hunk.paragraph);
}

/**
 * The review after Save to chapter wrote `review`: its decisions folded into
 * the base, which now has the written file's hash (PLAN 6.3, step 3). Comments
 * and labels follow their paragraphs into the new base (files.21).
 */
export function savedReview(review: Review, hash: string): Review {
  const committed = commitDecisions(review.base.text, review.hunks);
  // A save that split or joined a paragraph renumbers the ones after it.
  const remapped = remapAfterCommit(review.base.text, review.hunks, committed, review.comments);
  const now = new Date().toISOString();
  return {
    ...review,
    base: { ...review.base, text: committed.text, hash },
    hunks: remapped.hunks,
    comments: remapped.comments,
    updatedAt: now,
    decidedAt: now
  };
}

/**
 * Whether the review on screen is the one Save to chapter wrote (apply.3):
 * that object, or a copy of the same review on the same base whose decisions
 * compose the same text, which is what reading the review back during the
 * write puts on screen. Decisions are held while the file is written, so such
 * a copy carries nothing the file lacks. A copy on another base, such as one
 * rebased onto newer bytes, is not the written review.
 */
export function isWrittenReview(onScreen: Review, written: Review): boolean {
  if (onScreen === written) return true;
  return (
    onScreen.id === written.id &&
    onScreen.sourcePath === written.sourcePath &&
    onScreen.base.hash === written.base.hash &&
    composeReview(onScreen) === composeReview(written)
  );
}

export interface AppState {
  settings: Settings | null;
  review: Review | null;
  reviewPath: string | null;
  /**
   * the last review json write: its file and wall-clock time. The status bar
   * reads it through `reviewKeptAt`, so it shows only for that review.
   */
  reviewSavedAt: ReviewKept | null;
  /**
   * a review json write is waiting or running, for any review (apply.1), or
   * failed and has not been made since (apply.9)
   */
  persistPending: boolean;
  /**
   * a write of kept paragraph boxes is waiting, running or held, for any
   * chapter (apply.16), or failed and has not been made since (apply.9)
   */
  draftWritesPending: boolean;
  /**
   * which dialogs hold text the author typed: New chapter's name or text,
   * Submit manual review's corrected text (apply.16). Read through
   * `hasDialogText`, which counts the suggestion editor's changed words too.
   */
  dialogText: Record<DialogTextSource, boolean>;
  focusedHunkId: string | null;
  /** bumped whenever the focused hunk should be scrolled into view */
  focusScrollToken: number;
  /** the hunk under the pointer; never scrolls anything (item 3) */
  hoveredHunkId: string | null;
  /** the comment the author last clicked, in the gutter or the sidebar (item 7) */
  activeCommentId: string | null;
  /**
   * the chips the author has hidden, categories and You (polish.11) and the
   * comments (polish.13); empty means show everything
   */
  hiddenCategories: RowChip[];
  notifications: Notification[];
  confirmSpec: ConfirmSpec | null;
  find: FindState;
  /** the editor popover, open on exactly one thing at a time (item 3) */
  editor: EditorRequest | null;
  /** "Accept now" in the editor, remembered between edits */
  editorAccept: boolean;
  newChapterOpen: boolean;
  manualReviewOpen: boolean;
  reviewDialogOpen: boolean;
  settingsOpen: boolean;
  /** the Setup screen stands in place of the chapter, in the view `setupFor` names */
  setupOpen: boolean;
  /** which view the Setup screen shows: Claude's, or ChatGPT's sign-in (codex.2) */
  setupFor: SetupFor;
  /** where the Setup screen was opened from, which Done, Close and Escape go back to (setup.19) */
  setupFrom: SetupFrom;
  /**
   * Where leaving the Setup screen has just landed (setup.19, `setupLeave`):
   * Review with AI and the welcome guide read it as they are drawn again, to
   * take the focus, and App clears it once they have; null otherwise.
   */
  setupLanding: SetupLanding | null;
  /**
   * the Diagnostics dialog is open (hardening.5): `copy` from Setup's Copy
   * diagnostics, which copies the report as it comes in, `show` from a card's
   * Show diagnostics; null when closed
   */
  diagnosticsOpen: 'copy' | 'show' | null;
  /** the About dialog is open (release.9), from Settings' About */
  aboutOpen: boolean;
  /**
   * Where the updater is, as main last said (`update:get`, then each
   * `update:state`; release.9); null until main has answered. The update
   * card and About's status line are drawn from it.
   */
  updateStatus: UpdateStatus | null;
  /**
   * Restart now's overlay covers the window (release.9): from the moment the
   * page has agreed to go until the app quits, or the install fails.
   */
  updateOverlay: boolean;
  /**
   * Start or Skip closed the welcome guide in this run (setup.11 review). It
   * keeps the guide away even while the settings still say it is not done,
   * as after a write of `onboardingDone` that failed, until Show the welcome
   * guide again has written its settings (`state/welcome.ts`).
   */
  welcomeClosed: boolean;
  /** Save to chapter is writing the file (`state/saveChapter.ts`); decisions wait meanwhile */
  chapterSaving: boolean;
  /**
   * paragraphs open for editing in place, keyed by their first paragraph
   * index, or Full edit's box under `WHOLE_DRAFT_KEY` (rr.2)
   */
  drafts: Record<number, ParagraphDraft>;
  /**
   * Main or Preview, the view the window shows while Full edit is not open
   * (rr.2, `currentMode`). The window's own, never kept in the settings: the
   * window starts in Main, and another chapter or review keeps it (rr.5),
   * unless paragraph boxes with typed text come back with it, which open it
   * in Main (`reopenDrafts`, rr.5 review).
   */
  viewMode: ViewMode;
  /**
   * The id of the review on screen while the window waits to open Full edit
   * on it (rr.5): another chapter or review opened from Full edit opens in
   * Full edit, but only once what was kept for its chapter is back
   * (`openPendingFullEdit`), since a box with typed text, or Full edit's own,
   * goes first. Meanwhile the window is in Full edit (`currentMode`) with no
   * box, so the column draws nothing rather than Main for a moment. Null
   * otherwise.
   */
  fullEditPending: string | null;
  /** the chapter an AI review is running for; its review is read-only until it returns */
  aiBusyPath: string | null;

  setSettings: (settings: Settings) => void;
  /**
   * Put `review` on screen. `mode` is the mode it opens in, as it was in use
   * when the author chose it (rr.5); without it, Main or Preview stays and
   * Full edit stays only with its box, on the same review.
   */
  setReview: (review: Review | null, path?: string | null, mode?: Mode) => void;
  patchReview: (patch: (review: Review) => Review) => void;
  setHunkStatus: (id: string, status: HunkStatus) => void;
  toggleAccepted: (id: string) => void;
  toggleDismissed: (id: string) => void;
  /** apply one status to an explicit set of hunks, as planned by bulkPlan */
  applyBulk: (ids: readonly string[], status: HunkStatus) => void;
  focusHunk: (id: string | null, options?: { scroll?: boolean }) => void;
  /**
   * j and k, and with `pendingOnly` Shift+J and Shift+K; `view` is what is on
   * screen, which they start from when the focus is not (11.7, small.9).
   */
  moveFocus: (delta: number, options?: StepOptions) => void;
  setHoveredHunk: (id: string | null) => void;
  setActiveComment: (id: string | null) => void;
  toggleCategory: (category: RowChip) => void;
  /** Show only, and the eye's Hide all categories (polish.11) */
  setHiddenCategories: (categories: readonly RowChip[]) => void;
  clearCategoryFilter: () => void;
  notify: (
    tone: NotificationTone,
    text: string,
    key?: string,
    action?: NotificationAction,
    actionArg?: string
  ) => string;
  /**
   * Show the card for `key`, or update the one already showing in place: same
   * id, same position in the stack, new tone, text and button. For things that
   * change state, like a download's progress, where a card that jumped to the
   * bottom on every update would be hard to follow.
   */
  upsertNotification: (
    key: string,
    tone: NotificationTone,
    text: string,
    action?: NotificationAction
  ) => string;
  dismissNotification: (id: string) => void;
  /** close every card with this key, for example once Claude is ready */
  dismissNotificationsByKey: (key: string) => void;
  clearNotifications: () => void;
  /**
   * Show the confirm dialog and resolve with the button that answered it:
   * `confirm`, `alt` or `cancel` (Escape is cancel). A second question
   * replaces the first, which resolves `cancel`.
   */
  askChoice: (spec: ConfirmSpec) => Promise<ConfirmChoice>;
  /** `askChoice` for a yes-or-no question: true only for confirm. */
  askConfirm: (spec: ConfirmSpec) => Promise<boolean>;
  /** The dialog's answer; a choice the question does not show counts as cancel. */
  answerChoice: (choice: ConfirmChoice) => void;
  /** `answerChoice` for a yes-or-no question: true is confirm, false cancel. */
  answerConfirm: (ok: boolean) => void;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (query: string) => void;
  setFindMatches: (count: number) => void;
  stepFind: (delta: number) => void;
  setNewChapterOpen: (open: boolean) => void;
  setManualReviewOpen: (open: boolean) => void;
  setReviewDialogOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSetupOpen: (open: boolean) => void;
  setSetupFor: (view: SetupFor) => void;
  /**
   * The Setup screen in `view`, in place of Review with AI and Settings,
   * noting where it was opened from (setup.19). Asked for again from
   * anywhere but Review with AI while it is open, it keeps where it was first
   * opened from.
   */
  openSetupScreen: (view: SetupFor, from: SetupFrom) => void;
  /**
   * Done, Close or Escape on the Setup screen (setup.19): it closes, and
   * Review with AI opens again when its Open Setup led there (`setupLeave`).
   */
  leaveSetup: () => void;
  setSetupFrom: (from: SetupFrom) => void;
  setSetupLanding: (landing: SetupLanding | null) => void;
  setDiagnosticsOpen: (open: 'copy' | 'show' | null) => void;
  setAboutOpen: (open: boolean) => void;
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateOverlay: (shown: boolean) => void;
  setWelcomeClosed: (closed: boolean) => void;
  setChapterSaving: (saving: boolean) => void;
  /** say whether a dialog holds text the author typed; unchanged state sets nothing */
  setDialogText: (source: DialogTextSource, typed: boolean) => void;
  /**
   * Fold the decisions into the base after Save to chapter wrote the file
   * (`savedReview`). With `written`, only when the review on screen is that
   * review (`isWrittenReview`); false, with nothing changed, when the screen
   * has moved on or holds a copy that reads differently.
   */
  markSaved: (hash: string, written?: Review) => boolean;
  /** the review json at `path` was just written, at `at` or now */
  markReviewPersisted: (path: string, at?: string) => void;

  /* ---- editing (item 3) ---- */
  setCommentStatus: (id: string, status: ReviewComment['status']) => void;
  /** open the editor; on the suggestion it is already open on, the words typed stay */
  openEditor: (request: EditorRequest) => void;
  /** the words in the editor's box, as the author types them */
  setEditorText: (text: string) => void;
  closeEditor: () => void;
  setEditorAccept: (accept: boolean) => void;
  /** rewrite a suggestion's replacement text (item 3a) */
  editHunkText: (id: string, replacement: string, accept: boolean) => EditOutcome;

  /* ---- paragraph editing (Phase 5d) ---- */
  /** open the paragraph containing this index for editing; false when it cannot be */
  openDraft: (paragraph: number, select?: { start: number; end: number }) => boolean;
  setDraftText: (key: number, text: string) => void;
  cancelDraft: (key: number) => void;
  /**
   * Open boxes kept from before (apply.16), as `placeDrafts` placed them. A box
   * whose paragraphs another open box covers is skipped. Full edit's box opens
   * the window in Full edit (rr.2), and a paragraph box with typed text opens
   * it in Main from Preview, where the boxes show (rr.5 review). Returns how
   * many opened.
   */
  reopenDrafts: (drafts: readonly ParagraphDraft[]) => number;
  /** turn one open paragraph, or Full edit's box, into hunks and close it */
  commitDraft: (key: number) => DraftOutcome;
  /** commit every open paragraph, first to last; the messages of any that could not be */
  commitAllDrafts: () => { applied: number; blocked: string[] };

  /* ---- modes (rr.2) ---- */
  /** Main or Preview; Full edit opens and closes with its box */
  setViewMode: (mode: ViewMode) => void;
  /**
   * Open Full edit on the chapter as the page reads it, in Main once it
   * closes, or say why not: no chapter, a review of it running, a save under
   * way, or paragraph boxes open, which the caller deals with first.
   */
  openFullEdit: () => FullEditRefusal | null;
  /**
   * Open the Full edit the window waits for on review `reviewId`
   * (`fullEditPending`, rr.5), now that what was kept for its chapter is
   * back, or there was nothing (`state/drafts.ts`), or now that another
   * review failed to open over it (App). What came back decides first: Full
   * edit's own typed text is already open, as left; paragraph boxes with
   * typed text keep the window in Main, where they show; boxes left as they
   * opened close, as on the way into Full edit. A review of the chapter
   * running, or a save, keeps it in Main with a card saying why. Nothing
   * happens when the window waits for no Full edit, or for another review's.
   */
  openPendingFullEdit: (reviewId: string) => void;
  /**
   * Keep the window in Full edit, with no box, while another review of the
   * chapter loads (rr.5): Discard or Apply first closed Full edit's box on
   * the way, and Main drawn for those moments would flash up between two
   * Full edits. The review that comes on screen opens it afresh
   * (`setReview`); one that fails to open leaves this review, where App
   * opens it again (`openPendingFullEdit`).
   */
  holdFullEdit: () => void;

  setAiBusy: (sourcePath: string | null) => void;
}

/**
 * The review with new hunk decisions. Every decision path goes through here
 * (status changes, bulk actions, edited suggestions, paragraph edits), which is
 * what makes `decidedAt` mean "the review last worked in" (files.1).
 */
function withHunks(review: Review, hunks: Hunk[]): Review {
  const now = new Date().toISOString();
  return { ...review, hunks, updatedAt: now, decidedAt: now };
}

let notificationSeq = 0;
let confirmResolve: ((choice: ConfirmChoice) => void) | null = null;

const NO_FIND: FindState = { open: false, query: '', index: -1, count: 0, seek: 0 };

export const useApp = create<AppState>()((set, get) => ({
  settings: null,
  review: null,
  reviewPath: null,
  reviewSavedAt: null,
  persistPending: false,
  draftWritesPending: false,
  dialogText: { 'new-chapter': false, 'manual-review': false },
  focusedHunkId: null,
  focusScrollToken: 0,
  hoveredHunkId: null,
  activeCommentId: null,
  hiddenCategories: [],
  notifications: [],
  confirmSpec: null,
  find: NO_FIND,
  editor: null,
  editorAccept: true,
  newChapterOpen: false,
  manualReviewOpen: false,
  reviewDialogOpen: false,
  settingsOpen: false,
  setupOpen: false,
  setupFor: 'claude',
  setupFrom: 'elsewhere',
  setupLanding: null,
  diagnosticsOpen: null,
  aboutOpen: false,
  updateStatus: null,
  updateOverlay: false,
  welcomeClosed: false,
  chapterSaving: false,
  drafts: {},
  viewMode: 'main',
  fullEditPending: null,
  aiBusyPath: null,

  setSettings: (settings) => set({ settings }),

  /* Open paragraph editors survive a reload of the same review (the watcher
     rebasing it after an outside change): the commit checks whether their
     paragraph still reads the same. Anything else starts with none open, and
     Full edit's box goes with them; what was typed in either comes back from
     the chapter's drafts file (state/drafts.ts).

     The mode is the window's (rr.5): another chapter or review opens in the
     mode in use, which the caller passes as it was when the author chose,
     since a question on the way (the leave question's Apply and save first)
     may have closed Full edit meanwhile. Main and Preview are set at once;
     paragraph boxes with typed text that come back then open Preview's
     chapter in Main, where they show (`reopenDrafts`, rr.5 review). Full
     edit is a box that opens afresh on the new review, but only once
     what was kept for its chapter is back (`openPendingFullEdit`): a box opened
     now would leave a kept one no room and set it aside. Until then the
     window waits in Full edit (`fullEditPending`), with `viewMode` Main, where
     Full edit's Done and Cancel go back to. A review with no chapter file has
     no drafts to wait for, and opens in Main. */
  setReview: (review, path = null, mode) =>
    set((state) => {
      const sameReview = review !== null && state.review !== null && review.id === state.review.id;
      const drafts = sameReview ? state.drafts : {};
      const viewMode: ViewMode =
        mode === undefined ? state.viewMode : mode === 'preview' ? 'preview' : 'main';
      const fullEditPending =
        mode === undefined
          ? sameReview
            ? state.fullEditPending
            : null
          : mode === 'edit' && review !== null && review.sourcePath !== '' && !fullEditDraft(drafts)
            ? review.id
            : null;
      return {
        review,
        reviewPath: path,
        focusedHunkId: review?.hunks.find((h) => h.anchor !== 'stale')?.id ?? null,
        hoveredHunkId: null,
        activeCommentId: null,
        hiddenCategories: [],
        find: { ...NO_FIND, seek: state.find.seek },
        editor: null,
        drafts,
        viewMode,
        fullEditPending
      };
    }),

  patchReview: (patch) => {
    const review = get().review;
    if (!review) return;
    set({ review: patch(review) });
  },

  setHunkStatus: (id, status) => {
    const state = get();
    const review = state.review;
    const hunk = review?.hunks.find((h) => h.id === id);
    if (!review || !hunk || frozen(state, hunk)) return;
    const hunks = review.hunks.map((h) => (h.id === id ? { ...h, status } : h));
    set({ review: withHunks(review, hunks) });
  },

  toggleAccepted: (id) => {
    const hunk = get().review?.hunks.find((h) => h.id === id);
    if (!hunk) return;
    get().setHunkStatus(id, hunk.status === 'accepted' ? 'pending' : 'accepted');
    set({ focusedHunkId: id });
  },

  toggleDismissed: (id) => {
    const hunk = get().review?.hunks.find((h) => h.id === id);
    if (!hunk) return;
    get().setHunkStatus(id, hunk.status === 'dismissed' ? 'pending' : 'dismissed');
    set({ focusedHunkId: id });
  },

  applyBulk: (ids, status) => {
    const state = get();
    const review = state.review;
    if (!review || ids.length === 0 || held(state)) return;
    const wanted = new Set(ids);
    let changed = false;
    const hunks = review.hunks.map((h) => {
      if (!wanted.has(h.id) || frozen(state, h) || h.status === status) return h;
      changed = true;
      return { ...h, status };
    });
    if (changed) set({ review: withHunks(review, hunks) });
  },

  /**
   * Focus follows the keyboard and the suggestions list. Only those two ask for
   * a scroll; a click or a hover in the pane must leave the page where it is
   * (item 3), so `scroll` defaults to false.
   */
  focusHunk: (id, options) =>
    set((state) => ({
      focusedHunkId: id,
      focusScrollToken: options?.scroll ? state.focusScrollToken + 1 : state.focusScrollToken
    })),

  moveFocus: (delta, options) => {
    const review = get().review;
    if (!review) return;
    const hidden = get().hiddenCategories;
    const visible = review.hunks.filter((h) => h.anchor !== 'stale' && !chipHidden(h, hidden));
    const next = stepFocus(visible, get().focusedHunkId, delta > 0 ? 1 : -1, options);
    if (next === null) return;
    set((state) => ({
      focusedHunkId: next,
      focusScrollToken: state.focusScrollToken + 1
    }));
  },

  setHoveredHunk: (id) => set({ hoveredHunkId: id }),

  setActiveComment: (id) => set({ activeCommentId: id }),

  toggleCategory: (category) => {
    const hidden = get().hiddenCategories;
    set({
      hiddenCategories: hidden.includes(category)
        ? hidden.filter((c) => c !== category)
        : [...hidden, category]
    });
  },

  setHiddenCategories: (categories) => set({ hiddenCategories: [...new Set(categories)] }),

  clearCategoryFilter: () => set({ hiddenCategories: [] }),

  notify: (tone, text, key, action, actionArg) => {
    notificationSeq += 1;
    const id = `n${notificationSeq}`;
    set((state) => ({
      notifications: [
        ...(key ? state.notifications.filter((n) => n.key !== key) : state.notifications),
        {
          id,
          tone,
          text,
          ...(key ? { key } : {}),
          ...(action ? { action } : {}),
          ...(action && actionArg !== undefined ? { actionArg } : {})
        }
      ]
    }));
    return id;
  },

  upsertNotification: (key, tone, text, action) => {
    const existing = get().notifications.find((n) => n.key === key);
    if (!existing) return get().notify(tone, text, key, action);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === existing.id ? { id: n.id, tone, text, key, ...(action ? { action } : {}) } : n
      )
    }));
    return existing.id;
  },

  dismissNotification: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

  dismissNotificationsByKey: (key) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.key !== key) })),

  clearNotifications: () => set({ notifications: [] }),

  askChoice: (spec) => {
    // A second question replaces the first; the first is answered "cancel".
    if (confirmResolve) confirmResolve('cancel');
    set({ confirmSpec: spec });
    return new Promise<ConfirmChoice>((resolve) => {
      confirmResolve = resolve;
    });
  },

  askConfirm: async (spec) => (await get().askChoice(spec)) === 'confirm',

  answerChoice: (choice) => {
    const resolve = confirmResolve;
    const spec = get().confirmSpec;
    confirmResolve = null;
    set({ confirmSpec: null });
    if (resolve) resolve(spec ? offeredChoice(spec, choice) : 'cancel');
  },

  answerConfirm: (ok) => get().answerChoice(ok ? 'confirm' : 'cancel'),

  openFind: () => set((state) => ({ find: { ...state.find, open: true } })),

  closeFind: () => set((state) => ({ find: { ...NO_FIND, seek: state.find.seek } })),

  setFindQuery: (query) =>
    set((state) => ({ find: { ...state.find, query, index: 0, count: 0, seek: state.find.seek + 1 } })),

  setFindMatches: (count) =>
    set((state) => {
      const index = count === 0 ? -1 : Math.min(Math.max(0, state.find.index), count - 1);
      return { find: { ...state.find, count, index } };
    }),

  /* Stepping always asks for a scroll, even when there is one match and the
     index cannot move: the author may have scrolled away from it. */
  stepFind: (delta) =>
    set((state) => ({
      find: {
        ...state.find,
        index: stepIndex(state.find.index, state.find.count, delta),
        seek: state.find.seek + 1
      }
    })),

  setNewChapterOpen: (newChapterOpen) => set({ newChapterOpen }),

  setManualReviewOpen: (manualReviewOpen) => set({ manualReviewOpen }),

  setReviewDialogOpen: (reviewDialogOpen) => set({ reviewDialogOpen }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setSetupOpen: (setupOpen) => set({ setupOpen }),
  setSetupFor: (setupFor) => set({ setupFor }),
  openSetupScreen: (setupFor, setupFrom) =>
    set((state) => ({
      setupOpen: true,
      setupFor,
      /* Asked for again while it is open, by the status bar's label, Settings'
         Setup over it or the Review menu, in either view, it keeps where it
         was first opened from (setup.19 review). Open Setup in a Review with
         AI opened over it is a way in of its own, the dialog the author has
         just left. */
      setupFrom: state.setupOpen && setupFrom === 'elsewhere' ? state.setupFrom : setupFrom,
      setupLanding: null,
      reviewDialogOpen: false,
      settingsOpen: false
    })),
  leaveSetup: () =>
    set((state) => {
      if (!state.setupOpen) return {};
      const landing = setupLeave(state.setupFrom, state.setupFor, {
        chapterOpen: Boolean(state.review?.sourcePath),
        reviewRunning: state.aiBusyPath !== null,
        welcomeShown: welcomeShown(state.settings, state.welcomeClosed)
      });
      return {
        setupOpen: false,
        setupFrom: 'elsewhere',
        setupLanding: landing,
        ...(landing.to === 'review-dialog' ? { reviewDialogOpen: true } : {})
      };
    }),
  setSetupFrom: (setupFrom) => set({ setupFrom }),
  setSetupLanding: (setupLanding) => set({ setupLanding }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  setUpdateOverlay: (updateOverlay) => set({ updateOverlay }),
  setWelcomeClosed: (welcomeClosed) => set({ welcomeClosed }),

  setChapterSaving: (chapterSaving) => set({ chapterSaving }),

  setDialogText: (source, typed) =>
    set((state) =>
      state.dialogText[source] === typed ? {} : { dialogText: { ...state.dialogText, [source]: typed } }
    ),

  /* ---------------- editing (item 3) ---------------- */

  setCommentStatus: (id, status) => {
    const review = get().review;
    if (!review || held(get())) return;
    set({
      review: {
        ...review,
        comments: review.comments.map((c) => (c.id === id ? { ...c, status } : c)),
        updatedAt: new Date().toISOString(),
        decidedAt: new Date().toISOString()
      }
    });
  },

  openEditor: (editor) => {
    const state = get();
    const hunk = state.review?.hunks.find((h) => h.id === editor.hunkId);
    if (!hunk || frozen(state, hunk)) return;
    // The pencil again on the suggestion being edited moves the editor and
    // keeps what was typed, as when the panel kept the words itself.
    const open = state.editor;
    const typed = open?.hunkId === editor.hunkId && editor.text === undefined ? open.text : undefined;
    set({ editor: typed === undefined ? editor : { ...editor, text: typed } });
  },

  setEditorText: (text) =>
    set((state) =>
      state.editor && editorText(state.editor) !== text ? { editor: { ...state.editor, text } } : {}
    ),

  closeEditor: () => set({ editor: null }),

  setEditorAccept: (editorAccept) => set({ editorAccept }),

  editHunkText: (id, replacement, accept) => {
    const state = get();
    const review = state.review;
    const hunk = review?.hunks.find((h) => h.id === id);
    if (!review || !hunk) return { status: 'blocked', message: 'That suggestion is no longer here.' };
    if (frozen(state, hunk)) {
      return { status: 'blocked', message: 'That suggestion cannot change right now.' };
    }
    if (replacement === hunk.replacement && (!accept || hunk.status === 'accepted')) {
      return { status: 'noop' };
    }
    const hunks = review.hunks.map((h) =>
      h.id === id ? editSuggestion(review.base.text, h, replacement, accept) : h
    );
    set({ review: withHunks(review, hunks), focusedHunkId: id });
    return { status: 'applied', hunkId: id };
  },

  /* ---------------- paragraph editing (Phase 5d) ---------------- */

  openDraft: (paragraph, select) => {
    const state = get();
    const review = state.review;
    if (!review || held(state)) return false;
    // Full edit holds every paragraph (rr.2): a box beside it would edit the same words twice.
    if (fullEditDraft(state.drafts)) {
      state.notify('info', FULL_EDIT_HOLDS_PARAGRAPHS, 'full-edit-open');
      return false;
    }

    const open = Object.values(state.drafts).find((d) => d.paragraphs.includes(paragraph));
    if (open) return true;

    const base = review.base.text;
    const span = blockSpanFor(base, splitParagraphs(base), review.hunks, paragraph);
    if (!span) {
      state.notify('warn', 'That paragraph is no longer in the chapter.');
      return false;
    }

    const key = span.paragraphs[0] ?? paragraph;
    const initial = liveTextIn(base, review.hunks, span);
    const draft: ParagraphDraft = {
      key,
      paragraphs: span.paragraphs,
      initial,
      text: initial,
      ...(select ? { select } : {})
    };
    // A box the author opens while the window waits to open Full edit (rr.5) is Main's: the wait ends.
    set({
      drafts: { ...state.drafts, [key]: draft },
      editor: null,
      hoveredHunkId: null,
      fullEditPending: null
    });
    return true;
  },

  setDraftText: (key, text) =>
    set((state) => {
      const draft = state.drafts[key];
      if (!draft) return {};
      return { drafts: { ...state.drafts, [key]: { ...draft, text } } };
    }),

  cancelDraft: (key) =>
    set((state) => {
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next };
    }),

  reopenDrafts: (incoming) => {
    const state = get();
    if (!state.review || incoming.length === 0) return 0;
    const drafts = { ...state.drafts };
    const taken = new Set(Object.values(drafts).flatMap((d) => d.paragraphs));
    /* Full edit's box (rr.2) goes back only onto a page with no box open, and
       none goes back beside it; back, the window is in Full edit, which
       closes into Main. Paragraph boxes with typed text that go back while
       the window is in Preview, as on another chapter opened from it, open it
       in Main, where they show beside the card that names them (rr.5
       review): Preview kept over them would hide boxes the card says are
       open again. Boxes left as they opened stay behind Preview, as a switch
       to Preview leaves them. */
    let whole = fullEditDraft(drafts) !== null;
    let opened = 0;
    let typed = false;
    for (const draft of incoming) {
      if (draft.whole) {
        if (whole || Object.keys(drafts).length > 0) continue;
        whole = true;
        drafts[WHOLE_DRAFT_KEY] = {
          key: WHOLE_DRAFT_KEY,
          paragraphs: [],
          initial: draft.initial,
          text: draft.text,
          whole: true
        };
        opened += 1;
        continue;
      }
      if (whole || draft.paragraphs.some((p) => taken.has(p))) continue;
      for (const p of draft.paragraphs) taken.add(p);
      drafts[draft.key] = {
        key: draft.key,
        paragraphs: [...draft.paragraphs],
        initial: draft.initial,
        text: draft.text
      };
      opened += 1;
      if (draft.text !== draft.initial) typed = true;
    }
    if (opened === 0) return 0;
    set(
      whole
        ? {
            drafts,
            viewMode: 'main',
            editor: null,
            hoveredHunkId: null,
            find: { ...NO_FIND, seek: state.find.seek }
          }
        : typed && state.viewMode === 'preview'
          ? { drafts, viewMode: 'main' }
          : { drafts }
    );
    return opened;
  },

  /**
   * The author finished a paragraph. Its changed words become manual hunks and
   * the suggestions they swallowed are superseded, so the composed text stays a
   * pure function of the base plus the decisions (CLAUDE.md rule 5).
   *
   * If the paragraph no longer reads what the box started from, the chapter
   * changed on disk while the author typed. Committing then would silently undo
   * that outside change, so the box stays open with the author's words in it.
   *
   * Full edit's box (rr.2) is the whole chapter, planned in one pass
   * (`planChapterEdit`) under the same rules, and applied only when the plan
   * composes to exactly the chapter typed (`fullEditResult`), with no hunks
   * overlapping; otherwise the box stays open, as it is.
   */
  commitDraft: (key) => {
    const state = get();
    const review = state.review;
    const draft = state.drafts[key];
    if (!review || !draft) return { status: 'blocked', message: 'That paragraph is not being edited.' };
    if (isLocked(state)) return { status: 'blocked', message: 'Wait for the review to finish first.' };
    if (state.chapterSaving) return { status: 'blocked', message: 'Wait for the save to finish first.' };

    const base = review.base.text;
    let plan: BlockEditResult;
    if (draft.whole) {
      if (fullEditText(base, review.hunks) !== draft.initial) {
        return { status: 'blocked', message: FULL_EDIT_CHANGED };
      }
      try {
        plan = planChapterEdit({ base, hunks: review.hunks, text: draft.text });
      } catch {
        return { status: 'blocked', message: FULL_EDIT_NOT_EXACT };
      }
      if (plan.kind === 'edit') {
        const next = applyBlockEdit(review.hunks, plan);
        const exact = composeText(base, next) === fullEditResult(base, review.hunks, draft.text);
        if (!exact || findOverlaps(next).length > 0)
          return { status: 'blocked', message: FULL_EDIT_NOT_EXACT };
      }
    } else {
      const paragraphs = splitParagraphs(base);
      const span = blockSpanFor(base, paragraphs, review.hunks, key);
      if (!span || span.paragraphs[0] !== key || liveTextIn(base, review.hunks, span) !== draft.initial) {
        return {
          status: 'blocked',
          message: `Paragraph ${paragraphNumber(key)} changed while you were editing it, because the chapter file changed on disk. Your text is still in the box: copy it, press Cancel, then edit the paragraph again.`
        };
      }
      plan = planBlockEdit({ base, paragraphs, hunks: review.hunks, span, text: draft.text });
    }
    const drafts = { ...state.drafts };
    delete drafts[key];

    if (plan.kind === 'noop') {
      set({ drafts });
      return { status: 'noop' };
    }

    const accepted = plan.decided.filter((h) => h.status === 'accepted');
    const firstHunkId = plan.added[0]?.id ?? accepted[0]?.id ?? null;
    /* What the box applied shows at once: You for the edits it added, and the
       chip of a suggestion it accepted because the author typed exactly that.
       Left hidden, the author's words vanished from the line as they landed,
       while the card said they were added (the polish.11 review). */
    const landed = new Set<RowChip>([...plan.added, ...accepted].map(chipKeyOf));
    const hidden = state.hiddenCategories.filter((key) => !landed.has(key));
    set({
      review: withHunks(review, applyBlockEdit(review.hunks, plan)),
      drafts,
      ...(hidden.length < state.hiddenCategories.length ? { hiddenCategories: hidden } : {}),
      ...(firstHunkId ? { focusedHunkId: firstHunkId } : {})
    });
    return {
      status: 'applied',
      added: plan.added.length,
      accepted: accepted.length,
      superseded: plan.superseded.length,
      firstHunkId
    };
  },

  /* First to last: committing one paragraph never moves another one's text, and
     going in order keeps a whole-paragraph deletion from merging a neighbour's
     block before that neighbour has been committed. */
  commitAllDrafts: () => {
    let applied = 0;
    const blocked: string[] = [];
    const keys = Object.keys(get().drafts)
      .map(Number)
      .sort((a, b) => a - b);
    for (const key of keys) {
      const outcome = get().commitDraft(key);
      if (outcome.status === 'applied') applied += 1;
      else if (outcome.status === 'blocked') blocked.push(outcome.message);
    }
    return { applied, blocked };
  },

  /* ---------------- modes (rr.2) ---------------- */

  /* The find bar and the hover card are Main's: neither has anything to show
     in Preview, which draws the chapter afresh. A choice of Main or Preview
     while the window waits to open Full edit (rr.5) ends the wait. */
  setViewMode: (viewMode) =>
    set((state) => {
      const wait = state.fullEditPending !== null ? { fullEditPending: null } : {};
      if (viewMode === state.viewMode) return wait;
      return viewMode === 'main'
        ? { viewMode, ...wait }
        : { viewMode, hoveredHunkId: null, find: { ...NO_FIND, seek: state.find.seek }, ...wait };
    }),

  openFullEdit: () => {
    const state = get();
    const review = state.review;
    if (!review) return 'no-chapter';
    if (isLocked(state)) return 'locked';
    if (state.chapterSaving) return 'saving';
    if (fullEditDraft(state.drafts)) return null;
    if (Object.keys(state.drafts).length > 0) return 'boxes';
    const initial = fullEditText(review.base.text, review.hunks);
    set({
      drafts: {
        [WHOLE_DRAFT_KEY]: { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: initial, whole: true }
      },
      // Done and Cancel close into Main, whichever mode Full edit was opened from.
      viewMode: 'main',
      fullEditPending: null,
      editor: null,
      hoveredHunkId: null,
      find: { ...NO_FIND, seek: state.find.seek }
    });
    return null;
  },

  openPendingFullEdit: (reviewId) => {
    const state = get();
    if (state.fullEditPending !== reviewId) return;
    // Full edit's own typed text came back, as left, or boxes with typed
    // text did, which Main shows, with the card naming them.
    if (
      state.review?.id !== reviewId ||
      fullEditDraft(state.drafts) ||
      changedParagraphCount(state.drafts) > 0
    ) {
      set({ fullEditPending: null });
      return;
    }
    // Boxes left as they opened close on the way into Full edit (rr.2). The
    // box that opens ends the wait in the same change, so Main is never drawn.
    if (Object.keys(state.drafts).length > 0) set({ drafts: {} });
    const refused = get().openFullEdit();
    if (refused === null) return;
    set({ fullEditPending: null });
    if (refused === 'locked') state.notify('info', FULL_EDIT_WAIT_FOR_REVIEW, FULL_EDIT_CARD);
    if (refused === 'saving') state.notify('info', FULL_EDIT_WAIT_FOR_SAVE, FULL_EDIT_CARD);
  },

  holdFullEdit: () =>
    set((state) =>
      state.review && state.review.sourcePath !== '' && !fullEditDraft(state.drafts)
        ? { fullEditPending: state.review.id }
        : {}
    ),

  setAiBusy: (aiBusyPath) => set({ aiBusyPath }),

  markSaved: (hash, written) => {
    const review = get().review;
    if (!review || (written && !isWrittenReview(review, written))) return false;
    set({ review: savedReview(review, hash) });
    return true;
  },

  markReviewPersisted: (path, at) => set({ reviewSavedAt: { path, at: at ?? new Date().toISOString() } })
}));
