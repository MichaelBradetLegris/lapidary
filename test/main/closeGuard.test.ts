import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACK_TIMEOUT_MS,
  FINISHING_TIMEOUT_MS,
  boxAnswer,
  createCloseGuard,
  messageBoxOptions,
  type BoxAnswer,
  type CloseEventLike,
  type GuardWindow
} from '../../src/main/closeGuard';
import { APP_NAME } from '../../src/shared/branding';
import { EVENT_CHANNELS, REQUEST_CHANNELS, type CloseGuardState } from '../../src/shared/ipc';
import { unresponsiveDetail, type UnresponsiveBox } from '../../src/shared/ui/save';

/* apply.8: the close guard, main side (PLAN 7.7, 11.3 i). The window is a
   stand-in that keeps Electron's rules: a `close` whose event is held stays
   open, `close()` emits `close` as the title bar's X does, and `destroy()`
   closes without it. The native box resolves as Wait when its signal takes it
   away, as Electron's does. The page's half, which pushes the state and asks
   the question, is apply.9; the words are tested in test/shared/save.test.ts. */

type Listener = (event: CloseEventLike) => void;

class FakeWindow implements GuardWindow {
  private readonly listeners = new Map<string, Listener[]>();
  destroyed = false;
  minimized = false;
  focused = true;
  /** sending to the page throws, as Electron does once its contents are destroyed */
  unreachable = false;
  /** the page's own `beforeunload` keeps the window after `close` went through */
  pageCancelsUnload = false;
  /** what the window was told to do, in order */
  readonly calls: string[] = [];
  /** what went to the page */
  readonly sent: [string, unknown][] = [];
  readonly webContents = {
    send: (channel: string, payload: unknown): void => {
      if (this.unreachable) throw new Error('Object has been destroyed');
      this.sent.push([channel, payload]);
    }
  };

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, payload: CloseEventLike = { preventDefault: () => undefined }): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  /** The X in the title bar, Alt+F4 or a WM_CLOSE: true when the window closed. */
  userCloses(): boolean {
    if (this.destroyed) throw new Error('the window is already closed');
    let held = false;
    this.emit('close', {
      preventDefault: () => {
        held = true;
      }
    });
    if (held || this.pageCancelsUnload) return false;
    this.closed();
    return true;
  }

  private closed(): void {
    this.destroyed = true;
    this.emit('closed');
  }

  close(): void {
    this.calls.push('close');
    if (!this.destroyed) this.userCloses();
  }

  destroy(): void {
    this.calls.push('destroy');
    if (!this.destroyed) this.closed();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }

  isFocused(): boolean {
    return this.focused;
  }

  restore(): void {
    this.calls.push('restore');
    this.minimized = false;
  }

  show(): void {
    this.calls.push('show');
  }

  focus(): void {
    this.calls.push('focus');
    this.focused = true;
  }

  flashFrame(flag: boolean): void {
    this.calls.push(flag ? 'flash' : 'stop flashing');
  }

  /** The close requests that reached the page. */
  requests(): unknown[] {
    return this.sent.filter(([channel]) => channel === 'app:close-requested').map(([, payload]) => payload);
  }
}

interface ShownBox {
  box: UnresponsiveBox;
  signal: AbortSignal;
  press(answer: BoxAnswer): void;
}

interface Logged {
  level: string;
  event: string;
  fields: Readonly<Record<string, unknown>>;
}

function setup(showBox?: (box: UnresponsiveBox, signal: AbortSignal) => Promise<BoxAnswer>) {
  const boxes: ShownBox[] = [];
  const logged: Logged[] = [];
  let quits = 0;
  const guard = createCloseGuard<FakeWindow>({
    showBox: (_win, box, signal) =>
      showBox
        ? showBox(box, signal)
        : new Promise<BoxAnswer>((resolve) => {
            // As Electron's box does: taken away by its signal, it answers as its cancel button, Wait.
            signal.addEventListener('abort', () => resolve('wait'), { once: true });
            boxes.push({ box, signal, press: resolve });
          }),
    quit: () => {
      quits += 1;
    },
    log: (level, event, fields = {}) => void logged.push({ level, event, fields })
  });
  const win = new FakeWindow();
  guard.attach(win);
  return { guard, win, boxes, logged, quits: (): number => quits };
}

