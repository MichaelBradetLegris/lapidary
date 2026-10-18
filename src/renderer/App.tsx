import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeReview, unsavedDecisionCount } from '../shared/diff/compose';
import { rebaseReview } from '../shared/diff/rebase';
import { proPreselection } from '../shared/ai/claudeModels';
import { SHOW_BACKUPS_CARD } from '../shared/ui/backups';
import { chapterNotOpenedText, unwrittenReviewText } from '../shared/ui/open';
import { rebaseCardText } from '../shared/ui/rebase';
import { NOTHING_UNTIL_SAVE, SAVE_HINT_ID } from '../shared/ui/saveHint';
import {
  CLAUDE_RUNTIME_CARD,
  canTryReviewAnyway,
  reviewGate,
  runtimeButtonTitle,
  runtimeCard,
  runtimeCardAction,
  runtimeLabel as labelForRuntime,
  setupView
} from '../shared/ui/setup';
import { usageLimitCard } from '../shared/ui/usage';
import { chapterName, createReview, rehomeReview } from '../shared/review';
import { bodyClassName, columnClassName } from '../shared/ui/columns';
import { shellInert } from '../shared/ui/dialog';
import type { ApiEventMap, ChapterFile, LoadedReview, ReviewSummary } from '../shared/ipc';
import { PROVIDER_NAMES, type Review } from '../shared/types';
import { ColumnStrip } from './components/ColumnStrip';
import { ConfirmDialog } from './components/ConfirmDialog';
import { EditPopover } from './components/EditPopover';
import { FileList } from './components/FileList';
import { FilterChips } from './components/FilterChips';
import { FindBar } from './components/FindBar';
import { HunkTooltip } from './components/HunkTooltip';
import { LockCard } from './components/LockCard';
import { ManualReviewDialog } from './components/ManualReviewDialog';
import { NewChapterDialog } from './components/NewChapterDialog';
import { NotificationCards } from './components/NotificationCards';
import { ReviewDialog } from './components/ReviewDialog';
import { ReviewPane } from './components/ReviewPane';
import { SettingsDialog } from './components/SettingsDialog';
import { SetupScreen } from './components/SetupScreen';
import { SidePanel } from './components/SidePanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { ApiError, call, errorMessage } from './state/client';
import {
  installCloseGuard,
  type CloseGuardDeps,
  type CloseGuardIo,
  type PageWrites
} from './state/closeGuard';
import {
  draftWriteFailures,
  flushDraftWrites,
  installDraftPersistence,
  retryDraftWrites,
  type DraftIo
} from './state/drafts';
import { closeDrawer, drawerId, useColumns, useDrawer } from './state/columns';
import { dismissHint, flushHintWrites, type HintIo } from './state/hints';
import { flushSplitWrites } from './state/split';
import { beforeLeaving, type LeaveDeps } from './state/leave';
import { useKeyboardBindings } from './state/keyboard';
import { useProgressLabel } from './state/progress';
import { reviewWithoutSaving, saveThenReview } from './state/reviewStart';
import { useApp, type NotificationAction } from './state/store';
import {
  flushReviewWrites,
  installReviewPersistence,
  markReviewPersistedState,
  retryReviewWrites,
  reviewWriteFailureOf,
  reviewWriteFailures,
  writeReviewNow
} from './state/reviewPersistence';
import { baseFrom, useSaveChapter, type SaveDeps } from './state/saveChapter';
import { useAi } from './state/useAi';

/** How kept paragraph boxes reach main (apply.16, state/drafts.ts). */
const DRAFT_IO: DraftIo = {
  load: (sourcePath) => call('drafts:load', { sourcePath }),
  save: (request) => call('drafts:save', request),
  setAside: (request) => call('drafts:set-aside', request)
};

/** Listen to one of main's events, or to nothing outside the app window. */
function onMain<E extends 'app:close-requested' | 'app:flush'>(
  event: E,
  listener: (payload: ApiEventMap[E]) => void
): () => void {
  return typeof window.api?.on === 'function' ? window.api.on(event, listener) : () => undefined;
}

/**
 * How the close guard reaches main (apply.9, state/closeGuard.ts). `call`
 * sends before its first await, so each message is on its way when this
 * returns: a close right after a decision already finds it pushed.
 */
const CLOSE_GUARD_IO: CloseGuardIo = {
  pushState: (state) => void call('app:guard-state', state).catch(() => undefined),
  sendStatus: (status) => void call('app:close-status', { status }).catch(() => undefined),
  sendDecision: (close) => void call('app:close-decision', { close }).catch(() => undefined),
  onCloseRequested: (listener) => onMain('app:close-requested', () => listener()),
  onFlush: (listener) => onMain('app:flush', ({ reason }) => listener(reason))
};

/** How a one-time hint is put away for good (apply.12, state/hints.ts). */
const HINT_IO: HintIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/**
 * The review and paragraph writers, which a close and the end of a session
 * write out (apply.9), and a hint put away just before, such as the Save hint
 * that Save and close puts away (apply.12), and the side panel's split moved
 * just before (ui.6). A hint or a split that cannot be written is not
 * reported: the hint shows again at the next start, which has the split last
 * written.
 */
const PAGE_WRITES: PageWrites = {
  flush: async () => {
    await Promise.all([flushReviewWrites(), flushDraftWrites(), flushHintWrites(), flushSplitWrites()]);
  },
  retry: () => {
    retryReviewWrites();
    retryDraftWrites();
  },
  failures: () => [...reviewWriteFailures(), ...draftWriteFailures()]
};

