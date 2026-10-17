import { create } from 'zustand';
import { commitDecisions, unsavedDecisionCount } from '../../shared/diff/compose';
import { applyBlockEdit, blockSpanFor, editSuggestion, liveTextIn, planBlockEdit } from '../../shared/edit';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { remapAfterCommit } from '../../shared/review';
import { splitParagraphs } from '../../shared/text/paragraphs';
import { stepIndex } from '../../shared/ui/find';
import type { SaveShortcutContext } from '../../shared/ui/save';
import type { ChangeCategory, Hunk, HunkStatus, Review, ReviewComment, Settings } from '../../shared/types';

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

/** True when a paragraph editor is open on this paragraph index. */
export function inDraft(drafts: Record<number, ParagraphDraft>, paragraph: number): boolean {
  return Object.values(drafts).some((d) => d.paragraphs.includes(paragraph));
}

/** Paragraph boxes whose text differs from what they opened with. */
export function changedParagraphCount(drafts: Record<number, ParagraphDraft>): number {
  return Object.values(drafts).filter((d) => d.text !== d.initial).length;
}

/**
 * True while a dialog, a question, Settings or the Setup screen covers the page
 * (`SaveShortcutContext.modalOpen`). The suggestion editor is a floating panel,
 * not a modal, and is not counted.
 */
export function isModalOpen(
  state: Pick<
    AppState,
    'confirmSpec' | 'settingsOpen' | 'setupOpen' | 'newChapterOpen' | 'manualReviewOpen' | 'reviewDialogOpen'
  >
): boolean {
  return (
    state.confirmSpec !== null ||
    state.settingsOpen ||
    state.setupOpen ||
    state.newChapterOpen ||
    state.manualReviewOpen ||
    state.reviewDialogOpen
  );
}

