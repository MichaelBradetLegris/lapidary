import type { Review } from '../../shared/types';
import { call, errorMessage } from './client';
import { createKeyedWriter } from './persist';
import { useApp } from './store';

/*
 * Writing review json (apply.1, PLAN 6.4).
 *
 * Every review has its own queue, keyed by chapter and review id, so a
 * decision is written even when the author has already moved on to another
 * chapter or another review in History. Two save points remain: right away
 * for a new review and after Save to chapter (`writeReviewNow`), and 700 ms
 * after the last decision for everything else (the store subscription).
 */

/** Debounce for decisions: long enough to batch a burst of clicks. */
export const REVIEW_WRITE_DELAY_MS = 700;

interface Pending {
  review: Review;
  /** the history entry to overwrite, or null for a new one */
  path: string | null;
}

export function reviewKey(review: Pick<Review, 'sourcePath' | 'id'>): string {
  return `${review.sourcePath}\u0000${review.id}`;
}

/** The json file each review was last written to. */
const paths = new Map<string, string>();
/** The `updatedAt` of each review as it is on disk, so an unchanged review is not written again. */
const persisted = new Map<string, string>();

/** The card, and the close guard's line, when a review could not be written. */
function notSavedText(message: string): string {
  return `The review could not be saved: ${message}`;
}

const writer = createKeyedWriter<Pending>({
  delayMs: REVIEW_WRITE_DELAY_MS,
  describeError: errorMessage,
  write: async (key, { review, path }) => {
    const target = paths.get(key) ?? path;
    const stored = await call('reviews:save', { review, ...(target ? { path: target } : {}) });
    paths.set(key, stored.path);
    persisted.set(key, review.updatedAt);
    const state = useApp.getState();
    if (state.review && reviewKey(state.review) === key) {
      if (state.reviewPath !== stored.path) useApp.setState({ reviewPath: stored.path });
      state.markReviewPersisted(stored.path);
    }
  },
  // Said once per distinct failure; a card per keystroke would be noise.
  onError: (message) => {
    useApp.getState().notify('error', notSavedText(message), 'review-save');
  },
  // A write that failed counts until one succeeds, so a close asks first (apply.9).
  onPendingChange: (pending) => useApp.setState({ persistPending: pending })
});

/**
 * Queue a write of the review as it is now, unless it is empty (a chapter
 * opened with no review yet) or already on disk exactly like this.
 */
export function scheduleReviewWrite(review: Review, path: string | null): void {
  if (!review.sourcePath) return;
  if (review.hunks.length === 0 && review.comments.length === 0) return;
  const key = reviewKey(review);
  if (persisted.get(key) === review.updatedAt) return;
  writer.schedule(key, { review, path });
}

/**
 * Write the review now, after anything already queued for it, and resolve
 * with the file it is in, or null when the write failed (which has then been
 * reported). Used for a new review, which is expensive to lose, and after
 * Save to chapter.
 */
export async function writeReviewNow(review: Review, path: string | null): Promise<string | null> {
  const key = reviewKey(review);
  writer.schedule(key, { review, path });
  await writer.flush(key);
  return persisted.get(key) === review.updatedAt ? (paths.get(key) ?? null) : null;
}

/** Write everything that is waiting, for every review, and wait for it. */
export function flushReviewWrites(): Promise<void> {
  return writer.flush();
}

/**
 * Queue again every review write that failed and has not been made since, so
 * the next flush tries it once more (the close guard, apply.9).
 */
export function retryReviewWrites(): void {
  writer.retry();
}

/** Why reviews are not on disk as the author left them: the words of their cards; empty when they are. */
export function reviewWriteFailures(): string[] {
  return writer.failures().map(notSavedText);
}

/**
 * Why this review is not on disk as the author left it, in its card's words,
 * or null when it is: a write of it failed and none has worked since. An
 * open checks it, after trying failed writes again (`retryReviewWrites`),
 * before it shows the review read from disk, which would come on screen
 * without those decisions; the next write would then put them back over what
 * the page showed (apply.25 review).
 */
export function reviewWriteFailureOf(review: Pick<Review, 'sourcePath' | 'id'>): string | null {
  const [message] = writer.failures(reviewKey(review));
  return message === undefined ? null : notSavedText(message);
}

/** Record that `review` was just read from `path` unchanged, so it is not written back. */
export function markReviewPersistedState(review: Review, path: string | null): void {
  const key = reviewKey(review);
  persisted.set(key, review.updatedAt);
  if (path) paths.set(key, path);
}

/** Write the open review whenever a decision changes it. Returns the unsubscribe. */
export function installReviewPersistence(): () => void {
  return useApp.subscribe((state, previous) => {
    if (state.review && state.review !== previous.review) scheduleReviewWrite(state.review, state.reviewPath);
  });
}