/**
 * The card of a chapter that could not be opened, such as one whose review
 * another program holds (apply.25), and of a review from History or the
 * review selector that could not be (apply.25 review): the next try replaces
 * it, and an open that works closes it.
 */
const OPEN_CHAPTER_CARD = 'open-chapter';

/** Review failures the Setup screen can fix: Claude Code missing, too old, or signed out. */
const SETUP_FAILURES: ReadonlySet<string> = new Set([
  'claude-not-signed-in',
  'claude-login-expired',
  'claude-missing-binary',
  'claude-outdated'
]);

export function App(): React.JSX.Element {
  const settings = useApp((s) => s.settings);
  const review = useApp((s) => s.review);
  const reviewPath = useApp((s) => s.reviewPath);
  const newChapterOpen = useApp((s) => s.newChapterOpen);
  const manualReviewOpen = useApp((s) => s.manualReviewOpen);
  const reviewDialogOpen = useApp((s) => s.reviewDialogOpen);
  const setSettings = useApp((s) => s.setSettings);
  const setReview = useApp((s) => s.setReview);
  const notify = useApp((s) => s.notify);
  const upsertNotification = useApp((s) => s.upsertNotification);
  const dismissNotificationsByKey = useApp((s) => s.dismissNotificationsByKey);
  const setNewChapterOpen = useApp((s) => s.setNewChapterOpen);
  const setManualReviewOpen = useApp((s) => s.setManualReviewOpen);
  const setReviewDialogOpen = useApp((s) => s.setReviewDialogOpen);
  const setCommentStatus = useApp((s) => s.setCommentStatus);
  const findOpen = useApp((s) => s.find.open);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const setupOpen = useApp((s) => s.setupOpen);
  const setSetupOpen = useApp((s) => s.setSetupOpen);
  const chapterSaving = useApp((s) => s.chapterSaving);
  const questionOpen = useApp((s) => s.confirmSpec !== null);

  const [files, setFiles] = useState<ChapterFile[]>([]);
  const [filesProblem, setFilesProblem] = useState<string | null>(null);
  const [index, setIndex] = useState<Record<string, ReviewSummary>>({});
  const [history, setHistory] = useState<ReviewSummary[]>([]);

  const ai = useAi();
  const claudeRuntime = ai.runtimes.claude ?? null;
  const progressLabel = useProgressLabel(ai.running, ai.startedAt, ai.progress?.outputTokens);

  /* A new user on a Pro plan starts on Sonnet, once (setup.1, Appendix D 12). */
  useEffect(() => {
    if (!settings || claudeRuntime?.state !== 'ready') return;
    const patch = proPreselection(settings, claudeRuntime.subscriptionType);
    if (!patch) return;
    void call('settings:set', patch)
      .then(setSettings)
      .catch(() => undefined);
  }, [settings, claudeRuntime, setSettings]);

  const fail = useCallback((err: unknown) => notify('error', errorMessage(err)), [notify]);

  /* ---------------- Claude's setup (setup.7, PLAN 5.6) ---------------- */

  const activeProvider = settings?.provider ?? 'claude';
  const claudeView = setupView(claudeRuntime, ai.lastFailure);
  const claudeInUse = activeProvider === 'claude' || setupOpen;
  const settingsLoaded = settings !== null;

  /* The launch card (section 7): once the settings and Claude's first check
     are in, a card says what Setup has to do when Claude is the provider,
     with Open Setup, unless Setup is open already. While it is up, a later
     check keeps its words current; a check with nothing left to say, OpenAI
     as the provider or Setup open withdraws it by its key. Only the first
     check may put it up, so once closed with its X it stays closed
     (`runtimeCardAction`). */
  const runtimeCardPastLaunch = useRef(false);
  useEffect(() => {
    if (!claudeRuntime || !settingsLoaded) return;
    const card = runtimeCard(claudeView, claudeRuntime);
    const showing = useApp.getState().notifications.some((n) => n.key === CLAUDE_RUNTIME_CARD);
    const action = runtimeCardAction({
      card,
      showing,
      pastLaunch: runtimeCardPastLaunch.current,
      provider: activeProvider,
      setupOpen
    });
    runtimeCardPastLaunch.current = true;
    if (action === 'withdraw') {
      dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);
    } else if (card && (action === 'raise' || action === 'update')) {
      upsertNotification(CLAUDE_RUNTIME_CARD, card.tone, card.text, 'open-setup');
    }
  }, [
    claudeRuntime,
    claudeView,
    settingsLoaded,
    activeProvider,
    setupOpen,
    upsertNotification,
    dismissNotificationsByKey
  ]);

  /* Back from a terminal where the author installed, signed in or updated:
     check again as the window comes back to the front, while Setup has
     something to do and Claude is in use, at most every 3 s
     (`focusRecheckDue`). */
  const { recheckOnFocus } = ai;
  useEffect(() => {
    const onFocus = (): void => recheckOnFocus(claudeInUse, claudeView);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheckOnFocus, claudeInUse, claudeView]);

  /* ---------------- loading ---------------- */

  /* What the chapter list marks each chapter with (apply.5). Only the newest
     answer is kept, so a slow one cannot put back counts a later one has
     replaced. Resolves once the answer is in; never rejects. */
  const indexSeq = useRef(0);
  const refreshIndex = useCallback(async (): Promise<void> => {
    const ticket = ++indexSeq.current;
    let next: Record<string, ReviewSummary> = {};
    try {
      next = await call('reviews:index', undefined);
    } catch {
      // No marks rather than stale ones.
    }
    if (ticket === indexSeq.current) setIndex(next);
  }, []);

  /* The chapter list. A manuscript folder that cannot be read shows main's
     words where the empty-folder line would be, with Try again (apply.25).
     Only the newest answer is kept, as for the marks. */
  const filesSeq = useRef(0);
  const refreshFiles = useCallback(() => {
    const ticket = ++filesSeq.current;
    void call('files:list', undefined)
      .then((list) => {
        if (ticket !== filesSeq.current) return;
        setFiles(list);
        setFilesProblem(null);
      })
      .catch((err: unknown) => {
        if (ticket !== filesSeq.current) return;
        setFiles([]);
        setFilesProblem(errorMessage(err));
      });
    void refreshIndex();
  }, [refreshIndex]);

  useEffect(() => {
    call('settings:get', undefined)
      .then((loaded) => {
        setSettings(loaded);
        refreshFiles();
      })
      .catch(fail);
  }, [setSettings, refreshFiles, fail]);

  /* History lists the chapter on screen, so a reply for a chapter the author
     has left since is dropped (apply.3). */
  const refreshHistory = useCallback((sourcePath: string) => {
    const showing = (): boolean =>
      useApp.getState().review?.sourcePath.toLowerCase() === sourcePath.toLowerCase();
    void call('reviews:list', { sourcePath })
      .then((list) => {
        if (showing()) setHistory(list);
      })
      .catch(() => {
        if (showing()) setHistory([]);
      });
  }, []);

  /* ---------------- saving (apply.3, state/saveChapter.ts) ---------------- */

  const saveDeps = useMemo<SaveDeps>(
    () => ({
      saveFile: (request) => call('files:save', request),
      writeReview: writeReviewNow,
      onSaved: (saved, onScreen) => {
        // The first Save to chapter that reaches the file puts the Save hint
        // away for good, whether or not it was showing (apply.12).
        void dismissHint(SAVE_HINT_ID, HINT_IO);
        if (onScreen) refreshHistory(saved.sourcePath);
        refreshFiles();
      }
    }),
    [refreshHistory, refreshFiles]
  );
  const { save } = useSaveChapter(saveDeps);
  const saveChapter = useCallback(() => void save({ applyDrafts: 'ask' }), [save]);

  useKeyboardBindings(save);

  /* The side columns give way to the prose in a narrow window, which is what
     zooming in makes: they shrink, then fold to strips that open them as
     drawers over the edge of the prose (ui.3, state/columns.ts). */
  const {
    layout,
    shown,
    measure: measureBody,
    style: columnStyle,
    toggle: toggleDrawer
  } = useColumns(review !== null);

  /* ---------------- leaving (apply.7, state/leave.ts) ---------------- */

  const leaveDeps = useMemo<LeaveDeps>(() => ({ save }), [save]);

  /* ---------------- opening a chapter ---------------- */

  /* Opening a chapter or another review of the open one lets a save under way
     end first; another chapter then asks when something on screen is not
     saved to the chapter: Save first, Keep for later or Cancel
     (`beforeLeaving`). Another review of the open chapter, from History or
     the selector, asks nothing (apply.26). Clicking what is already open, the
     open chapter whichever of its reviews is on screen, asks nothing and only
     writes what is waiting (PLAN 11.3 i). */
  const openChapter = useCallback(
    (file: ChapterFile) => {
      void (async () => {
        const decision = await beforeLeaving({ kind: 'chapter', path: file.path }, leaveDeps);
        if (decision === 'stay') return;
        try {
          // A decision still waiting to be written must be on disk before
          // its review file is read back (apply.1), and so must the paragraph
          // boxes of the chapter being left (apply.16). A write that failed
          // is tried again first, so a review another program held a moment
          // ago gets its decisions now, before any review file is read back
          // (apply.25 review).
          retryReviewWrites();
          await flushReviewWrites();
          await flushDraftWrites();
          if (decision === 'here') return;
          // Once another chapter is open, the one being left is marked in the
          // list from its review as now written, so read the marks again
          // alongside the chapter, and have them in before it shows (apply.5).
          const marked = refreshIndex();
          const content = await call('files:read', { path: file.path });
          const base = baseFrom(content);
          // The review the chapter opens with. One that cannot be read, or a
          // reviews folder that cannot be made, fails here, before anything on
          // screen changes: the card names the chapter, since main's words
          // name only a review file or a folder, and the page stays on what
          // was open, since opening another review, or a blank one, would let
          // the next decision write a new review that becomes current over it
          // (apply.25 and its review). A chapter whose own review folder is
          // not there yet opens on a blank review, as before.
          let latest: LoadedReview | null;
          try {
            latest = await call('reviews:load-latest', { sourcePath: file.path, hash: base.hash });
          } catch (err) {
            throw new Error(chapterNotOpenedText(file.name, errorMessage(err)), { cause: err });
          }
          let loaded: { path: string | null; review: Review } | null = null;
          let asOnDisk = false;
          if (latest) {
            // The review is stored under this exact path from now on, however
            // the path was spelled when it was made (files.1).
            loaded = { path: latest.path, review: rehomeReview(latest.review, file.path) };
            asOnDisk = loaded.review === latest.review;
            // Decisions in it that could not be written, even just now, are
            // not in the file just read: shown, it would lack them, and the
            // next write would put them back over what the page showed, so it
            // stays off screen (apply.25 review).
            const unwritten = reviewWriteFailureOf(loaded.review);
            if (unwritten !== null) throw new Error(unwrittenReviewText({ chapter: file.name }, unwritten));
          }
          const adoptedFrom = latest?.adoptedFrom;

          await marked;
          // An open that worked closes the card of one that did not.
          dismissNotificationsByKey(OPEN_CHAPTER_CARD);
          if (!loaded) {
            setReview(
              createReview({ sourcePath: file.path, base, hunks: [], generator: { kind: 'file' } }),
              null
            );
          } else if (loaded.review.base.hash === base.hash) {
            if (asOnDisk) markReviewPersistedState(loaded.review, loaded.path);
            setReview(loaded.review, loaded.path);
          } else {
            const { review: rebased, stats } = rebaseReview(loaded.review, base);
            setReview(rebased, loaded.path);
            notify(stats.stale > 0 ? 'warn' : 'info', rebaseCardText('opened', stats));
          }
          if (adoptedFrom) {
            notify('info', `Reopened the review made when this chapter was at ${adoptedFrom}.`);
            refreshFiles();
          }
          refreshHistory(file.path);
        } catch (err) {
          // Nothing on screen has changed. Another try replaces this card.
          notify('error', errorMessage(err), OPEN_CHAPTER_CARD);
        }
      })();
    },
    [setReview, notify, dismissNotificationsByKey, refreshHistory, refreshFiles, refreshIndex, leaveDeps]
  );

  const openHistoryEntry = useCallback(
    (summary: ReviewSummary) => {
      void (async () => {
        const decision = await beforeLeaving({ kind: 'review', id: summary.id }, leaveDeps);
        if (decision === 'stay') return;
        try {
          // As for a chapter (openChapter): a write that failed is tried
          // again before anything waiting is written (apply.25 review).
          retryReviewWrites();
          await flushReviewWrites();
          await flushDraftWrites();
          if (decision === 'here') return;
          const loaded = await call('reviews:load', { path: summary.path });
          // History lists only the open chapter's reviews; read that chapter,
          // under the path it is open as.
          const sourcePath = useApp.getState().review?.sourcePath || loaded.review.sourcePath;
          const review = rehomeReview(loaded.review, sourcePath);
          // Decisions in it that could not be written, even just now, are not
          // in the file just read, so it stays off screen, as a chapter's
          // review does (apply.25 review).
          const unwritten = reviewWriteFailureOf(review);
          if (unwritten !== null) {
            throw new Error(unwrittenReviewText({ reviewCreatedAt: summary.createdAt }, unwritten));
          }
          const content = await call('files:read', { path: sourcePath });
          const base = baseFrom(content);
          // An open that worked closes the card of one that did not.
          dismissNotificationsByKey(OPEN_CHAPTER_CARD);
          if (review.base.hash === base.hash) {
            if (review === loaded.review) markReviewPersistedState(review, loaded.path);
            setReview(review, loaded.path);
          } else {
            const { review: rebased, stats } = rebaseReview(review, base);
            setReview(rebased, loaded.path);
            notify('info', rebaseCardText('history', stats));
          }
          // The chapter opens with this review from now on, the last on
          // screen (apply.26). Main records it without touching the review;
          // a record that cannot be written leaves the chapter opening with
          // the review last decided in, and nothing is lost.
          void call('reviews:shown', { sourcePath, path: loaded.path }).catch(() => undefined);
          // The review just left is no longer counted from the page, so read
          // History again, now that its last decisions are on disk (apply.5).
          refreshHistory(sourcePath);
        } catch (err) {
          // Nothing on screen has changed. Another try replaces this card.
          notify('error', errorMessage(err), OPEN_CHAPTER_CARD);
        }
      })();
    },
    [setReview, notify, dismissNotificationsByKey, leaveDeps, refreshHistory]
  );

  /* ---------------- external changes ---------------- */

  useEffect(() => {
    if (typeof window.api?.on !== 'function') return;

    const offChanged = window.api.on('file:changed', (event) => {
      const current = useApp.getState().review;
      if (!current?.sourcePath) return;
      if (current.sourcePath.toLowerCase() !== event.path.toLowerCase()) return;
      if (event.kind === 'unlink') {
        notify(
          'warn',
          'The chapter was deleted, renamed or moved on disk. If you renamed or moved it in Obsidian, open it again from the list; its review comes with it.'
        );
        return;
      }
      if (event.hash === current.base.hash) return;

      void call('files:read', { path: event.path })
        .then((content) => {
          const latest = useApp.getState().review;
          if (!latest) return;
          const { review: rebased, stats } = rebaseReview(latest, baseFrom(content));
          setReview(rebased, useApp.getState().reviewPath);
          notify(stats.stale > 0 ? 'warn' : 'info', rebaseCardText('reloaded', stats), 'file-reload');
        })
        .catch(fail);
    });

    const offInvalidated = window.api.on('files:invalidated', () => refreshFiles());
    // Ctrl+plus / minus / 0 and Ctrl+wheel are handled in the main process,
    // which says so here so the status bar shows the level in use (round 5).
    const offZoom = window.api.on('view:zoom-changed', ({ zoom }) => {
      const current = useApp.getState().settings;
      if (current && current.zoom !== zoom) useApp.getState().setSettings({ ...current, zoom });
    });
    // Cards main asks for (setup.7a); a newer one replaces the older in place.
    const offNotice = window.api.on('app:notice', ({ tone, message, action }) => {
      useApp.getState().upsertNotification('main-notice', tone, message, action);
    });
    return () => {
      offChanged();
      offInvalidated();
      offZoom();
      offNotice();
    };
  }, [setReview, notify, refreshFiles, fail]);

  /* A chapter chosen from the list, folded to a drawer in a narrow window,
     is what the drawer was opened for, so it closes (ui.3). */
  const openFromList = useCallback(
    (file: ChapterFile) => {
      closeDrawer('files');
      openChapter(file);
    },
    [openChapter]
  );

  /* ---------------- review persistence (apply.1) ---------------- */

  useEffect(() => installReviewPersistence(), []);

  /* ---------------- paragraph boxes kept on disk (apply.16) ---------------- */

  /* Open boxes are written as they are typed in, and come back whenever their
     chapter is on screen again (state/drafts.ts). */
  useEffect(() => installDraftPersistence(DRAFT_IO), []);

  /* ---------------- closing the window (apply.9, state/closeGuard.ts) ---------------- */

  /* Main decides at the window's close from what the page last told it: the
     page says what a close would put at risk whenever that changes, and when
     something is, answers main's request with "Close <name>?" after writing
     what is waiting. Windows ending the session only writes. */
  const cancelReview = ai.cancel;
  const closeDeps = useMemo<CloseGuardDeps>(
    () => ({
      io: CLOSE_GUARD_IO,
      writes: PAGE_WRITES,
      save,
      cancelReview
    }),
    [save, cancelReview]
  );
  useEffect(() => installCloseGuard(closeDeps), [closeDeps]);

  /* ---------------- actions ---------------- */

  const copyResult = useCallback(() => {
    if (!review) return;
    const text = composeReview(review);
    navigator.clipboard
      .writeText(text)
      .then(() => notify('info', `Copied ${text.length} characters.`))
      .catch((err: unknown) => notify('error', errorMessage(err)));
  }, [review, notify]);

  /* Show backups (apply.11, PLAN 6.5): a chapter's own backup folder, with its
     newest backup selected, which main works out from the chapter's path; with
     no path, the backups root. A chapter with no folder at its path gets a card
     saying so rather than an error, with Show all backups for the folders of
     other paths, a renamed or moved chapter's among them. A reveal that works
     closes any such card, since it may no longer be true. */
  const revealBackups = useCallback(
    (sourcePath?: string) => {
      void call('shell:reveal', { target: 'backups', ...(sourcePath ? { sourcePath } : {}) })
        .then(() => dismissNotificationsByKey(SHOW_BACKUPS_CARD))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === 'not-found') {
            notify('info', errorMessage(err), SHOW_BACKUPS_CARD, 'reveal-all-backups');
          } else {
            notify('error', errorMessage(err), SHOW_BACKUPS_CARD);
          }
        });
    },
    [notify, dismissNotificationsByKey]
  );

  const chooseManuscriptFolder = useCallback(() => {
    void call('dialog:pick-folder', { title: 'Choose the manuscript folder' })
      .then((folder) => (folder ? call('settings:set', { manuscriptFolder: folder }) : null))
      .then((next) => {
        if (next) {
          setSettings(next);
          refreshFiles();
        }
      })
      .catch(fail);
  }, [setSettings, refreshFiles, fail]);

  const loadCorrectedFromFile = useCallback(async (): Promise<string | null> => {
    const file = await call('dialog:pick-file', {
      title: 'Choose the corrected file',
      extensions: ['md', 'txt']
    });
    if (!file) return null;
    const content = await call('files:read', { path: file });
    return content.text;
  }, []);

  /* ---------------- reviews ---------------- */

  /**
   * Persist a freshly built review at once. A generated review costs money and
   * minutes, and a pasted one costs the author's attention; neither may depend
   * on a decision being made before it reaches disk (plan 6.4).
   */
  const adoptReview = useCallback(
    (next: Review) => {
      setReview(next, null);
      void (async () => {
        // A failure is reported by the writer, and the next decision tries again.
        await writeReviewNow(next, null);
        refreshHistory(next.sourcePath);
        refreshFiles();
      })();
    },
    [setReview, refreshHistory, refreshFiles]
  );

  /* ---------------- AI review ---------------- */

  const openSettings = useCallback(() => {
    setReviewDialogOpen(false);
    setSetupOpen(false);
    setSettingsOpen(true);
  }, [setReviewDialogOpen, setSetupOpen, setSettingsOpen]);

  /* The Setup screen, from the launch card, the status bar, Settings or the
     review dialog's warning (setup.7). The launch card has done its job once
     Setup is open, which says the same at length, so it goes. */
  const openSetup = useCallback(() => {
    setReviewDialogOpen(false);
    setSettingsOpen(false);
    dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);
    setSetupOpen(true);
  }, [setReviewDialogOpen, setSettingsOpen, setSetupOpen, dismissNotificationsByKey]);

  /* Test the connection, on the Setup screen (setup.8): one very small
     request. A test that fails for a reason Setup can fix checks again, as a
     review that fails so does (setup.5); Setup is open already. */
  const { testConnection, check: checkRuntime } = ai;
  const testClaude = useCallback(() => {
    void testConnection('claude').then((result) => {
      if (result?.error && SETUP_FAILURES.has(result.error.code)) checkRuntime('claude');
    });
  }, [testConnection, checkRuntime]);

  /** A new review replaces the working set, so open paragraph editors must be dealt with first. */
  const refuseWhileEditing = useCallback((): boolean => {
    const open = Object.keys(useApp.getState().drafts).length;
    if (open === 0) return false;
    notify(
      'info',
      `Finish or cancel the ${open === 1 ? 'paragraph' : `${open} paragraphs`} you are editing first.`,
      'review-drafts'
    );
    return true;
  }, [notify]);

  const openManualReview = useCallback(() => {
    if (refuseWhileEditing()) return;
    setManualReviewOpen(true);
  }, [refuseWhileEditing, setManualReviewOpen]);

  /**
   * The dialog collects provider, model and effort before anything is sent
   * (item 6). The Claude Setup screen stands in front of it only when Claude
   * is the provider and Claude Code is missing or definitely signed out; a
   * check that failed or an old Claude Code opens the dialog with a warning
   * (`reviewGate`, setup.7, 11.3 f). OpenAI's only prerequisite is a key,
   * which the dialog itself shows, and a card points at Settings when there is
   * none (Phase 5c).
   */
  const openReviewDialog = useCallback(() => {
    const current = useApp.getState().review;
    if (!current?.sourcePath) return;
    if (refuseWhileEditing()) return;
    const provider = settings?.provider ?? 'claude';
    if (provider === 'claude' && reviewGate(claudeRuntime) === 'setup') {
      openSetup();
      return;
    }
    if (provider === 'openai' && ai.keyStatus && !ai.keyStatus.configured) {
      notify(
        'warn',
        'OpenAI needs an API key before it can review. Paste one into Settings, or switch the provider back to Claude.',
        'openai-key',
        'open-settings'
      );
    }
    setReviewDialogOpen(true);
  }, [settings, claudeRuntime, ai.keyStatus, notify, setReviewDialogOpen, refuseWhileEditing, openSetup]);

  /**
   * Run a review. The chapter's review is read-only until it returns (round 3,
   * item 3): the result replaces the working set, so any decision made in the
   * meantime would vanish when it landed. Other chapters stay open to browse.
   */
  const startReview = useCallback(() => {
    // Read when it starts, which after "Save N changes, then review" is once
    // the save has ended: the review on screen then stands on the saved text,
    // and a model or effort chosen meanwhile counts (apply.20).
    const { review: current, settings } = useApp.getState();
    if (!current?.sourcePath || !settings) return;
    setReviewDialogOpen(false);
    const name = PROVIDER_NAMES[settings.provider];
    useApp.getState().setAiBusy(current.sourcePath);

    void ai
      .runReview(current, settings)
      .then((generated) => {
        const note = generated.generator.fallbackNote ? ` ${generated.generator.fallbackNote}` : '';
        const summary = `${generated.hunks.length} change${generated.hunks.length === 1 ? '' : 's'} and ${
          generated.comments.length
        } comment${generated.comments.length === 1 ? '' : 's'}`;
        const open = useApp.getState().review;
        const stillOpen =
          open?.sourcePath !== undefined &&
          open.sourcePath.toLowerCase() === generated.sourcePath.toLowerCase();

        /* The author moved to another chapter while waiting. Keep the result
           as that chapter's newest review, which is what opens next time,
           instead of pulling the author back to it. */
        if (!stillOpen) {
          void call('reviews:save', { review: generated })
            .then(() => {
              refreshFiles();
              notify(
                'info',
                `${name} finished reviewing ${chapterName(generated.sourcePath)}: ${summary}. Open that chapter to see them.${note}`
              );
            })
            .catch((err: unknown) =>
              notify(
                'error',
                `The review of ${chapterName(generated.sourcePath)} could not be saved: ${errorMessage(err)}`
              )
            );
          return;
        }

        /* The file changed on disk while the model worked: the result is
           anchored to the text it was sent, so move it onto the text the
           chapter has now, as the watcher does for any other review. */
        let next = generated;
        if (open.base.hash !== generated.base.hash) {
          next = rebaseReview(generated, open.base).review;
        }
        adoptReview(next);
        notify('info', `${name} suggested ${summary}.${note}`);
      })
      .catch((err: unknown) => {
        // Setup can fix these: re-check, then show what to do (setup.5).
        if (err instanceof ApiError && SETUP_FAILURES.has(err.code)) {
          ai.check('claude');
          openSetup();
        }
        if (err instanceof ApiError && err.code === 'cancelled') {
          notify('info', 'Review cancelled.');
          return;
        }
        // Claude Code's words, then what to do: wait, or another model (setup.9).
        if (err instanceof ApiError && err.code === 'claude-usage-limit') {
          notify('error', usageLimitCard(err.message, ai.latestRateLimit()));
          return;
        }
        if (err instanceof ApiError && (err.code === 'openai-invalid-key' || err.code === 'openai-no-key')) {
          ai.refreshKeyStatus();
          notify('error', err.message, 'openai-key', 'open-settings');
          return;
        }
        fail(err);
      })
      .finally(() => useApp.getState().setAiBusy(null));
  }, [ai, adoptReview, notify, setReviewDialogOpen, fail, refreshFiles, openSetup]);

  /* No stranded decisions (apply.20, state/reviewStart.ts): with changes not
     saved to the chapter, the dialog's blue button saves them and starts the
     review only once the file reads like the page, and "Review without them"
     asks first. Neither starts once the dialog has been closed. A save that
     does not reach the file hands the dialog what it said (apply.20 review). */
  const reviewDialogStillOpen = useCallback(() => useApp.getState().reviewDialogOpen, []);
  const saveThenStartReview = useCallback(
    (onNotSaved: (lines: string[]) => void) =>
      void saveThenReview({ save, start: startReview, stillWanted: reviewDialogStillOpen, onNotSaved }),
    [save, startReview, reviewDialogStillOpen]
  );
  const startReviewWithoutSaving = useCallback(
    () => void reviewWithoutSaving({ start: startReview, stillWanted: reviewDialogStillOpen }),
    [startReview, reviewDialogStillOpen]
  );

  /* Setup's "Try the review anyway": nothing the check found stops a review,
     so the dialog opens, with its warning (11.3 f). */
  const tryReviewAnyway = useCallback(() => {
    setSetupOpen(false);
    openReviewDialog();
  }, [setSetupOpen, openReviewDialog]);

  const activeRuntime = ai.runtimes[activeProvider];
  const runtimeLabel =
    labelForRuntime(activeRuntime, activeProvider === 'claude' ? ai.lastFailure : null) ?? undefined;

  // The first-use hint hangs over the prose when the side panel is folded
  // (ui.3); the Setup screen has no side panel, folded or not.
  const sideFolded = layout.side === 'strip' && !setupOpen;

  const toolbar = (
    <Toolbar
      review={review}
      running={ai.running}
      progressLabel={progressLabel}
      saving={chapterSaving}
      sideFolded={sideFolded}
      onReviewWithAi={openReviewDialog}
      onCancelReview={ai.cancel}
      onManualReview={openManualReview}
      onSaveChapter={saveChapter}
      onCopyResult={copyResult}
      onSettings={() => setSettingsOpen(true)}
      onSaveHintDone={() => void dismissHint(SAVE_HINT_ID, HINT_IO)}
    />
  );

  /* What a card's button does (setup.7a), in either layout: the notification
     cards show over the Setup screen too (setup.7). */
  const onCardAction = useCallback(
    (action: NotificationAction, arg?: string) => {
      switch (action) {
        case 'open-settings':
          openSettings();
          break;
        case 'open-setup':
          openSetup();
          break;
        case 'reveal-drafts':
          // A set-aside card names its file, which Show the text opens (apply.16).
          void call('shell:reveal', { target: 'drafts', ...(arg ? { name: arg } : {}) }).catch(fail);
          break;
        case 'reveal-backups':
          // The save card names the chapter it saved (apply.11).
          revealBackups(arg);
          break;
        case 'reveal-all-backups':
          // The no-backups card: the backups root, as in Settings (apply.11).
          revealBackups();
          break;
        default:
          // Diagnostics (hardening.5) and updates (release.9) wire theirs in when they land.
          break;
      }
    },
    [openSettings, openSetup, fail, revealBackups]
  );

  /* The status bar's runtime label is a button: Setup for Claude, Settings
     for OpenAI (setup.7). */
  const statusRuntime = {
    ...(runtimeLabel ? { runtimeLabel } : {}),
    onRuntime: activeProvider === 'claude' ? openSetup : openSettings,
    runtimeTitle: runtimeButtonTitle(activeProvider)
  };
  /* Claude's usage, in the status bar while Claude is in use: the notice is
     about the Claude plan, and beside OpenAI's status it would read as
     OpenAI's (setup.9). */
  const usageNotice = claudeInUse ? ai.rateLimit : null;

  /* The four dialogs, each drawn only when it can be. They sit outside the
     page, which is inert while one of them is open, so Tab and Shift+Tab go
     round the dialog's own controls and nothing behind its backdrop can take
     the focus; a question makes the dialogs inert too (ui.4, `shellInert`). */
  const newChapterDialog = newChapterOpen ? (
    <NewChapterDialog
      onClose={() => setNewChapterOpen(false)}
      onCreated={(file) => {
        setNewChapterOpen(false);
        refreshFiles();
        openChapter(file);
        // made from the chapter list's +, perhaps in its drawer (ui.3)
        closeDrawer('files');
        notify('info', `Created ${file.name}.`);
      }}
    />
  ) : null;
  const manualReviewDialog =
    manualReviewOpen && review?.sourcePath ? (
      <ManualReviewDialog
        review={review}
        onClose={() => setManualReviewOpen(false)}
        onLoadCorrected={loadCorrectedFromFile}
        onSave={save}
        onCreated={(next) => {
          adoptReview(next);
          notify(
            'info',
            `Built ${next.hunks.length} suggestion${next.hunks.length === 1 ? '' : 's'} from your text.`
          );
        }}
      />
    ) : null;
  const reviewDialog =
    reviewDialogOpen && review && settings ? (
      <ReviewDialog
        review={review}
        settings={settings}
        models={ai.models}
        modelsLoading={ai.modelsLoading}
        runtimes={ai.runtimes}
        keyStatus={ai.keyStatus}
        history={history}
        reviewPath={reviewPath}
        unsavedDecisions={unsavedDecisionCount(review.hunks)}
        saving={chapterSaving}
        onSaveThenStart={saveThenStartReview}
        onStartWithout={startReviewWithoutSaving}
        onApplySettings={setSettings}
        onNeedModels={ai.ensureModels}
        onOpenSettings={openSettings}
        onCheckClaude={() => ai.check('claude')}
        checking={ai.checking}
        claudeLastFailure={ai.lastFailure}
        onOpenSetup={openSetup}
        onStart={startReview}
        onClose={() => setReviewDialogOpen(false)}
      />
    ) : null;
  const settingsDialog =
    settingsOpen && settings ? (
      <SettingsDialog
        settings={settings}
        models={ai.models.claude ?? []}
        runtime={claudeRuntime}
        keyStatus={ai.keyStatus}
        onKeyChanged={ai.keyChanged}
        onApply={(next) => {
          setSettings(next);
          refreshFiles();
        }}
        onClose={() => setSettingsOpen(false)}
        onOpenSetup={openSetup}
      />
    ) : null;
  const inert = shellInert({
    dialog: [newChapterDialog, manualReviewDialog, reviewDialog, settingsDialog].some((d) => d !== null),
    question: questionOpen
  });

  /* The Setup screen in place of the chapter list, the prose and the side
     panel (setup.7). The rest is as in the layout below: the toolbar, the
     status bar, the notification cards, here at the top of the screen and
     before it, so they never cover its Close or Check again, the dialogs over
     the page, inert under them, and the question over everything. Closing the
     window can ask its question here too, with a review still open behind
     Setup (apply.9 review), and Settings, from the toolbar or a card, opens
     over it. The suggestion editor is not drawn here, but its words are kept
     in the store and come back with it (`EditorRequest.text`). */
  if (setupOpen) {
    return (
      <div className="app-shell">
        <div className="app-shell__page" inert={inert.page}>
          {toolbar}
          <div className="body body--single">
            <NotificationCards onAction={onCardAction} />
            <SetupScreen
              runtime={claudeRuntime}
              lastFailure={ai.lastFailure}
              checking={ai.checking}
              onCheckAgain={() => ai.check('claude')}
              onClose={() => setSetupOpen(false)}
              {...(review?.sourcePath && canTryReviewAnyway(claudeRuntime, ai.lastFailure)
                ? { onTryAnyway: tryReviewAnyway }
                : {})}
              onTest={testClaude}
              testing={ai.testing.claude ?? false}
              testOutcome={ai.testOutcomes.claude ?? null}
              rateLimit={ai.rateLimit}
            />
          </div>
          <StatusBar review={review} {...statusRuntime} rateLimit={usageNotice} />
        </div>
        <div className="app-shell__dialogs" inert={inert.dialogs}>
          {newChapterDialog}
          {manualReviewDialog}
          {reviewDialog}
          {settingsDialog}
        </div>
        <ConfirmDialog />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* Everything but the dialogs and the question. While either is open
          this is inert, so Tab, a click or a screen reader cannot reach the
          page behind it (apply.7 review for the question, ui.4 for the
          dialogs; the question is apply.6's). It lays out nothing of its own. */}
      <div className="app-shell__page" inert={inert.page}>
        {toolbar}
        {review ? <FilterChips review={review} /> : null}

        {/* Each side column is drawn in place, its wrapper laying out nothing,
            or, in a narrow window, folded to a strip whose button opens it as
            a drawer over the edge of the prose (ui.3). The wrappers are always
            there, so a column keeps its state as the window narrows or widens;
            a closed drawer is hidden and inert. */}
        <div className={bodyClassName(layout)} style={columnStyle} ref={measureBody}>
          {layout.files === 'strip' ? (
            <ColumnStrip column="files" open={shown === 'files'} onToggle={() => toggleDrawer('files')} />
          ) : null}
          <div
            id={drawerId('files')}
            className={columnClassName('files', layout, shown)}
            inert={layout.files === 'strip' && shown !== 'files'}
          >
            <FileList
              files={files}
              index={index}
              review={review}
              configured={Boolean(settings?.manuscriptFolder)}
              problem={filesProblem}
              onOpen={openFromList}
              onChooseFolder={chooseManuscriptFolder}
              onReadAgain={refreshFiles}
              onNewChapter={() => setNewChapterOpen(true)}
            />
          </div>

          {/* The find bar is a strip above the scroller, not a sticky bar inside
            it: inside, it scrolled out of view once the author was more than
            a screen down, and Ctrl+F then seemed to do nothing (round 4). */}
          <div className={`center-wrap ${findOpen ? 'center-wrap--find' : ''}`}>
            {review ? <FindBar /> : null}
            {/* A press in the prose closes an open drawer, as a click
                outside a menu closes it (ui.3), and does what it would anyway. */}
            <main
              className="center"
              onPointerDown={() => {
                if (useDrawer.getState().open !== null) useDrawer.getState().setOpen(null);
              }}
            >
              {review ? (
                <ReviewPane review={review} onSetCommentStatus={setCommentStatus} />
              ) : (
                <div className="empty">
                  <h1>Nothing open</h1>
                  <p>
                    Pick a chapter on the left, or start one with the + beside Chapters. Review with AI asks
                    for suggestions; Submit manual review turns a corrected copy into the same kind of list.
                    You accept or dismiss each suggestion here. {NOTHING_UNTIL_SAVE}
                  </p>
                </div>
              )}
            </main>
            <NotificationCards onAction={onCardAction} />
            <LockCard label={progressLabel} onCancel={ai.cancel} />
          </div>

          {layout.side === 'strip' ? (
            review ? (
              <ColumnStrip column="side" open={shown === 'side'} onToggle={() => toggleDrawer('side')} />
            ) : (
              // Nothing open, nothing to show: the strip without its button.
              <div className="strip strip--side strip--empty" />
            )
          ) : null}
          <div
            id={drawerId('side')}
            className={columnClassName('side', layout, shown)}
            inert={layout.side === 'strip' && shown !== 'side'}
          >
            {review ? (
              <SidePanel
                review={review}
                history={history}
                activeReviewPath={reviewPath}
                onSetCommentStatus={setCommentStatus}
                onOpenHistory={openHistoryEntry}
                onShowBackups={() => revealBackups(review.sourcePath)}
              />
            ) : (
              <aside className="side" />
            )}
          </div>
        </div>

        <StatusBar review={review} {...statusRuntime} rateLimit={usageNotice} />
        <HunkTooltip />
        <EditPopover onSaved={(message, tone) => notify(tone ?? 'info', message, 'edit')} />
      </div>
      {/* The dialogs, over the page; inert under a question. Like the page,
          it lays out nothing of its own. */}
      <div className="app-shell__dialogs" inert={inert.dialogs}>
        {newChapterDialog}
        {manualReviewDialog}
        {reviewDialog}
        {settingsDialog}
      </div>
      {/* Last, above everything: a question can be asked from any dialog above. */}
      <ConfirmDialog />
    </div>
  );
}
