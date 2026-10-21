/**
 * Writes main has under way, so that Restart now can let them end before the
 * installer stops the app (`release.8b`, PLAN 11.3 n). The four channels that
 * write the author's files run inside `trackWrite`: `files:save` (the chapter
 * and its backup), `files:create` (a new chapter), `reviews:save` (a review's
 * decisions) and `settings:set`; so does the controller's own write of the
 * download consent. `writesSettled(ms)` waits for every tracked write,
 * including one that starts while it waits, for at most `ms`.
 *
 * Nothing is refused or delayed: a write starts the moment its request
 * arrives, as before, and its answer and its failure are its own. The page
 * writes its waiting review and drafts writes before it asks for the install
 * (`prepareToLeaveApp('update')`); this only covers a write that is still in
 * main when the request comes.
 *
 * No electron import, so test/main/writes.test.ts drives it.
 */

export interface WriteTracker {
  /** Run `work` now and track it until it settles. Its result or its failure is the caller's, unchanged. */
  trackWrite: <T>(work: () => Promise<T>) => Promise<T>;
  /**
   * Resolve true once no tracked write is under way, or false after
   * `timeoutMs` while one still is. A write that starts while this waits is
   * waited for too, within the same time.
   */
  writesSettled: (timeoutMs: number) => Promise<boolean>;
  /** How many tracked writes are under way now. */
  pendingWrites: () => number;
}

export function createWriteTracker(): WriteTracker {
  const inFlight = new Set<Promise<void>>();

  function trackWrite<T>(work: () => Promise<T>): Promise<T> {
    let promise: Promise<T>;
    try {
      promise = work();
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const settled: Promise<void> = promise.then(
      () => undefined,
      () => undefined
    );
    inFlight.add(settled);
    void settled.then(() => {
      inFlight.delete(settled);
    });
    return promise;
  }

  async function writesSettled(timeoutMs: number): Promise<boolean> {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });
    try {
      // A write may start while the others end, so look again until none is left.
      while (inFlight.size > 0 && !timedOut) {
        await Promise.race([Promise.all([...inFlight]), deadline]);
      }
      return inFlight.size === 0;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  return { trackWrite, writesSettled, pendingWrites: () => inFlight.size };
}

/** The app's one tracker. */
const appWrites = createWriteTracker();

export const trackWrite: WriteTracker['trackWrite'] = (work) => appWrites.trackWrite(work);
export const writesSettled: WriteTracker['writesSettled'] = (timeoutMs) => appWrites.writesSettled(timeoutMs);
export const pendingWrites: WriteTracker['pendingWrites'] = () => appWrites.pendingWrites();
