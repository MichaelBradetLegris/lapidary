import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import {
  KEEP_GAP_MS,
  ON_TOP_LEVEL,
  REFOCUS_DELAY_MS,
  REFOCUS_GAP_MS,
  createFullScreen,
  type FocusSettings,
  type FullScreenWindow
} from '../../src/main/fullScreen';
import { EVENT_CHANNELS, REQUEST_CHANNELS } from '../../src/shared/ipc';
import type { FocusModeState } from '../../src/shared/ui/focusMode';
import type { FullScreenChange } from '../../src/shared/ui/fullScreen';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

/* polish.23: main's half of full screen; focus.1: focus mode, main's window
   driver. The window is a stand-in that keeps Electron's rules on Windows
   (native_window_views.cc): `setFullScreen` sends `enter-full-screen` or
   `leave-full-screen` as it begins, before `isFullScreen()` has changed ("We
   set the new value after notifying"), and sends it again for a state the
   window is already in; `closed` comes once the window has gone. Electron's
   kiosk on Windows is its full screen (`SetKiosk` calls `SetFullScreen`), so
   the stand-in's `setKiosk` enters and leaves full screen too. Every test of
   the driver also runs with the change made before the event, as on other
   systems, and the focus mode tests with a kiosk that leaves full screen
   alone, so nothing here leans on either. `focus()` gives the window the
   focus, as the foreground's owner would let it. The page's half is
   test/renderer/fullScreen.render.test.ts, focusMode.render.test.ts and
   focusMode.test.ts, the rules test/shared/fullScreen.test.ts and
   focusMode.test.ts. */

type Listener = () => void;

interface WindowModel {
  /** `setKiosk` enters and leaves full screen, as on Windows */
  kioskIsFullScreen?: boolean;
  /** the event comes before `isFullScreen()` has changed, as on Windows */
  notifyFirst?: boolean;
}

/** The stand-in's model for the tests that run once, `new FakeWindow()`; set by each `describe.each`. */
let model: WindowModel = {};

class FakeWindow implements FullScreenWindow {
  private readonly listeners = new Map<string, Listener[]>();
  private full = false;
  destroyed = false;
  focused = true;
  enabled = true;
  /** every setFullScreen call, in order */
  readonly calls: boolean[] = [];
  /** the focus mode calls, in order: kiosk, on top and focus */
  readonly focusCalls: string[] = [];
  /** what went to the page */
  readonly sent: [string, unknown][] = [];
  readonly webContents = {
    send: (channel: string, payload: unknown): void => {
      this.sent.push([channel, payload]);
    }
  };
  private readonly kioskIsFullScreen: boolean;
  private readonly notifyFirst: boolean;

  constructor({ kioskIsFullScreen = true, notifyFirst = true }: WindowModel = model) {
    this.kioskIsFullScreen = kioskIsFullScreen;
    this.notifyFirst = notifyFirst;
  }

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

  /**
   * The system's own full screen, as setFullScreen and, on Windows, setKiosk
   * make it: on Windows the event first, and for any call; else the change
   * first, and an event only for a change.
   */
  private screen(flag: boolean): void {
    const event = flag ? 'enter-full-screen' : 'leave-full-screen';
    if (this.notifyFirst) {
      this.emit(event);
      this.full = flag;
      return;
    }
    if (flag === this.full) return;
    this.full = flag;
    this.emit(event);
  }

  setFullScreen(flag: boolean): void {
    this.calls.push(flag);
    this.screen(flag);
  }

  setKiosk(flag: boolean): void {
    this.focusCalls.push(`kiosk ${flag}`);
    if (this.kioskIsFullScreen) this.screen(flag);
  }

  setAlwaysOnTop(flag: boolean, level?: string): void {
    this.focusCalls.push(level === undefined ? `on top ${flag}` : `on top ${flag} ${level}`);
  }