/** What Ctrl+S needs to know about the page (`saveShortcutAction`, apply.3). */
export function saveShortcutContext(state: AppState, inParagraphBox: boolean): SaveShortcutContext {
  return {
    hasChapter: Boolean(state.review?.sourcePath),
    modalOpen: isModalOpen(state),
    inParagraphBox,
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

export interface AppState {
  settings: Settings | null;
  review: Review | null;
  reviewPath: string | null;
  /** true when decisions changed since the review was last written to disk */
  dirty: boolean;
  /** wall-clock time of the last review json write, for the status bar */
  reviewSavedAt: string | null;
  /** a review json write is waiting or running, for any review (apply.1) */
  persistPending: boolean;
  focusedHunkId: string | null;
  /** bumped whenever the focused hunk should be scrolled into view */
  focusScrollToken: number;
  /** the hunk under the pointer; never scrolls anything (item 3) */
  hoveredHunkId: string | null;
  /** the comment the author last clicked, in the gutter or the sidebar (item 7) */
  activeCommentId: string | null;
  /** categories the author has hidden; empty means show everything */
  hiddenCategories: ChangeCategory[];
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
  /** the Claude Setup screen stands in place of the chapter */
  setupOpen: boolean;
  /** Save to chapter is writing the file (`state/saveChapter.ts`); decisions wait meanwhile */
  chapterSaving: boolean;
  /** paragraphs open for editing in place, keyed by their first paragraph index */
  drafts: Record<number, ParagraphDraft>;
  /** the chapter an AI review is running for; its review is read-only until it returns */
  aiBusyPath: string | null;

  setSettings: (settings: Settings) => void;
  setReview: (review: Review | null, path?: string | null) => void;
  patchReview: (patch: (review: Review) => Review) => void;
  setHunkStatus: (id: string, status: HunkStatus) => void;
  toggleAccepted: (id: string) => void;
  toggleDismissed: (id: string) => void;
  /** apply one status to an explicit set of hunks, as planned by bulkPlan */
  applyBulk: (ids: readonly string[], status: HunkStatus) => void;
  focusHunk: (id: string | null, options?: { scroll?: boolean }) => void;
  moveFocus: (delta: number) => void;
  setHoveredHunk: (id: string | null) => void;
  setActiveComment: (id: string | null) => void;
  toggleCategory: (category: ChangeCategory) => void;
  clearCategoryFilter: () => void;
  notify: (tone: NotificationTone, text: string, key?: string, action?: NotificationAction) => string;
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
  setChapterSaving: (saving: boolean) => void;
  /**
   * Fold the decisions into the base after Save to chapter wrote the file
   * (`savedReview`). With `written`, only when that exact review is still the
   * one on screen; false when the screen has moved on and nothing changed.
   */
  markSaved: (hash: string, written?: Review) => boolean;
  markReviewPersisted: (at?: string) => void;

  /* ---- editing (item 3) ---- */
  setCommentStatus: (id: string, status: ReviewComment['status']) => void;
  openEditor: (request: EditorRequest) => void;
  closeEditor: () => void;
  setEditorAccept: (accept: boolean) => void;
  /** rewrite a suggestion's replacement text (item 3a) */
  editHunkText: (id: string, replacement: string, accept: boolean) => EditOutcome;

  /* ---- paragraph editing (Phase 5d) ---- */
  /** open the paragraph containing this index for editing; false when it cannot be */
  openDraft: (paragraph: number, select?: { start: number; end: number }) => boolean;
  setDraftText: (key: number, text: string) => void;
  cancelDraft: (key: number) => void;
  /** turn one open paragraph into hunks and close it */
  commitDraft: (key: number) => DraftOutcome;
  /** commit every open paragraph, first to last; the messages of any that could not be */
  commitAllDrafts: () => { applied: number; blocked: string[] };
  discardDrafts: () => void;

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
  dirty: false,
  reviewSavedAt: null,
  persistPending: false,
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
  chapterSaving: false,
  drafts: {},
  aiBusyPath: null,

  setSettings: (settings) => set({ settings }),

  /* Open paragraph editors survive a reload of the same review (the watcher
     rebasing it after an outside change): the commit checks whether their
     paragraph still reads the same. Anything else starts with none open. */
  setReview: (review, path = null) =>
    set((state) => ({
      review,
      reviewPath: path,
      dirty: false,
      focusedHunkId: review?.hunks.find((h) => h.anchor !== 'stale')?.id ?? null,
      hoveredHunkId: null,
      activeCommentId: null,
      hiddenCategories: [],
      find: { ...NO_FIND, seek: state.find.seek },
      editor: null,
      drafts: review && state.review && review.id === state.review.id ? state.drafts : {}
    })),

  patchReview: (patch) => {
    const review = get().review;
    if (!review) return;
    set({ review: patch(review), dirty: true });
  },

  setHunkStatus: (id, status) => {
    const state = get();
    const review = state.review;
    const hunk = review?.hunks.find((h) => h.id === id);
    if (!review || !hunk || frozen(state, hunk)) return;
    const hunks = review.hunks.map((h) => (h.id === id ? { ...h, status } : h));
    set({ review: withHunks(review, hunks), dirty: true });
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
    if (changed) set({ review: withHunks(review, hunks), dirty: true });
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

  moveFocus: (delta) => {
    const review = get().review;
    if (!review) return;
    const hidden = get().hiddenCategories;
    const visible = review.hunks
      .filter((h) => h.anchor !== 'stale' && !hidden.includes(h.category ?? 'other'))
      .sort((a, b) => a.start - b.start);
    if (visible.length === 0) return;
    const current = visible.findIndex((h) => h.id === get().focusedHunkId);
    const nextIndex = current < 0 ? (delta > 0 ? 0 : visible.length - 1) : current + delta;
    const clamped = Math.max(0, Math.min(visible.length - 1, nextIndex));
    set((state) => ({
      focusedHunkId: visible[clamped]?.id ?? null,
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

  clearCategoryFilter: () => set({ hiddenCategories: [] }),

  notify: (tone, text, key, action) => {
    notificationSeq += 1;
    const id = `n${notificationSeq}`;
    set((state) => ({
      notifications: [
        ...(key ? state.notifications.filter((n) => n.key !== key) : state.notifications),
        { id, tone, text, ...(key ? { key } : {}), ...(action ? { action } : {}) }
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

  setChapterSaving: (chapterSaving) => set({ chapterSaving }),

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
      },
      dirty: true
    });
  },

  openEditor: (editor) => {
    const state = get();
    const hunk = state.review?.hunks.find((h) => h.id === editor.hunkId);
    if (!hunk || frozen(state, hunk)) return;
    set({ editor });
  },

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
    const hunks = review.hunks.map((h) => (h.id === id ? editSuggestion(h, replacement, accept) : h));
    set({ review: withHunks(review, hunks), dirty: true, focusedHunkId: id });
    return { status: 'applied', hunkId: id };
  },

  /* ---------------- paragraph editing (Phase 5d) ---------------- */

  openDraft: (paragraph, select) => {
    const state = get();
    const review = state.review;
    if (!review || held(state)) return false;

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
    set({ drafts: { ...state.drafts, [key]: draft }, editor: null, hoveredHunkId: null });
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

  /**
   * The author finished a paragraph. Its changed words become manual hunks and
   * the suggestions they swallowed are superseded, so the composed text stays a
   * pure function of the base plus the decisions (CLAUDE.md rule 5).
   *
   * If the paragraph no longer reads what the box started from, the chapter
   * changed on disk while the author typed. Committing then would silently undo
   * that outside change, so the box stays open with the author's words in it.
   */
  commitDraft: (key) => {
    const state = get();
    const review = state.review;
    const draft = state.drafts[key];
    if (!review || !draft) return { status: 'blocked', message: 'That paragraph is not being edited.' };
    if (isLocked(state)) return { status: 'blocked', message: 'Wait for the review to finish first.' };
    if (state.chapterSaving) return { status: 'blocked', message: 'Wait for the save to finish first.' };

    const base = review.base.text;
    const paragraphs = splitParagraphs(base);
    const span = blockSpanFor(base, paragraphs, review.hunks, key);
    if (!span || span.paragraphs[0] !== key || liveTextIn(base, review.hunks, span) !== draft.initial) {
      return {
        status: 'blocked',
        message: `Paragraph ${paragraphNumber(key)} changed while you were editing it, because the chapter file changed on disk. Your text is still in the box: copy it, press Cancel, then edit the paragraph again.`
      };
    }

    const plan = planBlockEdit({ base, paragraphs, hunks: review.hunks, span, text: draft.text });
    const drafts = { ...state.drafts };
    delete drafts[key];

    if (plan.kind === 'noop') {
      set({ drafts });
      return { status: 'noop' };
    }

    const accepted = plan.decided.filter((h) => h.status === 'accepted');
    const firstHunkId = plan.added[0]?.id ?? accepted[0]?.id ?? null;
    set({
      review: withHunks(review, applyBlockEdit(review.hunks, plan)),
      dirty: true,
      drafts,
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

  discardDrafts: () => set({ drafts: {} }),

  setAiBusy: (aiBusyPath) => set({ aiBusyPath }),

  markSaved: (hash, written) => {
    const review = get().review;
    if (!review || (written && review !== written)) return false;
    set({ review: savedReview(review, hash), dirty: false });
    return true;
  },

  markReviewPersisted: (at) => set({ reviewSavedAt: at ?? new Date().toISOString() })
}));