function lastBox(boxes: readonly ShownBox[]): ShownBox {
  const box = boxes.at(-1);
  if (!box) throw new Error('no box was shown');
  return box;
}

const CLEAN: CloseGuardState = {
  chapter: 'C:/Novel/Chapter 12.md',
  unsavedDecisions: 0,
  changedParagraphs: 0,
  locked: false,
  reviewRunning: false,
  writesPending: false,
  dialogText: false
};
const AT_RISK: CloseGuardState = { ...CLEAN, unsavedDecisions: 3 };

/** Run what is due now: the next tick's timers and every promise callback. */
const tick = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a close with nothing at risk goes through at once, with no IPC (apply.8, PLAN 11.3 i)', () => {
  it('while the page has pushed nothing, as every close did before apply.9', () => {
    const { win } = setup();
    expect(win.userCloses()).toBe(true);
    expect(win.sent).toEqual([]);
    expect(win.calls).toEqual([]);
  });

  it('when the page says nothing is at risk', () => {
    const { guard, win } = setup();
    guard.setState(CLEAN);
    expect(win.userCloses()).toBe(true);
    expect(win.sent).toEqual([]);
  });

  it('but is held for each thing at risk on its own', () => {
    const risks: Partial<CloseGuardState>[] = [
      { unsavedDecisions: 1 },
      { changedParagraphs: 1 },
      { locked: true },
      { reviewRunning: true },
      { writesPending: true },
      { dialogText: true }
    ];
    for (const risk of risks) {
      const { guard, win } = setup();
      guard.setState({ ...CLEAN, ...risk });
      expect(win.userCloses(), JSON.stringify(risk)).toBe(false);
      expect(win.requests()).toEqual([{ quitting: false }]);
    }
  });

  it('once what was at risk is no longer, even with a close under way', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    expect(win.userCloses()).toBe(false);
    guard.setState(CLEAN);
    expect(win.userCloses()).toBe(true);
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(boxes).toEqual([]);
  });
});

describe('asking the page', () => {
  it('holds the close, brings the window forward and asks the page once', () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    win.minimized = true;
    win.focused = false;
    expect(win.userCloses()).toBe(false);
    expect(win.calls).toEqual(['restore', 'show', 'focus', 'flash']);
    expect(win.requests()).toEqual([{ quitting: false }]);
    expect(logged.filter((l) => l.event === 'close.asked')).toEqual([
      { level: 'info', event: 'close.asked', fields: { quitting: false } }
    ]);
    expect(win.userCloses()).toBe(false);
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toHaveLength(1);
  });

  it('does not flash a window that is already in front', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    expect(win.calls).toEqual(['show', 'focus']);
  });

  it('tells the page when the close came from a quit', () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    guard.onBeforeQuit();
    expect(guard.isQuitting()).toBe(true);
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toEqual([{ quitting: true }]);
    expect(logged.find((l) => l.event === 'close.asked')?.fields).toEqual({ quitting: true });
  });

  it('lets the close through when the page cannot be reached', () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    win.unreachable = true;
    expect(win.userCloses()).toBe(true);
    expect(logged.map((l) => l.event)).toEqual(['close.send-failed']);
    expect(logged[0]?.fields['channel']).toBe('app:close-requested');
  });
});

