import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCloseGuard, type CloseEventLike, type GuardWindow } from '../../src/main/closeGuard';
import {
  LINES_PER_MINUTE,
  NOTICE_INTERVAL_MS,
  RENDERER_EVENTS,
  createMainErrorHandlers,
  createRendererGoneHandler,
  createRendererLog,
  goneAnswer,
  goneBoxOptions,
  goneOutcome,
  installCrashHandlers,
  type GoneBoxOptions
} from '../../src/main/crash';
import { LOG_FILE, createLogger } from '../../src/main/log';
import { APP_NAME } from '../../src/shared/branding';
import { REQUEST_CHANNELS, type AppNotice, type CloseGuardState } from '../../src/shared/ipc';
import {
  MAIN_ERROR_NOTICE,
  PAGE_ERROR_TEXT,
  RELOAD_WINDOW,
  goneCause,
  rendererGoneBox
} from '../../src/shared/ui/crash';

/* hardening.4: crash handling, main side (PLAN 7.7, 11.3 a and m). */

interface Logged {
  level: string;
  event: string;
  fields: Readonly<Record<string, unknown>>;
}

function clock(start = 5_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

function mainHandlers() {
  const logged: Logged[] = [];
  const notices: AppNotice[] = [];
  const time = clock();
  const handlers = createMainErrorHandlers({
    log: (level, event, fields = {}) => void logged.push({ level, event, fields }),
    notice: (notice) => void notices.push(notice),
    now: time.now
  });
  return { handlers, logged, notices, time };
}

describe("main's own errors", () => {
  it('logs an uncaught error with what the policy allows, and asks for the card', () => {
    const { handlers, logged, notices } = mainHandlers();
    const err = new TypeError('Cannot read properties of undefined');
    handlers.uncaught(err, 'uncaughtException');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.level).toBe('error');
    expect(logged[0]?.event).toBe('main.uncaught');
    expect(logged[0]?.fields).toMatchObject({
      origin: 'uncaughtException',
      name: 'TypeError',
      message: 'Cannot read properties of undefined'
    });
    expect(String(logged[0]?.fields['frames'])).toMatch(/^at /);
    expect(notices).toEqual([MAIN_ERROR_NOTICE]);
  });

  it('asks for a card at most once a minute, while every new error is logged', () => {
    const { handlers, logged, notices, time } = mainHandlers();
    handlers.uncaught(new Error('first'));
    time.advance(NOTICE_INTERVAL_MS - 1);
    handlers.uncaught(new Error('second'));
    expect(logged.map((l) => l.fields['message'])).toEqual(['first', 'second']);
    expect(notices).toHaveLength(1);
    time.advance(1);
    handlers.uncaught(new Error('third'));
    expect(notices).toHaveLength(2);
  });

  it('logs the same error once a minute, and repeats ask for no card', () => {
    const { handlers, logged, notices, time } = mainHandlers();
    const again = (): void => {
      try {
        throw new Error('the same');
      } catch (err) {
        handlers.uncaught(err);
      }
    };
    for (let i = 0; i < 5; i += 1) again();
    expect(logged).toHaveLength(1);
    expect(notices).toHaveLength(1);
    time.advance(60_000);
    again();
    expect(logged).toHaveLength(2);
  });

  it('only logs a rejection nothing handled, as a warning, with no card', () => {
    const { handlers, logged, notices } = mainHandlers();
    handlers.rejection(new Error('cancelled'));
    handlers.rejection('a bare reason');
    expect(logged.map((l) => [l.level, l.event])).toEqual([
      ['warn', 'main.rejection'],
      ['warn', 'main.rejection']
    ]);
    expect(logged[1]?.fields).toEqual({ error: 'a bare reason' });
    expect(notices).toEqual([]);
  });

  it("keeps to the logging policy: an app error's code and never what it quotes", () => {
    const { handlers, logged } = mainHandlers();
    handlers.uncaught(
      Object.assign(new Error('The model replied: Dear diary, the river rose.'), {
        name: 'AppFailure',
        code: 'claude-invalid-output',
        detail: 'the whole reply'
      })
    );
    expect(logged[0]?.fields).toEqual({ code: 'claude-invalid-output' });
    expect(JSON.stringify(logged)).not.toContain('Dear diary');
  });

  it('writes at most 30 lines a minute, and says once that it stopped', () => {
    const { handlers, logged, time } = mainHandlers();
    for (let i = 0; i < 40; i += 1) handlers.rejection(new Error(`distinct ${i}`));
    expect(logged.filter((l) => l.event === 'main.rejection')).toHaveLength(LINES_PER_MINUTE);
    expect(logged.filter((l) => l.event === 'main.errors-capped')).toHaveLength(1);
    time.advance(60_000);
    handlers.rejection(new Error('later'));
    expect(logged.at(-1)?.fields['message']).toBe('later');
  });

  it('never throws, even when the log and the card do, since a throwing listener ends the process', () => {
    const handlers = createMainErrorHandlers({
      log: () => {
        throw new Error('disk full');
      },
      notice: () => {
        throw new Error('window gone');
      }
    });
    expect(() => handlers.uncaught(new Error('x'))).not.toThrow();
    expect(() => handlers.rejection(new Error('y'))).not.toThrow();
  });

  it('listens on the process for both events', () => {
    const proc = new EventEmitter();
    const logged: Logged[] = [];
    const notices: AppNotice[] = [];
    installCrashHandlers(proc, {
      log: (level, event, fields = {}) => void logged.push({ level, event, fields }),
      notice: (notice) => void notices.push(notice)
    });
    proc.emit('uncaughtException', new RangeError('too far'), 'uncaughtException');
    proc.emit('unhandledRejection', new Error('nobody waited'));
    expect(logged.map((l) => l.event)).toEqual(['main.uncaught', 'main.rejection']);
    expect(notices).toEqual([MAIN_ERROR_NOTICE]);
  });
});

