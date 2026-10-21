import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteTracker } from '../../src/main/writes';

/* release.8b: the writes main has under way, which Restart now lets end
   before the installer stops the app (PLAN 11.3 n). */

/** A promise and the functions that settle it. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('trackWrite', () => {
  it('runs the work at once and hands back its result unchanged', async () => {
    const { trackWrite, pendingWrites } = createWriteTracker();
    const work = vi.fn(() => Promise.resolve('written'));
    const result = trackWrite(work);
    expect(work).toHaveBeenCalledTimes(1);
    expect(pendingWrites()).toBe(1);
    await expect(result).resolves.toBe('written');
    expect(pendingWrites()).toBe(0);
  });

  it('hands back its failure unchanged, and stops tracking it', async () => {
    const { trackWrite, pendingWrites } = createWriteTracker();
    const failure = new Error('disk full');
    await expect(trackWrite(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(pendingWrites()).toBe(0);
  });

  it('turns work that throws before it returns a promise into a rejection', async () => {
    const { trackWrite, pendingWrites } = createWriteTracker();
    await expect(
      trackWrite(() => {
        throw new Error('refused');
      })
    ).rejects.toThrow('refused');
    expect(pendingWrites()).toBe(0);
  });
});

describe('writesSettled', () => {
  it('is true at once with nothing under way', async () => {
    const { writesSettled } = createWriteTracker();
    await expect(writesSettled(2000)).resolves.toBe(true);
  });

  it('waits for the writes under way, and is true once they end, failed ones too', async () => {
    const { trackWrite, writesSettled } = createWriteTracker();
    const save = deferred<string>();
    const review = deferred<string>();
    void trackWrite(() => save.promise);
    trackWrite(() => review.promise).catch(() => undefined);
    let answer: boolean | null = null;
    void writesSettled(2000).then((value) => {
      answer = value;
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(answer).toBeNull();
    save.resolve('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toBeNull();
    review.reject(new Error('locked'));
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toBe(true);
  });

  it('waits for a write that starts while it waits, within the same time', async () => {
    const { trackWrite, writesSettled } = createWriteTracker();
    const first = deferred();
    const second = deferred();
    void trackWrite(() => first.promise);
    let answer: boolean | null = null;
    void writesSettled(2000).then((value) => {
      answer = value;
    });
    void trackWrite(() => second.promise);
    first.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(answer).toBeNull();
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(answer).toBe(true);
  });

  it('is false when the time runs out with a write still under way', async () => {
    const { trackWrite, writesSettled, pendingWrites } = createWriteTracker();
    void trackWrite(() => new Promise<never>(() => undefined));
    let answer: boolean | null = null;
    void writesSettled(2000).then((value) => {
      answer = value;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
    expect(pendingWrites()).toBe(1);
  });

  it('leaves no timer behind once the writes have ended', async () => {
    const { trackWrite, writesSettled } = createWriteTracker();
    const save = deferred();
    void trackWrite(() => save.promise);
    const settled = writesSettled(2000);
    save.resolve();
    await expect(settled).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
