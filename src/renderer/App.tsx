import { useCallback, useEffect, useState } from 'react';
import { composeReview, unsavedDecisionCount } from '../shared/diff/compose';
import { rebaseReview } from '../shared/diff/rebase';
import { proPreselection } from '../shared/ai/claudeModels';
import { runtimeLabel as labelForRuntime } from '../shared/ui/setup';
import { chapterName, createReview, rehomeReview } from '../shared/review';
import type { ChapterFile, FileContent, ReviewSummary } from '../shared/ipc';
import { PROVIDER_NAMES, type Review, type ReviewBase } from '../shared/types';
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
import { useKeyboardBindings } from './state/keyboard';
import { useProgressLabel } from './state/progress';
import { useApp } from './state/store';
import {
  flushReviewWrites,
  installReviewPersistence,
  markReviewPersistedState,
  writeReviewNow
} from './state/reviewPersistence';
import { useAi } from './state/useAi';

/** Review failures the Setup screen can fix: Claude Code missing, too old, or signed out. */
const SETUP_FAILURES: ReadonlySet<string> = new Set([
  'claude-not-signed-in',
  'claude-login-expired',
  'claude-missing-binary',
  'claude-outdated'
]);

function baseFrom(content: FileContent): ReviewBase {
  return {
    text: content.text,
    hash: content.hash,
    eol: content.eol,
    bom: content.bom,
    trailingNewline: content.trailingNewline
  };
}

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
  const setNewChapterOpen = useApp((s) => s.setNewChapterOpen);
  const setManualReviewOpen = useApp((s) => s.setManualReviewOpen);
  const setReviewDialogOpen = useApp((s) => s.setReviewDialogOpen);
  const setCommentStatus = useApp((s) => s.setCommentStatus);
  const markSaved = useApp((s) => s.markSaved);
  const askConfirm = useApp((s) => s.askConfirm);
  const findOpen = useApp((s) => s.find.open);

  const [files, setFiles] = useState<ChapterFile[]>([]);
  const [index, setIndex] = useState<Record<string, ReviewSummary>>({});
  const [history, setHistory] = useState<ReviewSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const ai = useAi();
  const claudeRuntime = ai.runtimes.claude ?? null;
  const progressLabel = useProgressLabel(ai.running, ai.startedAt, ai.progress?.outputTokens);

  useKeyboardBindings();

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

  /* ---------------- loading ---------------- */

  const refreshFiles = useCallback(() => {
    void call('files:list', undefined)
      .then(setFiles)
      .catch(() => setFiles([]));
    void call('reviews:index', undefined)
      .then(setIndex)
      .catch(() => setIndex({}));
  }, []);

  useEffect(() => {
    call('settings:get', undefined)
      .then((loaded) => {
        setSettings(loaded);
        refreshFiles();
      })
      .catch(fail);
  }, [setSettings, refreshFiles, fail]);

  const refreshHistory = useCallback((sourcePath: string) => {
    void call('reviews:list', { sourcePath })
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  /**
   * Paragraphs open for editing live only on screen until Done. Before anything
   * replaces the review on screen, ask rather than drop them (Phase 5d).
   */
  const confirmLeaveDrafts = useCallback(async (): Promise<boolean> => {
    const open = Object.keys(useApp.getState().drafts).length;
    if (open === 0) return true;
    const ok = await askConfirm({
      title: 'Discard paragraph edits?',
      body: `${open} paragraph${open === 1 ? ' is' : 's are'} open for editing. ${
        open === 1 ? 'Its changes have' : 'Their changes have'
      } not been applied and will be lost.`,
      confirmLabel: 'Discard'
    });
    if (ok) useApp.getState().discardDrafts();
    return ok;
  }, [askConfirm]);

  /* ---------------- opening a chapter ---------------- */

  const openChapter = useCallback(
    (file: ChapterFile) => {
      void (async () => {
        if (!(await confirmLeaveDrafts())) return;
        try {
          // A decision still waiting to be written must be on disk before
          // its review file is read back (apply.1).
          await flushReviewWrites();
          const content = await call('files:read', { path: file.path });
          const base = baseFrom(content);
          let loaded: { path: string | null; review: Review } | null = null;
          let adoptedFrom: string | undefined;
          let asOnDisk = false;
          try {
            const latest = await call('reviews:load-latest', { sourcePath: file.path, hash: base.hash });
            // The review is stored under this exact path from now on, however
            // the path was spelled when it was made (files.1).
            if (latest) {
              loaded = { path: latest.path, review: rehomeReview(latest.review, file.path) };
              asOnDisk = loaded.review === latest.review;
            }
            adoptedFrom = latest?.adoptedFrom;
          } catch {
            // A missing or unreadable review folder must not stop the chapter opening.
          }

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
            notify(
              stats.stale > 0 ? 'warn' : 'info',
              `The chapter changed since this review was made. ${stats.anchored} suggestion${
                stats.anchored === 1 ? '' : 's'
              } re-anchored, ${stats.stale} could not be found.`
            );
          }
          if (adoptedFrom) {
            notify('info', `Reopened the review made when this chapter was at ${adoptedFrom}.`);
            refreshFiles();
          }
          refreshHistory(file.path);
        } catch (err) {
          fail(err);
        }
      })();
    },
    [setReview, notify, refreshHistory, refreshFiles, fail, confirmLeaveDrafts]
  );

  const openHistoryEntry = useCallback(
    (summary: ReviewSummary) => {
      void (async () => {
        if (!(await confirmLeaveDrafts())) return;
        try {
          await flushReviewWrites();
          const loaded = await call('reviews:load', { path: summary.path });
          // History lists only the open chapter's reviews; read that chapter,
          // under the path it is open as.
          const sourcePath = useApp.getState().review?.sourcePath || loaded.review.sourcePath;
          const review = rehomeReview(loaded.review, sourcePath);
          const content = await call('files:read', { path: sourcePath });
          const base = baseFrom(content);
          if (review.base.hash === base.hash) {
            if (review === loaded.review) markReviewPersistedState(review, loaded.path);
            setReview(review, loaded.path);
          } else {
            const { review: rebased, stats } = rebaseReview(review, base);
            setReview(rebased, loaded.path);
            notify(
              'info',
              `Loaded an older review. ${stats.anchored} re-anchored, ${stats.stale} could not be found.`
            );
          }
        } catch (err) {
          fail(err);
        }
      })();
    },
    [setReview, notify, fail, confirmLeaveDrafts]
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
          notify(
            stats.stale > 0 ? 'warn' : 'info',
            `Reloaded from disk. ${stats.anchored} suggestion${
              stats.anchored === 1 ? '' : 's'
            } re-anchored, ${stats.stale} could not be found.`,
            'file-reload'
          );
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

  /* ---------------- saving ---------------- */

  const saveChapter = useCallback(() => {
    if (!useApp.getState().review?.sourcePath) return;

    void (async () => {
      /* Open paragraph editors hold changes that are not suggestions yet. Saving
         without them would write a chapter the author did not see; saving
         them silently would apply edits the author has not finished. Ask. */
      const open = Object.keys(useApp.getState().drafts).length;
      if (open > 0) {
        const ok = await askConfirm({
          title: 'Apply paragraph edits first?',
          body: `${open} paragraph${open === 1 ? ' is' : 's are'} still open for editing. Apply ${
            open === 1 ? 'its changes' : 'their changes'
          } as accepted suggestions, then save the chapter?`,
          confirmLabel: 'Apply and save'
        });
        if (!ok) return;
        const { blocked } = useApp.getState().commitAllDrafts();
        if (blocked.length > 0) {
          for (const message of blocked) notify('warn', message);
          notify(
            'error',
            'Nothing was saved. Resolve the paragraphs above, then save again.',
            'save-chapter'
          );
          return;
        }
      }

      const current = useApp.getState().review;
      if (!current?.sourcePath) return;
      setSaving(true);
      try {
        let working = current;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await call('files:save', {
            path: working.sourcePath,
            text: composeReview(working),
            eol: working.base.eol,
            bom: working.base.bom,
            trailingNewline: working.base.trailingNewline,
            expectedHash: working.base.hash
          });

          if (response.status === 'written') {
            markSaved(response.hash);
            const saved = useApp.getState().review;
            if (saved) {
              await writeReviewNow(saved, useApp.getState().reviewPath);
              refreshHistory(saved.sourcePath);
              refreshFiles();
            }
            notify('info', 'Saved to the chapter file.', 'save-chapter');
            return;
          }

          const { review: rebased, stats } = rebaseReview(working, baseFrom(response.disk));
          setReview(rebased, useApp.getState().reviewPath);
          working = rebased;
          notify(
            'warn',
            `The chapter changed on disk before saving. Rebased: ${stats.anchored} re-anchored, ${stats.stale} lost. Retrying.`
          );
        }
        notify('error', 'The chapter keeps changing on disk. Close it in Obsidian and save again.');
      } catch (err) {
        fail(err);
      } finally {
        setSaving(false);
      }
    })();
  }, [markSaved, refreshHistory, refreshFiles, setReview, notify, fail, askConfirm]);

  /* ---------------- review persistence (apply.1) ---------------- */

  useEffect(() => installReviewPersistence(), []);

  /* ---------------- actions ---------------- */

  const copyResult = useCallback(() => {
    if (!review) return;
    const text = composeReview(review);
    navigator.clipboard
      .writeText(text)
      .then(() => notify('info', `Copied ${text.length} characters.`))
      .catch((err: unknown) => notify('error', errorMessage(err)));
  }, [review, notify]);

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
  }, [setReviewDialogOpen]);

  /**
   * The dialog collects provider, model and effort before anything is sent
   * (item 6). The Claude Setup screen only stands in front of it when Claude is
   * the provider; OpenAI's only prerequisite is a key, which the dialog itself
   * shows, and a card points at Settings when there is none (Phase 5c).
   */
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

  const openReviewDialog = useCallback(() => {
    const current = useApp.getState().review;
    if (!current?.sourcePath) return;
    if (refuseWhileEditing()) return;
    const provider = settings?.provider ?? 'claude';
    if (provider === 'claude' && claudeRuntime && claudeRuntime.state !== 'ready') {
      setSetupOpen(true);
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
  }, [settings, claudeRuntime, ai.keyStatus, notify, setReviewDialogOpen, refuseWhileEditing]);

  /**
   * Run a review. The chapter's review is read-only until it returns (round 3,
   * item 3): the result replaces the working set, so any decision made in the
   * meantime would vanish when it landed. Other chapters stay open to browse.
   */
  const startReview = useCallback(() => {
    const current = useApp.getState().review;
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
          setSetupOpen(true);
        }
        if (err instanceof ApiError && err.code === 'cancelled') {
          notify('info', 'Review cancelled.');
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
  }, [settings, ai, adoptReview, notify, setReviewDialogOpen, fail, refreshFiles]);

  const activeProvider = settings?.provider ?? 'claude';
  const activeRuntime = ai.runtimes[activeProvider];
  const runtimeLabel =
    labelForRuntime(activeRuntime, activeProvider === 'claude' ? ai.lastFailure : null) ?? undefined;

  const toolbar = (
    <Toolbar
      review={review}
      running={ai.running}
      progressLabel={progressLabel}
      saving={saving}
      onReviewWithAi={openReviewDialog}
      onCancelReview={ai.cancel}
      onManualReview={openManualReview}
      onSaveChapter={saveChapter}
      onCopyResult={copyResult}
      onSettings={() => setSettingsOpen(true)}
    />
  );

  if (setupOpen && claudeRuntime) {
    return (
      <div className="app-shell">
        {toolbar}
        <div className="body body--single">
          <SetupScreen
            runtime={claudeRuntime}
            checking={ai.checking}
            onCheckAgain={() => ai.check('claude')}
            onClose={() => setSetupOpen(false)}
          />
        </div>
        <StatusBar review={review} {...(runtimeLabel ? { runtimeLabel } : {})} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {toolbar}
      {review ? <FilterChips review={review} /> : null}

      <div className="body">
        <FileList
          files={files}
          index={index}
          activePath={review?.sourcePath ?? null}
          configured={Boolean(settings?.manuscriptFolder)}
          onOpen={openChapter}
          onChooseFolder={chooseManuscriptFolder}
          onNewChapter={() => setNewChapterOpen(true)}
        />

        {/* The find bar is a strip above the scroller, not a sticky bar inside
            it: inside, it scrolled out of view once the author was more than
            a screen down, and Ctrl+F then seemed to do nothing (round 4). */}
        <div className={`center-wrap ${findOpen ? 'center-wrap--find' : ''}`}>
          {review ? <FindBar /> : null}
          <main className="center">
            {review ? (
              <ReviewPane review={review} onSetCommentStatus={setCommentStatus} />
            ) : (
              <div className="empty">
                <h1>Nothing open</h1>
                <p>
                  Pick a chapter on the left, or start one with the + beside Chapters. Review with AI asks for
                  suggestions; Submit manual review turns a corrected copy into the same kind of list.
                </p>
              </div>
            )}
          </main>
          <NotificationCards
            onAction={(action) => {
              switch (action) {
                case 'open-settings':
                  openSettings();
                  break;
                case 'open-setup':
                  setSetupOpen(true);
                  break;
                case 'reveal-drafts':
                case 'reveal-backups':
                  void window.api
                    .invoke('shell:reveal', { target: action === 'reveal-drafts' ? 'drafts' : 'backups' })
                    .then((result) => {
                      if (!result.ok) notify('error', result.error.message);
                    });
                  break;
                default:
                  // Diagnostics (hardening.5) and updates (release.9) wire theirs in when they land.
                  break;
              }
            }}
          />
          <LockCard label={progressLabel} onCancel={ai.cancel} />
        </div>

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

      <StatusBar
        review={review}
        {...(runtimeLabel ? { runtimeLabel } : {})}
        rateLimit={ai.rateLimit?.message}
      />
      <HunkTooltip />
      <EditPopover onSaved={(message, tone) => notify(tone ?? 'info', message, 'edit')} />
      {newChapterOpen ? (
        <NewChapterDialog
          onClose={() => setNewChapterOpen(false)}
          onCreated={(file) => {
            setNewChapterOpen(false);
            refreshFiles();
            openChapter(file);
            notify('info', `Created ${file.name}.`);
          }}
        />
      ) : null}
      {manualReviewOpen && review?.sourcePath ? (
        <ManualReviewDialog
          review={review}
          onClose={() => setManualReviewOpen(false)}
          onLoadCorrected={loadCorrectedFromFile}
          onCreated={(next) => {
            adoptReview(next);
            notify(
              'info',
              `Built ${next.hunks.length} suggestion${next.hunks.length === 1 ? '' : 's'} from your text.`
            );
          }}
        />
      ) : null}
      {reviewDialogOpen && review && settings ? (
        <ReviewDialog
          review={review}
          settings={settings}
          models={ai.models}
          modelsLoading={ai.modelsLoading}
          runtimes={ai.runtimes}
          keyStatus={ai.keyStatus}
          history={history}
          unsavedDecisions={unsavedDecisionCount(review.hunks)}
          saving={saving}
          onSaveFirst={saveChapter}
          onApplySettings={setSettings}
          onNeedModels={ai.ensureModels}
          onOpenSettings={openSettings}
          onCheckClaude={() => ai.check('claude')}
          checking={ai.checking}
          onStart={startReview}
          onClose={() => setReviewDialogOpen(false)}
        />
      ) : null}
      {settingsOpen && settings ? (
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
          onOpenSetup={() => {
            setSettingsOpen(false);
            setSetupOpen(true);
          }}
        />
      ) : null}
      {/* Last, above everything: a question can be asked from any dialog above. */}
      <ConfirmDialog />
    </div>
  );
}
