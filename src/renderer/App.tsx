import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { composeReview, unsavedDecisionCount } from '../shared/diff/compose';
import { rebaseReview } from '../shared/diff/rebase';
import { proPreselection } from '../shared/ai/claudeModels';
import { toRoyalRoadHtml } from '../shared/text/royalroad';
import { SHOW_BACKUPS_CARD } from '../shared/ui/backups';
import {
  PLAN_WELCOME_HINT,
  chatGptFailureRoute,
  chatGptUsageLimitCard,
  planWelcomeShown
} from '../shared/ui/chatgpt';
import { copiedHtmlNote } from '../shared/ui/copy';
import { FULL_SCREEN_CLASS } from '../shared/ui/fullScreen';
import { FINISH_FULL_EDIT_FIRST } from '../shared/ui/modes';
import { chapterNotOpenedText, unwrittenReviewText } from '../shared/ui/open';
import { mergeReloadRun, rebaseCardText, rebaseCardTone, type ReloadRun } from '../shared/ui/rebase';
import { NOTHING_UNTIL_SAVE, SAVE_HINT_ID } from '../shared/ui/saveHint';
import { windowTitleFor } from '../shared/ui/title';
import {
  CLAUDE_RUNTIME_CARD,
  RUNTIME_BUTTON_TITLE,
  canTryReviewAnyway,
  reviewGate,
  runtimeCard,
  runtimeCardAction,
  runtimeLabel as labelForRuntime,
  setupView,
  type SetupFor,
  type SetupFrom
} from '../shared/ui/setup';
import { usageLimitCard } from '../shared/ui/usage';
import { welcomeNotKept, welcomeShown } from '../shared/ui/welcome';
import { chapterName, createReview, rehomeReview } from '../shared/review';
import { bodyClassName, columnClassName } from '../shared/ui/columns';
import { focusReturnTarget, shellInert } from '../shared/ui/dialog';
import type { UpdateAction } from '../shared/ui/update';
import type { ChapterFile, LoadedReview, ReviewSummary } from '../shared/ipc';
import { PROVIDER_NAMES, type Provider, type Review, type Settings } from '../shared/types';
import { AboutDialog } from './components/AboutDialog';
import { ChatGptSetup } from './components/ChatGptSetup';
import { ColumnStrip } from './components/ColumnStrip';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DiagnosticsDialog } from './components/DiagnosticsDialog';
import { EditPopover } from './components/EditPopover';
import { FileList } from './components/FileList';
import { FindBar } from './components/FindBar';
import { FocusOverlay } from './components/FocusOverlay';
import { FullEdit } from './components/FullEdit';
import { HunkTooltip } from './components/HunkTooltip';
import { LockCard } from './components/LockCard';
import { ManualReviewDialog } from './components/ManualReviewDialog';
import { NewChapterDialog } from './components/NewChapterDialog';
import { NotificationCards } from './components/NotificationCards';
import { PreviewPane } from './components/PreviewPane';
import { ReviewDialog } from './components/ReviewDialog';
import { ReviewPane } from './components/ReviewPane';
import { SettingsDialog } from './components/SettingsDialog';
import { SettingsUnreadable } from './components/SettingsUnreadable';
import { SetupScreen } from './components/SetupScreen';
import { SidePanel } from './components/SidePanel';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { UpdateOverlay } from './components/UpdateOverlay';
import { WelcomeScreen } from './components/WelcomeScreen';
import { useChatGpt } from './state/chatgpt';
import { ApiError, call, errorMessage } from './state/client';
import { installCloseGuard, prepareToLeaveApp, type CloseGuardDeps } from './state/closeGuard';
import { flushDraftWrites, installDraftPersistence, type DraftIo } from './state/drafts';
import { useColumnHandle } from './state/columnHandles';
import { closeDrawer, drawerId, useColumns, useDrawer } from './state/columns';
import { holdToLeave, installFocusMode } from './state/focusMode';
import { installFullScreen, useFocusOverlay, useFullScreen } from './state/fullScreen';
import { dismissHint, type HintIo } from './state/hints';
import { CLOSE_GUARD_IO, PAGE_WRITES } from './state/pageIo';
import { chooseProvider as chooseReviewProvider } from './state/providerChoice';
import type { SettingIo } from './state/settingWrites';
import { beforeLeaving, type LeaveDeps } from './state/leave';
import { noteMergeMarkers } from './state/mergeMarkers';
import { useKeyboardBindings } from './state/keyboard';
import {
  chooseManuscriptFolder as pickManuscriptFolder,
  noteSavedSettings,
  type ManuscriptFolderIo
} from './state/manuscriptFolder';
import { useModePlaces } from './state/modePlaces';
import { useProgressLabel } from './state/progress';
import { reviewWithoutSaving, saveThenReview } from './state/reviewStart';
import { readSettings, useSettingsRead, type SettingsReadIo } from './state/settingsRead';
import { currentMode, fullEditDraft, useApp, type NotificationAction } from './state/store';
import { closeWelcome, reopenWelcome, type WelcomeIo } from './state/welcome';
import {
  flushReviewWrites,
  installReviewPersistence,
  markReviewPersistedState,
  retryReviewWrites,
  reviewWriteFailureOf,
  writeReviewNow
} from './state/reviewPersistence';
import { baseFrom, useSaveChapter, type SaveDeps } from './state/saveChapter';
import { useAi } from './state/useAi';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdateCards,
  restartNow,
  type UpdateIo
} from './state/updates';

/** How kept paragraph boxes reach main (apply.16, state/drafts.ts). */
const DRAFT_IO: DraftIo = {
  load: (sourcePath) => call('drafts:load', { sourcePath }),
  save: (request) => call('drafts:save', request),
  setAside: (request) => call('drafts:set-aside', request)
};

/** How a one-time hint is put away for good (apply.12, state/hints.ts). */
const HINT_IO: HintIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/** How the provider a Review menu item chooses is written (codex.3, state/providerChoice.ts). */
const SETTINGS_WRITE_IO: SettingIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/** How the page asks main for the settings (hardening.15, state/settingsRead.ts). */
const SETTINGS_READ_IO: SettingsReadIo = {
  getSettings: () => call('settings:get', undefined)
};