  isFocused(): boolean {
    return this.focused;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  focus(): void {
    this.focusCalls.push('focus');
    if (this.enabled) this.focused = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Another window took the focus: Alt+Tab, a click elsewhere, a box of the app's own. */
  blurs(): void {
    this.focused = false;
    this.emit('blur');
  }

  /** The window has the focus again. */
  focuses(): void {
    this.focused = true;
    this.emit('focus');
  }

  /** Something other than main takes the window out of full screen. */
  leavesByItself(): void {
    this.screen(false);
  }

  /** The window goes, as its X or the app's quit would close it. */
  closes(): void {
    this.destroyed = true;
    this.emit('closed');
  }
}

let quiet = false;
const logged: [string, string, unknown][] = [];

function make(settings?: Partial<FocusSettings>): ReturnType<typeof createFullScreen<FakeWindow>> {
  const made = createFullScreen<FakeWindow>({
    quietWindow: () => quiet,
    log: (level, event, fields) => logged.push([level, event, fields])
  });
  if (settings) made.setFocusSettings({ focusMode: false, focusHoldSeconds: 30, ...settings });
  return made;
}

const told = (on: boolean, focus: FocusModeState | null = null): [string, FullScreenChange] => [
  'window:full-screen-changed',
  { fullScreen: on, focus }
];
const HOLD_30: FocusModeState = { holdSeconds: 30 };

/** The fields of the last `window.focus-mode` line logged. */
const lastFocusLine = (): unknown => logged.filter(([, event]) => event === 'window.focus-mode').at(-1)?.[2];

beforeEach(() => {
  quiet = false;
  logged.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  model = {};
});

const ORDERS = [
  ['the event before the change, as Electron on Windows', true],
  ['the change before the event', false]
] as const;

describe.each(ORDERS)('full screen on the window (polish.23), %s', (_label, notifyFirst) => {
  beforeEach(() => {
    model = { notifyFirst };
  });

  it('toggles in and out through setFullScreen, the window telling the page each time', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: null });
    expect(win.isFullScreen()).toBe(true);
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: false, focus: null });
    expect(win.isFullScreen()).toBe(false);
    expect(win.calls).toEqual([true, false]);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('leaves only when in, and leaving again does nothing', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('leave').fullScreen).toBe(false);
    expect(win.calls).toEqual([]);
    fullScreen.act('toggle');
    expect(fullScreen.act('leave').fullScreen).toBe(false);
    expect(fullScreen.act('leave').fullScreen).toBe(false);
    expect(win.calls).toEqual([true, false]);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('reads where the window stands without changing it', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('current')).toEqual({ fullScreen: false, focus: null });
    fullScreen.act('toggle');
    expect(fullScreen.act('current')).toEqual({ fullScreen: true, focus: null });
    expect(win.calls).toEqual([true]);
  });

  it('tells the page of a change it did not ask for, as the system making the window full screen', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    win.setFullScreen(true);
    expect(fullScreen.act('current').fullScreen).toBe(true);
    win.setFullScreen(false);
    expect(win.sent).toEqual([told(true), told(false)]);
  });

  it('takes release outside focus mode as leave', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    fullScreen.act('toggle');
    expect(fullScreen.act('release')).toEqual({ fullScreen: false, focus: null });
    expect(win.calls).toEqual([true, false]);
    expect(win.focusCalls).toEqual([]);
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

  it('refuses anything but toggle, leave, current or release, naming no value, and changes nothing', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    for (const action of ['enter', 'TOGGLE', 'Release', '', undefined, null, 1, { action: 'toggle' }]) {
      let error: unknown = null;
      try {
        fullScreen.act(action);
      } catch (err) {
        error = err;
      }
      expect(error, JSON.stringify(action)).toBeInstanceOf(AppFailure);
      expect((error as AppFailure).code).toBe('invalid-input');
      expect((error as AppFailure).message).toBe(
        'The window:full-screen request was refused, because its action is not toggle, leave, current or release. Nothing was done.'
      );
    }
    expect(win.calls).toEqual([]);
    expect(win.sent).toEqual([]);
  });

  it('answers with neither and touches nothing with no window, or once the window has closed', () => {
    const fullScreen = make();
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: false, focus: null });
    const win = new FakeWindow();
    fullScreen.attach(win);
    fullScreen.act('toggle');
    win.closes();
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: false, focus: null });
    expect(fullScreen.act('current')).toEqual({ fullScreen: false, focus: null });
    expect(win.calls).toEqual([true]);
  });

  it('leaves a window that is being destroyed alone, before its closed event has come', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    win.destroyed = true;
    expect(fullScreen.act('toggle').fullScreen).toBe(false);
    expect(fullScreen.act('current').fullScreen).toBe(false);
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
    expect(fullScreen.act('current').fullScreen).toBe(false);
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
    expect(fullScreen.act('toggle').fullScreen).toBe(true);
    expect(fullScreen.act('current').fullScreen).toBe(true);
    expect(win.isFullScreen()).toBe(false);
    expect(fullScreen.act('leave').fullScreen).toBe(false);
    expect(fullScreen.act('current').fullScreen).toBe(false);
    expect(fullScreen.act('toggle').fullScreen).toBe(true);
    expect(fullScreen.act('toggle').fullScreen).toBe(false);
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
    expect(fullScreen.act('current').fullScreen).toBe(false);
    expect(second.calls).toEqual([]);
  });
});

