import { afterEach, describe, expect, it } from 'vitest';
import { abortAll, liveControllerCount, registerController } from '../../src/main/providers/controllers';

/* release.18: quitting aborts every piece of work still in flight. */

afterEach(() => {
  abortAll();
});

describe('in-flight controllers', () => {
  it('aborts everything still running, once', () => {
    const a = new AbortController();
    const b = new AbortController();
    registerController(a);
    registerController(b);
    expect(liveControllerCount()).toBe(2);
    expect(abortAll()).toBe(2);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(liveControllerCount()).toBe(0);
    expect(abortAll()).toBe(0);
  });

  it('forgets work that finished normally', () => {
    const done = new AbortController();
    const release = registerController(done);
    release();
    expect(liveControllerCount()).toBe(0);
    abortAll();
    expect(done.signal.aborted).toBe(false);
  });

  it('forgets work that was cancelled on its own', () => {
    const cancelled = new AbortController();
    registerController(cancelled);
    cancelled.abort();
    expect(liveControllerCount()).toBe(0);
  });

  it('does not track a controller that is already aborted', () => {
    const late = new AbortController();
    late.abort();
    registerController(late);
    expect(liveControllerCount()).toBe(0);
  });
});