/** How Start, Skip and Show the welcome guide again write the settings (setup.11, state/welcome.ts). */
const WELCOME_IO: WelcomeIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/** How Choose folder picks and saves the manuscript folder (setup.18 review, state/manuscriptFolder.ts). */
const MANUSCRIPT_FOLDER_IO: ManuscriptFolderIo = {
  pickFolder: () => call('dialog:pick-folder', { title: 'Choose the manuscript folder' }),
  setSettings: (patch) => call('settings:set', patch)
};

/** How the update card, About and Restart now reach main's updater (release.9, state/updates.ts). */
const UPDATE_IO: UpdateIo = {
  get: () => call('update:get', undefined),
  check: () => call('update:check', undefined),
  download: (version) => call('update:download', { version }),
  install: () => call('update:install', undefined),
  onState: (listener) =>
    typeof window.api?.on === 'function' ? window.api.on('update:state', listener) : () => undefined
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
  const setupFor = useApp((s) => s.setupFor);
  const openSetupScreen = useApp((s) => s.openSetupScreen);
  const leaveSetup = useApp((s) => s.leaveSetup);
  const setupLanding = useApp((s) => s.setupLanding);
  const setSetupLanding = useApp((s) => s.setSetupLanding);
  const setSetupFrom = useApp((s) => s.setSetupFrom);
  const diagnosticsOpen = useApp((s) => s.diagnosticsOpen);
  const setDiagnosticsOpen = useApp((s) => s.setDiagnosticsOpen);
  const aboutOpen = useApp((s) => s.aboutOpen);
  const setAboutOpen = useApp((s) => s.setAboutOpen);
  const updateStatus = useApp((s) => s.updateStatus);
  const updateOverlayShown = useApp((s) => s.updateOverlay);
  const welcomeClosed = useApp((s) => s.welcomeClosed);
  const settingsReadFailed = useSettingsRead((s) => s.failed);
  const settingsTrying = useSettingsRead((s) => s.trying);
  const settingsFailedAgain = useSettingsRead((s) => s.failedAgain);
  const chapterSaving = useApp((s) => s.chapterSaving);
  const questionOpen = useApp((s) => s.confirmSpec !== null);
  /* Main, Full edit or Preview (rr.2): the window's own, never a setting.
     Each keeps its own place in the chapter's one scroller. */
  const mode = useApp(currentMode);
  const modePlaces = useModePlaces(mode, review?.sourcePath ?? null);

  const [files, setFiles] = useState<ChapterFile[]>([]);
  const [filesProblem, setFilesProblem] = useState<string | null>(null);
  /* Whether main watches the manuscript folder (files.21); true until it says otherwise. */
  const [watching, setWatching] = useState(true);
  const [index, setIndex] = useState<Record<string, ReviewSummary>>({});
  const [history, setHistory] = useState<ReviewSummary[]>([]);

  const ai = useAi();
  const claudeRuntime = ai.runtimes.claude ?? null;
  /* Sign in with ChatGPT (codex.2): main's status and the sign-in the page waits on. */
  const chatgpt = useChatGpt();
  const progressLabel = useProgressLabel(ai.running, ai.startedAt, ai.progress?.outputTokens);

  /* The chapter's name, and the dot while changes are not saved to it, in
     the window's own title (polish.10, `windowTitle`): Electron gives the
     window the page's title, so they show in the title bar and on the
     taskbar, and the toolbar's row is left to the chips. */
  const title = useMemo(() => windowTitleFor(review), [review]);
  useEffect(() => {
    document.title = title;
  }, [title]);

  /* The welcome guide, until Start or Skip (setup.11): a fresh install has no
     settings file, so `onboardingDone` is false. Start and Skip close it for
     the rest of the run even when that could not be written (`welcomeClosed`,
     setup.11 review). */
  const welcomeOpen = welcomeShown(settings, welcomeClosed);

  /* A new user on a Pro plan starts on Sonnet, once, when a check finds Claude
     ready while the first welcome guide is open (setup.1, Appendix D 12,
     C.67). */
  useEffect(() => {
    if (!settings || claudeRuntime?.state !== 'ready') return;
    const patch = proPreselection(settings, claudeRuntime.subscriptionType, welcomeOpen);
    if (!patch) return;
    void call('settings:set', patch)
      .then(setSettings)
      .catch(() => undefined);
  }, [settings, claudeRuntime, welcomeOpen, setSettings]);

  const fail = useCallback((err: unknown) => notify('error', errorMessage(err)), [notify]);

  /* ---------------- Claude's setup (setup.7, PLAN 5.6) ---------------- */

  const activeProvider = settings?.provider ?? 'claude';
  const claudeView = setupView(claudeRuntime, ai.lastFailure);
  /* The Setup screen shows Claude's view or ChatGPT's (codex.2); only
     Claude's says what the launch card says, and only it puts Claude in use. */
  const claudeSetupOpen = setupOpen && setupFor === 'claude';
  const claudeInUse = activeProvider === 'claude' || claudeSetupOpen;
  /* ChatGPT's view, or ChatGPT as the provider with Claude's view not open
     (codex.3): the status bar's usage notice is then the ChatGPT plan's. */
  const chatGptSetupOpen = setupOpen && setupFor === 'chatgpt';
  const chatGptInUse = chatGptSetupOpen || (activeProvider === 'chatgpt' && !claudeSetupOpen);
  const settingsLoaded = settings !== null;

  /* The launch card (section 7): once the settings and Claude's first check
     are in, a card says what Setup has to do when Claude is the provider,
     with Open Setup, unless Setup or the welcome guide, whose first step says
     the same, is open already. While it is up, a later check keeps its words
     current; a check with nothing left to say, ChatGPT as the provider, or
     Setup or the welcome guide open withdraws it by its key. Only the first
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
      setupOpen: claudeSetupOpen,
      welcomeOpen
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
    claudeSetupOpen,
    welcomeOpen,
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

  /* ---------------- ChatGPT's sign-in and its reviews (codex.3) ---------------- */

  /* The sign-in as the ChatGPT view and Settings show it (useChatGpt) and its
     runtime as the status bar and Review with AI read it (useAi) follow each
     other. A sign-in, a sign-out or a plan that changes checks the runtime
     again and forgets the model list, which is the account's; the first
     status read at launch is what the launch check read already. A runtime
     that finds no sign-in, as when a model list found it ended, has the
     status read again. */
  const chatGptSignedIn = chatgpt.status?.signedIn ?? null;
  const chatGptPlan = chatgpt.status?.plan ?? null;
  const { chatGptAccountChanged } = ai;
  const chatGptSeen = useRef(false);
  useEffect(() => {
    if (chatGptSignedIn === null) return;
    if (!chatGptSeen.current) {
      chatGptSeen.current = true;
      return;
    }
    chatGptAccountChanged();
  }, [chatGptSignedIn, chatGptPlan, chatGptAccountChanged]);
  const chatGptRuntimeState = ai.runtimes.chatgpt?.state ?? null;
  const { refresh: refreshChatGpt } = chatgpt;
  useEffect(() => {
    if (chatGptRuntimeState === 'not-signed-in') refreshChatGpt();
  }, [chatGptRuntimeState, refreshChatGpt]);

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
     Only the newest answer is kept, as for the marks. A list read that works
     starts main's watcher when the folder refused its start, so once the
     answer is in, the page asks whether main is watching the folder; a later
     change comes as `files:watching-changed` (files.21). */
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
      })
      .then(() => call('files:watching', undefined))
      .then((answer) => setWatching(answer.watching))
      .catch(() => undefined);
    void refreshIndex();
  }, [refreshIndex]);

  /* The settings, as the page loads and from the card's Try again
     (`readSettings`). While settings.json cannot be read, main hands the page
     none and the store keeps none, so the card below stands in place of
     everything else, and nothing that assumes a first run shows or writes
     (hardening.15, C.86). */
  const loadSettings = useCallback(
    (again: boolean) => {
      void readSettings(SETTINGS_READ_IO, again)
        .then((read) => {
          if (read) refreshFiles();
        })
        .catch(fail);
    },
    [refreshFiles, fail]
  );

  useEffect(() => {
    loadSettings(false);
  }, [loadSettings]);

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

  /* Full screen is the window's (polish.23): main says where it stands as
     the page loads and whenever it changes, and the shell carries a class
     while it is on. Nothing in the layout changes with it. */
  useEffect(() => installFullScreen(), []);
  const fullScreen = useFullScreen((s) => s.on);
  const shellClass = fullScreen ? `app-shell ${FULL_SCREEN_CLASS}` : 'app-shell';

  /* Focus mode (focus.1, state/focusMode.ts): with Settings' box ticked, full
     screen is only left by holding F11 or Escape, over an overlay that shows
     the count and keeps every key from the page while it is up. Its keys are
     caught on the window before anything else's, and everything under it is
     inert, the question and Restart now's overlay included. */
  useEffect(() => installFocusMode(), []);
  const focusOverlayOpen = useFocusOverlay((s) => s.open);

  /* The side columns give way to the prose in a narrow window, which is what
     zooming in makes: they shrink, then fold to strips that open them as
     drawers over the edge of the prose (ui.3, state/columns.ts). Each has a
     handle on its inner edge while it is drawn in place, which sets its width
     (polish.5, state/columnHandles.ts). */
  const {
    layout,
    setLive: setLiveWidths,
    shown,
    measure: measureBody,
    style: columnStyle,
    toggle: toggleDrawer
  } = useColumns(review !== null);
  const filesHandle = useColumnHandle('files', layout, setLiveWidths);
  const sideHandle = useColumnHandle('side', layout, setLiveWidths);

  /* ---------------- leaving (apply.7, state/leave.ts) ---------------- */

  const leaveDeps = useMemo<LeaveDeps>(() => ({ save }), [save]);

  /* The reloads the reload card on screen reports, with the card's id: while
     that card is up, the next reload adds to them, so a run of saves in
     Obsidian cannot hide a suggestion lost in the first (`mergeReloadRun`,
     PLAN 6.2, the `files.20` review). Opening a chapter or a review starts a
     new run. */
  const reloadRun = useRef<{ card: string; run: ReloadRun } | null>(null);

  /* ---------------- opening a chapter ---------------- */

  /* Opening a chapter or another review of the open one lets a save under way
     end first; another chapter then asks when something on screen is not
     saved to the chapter: Save first, Keep for later or Cancel
     (`beforeLeaving`). Another review of the open chapter, from History or
     the selector, asks nothing (apply.26), unless Full edit holds typed text
     (rr.5). Clicking what is already open, the open chapter whichever of its
     reviews is on screen, asks nothing and only writes what is waiting (PLAN
     11.3 i). Either opens in the mode in use at the click (rr.5), taken
     before the question, whose Apply and save first closes Full edit. */
  const openChapter = useCallback(
    (file: ChapterFile) => {
      const modeInUse = currentMode(useApp.getState());
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
          reloadRun.current = null;
          if (!loaded) {
            setReview(
              createReview({ sourcePath: file.path, base, hunks: [], generator: { kind: 'file' } }),
              null,
              modeInUse
            );
          } else if (loaded.review.base.hash === base.hash) {
            if (asOnDisk) markReviewPersistedState(loaded.review, loaded.path);
            setReview(loaded.review, loaded.path, modeInUse);
          } else {
            const { review: rebased, stats } = rebaseReview(loaded.review, base);
            setReview(rebased, loaded.path, modeInUse);
            notify(rebaseCardTone(stats), rebaseCardText('opened', stats));
          }
          // Merge markers in the chapter get a warning; a card left from
          // another chapter goes (files.11).
          noteMergeMarkers(null, base.text, file.name);
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
      const modeInUse = currentMode(useApp.getState());
      void (async () => {
        const decision = await beforeLeaving({ kind: 'review', id: summary.id }, leaveDeps);
        if (decision === 'stay') return;
        // The review being left, which Full edit may be held over (rr.5).
        const leaving = useApp.getState().review?.id ?? null;
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
          // The chapter's text on screen until now, for the merge markers card.
          const before = useApp.getState().review?.base.text ?? null;
          // An open that worked closes the card of one that did not.
          dismissNotificationsByKey(OPEN_CHAPTER_CARD);
          reloadRun.current = null;
          if (review.base.hash === base.hash) {
            if (review === loaded.review) markReviewPersistedState(review, loaded.path);
            setReview(review, loaded.path, modeInUse);
          } else {
            const { review: rebased, stats } = rebaseReview(review, base);
            setReview(rebased, loaded.path, modeInUse);
            notify('info', rebaseCardText('history', stats));
          }
          // The chapter is the one on screen, read again: as at a reload, markers
          // it has just gained get the warning and markers gone close it (files.11).
          noteMergeMarkers(before, base.text, sourcePath);
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
          // Full edit, held while the other review loaded (rr.5), opens again
          // on the review still on screen.
          if (leaving !== null && useApp.getState().review?.id === leaving) {
            useApp.getState().openPendingFullEdit(leaving);
          }
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
          const before = latest.base.text;
          const result = rebaseReview(latest, baseFrom(content));
          setReview(result.review, useApp.getState().reviewPath);
          // While the reload card is up, this reload adds to what it reported (PLAN 6.2).
          const shown = reloadRun.current;
          const up = shown !== null && useApp.getState().notifications.some((n) => n.id === shown.card);
          const run = mergeReloadRun(up ? shown.run : null, result);
          const card = notify(
            rebaseCardTone(run.stats),
            rebaseCardText('reloaded', run.stats),
            'file-reload'
          );
          reloadRun.current = { card, run };
          // Markers a pull or a sync has just put in get the warning, and
          // the card goes once they are taken out (files.11).
          noteMergeMarkers(before, content.text, event.path);
        })
        .catch(fail);
    });

    const offInvalidated = window.api.on('files:invalidated', () => refreshFiles());
    // Main's watcher started, or the folder refused its start (files.21).
    const offWatching = window.api.on('files:watching-changed', (event) => setWatching(event.watching));
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
      offWatching();
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
      cancelReview,
      // In focus mode a close, or Restart now, waits on the hold (focus.1).
      focusHold: holdToLeave
    }),
    [save, cancelReview]
  );
  useEffect(() => installCloseGuard(closeDeps), [closeDeps]);

  /* ---------------- updates (release.9, state/updates.ts) ---------------- */

  /* Main pushes where the updater is (`update:state`); the page keeps it for
     About and shows the one update card from it, in place from Download to
     Restart now. */
  useEffect(() => installUpdateCards(UPDATE_IO), []);

  /* The update card's button, and the same beside About's status line:
     Download; Restart now, which asks the close question first and is refused
     while a review runs; or the release page, in the browser, through the
     window's open handler. */
  const onUpdateAction = useCallback((action: UpdateAction) => {
    if (action === 'update-download') {
      void downloadUpdate(UPDATE_IO);
    } else if (action === 'update-restart') {
      void restartNow({ io: UPDATE_IO, prepare: prepareToLeaveApp });
    } else {
      const url = useApp.getState().updateStatus?.releaseUrl;
      if (url) window.open(url, '_blank', 'noreferrer');
    }
  }, []);

  /* ---------------- actions ---------------- */

  const copyResult = useCallback(() => {
    if (!review) return;
    const text = composeReview(review);
    navigator.clipboard
      .writeText(text)
      .then(() => notify('info', `Copied ${text.length} characters.`))
      .catch((err: unknown) => notify('error', errorMessage(err)));
  }, [review, notify]);

  /* Export HTML (rr.1), under Copy result in Actions: the same text, as HTML for
     Royal Road's chapter editor (`toRoyalRoadHtml`, PLAN C.111). Nothing is
     written anywhere but the clipboard. */
  const exportHtml = useCallback(() => {
    if (!review) return;
    const html = toRoyalRoadHtml(composeReview(review));
    navigator.clipboard
      .writeText(html)
      .then(() => notify('info', copiedHtmlNote(html.length)))
      .catch((err: unknown) => notify('error', errorMessage(err)));
  }, [review, notify]);

  /* Show backups (apply.11, PLAN 6.5), in the toolbar's Actions menu since
     `polish.7` and on the save card: a chapter's own backup folder, with its
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

  /* Choose folder, in the chapter list and the welcome guide: a refusal, such
     as a folder that holds the backups folder, is a card under its own key,
     which a later choice that main takes withdraws (setup.18 review). */
  const chooseManuscriptFolder = useCallback(() => {
    void pickManuscriptFolder(MANUSCRIPT_FOLDER_IO).then((next) => {
      if (next) refreshFiles();
    });
  }, [refreshFiles]);

  /* The settings as main saved them after a change in Settings, or in the
     welcome guide's folder rows (setup.18): the chapter list is read again,
     as it leaves out a reviews folder that lies inside the manuscript folder,
     and a save that changes either folder withdraws Choose folder's card. */
  const applySavedSettings = useCallback(
    (next: Settings) => {
      noteSavedSettings(next);
      refreshFiles();
    },
    [refreshFiles]
  );

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

  /* The Setup screen in place of Review with AI and Settings, in Claude's
     view or ChatGPT's, noting where it was opened from, which Done, Close and
     Escape go back to (setup.19, `leaveSetup`), and where the focus was, for
     a return to the chapter. Asked for again while it is open, as the status
     bar's label and Settings over it can, it keeps both (the store keeps
     where from, `openSetupScreen`), so the way back is not lost to a button
     on the Setup screen itself (setup.19 review). The launch card has done
     its job once Claude's view is open, which says the same at length, so it
     goes; ChatGPT's says nothing it says, so it stays (codex.2). */
  const setupOpener = useRef<HTMLElement | null>(null);
  const showSetup = useCallback(
    (view: SetupFor, from: SetupFrom) => {
      if (view === 'claude') dismissNotificationsByKey(CLAUDE_RUNTIME_CARD);
      if (!useApp.getState().setupOpen) {
        setupOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      openSetupScreen(view, from);
    },
    [openSetupScreen, dismissNotificationsByKey]
  );

  /* Claude's view, from the launch card, the status bar, Settings, the
     Review menu or a review that failed (setup.7). */
  const openSetup = useCallback(() => showSetup('claude', 'elsewhere'), [showSetup]);

  /* ChatGPT's view (codex.2), from Settings' ChatGPT account row, the status
     bar, the Review menu or a review that failed (codex.3): the sign-in and
     the training warning. */
  const openChatGptSetup = useCallback(() => showSetup('chatgpt', 'elsewhere'), [showSetup]);

  /* Open Setup in Review with AI, Claude's warning or ChatGPT's account row:
     leaving Setup opens the dialog again (setup.19). */
  const openSetupFromDialog = useCallback(() => showSetup('claude', 'review-dialog'), [showSetup]);
  const openChatGptSetupFromDialog = useCallback(() => showSetup('chatgpt', 'review-dialog'), [showSetup]);

  /* The welcome guide's Set up Claude and Set up ChatGPT: leaving Setup
     shows the guide again, under it all along (setup.11, setup.19). */
  const openSetupFromWelcome = useCallback(() => showSetup('claude', 'welcome'), [showSetup]);
  const openChatGptSetupFromWelcome = useCallback(() => showSetup('chatgpt', 'welcome'), [showSetup]);

  /* The guide's Sign in with ChatGPT (setup.18): the ChatGPT view over the
     guide, as Set up ChatGPT opens it, with its sign-in started, as the
     view's own button starts it, so the wait, the training warning and,
     once signed in, OpenAI's welcome and Done are on screen. */
  const { signIn: signInChatGpt } = chatgpt;
  const signInChatGptFromWelcome = useCallback(() => {
    showSetup('chatgpt', 'welcome');
    signInChatGpt(false);
  }, [showSetup, signInChatGpt]);

  /* Where leaving Setup landed (setup.19). Review with AI and the welcome
     guide have taken what they need of it as they were drawn again, the
     focus on Start or on the step's button; a return to the chapter hands
     the focus back where it was when Setup opened, when that is still on the
     page, such as the status bar's label. Then it is cleared, so a guide
     shown again later takes no focus from it. */
  useEffect(() => {
    if (setupLanding === null) return;
    if (setupLanding.to === 'chapter') {
      focusReturnTarget(setupOpener.current, document.body, null)?.focus({ preventScroll: true });
    }
    setupOpener.current = null;
    setSetupLanding(null);
  }, [setupLanding, setSetupLanding]);

  /* Test the connection, on the Setup screen (setup.8): one very small
     request. A test that fails for a reason Setup can fix checks again, as a
     review that fails so does (setup.5); Setup is open already. */
  const { testConnection, check: checkRuntime } = ai;
  const testClaude = useCallback(() => {
    void testConnection('claude').then((result) => {
      if (result?.error && SETUP_FAILURES.has(result.error.code)) checkRuntime('claude');
    });
  }, [testConnection, checkRuntime]);

  /* ---------------- the welcome guide (setup.11) ---------------- */

  /* Start and Skip put the guide away for good. It goes at once and stays
     away for the rest of the run (`closeWelcome`); the setting is written
     after, and a write that fails says so in a card, since the guide then
     shows again at the next start. */
  const finishWelcome = useCallback(() => {
    void closeWelcome(WELCOME_IO).catch((err: unknown) => notify('error', welcomeNotKept(errorMessage(err))));
  }, [notify]);

  /* Use ChatGPT instead, and Use Claude instead, in the guide's first step:
     the provider Review with AI starts with. */
  const chooseProvider = useCallback(
    (provider: Provider) => {
      void call('settings:set', { provider }).then(setSettings).catch(fail);
    },
    [setSettings, fail]
  );

  /* Settings' "Show the welcome guide again": the guide comes back in place
     of the main view, so Settings and Setup, which would cover it, close. The
     same write settles the Pro preselection, so the model stays as it is
     (`reopenWelcome`, setup.11 review). */
  const showWelcomeAgain = useCallback(() => {
    setSettingsOpen(false);
    setSetupOpen(false);
    void reopenWelcome(WELCOME_IO).catch(fail);
  }, [setSettingsOpen, setSetupOpen, fail]);

  /** A new review replaces the working set, so open paragraph editors, and Full edit (rr.2), must be dealt with first. */
  const refuseWhileEditing = useCallback((): boolean => {
    const drafts = useApp.getState().drafts;
    const open = Object.keys(drafts).length;
    if (open === 0) return false;
    notify(
      'info',
      fullEditDraft(drafts)
        ? FINISH_FULL_EDIT_FIRST
        : `Finish or cancel the ${open === 1 ? 'paragraph' : `${open} paragraphs`} you are editing first.`,
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
   * (item 6). The Review menu has an item for each provider, which becomes
   * the one the dialog starts with (codex.3). The Claude Setup screen stands
   * in front of it only when Claude is the provider and Claude Code is
   * missing or definitely signed out; a check that failed or an old Claude
   * Code opens the dialog with a warning (`reviewGate`, setup.7, 11.3 f).
   * ChatGPT's view stands in front of it when no ChatGPT sign-in is kept,
   * and the dialog itself asks for the data settings box (5.7 item 7).
   */
  const openReviewFor = useCallback(
    (provider: Provider) => {
      const current = useApp.getState().review;
      if (!current?.sourcePath) return;
      if (refuseWhileEditing()) return;
      void chooseReviewProvider(provider, SETTINGS_WRITE_IO);
      if (provider === 'claude' && reviewGate(claudeRuntime) === 'setup') {
        openSetup();
        return;
      }
      if (provider === 'chatgpt' && chatgpt.status !== null && !chatgpt.status.signedIn) {
        openChatGptSetup();
        return;
      }
      /* Opened from the Review menu over the Setup screen, the dialog is not
         the one Setup's Open Setup came from: leaving Setup later goes to the
         chapter (setup.19). */
      setSetupFrom('elsewhere');
      setReviewDialogOpen(true);
    },
    [
      claudeRuntime,
      chatgpt.status,
      setReviewDialogOpen,
      setSetupFrom,
      refuseWhileEditing,
      openSetup,
      openChatGptSetup
    ]
  );

  /** Review with AI with the provider already chosen, as Setup's Try the review anyway opens it. */
  const openReviewDialog = useCallback(
    () => openReviewFor(useApp.getState().settings?.provider ?? 'claude'),
    [openReviewFor]
  );

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
        /* ChatGPT (codex.3): a sign-in that is not there, or has ended, and
           the box not ticked open its view, with the words under its
           buttons, never a failed review's card; a usage limit puts up its
           card with Manage usage. */
        if (err instanceof ApiError && settings.provider === 'chatgpt') {
          const route = chatGptFailureRoute(err.code);
          if (route === 'setup') {
            chatgpt.refresh();
            chatgpt.say({ tone: 'warn', text: err.message });
            openChatGptSetup();
            return;
          }
          if (route === 'usage-card') {
            notify(
              'error',
              chatGptUsageLimitCard(err.message, ai.latestChatGptRateLimit(), new Date()),
              'chatgpt-usage',
              'chatgpt-usage'
            );
            return;
          }
        }
        // Setup can fix these: re-check, then show what to do (setup.5).
        if (err instanceof ApiError && SETUP_FAILURES.has(err.code)) {
          ai.check('claude');
          openSetup();
        }
        if (err instanceof ApiError && err.code === 'cancelled') {
          notify('info', 'Review cancelled.');
          return;
        }
        // Claude Code's words, then what to do for a plan limit: wait, or another model
        // (setup.9). useAi records the same decision for Setup (failureSetupEvent).
        if (err instanceof ApiError && err.code === 'claude-usage-limit') {
          notify(
            'error',
            usageLimitCard(err.message, ai.latestRateLimit(), ai.runtimes.claude?.subscriptionType)
          );
          return;
        }
        fail(err);
      })
      .finally(() => useApp.getState().setAiBusy(null));
  }, [
    ai,
    chatgpt,
    adoptReview,
    notify,
    setReviewDialogOpen,
    fail,
    refreshFiles,
    openSetup,
    openChatGptSetup
  ]);

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
  const activeLastFailure =
    activeProvider === 'claude'
      ? ai.lastFailure
      : activeProvider === 'chatgpt'
        ? ai.chatGptLastFailure
        : null;
  const runtimeLabel = labelForRuntime(activeRuntime, activeLastFailure) ?? undefined;

  // The first-use hint hangs over the prose when the side panel is folded
  // (ui.3); the Setup screen and the welcome guide have no side panel,
  // folded or not, and while either is up the hint waits, since it would
  // hang over their own buttons (setup.11 review).
  const singleScreen = setupOpen || welcomeOpen;
  const sideFolded = layout.side === 'strip' && !singleScreen;

  const toolbar = (
    <Toolbar
      review={review}
      running={ai.running}
      progressLabel={progressLabel}
      saving={chapterSaving}
      sideFolded={sideFolded}
      singleScreen={singleScreen}
      onReviewWith={openReviewFor}
      onCancelReview={ai.cancel}
      onManualReview={openManualReview}
      onSaveChapter={saveChapter}
      onCopyResult={copyResult}
      onExportHtml={exportHtml}
      onShowBackups={() => revealBackups(review?.sourcePath)}
      onSettings={() => setSettingsOpen(true)}
      onSaveHintDone={() => void dismissHint(SAVE_HINT_ID, HINT_IO)}
    />
  );

  /* What a card's button does (setup.7a), in either layout: the notification
     cards show over the Setup screen too (setup.7). */
  const onCardAction = useCallback(
    (action: NotificationAction, arg?: string) => {
      switch (action) {
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
        case 'show-diagnostics':
          // Shows the report; only Setup's Copy diagnostics copies it at once (hardening.5).
          setDiagnosticsOpen('show');
          break;
        case 'update-download':
        case 'update-restart':
        case 'update-open-page':
          onUpdateAction(action);
          break;
        case 'chatgpt-usage':
          // ChatGPT's usage settings, by name: the page never hands main an address (codex.3).
          void call('shell:open-external', { page: 'chatgpt-usage' }).catch(fail);
          break;
      }
    },
    [openSetup, fail, revealBackups, setDiagnosticsOpen, onUpdateAction]
  );

  /* The status bar's runtime label is a button: Setup for Claude, its
     ChatGPT view for ChatGPT (setup.7, codex.3). */
  const statusRuntime = {
    ...(runtimeLabel ? { runtimeLabel } : {}),
    onRuntime: activeProvider === 'chatgpt' ? openChatGptSetup : openSetup,
    runtimeTitle: RUNTIME_BUTTON_TITLE
  };
  /* Claude's usage, in the status bar while Claude is in use: the notice is
     about the Claude plan, and beside ChatGPT's status it would read as
     ChatGPT's (setup.9). The ChatGPT plan's in its place while ChatGPT is in
     use (codex.3). */
  const usageNotice = chatGptInUse ? ai.chatGptRateLimit : claudeInUse ? ai.rateLimit : null;

  /* The dialogs, each drawn only when it can be. They sit outside the
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
        modelsError={ai.modelsError}
        runtimes={ai.runtimes}
        history={history}
        reviewPath={reviewPath}
        unsavedDecisions={unsavedDecisionCount(review.hunks)}
        saving={chapterSaving}
        onSaveThenStart={saveThenStartReview}
        onStartWithout={startReviewWithoutSaving}
        onApplySettings={setSettings}
        onNeedModels={ai.ensureModels}
        onRetryModels={ai.retryModels}
        onCheckClaude={() => ai.check('claude')}
        checking={ai.checking}
        claudeLastFailure={ai.lastFailure}
        onOpenSetup={openSetupFromDialog}
        chatgpt={chatgpt.status}
        chatgptWaiting={chatgpt.waiting}
        onOpenChatGptSetup={openChatGptSetupFromDialog}
        onConfirmDataSettings={chatgpt.setDataSettingsConfirmed}
        onOpenDataControls={chatgpt.openDataControls}
        onStart={startReview}
        onClose={() => setReviewDialogOpen(false)}
        focusStart={setupLanding?.to === 'review-dialog'}
      />
    ) : null;
  const settingsDialog =
    settingsOpen && settings ? (
      <SettingsDialog
        settings={settings}
        models={ai.models.claude ?? []}
        runtime={claudeRuntime}
        chatgpt={chatgpt.status}
        chatgptWaiting={chatgpt.waiting}
        onApply={applySavedSettings}
        onClose={() => setSettingsOpen(false)}
        onOpenSetup={openSetup}
        onOpenChatGptSetup={openChatGptSetup}
        onShowWelcome={showWelcomeAgain}
        onAbout={() => {
          setSettingsOpen(false);
          setAboutOpen(true);
        }}
      />
    ) : null;
  /* Diagnostics (hardening.5): from Setup's Copy diagnostics, which copies
     the report as it comes in, or a card's Show diagnostics. */
  const diagnosticsDialog = diagnosticsOpen ? (
    <DiagnosticsDialog copyOnOpen={diagnosticsOpen === 'copy'} onClose={() => setDiagnosticsOpen(null)} />
  ) : null;
  /* About (release.9), from Settings' About, which it replaces. */
  const aboutDialog =
    aboutOpen && settings ? (
      <AboutDialog
        settings={settings}
        runtime={claudeRuntime}
        update={updateStatus}
        onApply={setSettings}
        onCheck={() => checkForUpdates(UPDATE_IO)}
        onUpdateAction={onUpdateAction}
        onClose={() => setAboutOpen(false)}
      />
    ) : null;
  /* Restart now's overlay (release.9) covers the page and the dialogs, and
     focus mode's (focus.1) covers everything, the question and Restart now's
     overlay included: what each covers is inert under it (`over` for the
     question and Restart now's overlay, given to both below). */
  const inert = shellInert({
    dialog: [
      newChapterDialog,
      manualReviewDialog,
      reviewDialog,
      settingsDialog,
      diagnosticsDialog,
      aboutDialog
    ].some((d) => d !== null),
    question: questionOpen,
    overlay: updateOverlayShown,
    focus: focusOverlayOpen
  });
  /* Restart now's overlay, from the moment the page has agreed to go until
     the app closes for the installer. */
  const updateOverlay = updateOverlayShown ? (
    <UpdateOverlay update={updateStatus} inert={inert.over} />
  ) : null;

  /* settings.json could not be read (hardening.15, C.86): one card says so,
     in the words for the reason main gave, with Try again, in place of
     everything else, the toolbar and the status bar too, whose buttons lead to
     Settings, Setup and the rest, none of which has settings to work from. The
     notification cards stay, for a Try again whose request fails, and so does
     the question, for a close. Diagnostics, which needs no settings, opens
     over the card from its own Show diagnostics or a card's, and the page is
     inert only under what this layout draws: under the whole list of dialogs
     it went inert with nothing over it and could not be left (the
     hardening.15 review). A read that works puts the settings in the store,
     and the page is drawn as usual. */
  if (settingsReadFailed && settings === null) {
    const cardInert = shellInert({
      dialog: diagnosticsDialog !== null,
      question: questionOpen,
      overlay: updateOverlayShown,
      focus: focusOverlayOpen
    });
    return (
      <div className={shellClass}>
        <div className="app-shell__page" inert={cardInert.page}>
          <div className="body body--single">
            <NotificationCards onAction={onCardAction} />
            <SettingsUnreadable
              reason={settingsReadFailed}
              trying={settingsTrying}
              failedAgain={settingsFailedAgain}
              onTryAgain={() => loadSettings(true)}
              onShowFile={() => void call('shell:reveal', { target: 'settings' }).catch(fail)}
              onShowDiagnostics={() => setDiagnosticsOpen('show')}
            />
          </div>
        </div>
        <div className="app-shell__dialogs" inert={cardInert.dialogs}>
          {diagnosticsDialog}
        </div>
        {updateOverlay}
        <ConfirmDialog inert={cardInert.over} />
        <FocusOverlay />
      </div>
    );
  }

  /* The Setup screen, or the welcome guide, in place of the chapter list, the
     prose and the side panel (setup.7, setup.11). Setup comes first, so the
     guide's Set up Claude opens it over the guide, and its Close goes back
     there. The rest is as in the layout below: the toolbar, the status bar,
     the notification cards, here at the top of the screen and before it, so
     they never cover its Close or Check again, the dialogs over the page,
     inert under them, and the question over everything. Closing the window
     can ask its question here too, with a review still open behind Setup
     (apply.9 review), and Settings, from the toolbar or a card, opens over
     it. The suggestion editor is not drawn here, but its words are kept in
     the store and come back with it (`EditorRequest.text`). */
  if (singleScreen) {
    return (
      <div className={shellClass}>
        <div className="app-shell__page" inert={inert.page}>
          {toolbar}
          <div className="body body--single">
            <NotificationCards onAction={onCardAction} />
            {setupOpen && setupFor === 'chatgpt' ? (
              <ChatGptSetup
                status={chatgpt.status}
                waiting={chatgpt.waiting}
                busy={chatgpt.busy}
                outcome={chatgpt.outcome}
                onSignIn={chatgpt.signIn}
                onCancelSignIn={chatgpt.cancelSignIn}
                onSignOut={chatgpt.signOut}
                onConfirmDataSettings={chatgpt.setDataSettingsConfirmed}
                onOpenDataControls={chatgpt.openDataControls}
                welcome={planWelcomeShown(chatgpt.status, settings?.dismissedHints)}
                onManageUsage={chatgpt.openUsage}
                onWelcomeDone={() => void dismissHint(PLAN_WELCOME_HINT, HINT_IO)}
                onClose={leaveSetup}
                version={updateStatus?.current ?? null}
              />
            ) : setupOpen ? (
              <SetupScreen
                runtime={claudeRuntime}
                lastFailure={ai.lastFailure}
                checking={ai.checking}
                onCheckAgain={() => ai.check('claude')}
                onClose={leaveSetup}
                {...(review?.sourcePath && canTryReviewAnyway(claudeRuntime, ai.lastFailure)
                  ? { onTryAnyway: tryReviewAnyway }
                  : {})}
                onTest={testClaude}
                testing={ai.testing.claude ?? false}
                testOutcome={ai.testOutcomes.claude ?? null}
                rateLimit={ai.rateLimit}
                onCopyDiagnostics={() => setDiagnosticsOpen('copy')}
                version={updateStatus?.current ?? null}
              />
            ) : settings ? (
              <WelcomeScreen
                settings={settings}
                claude={claudeRuntime}
                claudeLastFailure={ai.lastFailure}
                chatgpt={chatgpt.status}
                chatgptWaiting={chatgpt.waiting}
                onSetUpClaude={openSetupFromWelcome}
                onSetUpChatGpt={openChatGptSetupFromWelcome}
                onSignInChatGpt={signInChatGptFromWelcome}
                onUseProvider={chooseProvider}
                onChooseFolder={chooseManuscriptFolder}
                onApply={applySavedSettings}
                onStart={finishWelcome}
                onSkip={finishWelcome}
                landOn={setupLanding?.to === 'welcome' ? setupLanding.view : null}
              />
            ) : null}
          </div>
          <StatusBar
            review={review}
            {...statusRuntime}
            rateLimit={usageNotice}
            plan={claudeRuntime?.subscriptionType}
          />
        </div>
        <div className="app-shell__dialogs" inert={inert.dialogs}>
          {newChapterDialog}
          {manualReviewDialog}
          {reviewDialog}
          {settingsDialog}
          {diagnosticsDialog}
          {aboutDialog}
        </div>
        {updateOverlay}
        <ConfirmDialog inert={inert.over} />
        <FocusOverlay />
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {/* Everything but the dialogs and the question. While either is open
          this is inert, so Tab, a click or a screen reader cannot reach the
          page behind it (apply.7 review for the question, ui.4 for the
          dialogs; the question is apply.6's). It lays out nothing of its own. */}
      <div className="app-shell__page" inert={inert.page}>
        {toolbar}

        {/* Each side column is drawn in place, its wrapper laying out nothing,
            or, in a narrow window, folded to a strip whose button opens it as
            a drawer over the edge of the prose (ui.3). The wrappers are always
            there, so a column keeps its state as the window narrows or widens;
            a closed drawer is hidden and inert. A column in place has a handle
            on its inner edge, after it in the Tab order for the chapter list
            and before it for the side panel, laid over the edge rather than
            given a grid column of its own (polish.5). */}
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
              watching={watching}
              onOpen={openFromList}
              onChooseFolder={chooseManuscriptFolder}
              onReadAgain={refreshFiles}
              onNewChapter={() => setNewChapterOpen(true)}
            />
          </div>
          {filesHandle ? <div {...filesHandle} /> : null}

          {/* The centre column: the manuscript pane, from the toolbar's foot,
              as the chapter list and the side panel are. The category chips
              were at its top from polish.6 and are in the toolbar's row since
              polish.10. The Mode select stood at its top right, above the
              prose, from rr.2, and is the toolbar's first item since rr.6, so
              the prose starts at the column's top again. */}
          <div className="center-col">
            {/* The find bar is a strip above the scroller, not a sticky bar inside
              it: inside, it scrolled out of view once the author was more than
              a screen down, and Ctrl+F then seemed to do nothing (round 4). The
              notification cards and the lock card are pinned to this wrapper.
              The find bar is Main's: Full edit and Preview have none (rr.2). */}
            <div className={`center-wrap ${findOpen && mode === 'main' ? 'center-wrap--find' : ''}`}>
              {review && mode === 'main' ? <FindBar /> : null}
              {/* A press in the prose closes an open drawer, as a click
                  outside a menu closes it (ui.3), and does what it would anyway. */}
              <main
                {...modePlaces}
                className={`center center--${mode}`}
                onPointerDown={() => {
                  if (useDrawer.getState().open !== null) useDrawer.getState().setOpen(null);
                }}
              >
                {review ? (
                  mode === 'edit' ? (
                    <FullEdit review={review} />
                  ) : mode === 'preview' ? (
                    <PreviewPane review={review} />
                  ) : (
                    <ReviewPane review={review} onSetCommentStatus={setCommentStatus} />
                  )
                ) : (
                  <div className="empty">
                    <h1>Nothing open</h1>
                    <p>
                      Pick a chapter on the left, or start one with the + beside Chapters. In the Review menu,
                      Claude or ChatGPT asks for suggestions, and Manual turns a corrected copy into the same
                      kind of list. You accept or dismiss each suggestion here. {NOTHING_UNTIL_SAVE}
                    </p>
                  </div>
                )}
              </main>
              <NotificationCards onAction={onCardAction} />
              <LockCard label={progressLabel} onCancel={ai.cancel} />
            </div>
          </div>
          {sideHandle ? <div {...sideHandle} /> : null}

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
              />
            ) : (
              <aside className="side" />
            )}
          </div>
        </div>

        <StatusBar
          review={review}
          {...statusRuntime}
          rateLimit={usageNotice}
          plan={claudeRuntime?.subscriptionType}
        />
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
        {diagnosticsDialog}
        {aboutDialog}
      </div>
      {updateOverlay}
      {/* Above everything: a question can be asked from any dialog above. */}
      <ConfirmDialog inert={inert.over} />
      {/* Focus mode's hold (focus.1) covers even a question, inert under it. */}
      <FocusOverlay />
    </div>
  );
}