describe('a page that does not say it has the request', () => {
  it('has 3 s to say it has the request and 10 s more to ask, as 11.3 (i) says', () => {
    expect(ACK_TIMEOUT_MS).toBe(3_000);
    expect(FINISHING_TIMEOUT_MS).toBe(10_000);
  });

  it('gets the "not responding" box 3 s after the request, not before', async () => {
    const { guard, win, boxes, logged } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS - 1);
    expect(boxes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(boxes).toHaveLength(1);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('no-answer', AT_RISK));
    expect(lastBox(boxes).box.message).toBe(`${APP_NAME} is not responding`);
    expect(lastBox(boxes).signal.aborted).toBe(false);
    expect(logged.at(-1)).toEqual({
      level: 'warn',
      event: 'close.unresponsive',
      fields: { stage: 'no-answer' }
    });
  });

  it('words the box from the last state the page pushed', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    const later: CloseGuardState = { ...AT_RISK, unsavedDecisions: 5, dialogText: true };
    guard.setState(later);
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('no-answer', later));
  });

  it('brings the window forward again for the box', async () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    win.minimized = true;
    win.focused = false;
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    expect(win.calls).toEqual(['show', 'focus', 'restore', 'show', 'focus', 'flash']);
  });

  it('Wait leaves the page its time: no box comes back by itself, and another close opens one at once', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    lastBox(boxes).press('wait');
    await tick();
    expect(win.isDestroyed()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(boxes).toHaveLength(1);
    expect(win.userCloses()).toBe(false);
    expect(boxes).toHaveLength(2);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('no-answer', AT_RISK));
    expect(win.requests()).toHaveLength(1);
  });

  it('then reaches the page s question when the page answers after Wait', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    lastBox(boxes).press('wait');
    await vi.advanceTimersByTimeAsync(12_000);
    guard.onStatus('received');
    guard.onStatus('prompting');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(boxes).toHaveLength(1);
    guard.onDecision(true);
    await tick();
    expect(win.isDestroyed()).toBe(true);
  });

  it('Close anyway destroys the window without waiting for the page', async () => {
    const { guard, win, boxes, quits, logged } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    lastBox(boxes).press('close');
    await tick();
    expect(win.calls.at(-1)).toBe('destroy');
    expect(win.isDestroyed()).toBe(true);
    expect(quits()).toBe(0);
    expect(logged.at(-1)).toEqual({
      level: 'info',
      event: 'close.box-answer',
      fields: { stage: 'no-answer', answer: 'close' }
    });
  });

  it('Close anyway goes on quitting when the close came from a quit', async () => {
    const { guard, win, boxes, quits } = setup();
    guard.setState(AT_RISK);
    guard.onBeforeQuit();
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    lastBox(boxes).press('close');
    await tick();
    expect(win.isDestroyed()).toBe(true);
    expect(quits()).toBe(1);
  });

  it('a second close before the page answers opens the box at once, and the timer adds none', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(win.userCloses()).toBe(false);
    expect(boxes).toHaveLength(1);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('no-answer', AT_RISK));
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(boxes).toHaveLength(1);
  });

  it('a close while the box is open opens no second box', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    expect(win.userCloses()).toBe(false);
    expect(win.userCloses()).toBe(false);
    expect(boxes).toHaveLength(1);
  });

  it('a box that fails to open counts as Wait', async () => {
    let shown = 0;
    const { guard, win, logged } = setup(() => {
      shown += 1;
      return Promise.reject(new Error('no box'));
    });
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    expect(shown).toBe(1);
    expect(win.isDestroyed()).toBe(false);
    expect(logged.map((l) => l.event)).toContain('close.box-failed');
    // Another close tries the box again.
    win.userCloses();
    await tick();
    expect(shown).toBe(2);
  });

  it('a box that throws as it opens counts as Wait too', async () => {
    const { guard, win, logged } = setup(() => {
      throw new Error('no box');
    });
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    expect(win.isDestroyed()).toBe(false);
    expect(logged.map((l) => l.event)).toContain('close.box-failed');
  });
});