describe("the page's lines (log:renderer)", () => {
  function rendererLog() {
    const logged: Logged[] = [];
    const time = clock();
    const accept = createRendererLog({
      log: (level, event, fields = {}) => void logged.push({ level, event, fields }),
      now: time.now
    });
    return { accept, logged, time };
  }

  it('logs each kind as its own event and level', () => {
    const { accept, logged } = rendererLog();
    for (const kind of ['error', 'rejection', 'render', 'render-uncaught'] as const) {
      expect(accept({ kind, fields: { name: 'TypeError', message: kind } })).toBe('logged');
    }
    expect(logged.map((l) => [l.level, l.event])).toEqual([
      ['error', 'renderer.error'],
      ['warn', 'renderer.rejection'],
      ['error', 'renderer.render-failed'],
      ['error', 'renderer.render-uncaught']
    ]);
    expect(Object.keys(RENDERER_EVENTS).sort()).toEqual(['error', 'rejection', 'render', 'render-uncaught']);
  });

  it('keeps only the fields it knows that hold a scalar', () => {
    const { accept, logged } = rendererLog();
    accept({
      kind: 'render',
      fields: {
        name: 'TypeError',
        code: 'io',
        message: 'x',
        frames: 'at a',
        error: 'thrown',
        errno: -4058,
        syscall: 'open',
        components: 'StatusBar < App',
        detail: 'It was a dark night.',
        text: 'It was a dark night.',
        chapter: 'Chapter 12.md',
        nested: { text: 'It was a dark night.' } as unknown as string
      }
    });
    expect(logged[0]?.fields).toEqual({
      name: 'TypeError',
      code: 'io',
      message: 'x',
      frames: 'at a',
      error: 'thrown',
      errno: -4058,
      syscall: 'open',
      components: 'StatusBar < App'
    });
    accept({ kind: 'error', fields: { name: ['TypeError'], message: { a: 1 } } });
    expect(logged[1]?.fields).toEqual({});
  });

  it('refuses a payload of any other shape, unlogged', () => {
    const { accept, logged } = rendererLog();
    for (const payload of [
      undefined,
      null,
      'error',
      [],
      { kind: 'error' },
      { kind: 'error', fields: [] },
      { kind: 'error', fields: 'x' },
      { kind: 'crash', fields: {} },
      { kind: 'toString', fields: {} },
      { kind: 'constructor', fields: {} },
      Object.assign(Object.create({ kind: 'error' }) as object, { fields: {} })
    ]) {
      expect(accept(payload)).toBe('refused');
    }
    expect(logged).toEqual([]);
  });

  it('writes at most 30 lines a minute, says so once, and writes again when the minute has room', () => {
    const { accept, logged, time } = rendererLog();
    const line = { kind: 'error', fields: { name: 'Error', message: 'loop' } };
    const answers = Array.from({ length: 35 }, () => accept(line));
    expect(answers.filter((a) => a === 'logged')).toHaveLength(30);
    expect(answers.slice(30)).toEqual(['capped', 'capped', 'capped', 'capped', 'capped']);
    expect(logged.filter((l) => l.event === 'renderer.error')).toHaveLength(30);
    expect(logged.filter((l) => l.event === 'renderer.log-capped')).toEqual([
      { level: 'warn', event: 'renderer.log-capped', fields: { limit: 30 } }
    ]);
    time.advance(60_000);
    expect(accept(line)).toBe('logged');
    for (let i = 0; i < 30; i += 1) accept(line);
    expect(logged.filter((l) => l.event === 'renderer.log-capped')).toHaveLength(2);
  });

  describe('through the real logger', () => {
    let dir = '';
    beforeEach(() => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'lapidary-crash-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('writes a scrubbed line, with no home folder, email or key, and nothing of what was dropped', () => {
      const home = 'C:\\Users\\Someone'; // check-public: allow
      const logger = createLogger({
        dir,
        home,
        now: () => new Date('2026-10-20T09:00:00.000Z'),
        schedule: () => undefined
      });
      const accept = createRendererLog({ log: (level, event, fields) => logger.log(level, event, fields) });
      accept({
        kind: 'error',
        fields: {
          name: 'Error',
          message: `Could not open ${home}\\Novel\\Chapter 12.md for writer@example.com with sk-abcdefghijklmnopqrstuvwx`, // check-public: allow
          detail: 'It was a dark night.'
        }
      });
      logger.flush();
      const text = readFileSync(path.join(dir, LOG_FILE), 'utf8');
      expect(text).toMatch(
        /^2026-10-20T09:00:00\.000Z ERROR renderer\.error name=Error message="Could not open ~/
      );
      expect(text).not.toContain('Someone');
      expect(text).not.toContain('example.com');
      expect(text).not.toContain('sk-abc');
      expect(text).not.toContain('dark night');
    });
  });

  it('is a request the page may make', () => {
    expect(REQUEST_CHANNELS).toContain('log:renderer');
  });
});

