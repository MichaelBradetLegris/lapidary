import type { ApiEventMap } from '../../shared/ipc';
import { call } from './client';
import type { CloseGuardIo, PageWrites } from './closeGuard';
import { flushColumnWrites } from './columnWidths';
import type { CrashPageDeps } from './crashPage';
import { draftWriteFailures, flushDraftWrites, retryDraftWrites } from './drafts';
import { flushHintWrites } from './hints';
import { flushReviewWrites, retryReviewWrites, reviewWriteFailures } from './reviewPersistence';
import { flushSplitWrites } from './split';

/*
 * How the page's close guard and writers reach main, for App and for the
 * page shown after a crash (hardening.4, `CrashFallback`), which takes the
 * guard over when App can no longer be drawn.
 */

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
export const CLOSE_GUARD_IO: CloseGuardIo = {
  pushState: (state) => void call('app:guard-state', state).catch(() => undefined),
  sendStatus: (status) => void call('app:close-status', { status }).catch(() => undefined),
  sendDecision: (close) => void call('app:close-decision', { close }).catch(() => undefined),
  onCloseRequested: (listener) => onMain('app:close-requested', () => listener()),
  onFlush: (listener) => onMain('app:flush', ({ reason }) => listener(reason))
};

/**
 * The review and paragraph writers, which a close and the end of a session
 * write out (apply.9), and a hint put away just before, such as the Save hint
 * that Save and close puts away (apply.12), and the side panel's split moved
 * just before (ui.6), or a column's width (polish.5). A hint, a split or a
 * width that cannot be written is not reported: the hint shows again at the
 * next start, which has the split and the widths last written. (Show states,
 * polish.12, was written here too until polish.17 took it away.)
 */
export const PAGE_WRITES: PageWrites = {
  flush: async () => {
    await Promise.all([
      flushReviewWrites(),
      flushDraftWrites(),
      flushHintWrites(),
      flushSplitWrites(),
      flushColumnWrites()
    ]);
  },
  retry: () => {
    retryReviewWrites();
    retryDraftWrites();
  },
  failures: () => [...reviewWriteFailures(), ...draftWriteFailures()]
};

/**
 * What the page shown after a crash writes as it opens (hardening.4,
 * `writeAfterCrash`): the review and paragraph writers, whose failures it
 * names. A hint or a split is not worth holding Reload window for.
 */
export const CRASH_WRITES: PageWrites = {
  flush: async () => {
    await Promise.all([flushReviewWrites(), flushDraftWrites()]);
  },
  retry: () => PAGE_WRITES.retry(),
  failures: () => PAGE_WRITES.failures()
};

/**
 * What the page shown after a crash takes over and writes (hardening.4,
 * `createCrashPage`): the close guard with the writes a close makes, and
 * `CRASH_WRITES` as it opens and on Try again.
 */
export const CRASH_PAGE: CrashPageDeps = {
  io: CLOSE_GUARD_IO,
  closeWrites: PAGE_WRITES,
  writes: CRASH_WRITES
};
