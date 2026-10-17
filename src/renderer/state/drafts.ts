import type { DraftFile, DraftSaveRequest, SetAsideRequest, StoredDraft } from '../../shared/ipc';
import type { Review } from '../../shared/types';
import {
  draftsUnreadableCardText,
  placeDrafts,
  restoredCardText,
  setAsideCardText,
  setAsideFailedCardText,
  toStoredDrafts
} from '../../shared/ui/drafts';
import { createKeyedWriter } from './persist';
import { useApp } from './store';

/*
 * Paragraph boxes kept on disk (apply.16, PLAN 11.3 j and 7.4).
 *
 * Every box open in a chapter is written to that chapter's drafts file 700 ms
 * after the last keystroke, by a writer with one queue per chapter
 * (`draftWriter`), so a box survives leaving the chapter, closing the app, an
 * update or a crash. Closing the last box deletes the file. Whenever another
 * chapter or another review comes on screen, what was kept for its chapter
 * comes back (`restore`): a box goes back where its block still reads as it
 * did when the box opened (`placeDrafts`), and one holding typed text that
 * cannot go back is set aside as a .txt, with a card whose Show the text
 * opens it. Until the .txt is written, such a box stays in the chapter's file
 * ("carried"), so a failure never loses what was typed.
 *
 * It reaches main only through `DraftIo`, which App fills with the IPC calls
 * when it installs this, so the module needs neither the DOM nor the preload
 * bridge and the tests run in node with stand-ins.
 */

/** Debounce for typing, the same as for decisions (`REVIEW_WRITE_DELAY_MS`). */
export const DRAFT_WRITE_DELAY_MS = 700;

/** Cards about keeping boxes share a key, so a failing disk leaves one card, not one per keystroke. */
export const DRAFTS_SAVE_CARD = 'drafts-save';

/** The card saying boxes came back; a later one replaces it. */
export const DRAFTS_RESTORED_CARD = 'drafts-restored';

export interface DraftIo {
  /** `drafts:load` */
  load: (sourcePath: string) => Promise<DraftFile | null>;
  /** `drafts:save` */
  save: (request: DraftSaveRequest) => Promise<void>;
  /** `drafts:set-aside` */
  setAside: (request: SetAsideRequest) => Promise<{ name: string }>;
}