describe('after the page has gone (render-process-gone)', () => {
  interface Box {
    win: string;
    options: GoneBoxOptions;
    answer: (response: number) => void;
    fail: (err: Error) => void;
  }

  function goneHandler({ quitting = false, sessionEnding = false } = {}) {
    const flags = { quitting, sessionEnding, destroyed: false };
    const logged: Logged[] = [];
    const boxes: Box[] = [];
    const did: string[] = [];
    const handle = createRendererGoneHandler<string>({
      guard: { isQuitting: () => flags.quitting, isSessionEnding: () => flags.sessionEnding },
      showBox: (win, options) =>
        new Promise<number>((resolve, reject) => {
          boxes.push({ win, options, answer: resolve, fail: reject });
        }),
      reload: (win) => void did.push(`reload ${win}`),
      quit: () => void did.push('quit'),
      isDestroyed: () => flags.destroyed,
      log: (level, event, fields = {}) => void logged.push({ level, event, fields })
    });
    return { handle, flags, logged, boxes, did };
  }

  const crashed = { reason: 'crashed', exitCode: -1073741819 };

  it('offers Reload window or Quit for every way a page can go wrong', () => {
    for (const reason of [
      'crashed',
      'abnormal-exit',
      'killed',
      'oom',
      'launch-failed',
      'integrity-failure',
      'memory-eviction'
    ]) {
      expect(
        goneOutcome(
          { reason, exitCode: 1 },
          { closing: false, quitting: false, sessionEnding: false, windowGone: false }
        )
      ).toBe('offer');
    }
  });

  it('offers nothing when the window or the app is going anyway, or the process ended as asked', () => {
    const facts = { closing: false, quitting: false, sessionEnding: false, windowGone: false };
    expect(goneOutcome(crashed, { ...facts, closing: true })).toBe('closing');
    expect(goneOutcome(crashed, { ...facts, quitting: true })).toBe('quitting');
    expect(goneOutcome(crashed, { ...facts, sessionEnding: true })).toBe('session-end');
    expect(goneOutcome(crashed, { ...facts, windowGone: true })).toBe('no-window');
    expect(goneOutcome({ reason: 'clean-exit', exitCode: 0 }, facts)).toBe('clean-exit');
  });

  it('logs the reason and the exit code, asks, and reloads on Reload window', async () => {
    const { handle, logged, boxes, did } = goneHandler();
    const done = handle('the window', crashed, false);
    await Promise.resolve();
    expect(logged[0]).toEqual({
      level: 'warn',
      event: 'renderer.gone',
      fields: { reason: 'crashed', exitCode: -1073741819, outcome: 'offer' }
    });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]?.win).toBe('the window');
    expect(boxes[0]?.options).toEqual(goneBoxOptions(rendererGoneBox('crashed')));
    boxes[0]?.answer(0);
    expect(await done).toBe('reload');
    expect(did).toEqual(['reload the window']);
    expect(logged.at(-1)).toEqual({
      level: 'info',
      event: 'renderer.gone-answer',
      fields: { answer: 'reload' }
    });
  });

  it('quits on Quit', async () => {
    const { handle, boxes, did } = goneHandler();
    const done = handle('w', { reason: 'oom', exitCode: 0 }, false);
    await Promise.resolve();
    expect(boxes[0]?.options.detail).toContain('It ran out of memory.');
    boxes[0]?.answer(1);
    expect(await done).toBe('quit');
    expect(did).toEqual(['quit']);
  });

  it('reloads when the box could not open, since a window with no page shows nothing', async () => {
    const { handle, boxes, did, logged } = goneHandler();
    const done = handle('w', crashed, false);
    await Promise.resolve();
    boxes[0]?.fail(new Error('no box today'));
    expect(await done).toBe('reload');
    expect(did).toEqual(['reload w']);
    expect(logged.map((l) => l.event)).toContain('renderer.gone-box-failed');
  });

  it('does nothing with an answer that comes after the window closed or the app began quitting', async () => {
    for (const late of ['destroyed', 'quitting'] as const) {
      const { handle, boxes, did, flags } = goneHandler();
      const done = handle('w', crashed, false);
      await Promise.resolve();
      flags[late] = true;
      boxes[0]?.answer(0);
      expect(await done).toBeNull();
      expect(did).toEqual([]);
    }
  });

  it('asks nothing while quitting, at the end of the session, after a clean exit or when a close goes ahead', async () => {
    const cases = [
      { setup: { quitting: true }, details: crashed, closing: false, outcome: 'quitting', level: 'warn' },
      {
        setup: { sessionEnding: true },
        details: crashed,
        closing: false,
        outcome: 'session-end',
        level: 'warn'
      },
      {
        setup: {},
        details: { reason: 'clean-exit', exitCode: 0 },
        closing: false,
        outcome: 'clean-exit',
        level: 'info'
      },
      { setup: {}, details: crashed, closing: true, outcome: 'closing', level: 'warn' }
    ];
    for (const c of cases) {
      const { handle, boxes, did, logged } = goneHandler(c.setup);
      expect(await handle('w', c.details, c.closing)).toBeNull();
      expect(boxes).toEqual([]);
      expect(did).toEqual([]);
      expect(logged).toEqual([
        {
          level: c.level,
          event: 'renderer.gone',
          fields: { reason: c.details.reason, exitCode: c.details.exitCode, outcome: c.outcome }
        }
      ]);
    }
  });

  it('reads the box: Reload window first, the default and what Escape gives; Quit second', () => {
    const options = goneBoxOptions(rendererGoneBox('killed'));
    expect(options).toEqual({
      type: 'warning',
      title: APP_NAME,
      message: `${APP_NAME}'s window stopped working`,
      detail: options.detail,
      buttons: [RELOAD_WINDOW, 'Quit'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    expect(options.detail.split('\n')).toEqual([
      goneCause('killed'),
      expect.stringContaining('Your decisions and open paragraph boxes are written as you make them'),
      `Quit closes ${APP_NAME}.`
    ]);
    expect(goneAnswer(1)).toBe('quit');
    for (const response of [0, -1, 2]) expect(goneAnswer(response)).toBe('reload');
  });

  describe('with the close guard (7.7)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    class Win extends EventEmitter implements GuardWindow {
      destroyed = false;
      readonly webContents = {
        send: (): void => undefined,
        on: (): void => undefined
      };
      isDestroyed(): boolean {
        return this.destroyed;
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
      /** The title bar's X: true when it closed. */
      close(): boolean {
        let held = false;
        this.emit('close', { preventDefault: () => (held = true) } satisfies CloseEventLike);
        if (!held) this.destroyed = true;
        return !held;
      }
      destroy(): void {
        this.destroyed = true;
      }
    }

    const AT_RISK: CloseGuardState = {
      chapter: 'C:/Novel/Chapter 12.md',
      unsavedDecisions: 3,
      changedParagraphs: 0,
      locked: false,
      reviewRunning: false,
      writesPending: false,
      dialogText: false
    };

    function withGuard() {
      const guard = createCloseGuard<Win>({
        showBox: () => new Promise(() => undefined),
        quit: () => undefined,
        log: () => undefined,
        quietWindow: () => false
      });
      const win = new Win();
      guard.attach(win);
      const shown: GoneBoxOptions[] = [];
      const handle = createRendererGoneHandler<Win>({
        guard,
        showBox: (_win, options) => {
          shown.push(options);
          return new Promise(() => undefined);
        },
        reload: () => undefined,
        quit: () => undefined,
        isDestroyed: (w) => w.isDestroyed(),
        log: () => undefined
      });
      /** What `createWindow`'s handler does: the guard first, then this. */
      const gone = (): Promise<unknown> => handle(win, crashed, guard.onRendererGone());
      return { guard, win, shown, gone };
    }

    it('lets a close under way go ahead, and offers nothing', async () => {
      const { guard, win, shown, gone } = withGuard();
      guard.setState(AT_RISK);
      expect(win.close()).toBe(false);
      await gone();
      expect(shown).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(win.destroyed).toBe(true);
    });

    it('offers Reload window or Quit with no close under way, and a close meanwhile goes through at once', async () => {
      const { guard, win, shown, gone } = withGuard();
      guard.setState(AT_RISK);
      void gone();
      await Promise.resolve();
      expect(shown).toHaveLength(1);
      expect(win.close()).toBe(true);
    });

    it('offers nothing once the app is quitting or the session ending', async () => {
      const quitting = withGuard();
      quitting.guard.onBeforeQuit();
      await quitting.gone();
      expect(quitting.shown).toEqual([]);

      const ending = withGuard();
      ending.win.emit('session-end');
      await ending.gone();
      expect(ending.shown).toEqual([]);
    });
  });
});