describe('a page that has the request but does not ask', () => {
  it('gets no "not responding" box, and the "still finishing" box 10 s after it said received', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(2_000);
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS - 1);
    expect(boxes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(boxes).toHaveLength(1);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('finishing', AT_RISK));
    expect(lastBox(boxes).box.message).toBe(`${APP_NAME} is still finishing`);
  });

  it('takes a "not responding" box away when the page says received after all, and ignores its late answer', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    const late = lastBox(boxes);
    guard.onStatus('received');
    expect(late.signal.aborted).toBe(true);
    late.press('close');
    await tick();
    expect(win.isDestroyed()).toBe(false);
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS);
    expect(boxes).toHaveLength(2);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('finishing', AT_RISK));
  });

  it('a second close after received opens the "still finishing" box at once', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    expect(win.userCloses()).toBe(false);
    expect(boxes).toHaveLength(1);
    expect(lastBox(boxes).box).toEqual(unresponsiveDetail('finishing', AT_RISK));
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS * 2);
    expect(boxes).toHaveLength(1);
  });

  it('a repeated received changes nothing', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS - 1_000);
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(boxes).toHaveLength(1);
  });

  it('Close anyway from the "still finishing" box destroys the window', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS);
    lastBox(boxes).press('close');
    await tick();
    expect(win.calls.at(-1)).toBe('destroy');
  });
});

describe('a page that asks its question', () => {
  it('clears both timers: no box at 3 s or after 10 s', async () => {
    for (const statuses of [['prompting'], ['received', 'prompting']] as const) {
      const { guard, win, boxes } = setup();
      guard.setState(AT_RISK);
      win.userCloses();
      for (const status of statuses) guard.onStatus(status);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(boxes, statuses.join(', ')).toEqual([]);
    }
  });

  it('takes an open box away, and its late answer is ignored', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS);
    const late = lastBox(boxes);
    guard.onStatus('prompting');
    expect(late.signal.aborted).toBe(true);
    late.press('close');
    await tick();
    expect(win.isDestroyed()).toBe(false);
  });

  it('wins over a Close anyway pressed in the same moment, since its own question is up', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    // The press is in, but main hears the page before it handles the box's answer.
    lastBox(boxes).press('close');
    guard.onStatus('prompting');
    await tick();
    expect(win.calls).not.toContain('destroy');
    expect(win.isDestroyed()).toBe(false);
  });

  it('a close while the question is on screen only brings the window forward', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    guard.onStatus('prompting');
    win.minimized = true;
    expect(win.userCloses()).toBe(false);
    expect(win.calls.slice(-3)).toEqual(['restore', 'show', 'focus']);
    await tick();
    expect(boxes).toEqual([]);
    expect(win.requests()).toHaveLength(1);
  });

  it('a received after the question changes nothing', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('prompting');
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS * 2);
    expect(boxes).toEqual([]);
  });
});

describe('the page s decision', () => {
  it('to close closes the window on the next tick, after the reply has gone', async () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    win.focused = false;
    win.userCloses();
    guard.onStatus('received');
    guard.onStatus('prompting');
    guard.onDecision(true);
    expect(win.isDestroyed()).toBe(false);
    expect(win.calls.at(-1)).toBe('stop flashing');
    await tick();
    expect(win.calls.at(-1)).toBe('close');
    expect(win.isDestroyed()).toBe(true);
    expect(win.requests()).toHaveLength(1);
    expect(logged.map((l) => l.event).slice(-2)).toEqual(['close.decided', 'close.allowed']);
    expect(logged.at(-1)?.fields).toEqual({ reason: 'decided' });
  });

  it('to close, with nothing asked because nothing needed asking, closes too', async () => {
    const { guard, win } = setup();
    guard.setState({ ...CLEAN, writesPending: true });
    win.userCloses();
    guard.onStatus('received');
    guard.onDecision(true);
    await tick();
    expect(win.isDestroyed()).toBe(true);
  });

  it('to close goes on quitting when the close came from a quit, and that close goes through', async () => {
    const { guard, win, quits } = setup();
    guard.setState(AT_RISK);
    guard.onBeforeQuit();
    win.userCloses();
    guard.onStatus('prompting');
    guard.onDecision(true);
    await tick();
    expect(quits()).toBe(1);
    expect(win.calls).not.toContain('close');
    // app.quit() then closes the window, which the decision lets through.
    expect(win.userCloses()).toBe(true);
  });

  it('to close does nothing more once a close has gone through meanwhile', async () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('prompting');
    guard.onDecision(true);
    expect(win.userCloses()).toBe(true);
    await tick();
    expect(win.calls).not.toContain('close');
  });

  it('to close takes an open box away, and the box pressed after it is ignored', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    const late = lastBox(boxes);
    guard.onDecision(true);
    expect(late.signal.aborted).toBe(true);
    late.press('close');
    await tick();
    expect(win.calls).toContain('close');
    expect(win.calls).not.toContain('destroy');
  });

  it('to stay keeps the window, forgets the quit, and the next close asks again', async () => {
    const { guard, win, boxes, quits } = setup();
    guard.setState(AT_RISK);
    guard.onBeforeQuit();
    win.userCloses();
    guard.onStatus('received');
    guard.onStatus('prompting');
    guard.onDecision(false);
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(win.isDestroyed()).toBe(false);
    expect(guard.isQuitting()).toBe(false);
    expect(quits()).toBe(0);
    expect(boxes).toEqual([]);
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toEqual([{ quitting: true }, { quitting: false }]);
  });

  it('to stay takes an open box away', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    guard.onDecision(false);
    expect(lastBox(boxes).signal.aborted).toBe(true);
  });

  it('anything but a plain true keeps the window', async () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('prompting');
    guard.onDecision('yes' as unknown as boolean);
    await tick();
    expect(win.isDestroyed()).toBe(false);
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toHaveLength(2);
  });
});