/* focus.1: focus mode, main's window driver. Kiosk, on top and the refocus
   are main's alone, never set for a quiet window; the live check of what they
   do to a real window is the author's, on the packaged build (PLAN C.121). */
describe.each([
  ['a kiosk that is full screen and the event first, as on Windows', true, true],
  ['a kiosk that is full screen and the change first', true, false],
  ['a kiosk that leaves full screen alone, the event first', false, true],
  ['a kiosk that leaves full screen alone, the change first', false, false]
] as const)('focus mode (focus.1), with %s', (_label, kioskIsFullScreen, notifyFirst) => {
  beforeEach(() => {
    model = { kioskIsFullScreen, notifyFirst };
  });

  const enter = (settings: Partial<FocusSettings> = {}) => {
    const fullScreen = make({ focusMode: true, ...settings });
    const win = new FakeWindow();
    fullScreen.attach(win);
    const answer = fullScreen.act('toggle');
    return { fullScreen, win, answer };
  };

  it('is off by default: full screen is plain, with no kiosk and nothing on top', () => {
    const fullScreen = make();
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: null });
    expect(win.focusCalls).toEqual([]);
    expect(fullScreen.focusMode()).toBe(false);
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: false, focus: null });
  });

  it('enters with full screen when the box is ticked: kiosk, on top above the taskbar, and the page told', () => {
    const { fullScreen, win, answer } = enter();
    expect(answer).toEqual({ fullScreen: true, focus: HOLD_30 });
    expect(win.calls).toEqual([true]);
    expect(win.focusCalls).toEqual(['kiosk true', `on top true ${ON_TOP_LEVEL}`]);
    expect(ON_TOP_LEVEL).toBe('screen-saver');
    expect(win.isFullScreen()).toBe(true);
    expect(win.sent).toEqual([told(true, HOLD_30)]);
    expect(fullScreen.focusMode()).toBe(true);
    expect(fullScreen.act('current')).toEqual({ fullScreen: true, focus: HOLD_30 });
    expect(logged).toEqual([
      ['info', 'window.focus-mode', { on: true, quiet: false, holdSeconds: 30 }],
      ['info', 'window.full-screen', { on: true, quiet: false }]
    ]);
  });

  it('keeps the hold time it was entered with, and a change of the settings waits for the next time', () => {
    const { fullScreen, answer } = enter({ focusHoldSeconds: 60 });
    expect(answer.focus).toEqual({ holdSeconds: 60 });
    fullScreen.setFocusSettings({ focusMode: false, focusHoldSeconds: 15 });
    expect(fullScreen.act('current').focus).toEqual({ holdSeconds: 60 });
    expect(fullScreen.focusMode()).toBe(true);
    fullScreen.act('release');
    // The box now off: the next full screen is plain.
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: null });
  });

  it('enters with the shortest hold, 5 s, and the default, 10 s, as with any other (focus.2)', () => {
    const { fullScreen, answer } = enter({ focusHoldSeconds: 5 });
    expect(answer.focus).toEqual({ holdSeconds: 5 });
    expect(lastFocusLine()).toEqual({ on: true, quiet: false, holdSeconds: 5 });
    fullScreen.act('release');
    fullScreen.setFocusSettings({ focusMode: true, focusHoldSeconds: DEFAULT_SETTINGS.focusHoldSeconds });
    expect(fullScreen.act('toggle').focus).toEqual({ holdSeconds: 10 });
    expect(lastFocusLine()).toEqual({ on: true, quiet: false, holdSeconds: 10 });
  });

  it('keeps the window as it is on toggle and leave: only the hold leaves', () => {
    const { fullScreen, win } = enter();
    win.sent.length = 0;
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: HOLD_30 });
    expect(fullScreen.act('leave')).toEqual({ fullScreen: true, focus: HOLD_30 });
    expect(win.calls).toEqual([true]);
    expect(win.focusCalls).toEqual(['kiosk true', `on top true ${ON_TOP_LEVEL}`]);
    expect(win.sent).toEqual([]);
    expect(win.isFullScreen()).toBe(true);
  });

  it('leaves on release, the hold done: on top, kiosk and full screen go together', () => {
    const { fullScreen, win } = enter();
    win.sent.length = 0;
    logged.length = 0;
    expect(fullScreen.act('release')).toEqual({ fullScreen: false, focus: null });
    expect(win.focusCalls).toEqual([
      'kiosk true',
      `on top true ${ON_TOP_LEVEL}`,
      'on top false',
      'kiosk false'
    ]);
    expect(win.isFullScreen()).toBe(false);
    // Told once, however many ways the window left full screen.
    expect(win.sent).toEqual([told(false)]);
    expect(fullScreen.focusMode()).toBe(false);
    expect(logged[0]).toEqual([
      'info',
      'window.focus-mode',
      { on: false, quiet: false, reason: 'hold', refocused: 0 }
    ]);
    // While the box is ticked, the next full screen is focus mode again.
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: HOLD_30 });
  });

  it('brings the window back 150 ms after it loses the focus, unless it is back already', () => {
    vi.useFakeTimers();
    const { win } = enter();
    win.blurs();
    vi.advanceTimersByTime(REFOCUS_DELAY_MS - 1);
    expect(win.focusCalls.filter((c) => c === 'focus')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(win.focusCalls.filter((c) => c === 'focus')).toEqual(['focus']);
    expect(win.isFocused()).toBe(true);
    // Back by itself before the time is up: nothing to do.
    win.blurs();
    vi.advanceTimersByTime(50);
    win.focuses();
    vi.advanceTimersByTime(1000);
    expect(win.focusCalls.filter((c) => c === 'focus')).toHaveLength(1);
    expect(REFOCUS_DELAY_MS).toBe(150);
  });

  it('brings it back at most once every 300 ms, however often it loses the focus', () => {
    vi.useFakeTimers();
    const { fullScreen, win } = enter();
    const at: number[] = [];
    const start = Date.now();
    const original = win.focus.bind(win);
    win.focus = () => {
      at.push(Date.now() - start);
      original();
    };
    for (let i = 0; i < 6; i += 1) {
      win.blurs();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(1000);
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < at.length; i += 1) {
      expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(REFOCUS_GAP_MS);
    }
    expect(REFOCUS_GAP_MS).toBe(300);
    fullScreen.act('release');
    expect(lastFocusLine()).toMatchObject({ reason: 'hold', refocused: at.length });
  });

  it("leaves a box or a picker of the app's own open over the window alone, which disables it", () => {
    vi.useFakeTimers();
    const { win } = enter();
    win.enabled = false;
    win.blurs();
    vi.advanceTimersByTime(2000);
    expect(win.focusCalls.filter((c) => c === 'focus')).toEqual([]);
  });

  it('never brings the window back outside focus mode', () => {
    vi.useFakeTimers();
    const fullScreen = make();
    const plain = new FakeWindow();
    fullScreen.attach(plain);
    fullScreen.act('toggle');
    plain.blurs();
    vi.advanceTimersByTime(2000);
    expect(plain.focusCalls).toEqual([]);

    const { fullScreen: held, win } = enter();
    win.blurs();
    held.act('release');
    vi.advanceTimersByTime(2000);
    expect(win.focusCalls.filter((c) => c === 'focus')).toEqual([]);
  });

  it('leaves on its own when the page stops answering', () => {
    const { fullScreen, win } = enter();
    win.emit('unresponsive');
    expect(fullScreen.focusMode()).toBe(false);
    expect(win.isFullScreen()).toBe(false);
    expect(win.focusCalls.slice(2)).toEqual(['on top false', 'kiosk false']);
    expect(win.sent.at(-1)).toEqual(told(false));
    expect(lastFocusLine()).toEqual({ on: false, quiet: false, reason: 'unresponsive', refocused: 0 });
  });

  it.each(['renderer-gone', 'close-box', 'quit'] as const)("leaves on main's own word: %s", (reason) => {
    const { fullScreen, win } = enter();
    fullScreen.leaveFocus(reason);
    expect(fullScreen.focusMode()).toBe(false);
    expect(win.isFullScreen()).toBe(false);
    expect(win.focusCalls.slice(2)).toEqual(['on top false', 'kiosk false']);
    expect(lastFocusLine()).toEqual({ on: false, quiet: false, reason, refocused: 0 });
    // Nothing more the second time, and nothing at all outside focus mode.
    const calls = win.focusCalls.length;
    fullScreen.leaveFocus(reason);
    expect(win.focusCalls).toHaveLength(calls);
  });

  it('forgets focus mode when the window closes, touching nothing of the closed window', () => {
    vi.useFakeTimers();
    const { fullScreen, win } = enter();
    win.blurs();
    win.closes();
    vi.advanceTimersByTime(2000);
    expect(win.focusCalls).toEqual(['kiosk true', `on top true ${ON_TOP_LEVEL}`]);
    expect(fullScreen.focusMode()).toBe(false);
    expect(logged.at(-1)).toEqual([
      'info',
      'window.focus-mode',
      { on: false, quiet: false, reason: 'closed', refocused: 0 }
    ]);
    const next = new FakeWindow();
    fullScreen.attach(next);
    expect(fullScreen.act('current')).toEqual({ fullScreen: false, focus: null });
  });

  it('puts the window back when something else takes it out of full screen, and asks the page for the hold', async () => {
    vi.useFakeTimers();
    const { fullScreen, win } = enter();
    win.sent.length = 0;
    win.leavesByItself();
    expect(win.sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(win.isFullScreen()).toBe(true);
    expect(win.focusCalls.slice(2)).toEqual(['kiosk true', `on top true ${ON_TOP_LEVEL}`]);
    expect(win.sent).toEqual([
      ['window:full-screen-changed', { fullScreen: true, focus: HOLD_30, kept: true }]
    ]);
    expect(fullScreen.focusMode()).toBe(true);
    expect(logged.some(([, event]) => event === 'window.focus-mode-kept')).toBe(true);
  });

  it('ends focus mode rather than fight when it is taken out again within two seconds', async () => {
    vi.useFakeTimers();
    const { fullScreen, win } = enter();
    win.leavesByItself();
    await vi.advanceTimersByTimeAsync(KEEP_GAP_MS - 100);
    const calls = win.focusCalls.length;
    win.leavesByItself();
    // Focus mode has ended at once, and the window's calls wait for its own event to end.
    expect(fullScreen.focusMode()).toBe(false);
    expect(win.focusCalls).toHaveLength(calls);
    await vi.advanceTimersByTimeAsync(0);
    expect(win.focusCalls.slice(calls)).toEqual(['on top false', 'kiosk false']);
    expect(win.isFullScreen()).toBe(false);
    expect(lastFocusLine()).toMatchObject({ on: false, reason: 'left-full-screen' });
    expect(win.sent.at(-1)).toEqual(told(false));
    expect(KEEP_GAP_MS).toBe(2000);
  });

  it('puts it back again once two seconds have passed', async () => {
    vi.useFakeTimers();
    const { fullScreen, win } = enter();
    win.leavesByItself();
    await vi.advanceTimersByTimeAsync(KEEP_GAP_MS);
    win.leavesByItself();
    await vi.advanceTimersByTimeAsync(0);
    expect(fullScreen.focusMode()).toBe(true);
    expect(win.isFullScreen()).toBe(true);
  });
});

