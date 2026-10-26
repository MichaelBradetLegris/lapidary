import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import { createFullScreen, type FullScreenWindow } from '../../src/main/fullScreen';
import { EVENT_CHANNELS, REQUEST_CHANNELS } from '../../src/shared/ipc';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

/* polish.23: main's half of full screen. The window is a stand-in that keeps
   Electron's rules on Windows: `setFullScreen` changes `isFullScreen()` at
   once and emits `enter-full-screen` or `leave-full-screen`, and only when
   the state changes; `closed` comes once the window has gone. The page's half
   is test/renderer/fullScreen.render.test.ts, the rules test/shared/fullScreen.test.ts. */

type Listener = () => void;

class FakeWindow implements FullScreenWindow {
  private readonly listeners = new Map<string, Listener[]>();
  private full = false;
  destroyed = false;
  /** every setFullScreen call, in order */
  readonly calls: boolean[] = [];
  /** what went to the page */
  readonly sent: [string, unknown][] = [];
  readonly webContents = {
    send: (channel: string, payload: unknown): void => {
      this.sent.push([channel, payload]);
    }
  };

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  isFullScreen(): boolean {
    return this.full;
  }

  setFullScreen(flag: boolean): void {
    this.calls.push(flag);
    if (flag === this.full) return;
    this.full = flag;
    this.emit(flag ? 'enter-full-screen' : 'leave-full-screen');
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The window goes, as its X or the app's quit would close it. */
  closes(): void {
    this.destroyed = true;
    this.emit('closed');
  }
}

let quiet = false;
const logged: [string, string, unknown][] = [];

function make(): ReturnType<typeof createFullScreen<FakeWindow>> {
  return createFullScreen<FakeWindow>({
    quietWindow: () => quiet,
    log: (level, event, fields) => logged.push([level, event, fields])
  });
}

const told = (on: boolean): [string, unknown] => ['window:full-screen-changed', { fullScreen: on }];

beforeEach(() => {
  quiet = false;
  logged.length = 0;
});

describe('full screen on the window (polish.23)', () => {
  it('toggles in and out through setFullScreen, the window telling the page each time', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('toggle')).toBe(true);
    expect(win.isFullScreen()).toBe(true);
    expect(fullScreen.act('toggle')).toBe(false);
    expect(win.isFullScreen()).toBe(false);
    expect(win.calls).toEqual([true, false]);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('leaves only when in, and leaving again does nothing', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('leave')).toBe(false);
    expect(win.calls).toEqual([]);
    fullScreen.act('toggle');
    expect(fullScreen.act('leave')).toBe(false);
    expect(fullScreen.act('leave')).toBe(false);
    expect(win.calls).toEqual([true, false]);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('reads where the window stands without changing it', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('current')).toBe(false);
    fullScreen.act('toggle');
    expect(fullScreen.act('current')).toBe(true);
    expect(win.calls).toEqual([true]);
  });

  it('tells the page of a change it did not ask for, as the system making the window full screen', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    win.setFullScreen(true);
    expect(fullScreen.act('current')).toBe(true);
    win.setFullScreen(false);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('logs each change with its direction and whether the window is quiet, and nothing else', () => {
    const fullScreen = make();
    fullScreen.attach(new FakeWindow());
    fullScreen.act('toggle');
    fullScreen.act('current');
    fullScreen.act('leave');
    fullScreen.act('leave');
    expect(logged).toEqual([
      ['info', 'window.full-screen', { on: true, quiet: false }],
      ['info', 'window.full-screen', { on: false, quiet: false }]
    ]);
  });

  it('refuses anything but toggle, leave or current, naming no value, and changes nothing', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    for (const action of ['enter', 'TOGGLE', '', undefined, null, 1, { action: 'toggle' }]) {
      let error: unknown = null;
      try {
        fullScreen.act(action);
      } catch (err) {
        error = err;
      }
      expect(error, JSON.stringify(action)).toBeInstanceOf(AppFailure);
      expect((error as AppFailure).code).toBe('invalid-input');
      expect((error as AppFailure).message).toBe(
        'The window:full-screen request was refused, because its action is not toggle, leave or current. Nothing was done.'
      );
    }
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([]);
  });