describe('what the page says with no close under way', () => {
  it('changes nothing: Restart now asks its own question and answers it', async () => {
    const { guard, win, boxes, quits } = setup();
    guard.setState(AT_RISK);
    guard.onStatus('received');
    guard.onStatus('prompting');
    guard.onDecision(true);
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(win.isDestroyed()).toBe(false);
    expect(win.calls).toEqual([]);
    expect(boxes).toEqual([]);
    expect(quits()).toBe(0);
    // ...and the close after it is asked about as usual.
    expect(win.userCloses()).toBe(false);
  });

  it('a decision to stay still forgets a quit', () => {
    const { guard } = setup();
    guard.onBeforeQuit();
    guard.onDecision(false);
    expect(guard.isQuitting()).toBe(false);
  });
});

describe('allowNextClose', () => {
  it('lets the update s quit through with nothing asked', () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    guard.allowNextClose('update');
    expect(win.userCloses()).toBe(true);
    expect(win.sent).toEqual([]);
    expect(logged.map((l) => l.event)).toEqual(['close.allow-next', 'close.allowed']);
    expect(logged.at(-1)?.fields).toEqual({ reason: 'update' });
  });

  it('takes over a close already under way: no box comes later', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.allowNextClose('update');
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(boxes).toEqual([]);
    expect(win.userCloses()).toBe(true);
  });

  it('can be taken back, for an install that failed', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    const takeBack = guard.allowNextClose('update');
    takeBack();
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toHaveLength(1);
  });

  it('is used by one close, even one the page then keeps from closing', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    guard.allowNextClose('update');
    win.pageCancelsUnload = true;
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toEqual([]);
    win.pageCancelsUnload = false;
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toHaveLength(1);
  });

  it('is used by one close and does not pass to a new window', () => {
    const { guard, win } = setup();
    guard.allowNextClose('update');
    expect(win.userCloses()).toBe(true);
    const next = new FakeWindow();
    guard.attach(next);
    guard.setState(AT_RISK);
    expect(next.userCloses()).toBe(false);
  });
});