export interface DraftPersistence {
  /** watch the store: write boxes as they change, bring them back as reviews come on screen; returns the unsubscribe */
  install: () => () => void;
  /** write what is waiting, for one chapter or for every chapter, and wait for it */
  flush: (sourcePath?: string) => Promise<void>;
  /** a write is waiting or under way, for one chapter or any */
  pending: (sourcePath?: string) => boolean;
  /** bring back what was kept for the chapter of `review`; resolves when done, never rejects */
  restore: (review: Review) => Promise<void>;
  /** the restores under way, for a caller (or a test) that must let them end */
  settled: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sameReview(a: Review | null, b: Review | null): boolean {
  return a !== null && b !== null && a.id === b.id && a.sourcePath === b.sourcePath;
}

export function createDraftPersistence(io: DraftIo, options: { delayMs?: number } = {}): DraftPersistence {
  /** boxes in a chapter's file that are not on screen, because setting them aside failed */
  const carried = new Map<string, StoredDraft[]>();
  /** the boxes last written for each chapter, so a write can be repeated without them on screen */
  const latest = new Map<string, { reviewId: string; drafts: StoredDraft[] }>();
  /** chapters whose file is being read back: writes wait, so none replaces it unread */
  const loading = new Set<string>();
  /** chapters whose boxes changed while their file was being read back */
  const changedWhileLoading = new Set<string>();
  /** restores under way, by chapter; a second for the same chapter runs after the first */
  const restores = new Map<string, Promise<void>>();

  const notify = (...args: Parameters<ReturnType<typeof useApp.getState>['notify']>): void =>
    void useApp.getState().notify(...args);

  const draftWriter = createKeyedWriter<DraftSaveRequest>({
    delayMs: options.delayMs ?? DRAFT_WRITE_DELAY_MS,
    describeError: messageOf,
    write: (_sourcePath, request) => io.save(request),
    // Said once per distinct failure; a card per keystroke would be noise.
    onError: (message) =>
      notify('error', `The paragraphs you are editing could not be kept: ${message}`, DRAFTS_SAVE_CARD),
    onPendingChange: (pending) => useApp.setState({ draftWritesPending: pending })
  });

  /** Queue a write of these boxes for the chapter, with any it still carries after them. */
  function write(sourcePath: string, reviewId: string, onScreen: StoredDraft[]): void {
    latest.set(sourcePath, { reviewId, drafts: onScreen });
    draftWriter.schedule(sourcePath, {
      sourcePath,
      reviewId,
      drafts: [...onScreen, ...(carried.get(sourcePath) ?? [])]
    });
  }

  function writeOnScreen(sourcePath: string): boolean {
    const { review, drafts } = useApp.getState();
    if (!review || review.sourcePath !== sourcePath) return false;
    write(sourcePath, review.id, toStoredDrafts(drafts));
    return true;
  }

  async function restoreNow(sourcePath: string): Promise<void> {
    let kept: DraftFile | null = null;
    let failed = false;
    loading.add(sourcePath);
    try {
      // A write still waiting for this chapter lands first, so the newest is read back.
      await draftWriter.flush(sourcePath);
      kept = await io.load(sourcePath);
    } catch (err) {
      failed = true;
      notify('error', draftsUnreadableCardText(messageOf(err)), DRAFTS_SAVE_CARD);
    } finally {
      loading.delete(sourcePath);
    }
    const typedMeanwhile = changedWhileLoading.delete(sourcePath);

    const state = useApp.getState();
    const review = state.review;
    // The author has left the chapter already: the file stays as it is for next time.
    if (!review || review.sourcePath !== sourcePath) return;
    if (failed || !kept || kept.drafts.length === 0) {
      // Boxes opened while the file was read are written now; with nothing
      // read and nothing typed, the file is left as it is.
      if (typedMeanwhile) writeOnScreen(sourcePath);
      return;
    }

    // What this chapter carried is in the file just read, and is placed again.
    carried.delete(sourcePath);
    const placement = placeDrafts(
      { base: review.base.text, hunks: review.hunks },
      kept.drafts,
      Object.values(state.drafts)
    );
    if (placement.setAside.length > 0) carried.set(sourcePath, placement.setAside);
    state.reopenDrafts(placement.reopen);
    writeOnScreen(sourcePath);
    const restored = restoredCardText(placement.reopen);
    if (restored) notify('info', restored, DRAFTS_RESTORED_CARD);

    if (placement.setAside.length === 0) return;
    try {
      const { name } = await io.setAside({ sourcePath, drafts: placement.setAside });
      if (carried.get(sourcePath) === placement.setAside) carried.delete(sourcePath);
      // The file no longer needs them; on screen or not, write it without them.
      const last = latest.get(sourcePath);
      if (last) write(sourcePath, last.reviewId, last.drafts);
      notify('warn', setAsideCardText(placement.setAside, name), undefined, 'reveal-drafts', name);
    } catch (err) {
      notify('error', setAsideFailedCardText(placement.setAside, messageOf(err)));
    }
  }

  function restore(review: Review): Promise<void> {
    const sourcePath = review.sourcePath;
    if (!sourcePath) return Promise.resolve();
    const before = restores.get(sourcePath) ?? Promise.resolve();
    const run: Promise<void> = before
      .then(() => restoreNow(sourcePath))
      .catch((err: unknown) => notify('error', draftsUnreadableCardText(messageOf(err)), DRAFTS_SAVE_CARD))
      .finally(() => {
        if (restores.get(sourcePath) === run) restores.delete(sourcePath);
      });
    restores.set(sourcePath, run);
    return run;
  }

  return {
    install: () =>
      useApp.subscribe((state, previous) => {
        const review = state.review;
        if (!review?.sourcePath) return;
        if (!sameReview(review, previous.review)) {
          // Another chapter or review is on screen: what was left open in it comes back.
          void restore(review);
          return;
        }
        if (state.drafts === previous.drafts) return;
        if (loading.has(review.sourcePath)) changedWhileLoading.add(review.sourcePath);
        else write(review.sourcePath, review.id, toStoredDrafts(state.drafts));
      }),
    flush: (sourcePath) => draftWriter.flush(sourcePath),
    pending: (sourcePath) => draftWriter.pending(sourcePath),
    restore,
    settled: async () => {
      while (restores.size > 0) await Promise.all([...restores.values()]);
    }
  };
}

/** The app's one instance, made by the first install. */
let persistence: DraftPersistence | null = null;

/**
 * Keep paragraph boxes on disk and bring them back, through `io` (App, once;
 * a second install, as React's development mode makes, reuses the first
 * instance). Returns the unsubscribe.
 */
export function installDraftPersistence(io: DraftIo): () => void {
  persistence ??= createDraftPersistence(io);
  return persistence.install();
}

/**
 * Write the boxes waiting to be written, for one chapter or all, and wait for
 * it: before leaving a chapter, and before the window closes or the session
 * ends.
 */
export function flushDraftWrites(sourcePath?: string): Promise<void> {
  return persistence ? persistence.flush(sourcePath) : Promise.resolve();
}
