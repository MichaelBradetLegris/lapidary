import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeyedWriter } from '../../src/renderer/state/persist';

/* apply.1: one debounced write queue per review. */

interface Harness {
  writes: [string, string][];
  errors: string[];
  pendingChanges: boolean[];
  /** resolve or fail the oldest write still in flight */
  finish: (error?: Error) => Promise<void>;
  inFlight: () => number;
}

function harness(manual = false) {
  const h: Harness = {
    writes: [],
    errors: [],
    pendingChanges: [],
    finish: () => Promise.resolve(),
    inFlight: () => 0
  };
  const waiting: { resolve: () => void; reject: (e: Error) => void }[] = [];
  h.finish = async (error) => {
    const next = waiting.shift();
    if (error) next?.reject(error);
    else next?.resolve();
    await vi.advanceTimersByTimeAsync(0);
  };
  h.inFlight = () => waiting.length;
  const writer = createKeyedWriter<string>({
    delayMs: 700,
    write: (key, value) => {
      h.writes.push([key, value]);
      if (!manual) return Promise.resolve();
      return new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }));
    },
    onError: (message) => void h.errors.push(message),
    onPendingChange: (pending) => void h.pendingChanges.push(pending)
  });
  return { h, writer };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createKeyedWriter', () => {
  it('writes the newest value once the key has been quiet for the delay', async () => {
    const { h, writer } = harness();
    writer.schedule('a', 'one');
    await vi.advanceTimersByTimeAsync(500);
    writer.schedule('a', 'two');
    await vi.advanceTimersByTimeAsync(699);
    expect(h.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.writes).toEqual([['a', 'two']]);
  });

  it('never lets one key cancel another, which is how a decision used to be lost', async () => {
    const { h, writer } = harness();
    writer.schedule('chapter A', 'accepted');
    await vi.advanceTimersByTimeAsync(100);
    writer.schedule('chapter B', 'opened');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.writes).toEqual([
      ['chapter A', 'accepted'],
      ['chapter B', 'opened']
    ]);
  });

  it('keeps one write in flight per key and writes the newest value last', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.inFlight()).toBe(1);
    writer.schedule('a', 'two');
    writer.schedule('a', 'three');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.inFlight()).toBe(1);
    await h.finish();
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['a', 'three']
    ]);
    await h.finish();
    expect(writer.pending()).toBe(false);
  });

  it('flush writes what is waiting at once and resolves when it is written', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    writer.schedule('b', 'two');
    let done = false;
    const flushed = writer.flush().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['b', 'two']
    ]);
    expect(done).toBe(false);
    await h.finish();
    await h.finish();
    await flushed;
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.writes).toHaveLength(2);
  });

  it('flush of one key leaves the others to their timers', async () => {
    const { h, writer } = harness();
    writer.schedule('a', 'one');
    writer.schedule('b', 'two');
    await writer.flush('a');
    expect(h.writes).toEqual([['a', 'one']]);
    expect(writer.pending('a')).toBe(false);
    expect(writer.pending('b')).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['b', 'two']
    ]);
  });

  it('a flush that meets a write in flight waits for it and then writes the newest value', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    await vi.advanceTimersByTimeAsync(700);
    writer.schedule('a', 'two');
    const flushed = writer.flush('a');
    await h.finish();
    await h.finish();
    await flushed;
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['a', 'two']
    ]);
  });

  it('reports a failure once per distinct message, and again after a success', async () => {
    const { h, writer } = harness(true);
    for (const value of ['one', 'two']) {
      writer.schedule('a', value);
      await vi.advanceTimersByTimeAsync(700);
      await h.finish(new Error('disk full'));
    }
    expect(h.errors).toEqual(['disk full']);
    writer.schedule('a', 'three');
    await vi.advanceTimersByTimeAsync(700);
    await h.finish();
    writer.schedule('a', 'four');
    await vi.advanceTimersByTimeAsync(700);
    await h.finish(new Error('disk full'));
    expect(h.errors).toEqual(['disk full', 'disk full']);
  });

  it('keeps a value whose write failed, says why, and counts as busy until it is written (apply.9)', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    await vi.advanceTimersByTimeAsync(700);
    await h.finish(new Error('disk full'));
    expect(writer.pending()).toBe(false);
    expect(writer.failures()).toEqual(['disk full']);
    expect(writer.failures('a')).toEqual(['disk full']);
    expect(writer.failures('b')).toEqual([]);
    // Not on disk, so the writer has not gone idle.
    expect(h.pendingChanges).toEqual([true]);

    // A flush alone does not try it again; retry queues it, and the flush writes it.
    await writer.flush();
    expect(h.writes).toEqual([['a', 'one']]);
    writer.retry();
    const flushed = writer.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['a', 'one']
    ]);
    await h.finish();
    await flushed;
    expect(writer.failures()).toEqual([]);
    expect(h.pendingChanges).toEqual([true, false]);
  });

  it('retry leaves a key alone while a newer value for it waits, whose write clears the failure', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    await vi.advanceTimersByTimeAsync(700);
    await h.finish(new Error('disk full'));
    writer.schedule('a', 'two');
    writer.retry('a');
    const flushed = writer.flush();
    await h.finish();
    await flushed;
    expect(h.writes).toEqual([
      ['a', 'one'],
      ['a', 'two']
    ]);
    expect(writer.failures()).toEqual([]);
    expect(writer.pending()).toBe(false);
  });

  it('lists each reason once, and retries only the key it is given', async () => {
    const { h, writer } = harness(true);
    writer.schedule('a', 'one');
    writer.schedule('b', 'two');
    await vi.advanceTimersByTimeAsync(700);
    await h.finish(new Error('disk full'));
    await h.finish(new Error('disk full'));
    expect(writer.failures()).toEqual(['disk full']);
    writer.retry('b');
    const flushed = writer.flush();
    await h.finish();
    await flushed;
    expect(h.writes.slice(2)).toEqual([['b', 'two']]);
    expect(writer.failures()).toEqual(['disk full']);
    expect(writer.failures('b')).toEqual([]);
  });

  it('says when it becomes busy and when it is idle again', async () => {
    const { h, writer } = harness(true);
    expect(writer.pending()).toBe(false);
    writer.schedule('a', 'one');
    writer.schedule('b', 'two');
    expect(writer.pending()).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    await h.finish();
    expect(writer.pending()).toBe(true);
    await h.finish();
    expect(writer.pending()).toBe(false);
    expect(h.pendingChanges).toEqual([true, false]);
  });
});