describe('a page that is gone', () => {
  it('never holds a close, and nothing is sent to it', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    expect(guard.onRendererGone()).toBe(false);
    expect(win.userCloses()).toBe(true);
    expect(win.sent).toEqual([]);
  });

  it('during a close: takes the box away, stops the timers and finishes the close', async () => {
    const { guard, win, boxes, logged } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    const late = lastBox(boxes);
    expect(guard.onRendererGone()).toBe(true);
    expect(late.signal.aborted).toBe(true);
    expect(win.isDestroyed()).toBe(false);
    await tick();
    expect(win.calls.at(-1)).toBe('close');
    expect(win.isDestroyed()).toBe(true);
    expect(logged.map((l) => l.event)).toContain('close.page-gone');
  });

  it('during a close that came from a quit: goes on quitting', async () => {
    const { guard, win, quits } = setup();
    guard.setState(AT_RISK);
    guard.onBeforeQuit();
    win.userCloses();
    guard.onStatus('prompting');
    expect(guard.onRendererGone()).toBe(true);
    await tick();
    expect(quits()).toBe(1);
    expect(win.userCloses()).toBe(true);
  });

  it('opens no box once it is gone', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    guard.onStatus('received');
    guard.onRendererGone();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(boxes).toEqual([]);
  });

  it('is asked again once a page pushes a state, as a reloaded one does', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    guard.onRendererGone();
    guard.setState(AT_RISK);
    expect(win.userCloses()).toBe(false);
    expect(win.requests()).toHaveLength(1);
  });

  it('does not close a window a reloaded page is in by then', async () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    expect(guard.onRendererGone()).toBe(true);
    guard.setState(AT_RISK);
    await tick();
    expect(win.calls).not.toContain('close');
    expect(win.isDestroyed()).toBe(false);
  });
});

