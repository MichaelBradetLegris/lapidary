import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloseGuard, type CloseEventLike, type GuardWindow } from '../../src/main/closeGuard';
import {
  INSTALL_WRITES_WAIT_MS,
  runUpdateInstall,
  type UpdateInstallDeps
} from '../../src/main/updateInstall';
import { createWriteTracker } from '../../src/main/writes';
import type { CloseGuardState } from '../../src/shared/ipc';

/* release.8b: Restart now, main's half (PLAN 11.3 n and 7.7). The steps go in
   the plan's order, the close the quit brings is allowed before the installer
   starts, the install goes ahead when main's writes do not end in time, and an
   install that cannot start takes the allowance back. */

interface Logged {
  level: string;
  event: string;
  fields: Readonly<Record<string, unknown>> | undefined;
}

function setup(overrides: Partial<UpdateInstallDeps> = {}): {
  deps: UpdateInstallDeps;
  calls: string[];
  logged: Logged[];
  takeBack: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const logged: Logged[] = [];
  const takeBack = vi.fn(() => calls.push('takeBack'));
  const deps: UpdateInstallDeps = {
    allowNextClose: (reason) => {
      calls.push(`allowNextClose:${reason}`);
      return takeBack;
    },
    abortAll: () => {
      calls.push('abortAll');
      return 2;
    },
    writesSettled: (ms) => {
      calls.push(`writesSettled:${ms}`);
      return Promise.resolve(true);
    },
    stopWatching: () => calls.push('stopWatching'),
    resumeWatching: () => calls.push('resumeWatching'),
    quitAndInstall: () => calls.push('quitAndInstall'),
    log: (level, event, fields) => logged.push({ level, event, fields }),
    ...overrides
  };
  return { deps, calls, logged, takeBack };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runUpdateInstall', () => {
  it('allows the close, stops the work, lets the writes end, lets go of the folder, then installs', async () => {
    const { deps, calls, logged } = setup();
    const outcome = await runUpdateInstall(deps);
    expect(calls).toEqual([
      'allowNextClose:update',
      'abortAll',
      `writesSettled:${INSTALL_WRITES_WAIT_MS}`,
      'stopWatching',
      'quitAndInstall'
    ]);
    expect(INSTALL_WRITES_WAIT_MS).toBe(2000);
    expect(outcome.started).toBe(true);
    expect(logged).toEqual([
      { level: 'info', event: 'update.install', fields: { aborted: 2, writesSettled: true } }
    ]);
  });

  it('allows the close before the installer can quit the app', async () => {
    let allowed = false;
    let allowedWhenInstalling: boolean | null = null;
    const { deps } = setup({
      allowNextClose: () => {
        allowed = true;
        return () => {
          allowed = false;
        };
      },
      quitAndInstall: () => {
        allowedWhenInstalling = allowed;
      }
    });
    await runUpdateInstall(deps);
    expect(allowedWhenInstalling).toBe(true);
  });

  it('awaits nothing after quitAndInstall: it is the last step, and the outcome follows it at once', async () => {
    const order: string[] = [];
    const { deps } = setup({ quitAndInstall: () => void order.push('quitAndInstall') });
    const run = runUpdateInstall(deps).then((outcome) => {
      order.push('outcome');
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['quitAndInstall', 'outcome']);
    await run;
  });

  it('installs when the writes have not ended after 2 s, and logs that they had not', async () => {
    const tracker = createWriteTracker();
    void tracker.trackWrite(() => new Promise<never>(() => undefined));
    const { deps, calls, logged } = setup({
      writesSettled: (ms) => {
        calls.push(`writesSettled:${ms}`);
        return tracker.writesSettled(ms);
      }
    });
    let done = false;
    const run = runUpdateInstall(deps).then((outcome) => {
      done = true;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(INSTALL_WRITES_WAIT_MS - 1);
    expect(done).toBe(false);
    expect(calls).not.toContain('quitAndInstall');
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await run;
    expect(outcome.started).toBe(true);
    expect(calls.slice(-2)).toEqual(['stopWatching', 'quitAndInstall']);
    expect(logged.map((l) => l.event)).toEqual(['update.install.writes-pending', 'update.install']);
    expect(logged[0]?.fields).toEqual({ waitedMs: INSTALL_WRITES_WAIT_MS });
    expect(logged[1]?.fields).toEqual({ aborted: 2, writesSettled: false });
  });

  it('waits for a write that is still under way, then installs', async () => {
    const tracker = createWriteTracker();
    let finish!: () => void;
    void tracker.trackWrite(() => new Promise<void>((resolve) => (finish = resolve)));
    const { deps, calls } = setup({ writesSettled: (ms) => tracker.writesSettled(ms) });
    const run = runUpdateInstall(deps);
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).not.toContain('quitAndInstall');
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect((await run).started).toBe(true);
    expect(calls.at(-1)).toBe('quitAndInstall');
  });

  it('takes the allowance back and watches again when the installer cannot start', async () => {
    const failure = Object.assign(new Error('spawn installer.exe ENOENT'), {
      code: 'ENOENT',
      syscall: 'spawn'
    });
    const { deps, calls, logged, takeBack } = setup({
      quitAndInstall: () => {
        calls.push('quitAndInstall');
        throw failure;
      }
    });
    const outcome = await runUpdateInstall(deps);
    expect(outcome).toEqual({ started: false, error: failure });
    expect(takeBack).toHaveBeenCalledTimes(1);
    expect(calls.slice(-3)).toEqual(['quitAndInstall', 'takeBack', 'resumeWatching']);
    expect(logged.at(-1)?.event).toBe('update.install.failed');
    expect(logged.at(-1)?.fields).toMatchObject({ code: 'ENOENT', syscall: 'spawn' });
  });

  it('takes the allowance back, and starts no watcher it never stopped, when a step before fails', async () => {
    const { deps, calls, takeBack } = setup({
      abortAll: () => {
        throw new Error('abort failed');
      }
    });
    const outcome = await runUpdateInstall(deps);
    expect(outcome.started).toBe(false);
    expect(takeBack).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain('resumeWatching');
    expect(calls).not.toContain('quitAndInstall');
  });

  it('hands back the function that takes the allowance back once the installer has started', async () => {
    const { deps, takeBack } = setup();
    const outcome = await runUpdateInstall(deps);
    expect(outcome.started && outcome.takeBack).toBe(takeBack);
    expect(takeBack).not.toHaveBeenCalled();
  });
});

/* With the app's own close guard: the quit that the installer brings closes a
   window whose page holds unsaved changes without asking the page again, and
   after an install that failed the next close is asked about as before. */

const AT_RISK: CloseGuardState = {
  chapter: 'C:\\Novel\\Chapter 01.md',
  unsavedDecisions: 3,
  changedParagraphs: 0,
  locked: false,
  reviewRunning: false,
  writesPending: false,
  dialogText: false
};

class StubWindow implements GuardWindow {
  private readonly listeners = new Map<string, ((event: CloseEventLike) => void)[]>();
  readonly sent: string[] = [];
  closed = false;
  readonly webContents = {
    send: (channel: string): void => void this.sent.push(channel),
    on: (): void => undefined
  };
  on(event: string, listener: (event: CloseEventLike) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  /** What the quit does to the window: `close`, which the guard may hold. True when it closed. */
  tryClose(): boolean {
    let held = false;
    for (const listener of this.listeners.get('close') ?? [])
      listener({ preventDefault: () => (held = true) });
    if (!held) this.closed = true;
    return !held;
  }
  isDestroyed(): boolean {
    return this.closed;
  }
  isMinimized(): boolean {
    return false;
  }
  isFocused(): boolean {
    return true;
  }
  restore(): void {}
  show(): void {}
  showInactive(): void {}
  focus(): void {}
  flashFrame(): void {}
  close(): void {
    this.tryClose();
  }
  destroy(): void {
    this.closed = true;
  }
}

describe('Restart now with the close guard', () => {
  function guarded(): { guard: ReturnType<typeof createCloseGuard<StubWindow>>; win: StubWindow } {
    const guard = createCloseGuard<StubWindow>({
      showBox: () => Promise.resolve('wait'),
      quit: () => undefined,
      log: () => undefined,
      quietWindow: () => false
    });
    const win = new StubWindow();
    guard.attach(win);
    guard.setState(AT_RISK);
    return { guard, win };
  }

  it('lets the quit close the window without asking the page', async () => {
    const { guard, win } = guarded();
    let closedByQuit: boolean | null = null;
    const { deps } = setup({
      allowNextClose: (reason) => guard.allowNextClose(reason),
      quitAndInstall: () => {
        closedByQuit = win.tryClose();
      }
    });
    await runUpdateInstall(deps);
    expect(closedByQuit).toBe(true);
    expect(win.sent).toEqual([]);
  });

  it('asks the page about the next close after an install that could not start', async () => {
    const { guard, win } = guarded();
    const { deps } = setup({
      allowNextClose: (reason) => guard.allowNextClose(reason),
      quitAndInstall: () => {
        throw new Error('installer missing');
      }
    });
    expect((await runUpdateInstall(deps)).started).toBe(false);
    expect(win.tryClose()).toBe(false);
    expect(win.sent).toEqual(['app:close-requested']);
  });
});