describe('focus mode in a quiet test window (focus.1, C.61): the state alone', () => {
  it('never sets kiosk or on top, never puts the window in full screen and never brings it forward', () => {
    vi.useFakeTimers();
    quiet = true;
    const fullScreen = make({ focusMode: true });
    const win = new FakeWindow();
    fullScreen.attach(win);
    expect(fullScreen.act('toggle')).toEqual({ fullScreen: true, focus: HOLD_30 });
    expect(fullScreen.focusMode()).toBe(true);
    expect(fullScreen.act('leave')).toEqual({ fullScreen: true, focus: HOLD_30 });
    win.blurs();
    vi.advanceTimersByTime(5000);
    win.emit('leave-full-screen');
    vi.advanceTimersByTime(5000);
    expect(fullScreen.act('release')).toEqual({ fullScreen: false, focus: null });
    fullScreen.act('toggle');
    fullScreen.leaveFocus('quit');
    expect(win.calls).toEqual([]);
    expect(win.focusCalls).toEqual([]);
    expect(win.sent).toEqual([told(true, HOLD_30), told(false), told(true, HOLD_30), told(false)]);
    expect(logged.filter(([, event]) => event === 'window.focus-mode').map(([, , fields]) => fields)).toEqual(
      [
        { on: true, quiet: true, holdSeconds: 30 },
        { on: false, quiet: true, reason: 'hold', refocused: 0 },
        { on: true, quiet: true, holdSeconds: 30 },
        { on: false, quiet: true, reason: 'quit', refocused: 0 }
      ]
    );
  });
});

