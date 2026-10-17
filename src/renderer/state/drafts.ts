import type { DraftFile, DraftSaveRequest, SetAsideRequest, StoredDraft } from '../../shared/ipc';
import type { Review } from '../../shared/types';
import {
  draftsReadLaterCardText,
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
 * (`draftWriter`), so a box survives leaving the chapter (the leave prompt's
 * Keep for later, apply.7), closing the app, an update or a crash. Closing the
 * last box deletes the file. Whenever another chapter or another review comes
 * on screen, what was kept for its chapter comes back (`restore`): a box goes
 * back where its block still reads as it did when the box opened
 * (`placeDrafts`), and one holding typed text that cannot go back is set aside
 * as a .txt, with a card whose Show the text opens it. Until the .txt is
 * written, such a box stays in the chapter's file ("carried"), so a failure
 * never loses what was typed. The card saying boxes came back goes when
 * another chapter or review comes on screen, or once the boxes it names are
 * applied or closed.
 *
 * A file that could not be read back is never written over unread: every
 * write for its chapter reads it first and writes nothing while it still
 * cannot be read, and once it can, what it held is carried (C.53).
 *
 * It reaches main only through `DraftIo`, which App fills with the IPC calls
 * when it installs this, so the module needs neither the DOM nor the preload
 * bridge and the tests run in node with stand-ins.
 */

/** Debounce for typing, the same as for decisions (`REVIEW_WRITE_DELAY_MS`). */
export const DRAFT_WRITE_DELAY_MS = 700;

/** Cards about keeping boxes share a key, so a failing disk leaves one card, not one per keystroke. */
export const DRAFTS_SAVE_CARD = 'drafts-save';

/**
 * The card saying boxes came back; a later one replaces it, and it goes when
 * another chapter or review comes on screen or its boxes are all closed.
 */
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
  /** write what is waiting, for one chapter or for every chapter, and wait for it; a held write is tried again */
  flush: (sourcePath?: string) => Promise<void>;
  /** a write is waiting, under way or held (its file could not be read), for one chapter or any */
  pending: (sourcePath?: string) => boolean;
  /**
   * Why boxes are not on disk as they stand: a write that failed, or one held
   * because the chapter's file could not be read; empty when they are (the
   * close guard, apply.9).
   */
  failures: () => string[];
  /** queue again the writes that failed, so the next flush tries them once more; held writes need no help */
  retry: () => void;
  /** bring back what was kept for the chapter of `review`; resolves when done, never rejects */
  restore: (review: Review) => Promise<void>;
  /** the restores under way, for a caller (or a test) that must let them end */
  settled: () => Promise<void>;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The card, and the close guard's line, when boxes could not be written. */
function notKeptText(message: string): string {
  return `The paragraphs you are editing could not be kept: ${message}`;
}

function sameReview(a: Review | null, b: Review | null): boolean {
  return a !== null && b !== null && a.id === b.id && a.sourcePath === b.sourcePath;
}

/** A write waiting for a chapter: the boxes on screen, and the review they are open in. */
interface PendingDrafts {
  reviewId: string;
  drafts: StoredDraft[];
}

export function createDraftPersistence(io: DraftIo, options: { delayMs?: number } = {}): DraftPersistence {
  /**
   * Boxes in a chapter's file that are not on screen: setting them aside
   * failed, or the file could be read only after the chapter came on screen.
   */
  const carried = new Map<string, StoredDraft[]>();
  /** the boxes last written for each chapter, so a write can be repeated without them on screen */
  const latest = new Map<string, PendingDrafts>();
  /** chapters whose file is being read back: writes wait, so none replaces it unread */
  const loading = new Set<string>();
  /** chapters whose boxes changed while their file was being read back */
  const changedWhileLoading = new Set<string>();
  /**
   * Chapters whose file could not be read back, with the reason last shown:
   * nothing is written to the file until it has been read.
   */
  const unread = new Map<string, string>();
  /**
   * Writes not made because the file still could not be read, by chapter: the
   * next flush tries each again, unless a newer write for it is waiting.
   */
  const held = new Map<string, PendingDrafts>();
  /** restores under way, by chapter; a second for the same chapter runs after the first */
  const restores = new Map<string, Promise<void>>();
  /**
   * The keys of the boxes the restored card names ("Paragraph 6 is open for
   * editing again"), while that card is the one under `DRAFTS_RESTORED_CARD`:
   * it goes once none of them is open (`dismissRestoredCard`).
   */
  let restoredCardKeys: number[] | null = null;

  /**
   * Take the card about boxes coming back off the screen once it no longer
   * says anything true about the page: another chapter or review is on
   * screen, or the boxes it names are applied or closed (apply.7 review).
   */
  function dismissRestoredCard(): void {
    restoredCardKeys = null;
    useApp.getState().dismissNotificationsByKey(DRAFTS_RESTORED_CARD);
  }

  const notify = (...args: Parameters<ReturnType<typeof useApp.getState>['notify']>): void =>
    void useApp.getState().notify(...args);

  /** The store's flag: a write is waiting, under way, or held. */
  let writerBusy = false;
  function reportPending(): void {
    const pending = writerBusy || held.size > 0;
    if (useApp.getState().draftWritesPending !== pending) useApp.setState({ draftWritesPending: pending });
  }

  const draftWriter = createKeyedWriter<PendingDrafts>({
    delayMs: options.delayMs ?? DRAFT_WRITE_DELAY_MS,
    describeError: messageOf,
    write: (sourcePath, pending) => save(sourcePath, pending),
    // Said once per distinct failure; a card per keystroke would be noise.
    onError: (message) => notify('error', notKeptText(message), DRAFTS_SAVE_CARD),
    onPendingChange: (busy) => {
      writerBusy = busy;
      reportPending();
    }
  });

  /**
   * Write a chapter's boxes: those on screen, then any it carries, as they are
   * when the write starts. A file that could not be read back is read first,
   * and while it still cannot be, nothing is written and the write is held.
   */
  async function save(sourcePath: string, pending: PendingDrafts): Promise<void> {
    if (unread.has(sourcePath) && !(await readUnread(sourcePath))) {
      held.set(sourcePath, pending);
      reportPending();
      return;
    }
    if (held.delete(sourcePath)) reportPending();
    await io.save({
      sourcePath,
      reviewId: pending.reviewId,
      drafts: [...pending.drafts, ...(carried.get(sourcePath) ?? [])]
    });
  }

  /** Write what is waiting for a chapter, or for every chapter, trying held writes again. */
  async function flush(sourcePath?: string): Promise<void> {
    for (const [chapter, pending] of held) {
      if (sourcePath !== undefined && chapter !== sourcePath) continue;
      // A newer write for the chapter replaces the held one.
      if (!draftWriter.pending(chapter)) draftWriter.schedule(chapter, pending);
    }
    await draftWriter.flush(sourcePath);
  }

  /**
   * Read again a file that could not be read back when its chapter came on
   * screen. Its boxes never went back on the page, so they are carried: kept
   * after the boxes on screen, and placed the next time a review of the
   * chapter comes on screen. False when it still cannot be read; the card says
   * so once per reason, not once per pause in typing.
   */
  async function readUnread(sourcePath: string): Promise<boolean> {
    let kept: DraftFile | null;
    try {
      kept = await io.load(sourcePath);
    } catch (err) {
      const message = messageOf(err);
      if (unread.get(sourcePath) !== message) {
        unread.set(sourcePath, message);
        notify('error', draftsUnreadableCardText(message), DRAFTS_SAVE_CARD);
      }
      return false;
    }
    unread.delete(sourcePath);
    useApp.getState().dismissNotificationsByKey(DRAFTS_SAVE_CARD);
    // The file holds whatever this chapter carried, as at a restore. The card
    // goes when the boxes come back and say so.
    if (kept && kept.drafts.length > 0) {
      carried.set(sourcePath, kept.drafts);
      // This card names boxes that are not on screen, so closing a box does not take it away.
      restoredCardKeys = null;
      notify('info', draftsReadLaterCardText(), DRAFTS_RESTORED_CARD);
    }
    return true;
  }

  /** Queue a write of these boxes for the chapter; any it carries are added when it is written. */
  function write(sourcePath: string, reviewId: string, onScreen: StoredDraft[]): void {
    const pending = { reviewId, drafts: onScreen };
    latest.set(sourcePath, pending);
    draftWriter.schedule(sourcePath, pending);
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
    const wasUnread = unread.has(sourcePath);
    loading.add(sourcePath);
    try {
      // A write still waiting for this chapter lands first, so the newest is read back.
      await flush(sourcePath);
      // Still held: the file could not be read a moment ago, and the held
      // boxes must reach it before it is read back, or they would be lost.
      if (held.has(sourcePath)) throw new Error(unread.get(sourcePath) ?? 'it could not be read');
      kept = await io.load(sourcePath);
      unread.delete(sourcePath);
      // Read at last: a card saying it could not be, or that it was read
      // since, is out of date; what comes back now has a card of its own.
      if (wasUnread) {
        useApp.getState().dismissNotificationsByKey(DRAFTS_SAVE_CARD);
        dismissRestoredCard();
      }
    } catch (err) {
      failed = true;
      // Until it has been read, every write reads it first (`save`).
      const message = messageOf(err);
      unread.set(sourcePath, message);
      notify('error', draftsUnreadableCardText(message), DRAFTS_SAVE_CARD);
    } finally {
      loading.delete(sourcePath);
    }
    const typedMeanwhile = changedWhileLoading.delete(sourcePath);

    const state = useApp.getState();
    const review = state.review;
    // The author has left the chapter already: the file stays as it is for next time.
    if (!review || review.sourcePath !== sourcePath) return;
    if (failed || !kept || kept.drafts.length === 0) {
      // Boxes opened while the file was read are written now (`save` reads a
      // file that could not be read first); with nothing typed, the file is
      // left as it is.
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
    if (restored) {
      // The boxes the card names: those with typed text, as `restoredCardText` counts them.
      restoredCardKeys = placement.reopen.filter((draft) => draft.text !== draft.initial).map((d) => d.key);
      notify('info', restored, DRAFTS_RESTORED_CARD);
    }

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
          // Another chapter or review is on screen: a card about boxes that
          // came back on the last one is out of date, and what was left open
          // in this one comes back, with a card of its own.
          dismissRestoredCard();
          void restore(review);
          return;
        }
        if (state.drafts === previous.drafts) return;
        // The boxes the card names are all applied or closed: it has nothing left to say.
        if (restoredCardKeys && !restoredCardKeys.some((key) => key in state.drafts)) dismissRestoredCard();
        if (loading.has(review.sourcePath)) changedWhileLoading.add(review.sourcePath);
        else write(review.sourcePath, review.id, toStoredDrafts(state.drafts));
      }),
    flush,
    pending: (sourcePath) =>
      draftWriter.pending(sourcePath) || (sourcePath === undefined ? held.size > 0 : held.has(sourcePath)),
    failures: () => {
      const reasons = draftWriter.failures().map(notKeptText);
      for (const chapter of held.keys()) {
        reasons.push(draftsUnreadableCardText(unread.get(chapter) ?? 'it could not be read'));
      }
      return [...new Set(reasons)];
    },
    retry: () => draftWriter.retry(),
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

/** Queue again the box writes that failed, before the window closes (apply.9). */
export function retryDraftWrites(): void {
  persistence?.retry();
}

/** Why boxes are not on disk as they stand, in the words of their cards; empty when they are. */
export function draftWriteFailures(): string[] {
  return persistence ? persistence.failures() : [];
}