describe('shutdown is never blocked', () => {
  it('query-session-end asks the page to write what it holds, and holds nothing', () => {
    const { guard, win } = setup();
    guard.setState(AT_RISK);
    let prevented = false;
    win.emit('query-session-end', {
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
    expect(win.sent).toEqual([['app:flush', { reason: 'query-session-end' }]]);
    // The session may yet go on, so a close is still asked about.
    expect(win.userCloses()).toBe(false);
  });

  it('session-end asks the page to write, and every close after it goes through at once', () => {
    const { guard, win, logged } = setup();
    guard.setState(AT_RISK);
    let prevented = false;
    win.emit('session-end', {
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
    expect(win.sent).toEqual([['app:flush', { reason: 'session-end' }]]);
    expect(win.userCloses()).toBe(true);
    expect(win.requests()).toEqual([]);
    expect(logged.map((l) => l.event)).toEqual(['close.session-end']);
  });

  it('session-end during a close takes the box away and stops the timers', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    win.emit('session-end');
    expect(lastBox(boxes).signal.aborted).toBe(true);
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(FINISHING_TIMEOUT_MS * 2);
    expect(boxes).toHaveLength(1);
    expect(win.userCloses()).toBe(true);
  });

  it('sends nothing to a page that is gone', () => {
    const { guard, win } = setup();
    guard.onRendererGone();
    win.emit('query-session-end');
    win.emit('session-end');
    expect(win.sent).toEqual([]);
  });
});

describe('the window', () => {
  it('a window that closes ends the close under way: no box later, and nothing is sent after', async () => {
    const { guard, win, boxes } = setup();
    guard.setState(AT_RISK);
    win.userCloses();
    win.destroy();
    guard.onStatus('received');
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS + FINISHING_TIMEOUT_MS);
    expect(boxes).toEqual([]);
    win.emit('session-end');
    expect(win.sent).toEqual([['app:close-requested', { quitting: false }]]);
  });

  it('a new window starts with nothing known about its page', () => {
    const { guard } = setup();
    guard.setState(AT_RISK);
    const next = new FakeWindow();
    guard.attach(next);
    expect(next.userCloses()).toBe(true);
  });

  it('a window no longer attached is no longer guarded, and nothing goes to the new one for it', () => {
    const { guard, win } = setup();
    const next = new FakeWindow();
    guard.attach(next);
    guard.setState(AT_RISK);
    expect(win.userCloses()).toBe(true);
    expect(win.sent).toEqual([]);
    expect(next.sent).toEqual([]);
    win.emit('session-end');
    expect(next.sent).toEqual([]);
    expect(next.userCloses()).toBe(false);
  });

  it('never logs the chapter or anything typed', async () => {
    const { guard, win, boxes, logged } = setup();
    guard.setState({ ...AT_RISK, dialogText: true, changedParagraphs: 2 });
    guard.onBeforeQuit();
    win.userCloses();
    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT_MS);
    lastBox(boxes).press('wait');
    await tick();
    guard.onStatus('received');
    guard.onStatus('prompting');
    guard.onDecision(true);
    await tick();
    expect(logged.length).toBeGreaterThan(3);
    expect(JSON.stringify(logged)).not.toMatch(/Novel|Chapter/);
  });
});

describe('the native box', () => {
  it('puts Wait first, as the default and the cancel answer, with plain buttons', () => {
    const box = unresponsiveDetail('no-answer', AT_RISK);
    expect(messageBoxOptions(box)).toEqual({
      type: 'warning',
      title: APP_NAME,
      message: box.message,
      detail: box.detail,
      buttons: ['Wait', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
  });

  it('closes only for the Close anyway button; anything else waits', () => {
    expect(boxAnswer(1)).toBe('close');
    for (const response of [0, -1, 2]) expect(boxAnswer(response)).toBe('wait');
  });
});

/* The wiring in Electron. The tests run without Electron; apply.9 checks the
   window with real input (PLAN). */
describe('the wiring (apply.8)', () => {
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const read = (file: string): string =>
    withoutComments(readFileSync(path.join(__dirname, '../../src/main', file), 'utf8'));
  const INDEX = read('index.ts');
  const IPC = read('ipc.ts');
  const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    expect(start, from).toBeGreaterThanOrEqual(0);
    return text.slice(start, text.indexOf(to, start));
  };

  it('attaches every window createWindow makes, before its page loads', () => {
    const create = between(INDEX, 'function createWindow(): BrowserWindow {', '\n}\n');
    const attach = create.indexOf('closeGuard.attach(win);');
    expect(attach).toBeGreaterThan(create.indexOf('new BrowserWindow('));
    expect(attach).toBeLessThan(create.indexOf('win.loadURL('));
    expect(attach).toBeLessThan(create.indexOf('win.loadFile('));
  });

  it('has one render-process-gone handler, which tells the guard in every build', () => {
    expect(INDEX.match(/'render-process-gone'/g)).toHaveLength(1);
    const handler = between(INDEX, "win.webContents.on('render-process-gone'", '});');
    expect(handler).toContain('closeGuard.onRendererGone();');
    expect(between(INDEX, '  if (isDev) {\n', '\n  }\n')).not.toContain('render-process-gone');
  });

  it('tells the guard when the app quits, and awaits nothing', () => {
    expect(INDEX).toContain("app.on('before-quit', () => closeGuard.onBeforeQuit());");
  });

  it('registers the three requests inside registerCoreHandlers', () => {
    expect(between(IPC, 'export function registerCoreHandlers(): void {', '\n}\n')).toContain(
      'registerCloseGuardHandlers();'
    );
    const handlers = between(IPC, 'function registerCloseGuardHandlers(): void {', '\n}\n');
    expect(handlers).toContain("handle('app:guard-state', (state) => {\n    closeGuard.setState(state);");
    expect(handlers).toContain(
      "handle('app:close-status', ({ status }) => {\n    closeGuard.onStatus(status);"
    );
    expect(handlers).toContain(
      "handle('app:close-decision', ({ close }) => {\n    closeGuard.onDecision(close);"
    );
  });

  it('shows the native box over the window with its signal, and quits through app.quit', () => {
    const guard = between(IPC, 'export const closeGuard = createCloseGuard<BrowserWindow>({', '});');
    expect(guard).toContain('dialog.showMessageBox(win, { ...messageBoxOptions(box), signal })');
    expect(guard).toContain('boxAnswer(');
    expect(guard).toContain('quit: () => app.quit()');
  });

  it('lets the page use the three requests and hear the two events', () => {
    for (const channel of ['app:guard-state', 'app:close-status', 'app:close-decision'] as const) {
      expect(REQUEST_CHANNELS).toContain(channel);
    }
    for (const channel of ['app:close-requested', 'app:flush'] as const) {
      expect(EVENT_CHANNELS).toContain(channel);
    }
  });
});