describe('the words (shared/ui/crash.ts)', () => {
  it('names each cause plainly, and every other as a stop', () => {
    expect(goneCause('oom')).toBe('It ran out of memory.');
    expect(goneCause('killed')).toContain('Task Manager');
    expect(goneCause('launch-failed')).toBe('Its process could not start.');
    expect(goneCause('integrity-failure')).toContain('integrity check');
    for (const reason of ['crashed', 'abnormal-exit', 'memory-eviction', 'something new']) {
      expect(goneCause(reason)).toBe('Its process stopped unexpectedly.');
    }
  });

  it("main's card is an error with Show diagnostics, and both cards say what to do", () => {
    expect(MAIN_ERROR_NOTICE.tone).toBe('error');
    expect(MAIN_ERROR_NOTICE.action).toBe('show-diagnostics');
    for (const text of [MAIN_ERROR_NOTICE.message, PAGE_ERROR_TEXT]) {
      expect(text).toContain('may not have finished');
      expect(text).toContain('Show diagnostics');
      expect(text).not.toMatch(/accepted changes/i);
    }
  });
});

describe('the wiring', () => {
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

  it('installs the handlers in start(), once the log is open (11.3 a, step 5)', () => {
    const start = between(INDEX, 'function start(): void {', '\n}\n');
    const install = start.indexOf('installCrashHandlers(process, { log, notice: sendNotice });');
    expect(install).toBeGreaterThan(start.indexOf('initLog('));
    expect(install).toBeLessThan(start.indexOf('app.setAppUserModelId(APP_ID)'));
  });

  it('tells the guard first in the one render-process-gone handler, then offers Reload or Quit', () => {
    const handler = between(INDEX, "win.webContents.on('render-process-gone'", '});');
    expect(handler).toMatch(
      /const closing = closeGuard\.onRendererGone\(\);\s*void afterRendererGone\(win, details, closing\);/
    );
    const made = between(
      INDEX,
      'const afterRendererGone = createRendererGoneHandler<BrowserWindow>({',
      '\n});'
    );
    expect(made).toContain('guard: closeGuard,');
    expect(made).toContain('dialog.showMessageBox(win, { ...options, signal: controller.signal })');
    expect(made).toContain("win.once('closed', abort);");
    expect(made).toContain('reload: (win) => win.webContents.reload(),');
    expect(made).toContain('quit: () => app.quit(),');
  });

  it("logs the page's lines through createRendererLog", () => {
    const handlers = between(IPC, 'function registerDiagnosticsHandlers(): void {', '\n}\n');
    expect(handlers).toMatch(/handle\('log:renderer', \(line\) => \{\s*rendererLog\(line\);/);
    expect(IPC).toContain('const rendererLog = createRendererLog({ log });');
  });
});