describe('the wiring', () => {
  const read = (file: string): string =>
    readFileSync(path.join(__dirname, '../../src/main', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
  const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    expect(start, from).toBeGreaterThanOrEqual(0);
    return text.slice(start, text.indexOf(to, start));
  };

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
      "handle('window:full-screen', ({ action }) => Promise.resolve(fullScreen.act(action)));"
    );
    expect(read('index.ts')).toContain('fullScreen.attach(win);');
  });

  it('reads the focus mode settings as they are loaded and saved, and at the start (focus.1)', () => {
    const ipc = read('ipc.ts');
    expect(between(ipc, "handle('settings:get'", '\n  });')).toContain(
      'fullScreen.setFocusSettings(read.settings);'
    );
    expect(between(ipc, "handleWrite('settings:set'", '\n  });')).toContain(
      'fullScreen.setFocusSettings(settings);'
    );
    const ready = between(read('index.ts'), 'void app.whenReady().then(async () => {', 'createWindow();');
    expect(ready).toContain('fullScreen.setFocusSettings(settings);');
  });

  it('has the close guard ask about every close in focus mode, and leave it before its box (focus.1)', () => {
    const guard = between(
      read('ipc.ts'),
      'export const closeGuard = createCloseGuard<BrowserWindow>({',
      '});'
    );
    expect(guard).toContain('focusMode: () => fullScreen.focusMode()');
    expect(guard).toContain("leaveFocusMode: () => fullScreen.leaveFocus('close-box')");
  });

  it('leaves focus mode first when the page process goes, and when the app quits (focus.1)', () => {
    const index = read('index.ts');
    const gone = between(index, "win.webContents.on('render-process-gone'", '});');
    expect(gone).toMatch(
      /^[^]*?\{\s*fullScreen\.leaveFocus\('renderer-gone'\);\s*const closing = closeGuard\.onRendererGone\(\);/
    );
    const quit = between(index, "app.on('before-quit', (event) => {", '\n  });\n');
    expect(quit).toMatch(/closeGuard\.onBeforeQuit\(\);\s*fullScreen\.leaveFocus\('quit'\);/);
  });

  it('never starts in full screen or kiosk: no window option for either, and no setting with their names', () => {
    const index = read('index.ts');
    // Electron's window options that start full screen, or take it away.
    expect(index).not.toMatch(/\b(fullscreen|fullscreenable|simpleFullscreen|kiosk|alwaysOnTop)\s*:/);
    expect(index).toContain('new BrowserWindow({');
    expect(Object.keys(DEFAULT_SETTINGS).filter((k) => /full|screen|kiosk|top/i.test(k))).toEqual([]);
    expect(DEFAULT_SETTINGS.focusMode).toBe(false);
    expect(DEFAULT_SETTINGS.focusHoldSeconds).toBe(10);
  });

  it('puts the window in full screen, kiosk or on top nowhere but src/main/fullScreen.ts, and the page never asks the DOM', () => {
    const main = path.join(__dirname, '../../src/main');
    const files = readdirSync(main, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => /setFullScreen\(|setKiosk\(|setAlwaysOnTop\(/.test(read(f)))).toEqual([
      'fullScreen.ts'
    ]);
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

  it('brings the window back only through refocus in foreground.ts, which a quiet window skips', () => {
    const driver = read('fullScreen.ts');
    expect(driver).toContain("import { refocus } from './foreground';");
    expect(driver).toContain('refocus(w, deps.quietWindow());');
    expect(driver).not.toMatch(/\.focus\(\)/);
    const foreground = read('foreground.ts');
    expect(foreground).toMatch(
      /export function refocus\(win: Pick<FrontWindow, 'focus'>, quiet: boolean\): void \{\s*if \(quiet\) return;\s*win\.focus\(\);\s*\}/
    );
  });

  it('registers no global shortcut and no hook on a system key (focus.1: Electron cannot block them, and the app never tries)', () => {
    const main = path.join(__dirname, '../../src/main');
    const files = readdirSync(main, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      expect(read(file), file).not.toMatch(/globalShortcut/);
    }
  });
});