  it('answers false and touches nothing with no window, or once the window has closed', () => {
    const fullScreen = make();
    expect(fullScreen.act('toggle')).toBe(false);
    const win = new FakeWindow();
    fullScreen.attach(win);
    fullScreen.act('toggle');
    win.closes();
    expect(fullScreen.act('toggle')).toBe(false);
    expect(fullScreen.act('current')).toBe(false);
    expect(win.calls).toEqual([true]);
  });

  it('leaves a window that is being destroyed alone, before its closed event has come', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    win.destroyed = true;
    expect(fullScreen.act('toggle')).toBe(false);
    expect(fullScreen.act('current')).toBe(false);
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([]);
  });

  it('follows only the window attached last, which starts out of full screen', () => {
    const fullScreen = make();
    const first = new FakeWindow();
    fullScreen.attach(first);
    fullScreen.act('toggle');
    const second = new FakeWindow();
    fullScreen.attach(second);
    expect(fullScreen.act('current')).toBe(false);
    first.setFullScreen(false);
    expect(second.sent).toEqual([]);
    expect(first.sent).toEqual([told(true)]);
  });
});

describe('a quiet test window (dev.1, C.61) never covers the screen', () => {
  it('keeps the state in main and tells the page, the window never put in full screen', () => {
    quiet = true;
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('toggle')).toBe(true);
    expect(fullScreen.act('current')).toBe(true);
    expect(win.isFullScreen()).toBe(false);
    expect(fullScreen.act('leave')).toBe(false);
    expect(fullScreen.act('current')).toBe(false);
    expect(fullScreen.act('toggle')).toBe(true);
    expect(fullScreen.act('toggle')).toBe(false);
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([told(true), told(false), told(true), told(false)]);
    expect(logged.map(([, , fields]) => fields)).toEqual([
      { on: true, quiet: true },
      { on: false, quiet: true },
      { on: true, quiet: true },
      { on: false, quiet: true }
    ]);
  });

  it('starts a new window out of full screen, and forgets the state when the window closes', () => {
    quiet = true;
    const fullScreen = make();
    const first = new FakeWindow();
    fullScreen.attach(first);
    fullScreen.act('toggle');
    first.closes();
    const second = new FakeWindow();
    fullScreen.attach(second);
    expect(fullScreen.act('current')).toBe(false);
    expect(second.calls).toEqual([]);
  });
});

describe('the wiring', () => {
  const read = (file: string): string =>
    readFileSync(path.join(__dirname, '../../src/main', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');

  it('is one request and one event, window:full-screen and its -changed', () => {
    expect(REQUEST_CHANNELS.filter((c) => c.startsWith('window:'))).toEqual(['window:full-screen']);
    expect(EVENT_CHANNELS.filter((c) => c.startsWith('window:'))).toEqual(['window:full-screen-changed']);
  });

  it('answers the request with the one controller, which the window is attached to', () => {
    const ipc = read('ipc.ts');
    expect(ipc).toMatch(
      /export const fullScreen = createFullScreen<BrowserWindow>\(\{\s*quietWindow: \(\) => getDevSwitches\(\)\.quietWindow,\s*log\s*\}\);/
    );
    expect(ipc).toContain(
      "handle('window:full-screen', ({ action }) => Promise.resolve({ fullScreen: fullScreen.act(action) }));"
    );
    expect(read('index.ts')).toContain('fullScreen.attach(win);');
  });

  it('never starts in full screen: no window option for it, and no setting', () => {
    const index = read('index.ts');
    // Electron's window options that start full screen, or take it away.
    expect(index).not.toMatch(/\b(fullscreen|fullscreenable|simpleFullscreen|kiosk)\s*:/);
    expect(index).toContain('new BrowserWindow({');
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => /full|screen/i.test(k))).toEqual([]);
  });

  it('puts the window in full screen nowhere but src/main/fullScreen.ts, and the page never asks the DOM', () => {
    const main = path.join(__dirname, '../../src/main');
    const files = readdirSync(main, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => /setFullScreen\(|setKiosk\(/.test(read(f)))).toEqual(['fullScreen.ts']);
    const renderer = path.join(__dirname, '../../src/renderer');
    const pages = readdirSync(renderer, { recursive: true, encoding: 'utf8' }).filter((f) =>
      /\.tsx?$/.test(f)
    );
    expect(pages.length).toBeGreaterThan(10);
    for (const file of pages) {
      expect(readFileSync(path.join(renderer, file), 'utf8'), file).not.toMatch(
        /requestFullscreen|exitFullscreen|fullscreenElement/
      );
    }
  });
});
