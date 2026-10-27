import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  focusKeyDown,
  holdToLeave,
  installFocusMode,
  resumeFocus,
  type FocusModeDeps
} from '../../src/renderer/state/focusMode';
import {
  FOCUS_OVERLAY_CLOSED,
  showFocusOverlay,
  useFocusOverlay,
  useFullScreen
} from '../../src/renderer/state/fullScreen';
import type { FocusModeState } from '../../src/shared/ui/focusMode';
import type { EscapeTakers, FullScreenState } from '../../src/shared/ui/fullScreen';

/* focus.1: focus mode, the page's half, run in node with fake timers. The
   window is a plain EventTarget: focus mode's listeners go on it first, as
   App installs them on the window before any dialog adds its own, and a
   listener added after them stands for the rest of the page, so a key "kept
   from the page" is one that never reaches it. Main is a stand-in that
   answers `release` when told. The overlay itself is drawn in
   focusOverlay.render.test.ts; main's half is test/main/fullScreen.test.ts. */

const HOLD: FocusModeState = { holdSeconds: 15 };
const NOTHING: EscapeTakers = {
  modal: false,
  popup: false,
  hoverCard: false,
  find: false,
  editor: false,
  boxes: false,
  drawer: false,
  list: false
};

interface Keyed {
  key: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}

let target: EventTarget;
/** the keys that reached the rest of the page, as "keydown F11" */
let reached: string[];
let takers: EscapeTakers;
let released: number;
let releaseAnswer: { resolve: (state: FullScreenState) => void; reject: (err: Error) => void } | null;
let notes: string[];
let uninstall: () => void;

/** Send a key event to the window; true when it was kept from the page (cancelled). */
function send(type: 'keydown' | 'keyup', key: Keyed): boolean {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, {
    code: key.code ?? (key.key.length === 1 ? `Key${key.key.toUpperCase()}` : key.key),
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    ...key
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

const down = (key: string, extra: Omit<Keyed, 'key'> = {}): boolean => send('keydown', { key, ...extra });
const up = (key: string, extra: Omit<Keyed, 'key'> = {}): boolean => send('keyup', { key, ...extra });
const overlay = (): ReturnType<typeof useFocusOverlay.getState> => useFocusOverlay.getState();

function deps(): FocusModeDeps {
  return {
    escapeTakers: () => takers,
    release: () =>
      new Promise<FullScreenState>((resolve, reject) => {
        released += 1;
        releaseAnswer = { resolve, reject };
      }),
    now: () => Date.now(),
    notify: (message) => void notes.push(message)
  };
}

/** Main answers `release`: out of focus mode and full screen. */
async function mainLeaves(): Promise<void> {
  releaseAnswer?.resolve({ fullScreen: false, focus: null });
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  target = new EventTarget();
  reached = [];
  takers = NOTHING;
  released = 0;
  releaseAnswer = null;
  notes = [];
  useFullScreen.setState({ on: true, focus: HOLD });
  useFocusOverlay.setState(FOCUS_OVERLAY_CLOSED);
  uninstall = installFocusMode(target, deps());
  for (const type of ['keydown', 'keyup'] as const) {
    target.addEventListener(type, (event) => reached.push(`${type} ${(event as unknown as Keyed).key}`));
  }
});

afterEach(() => {
  uninstall();
  useFullScreen.setState({ on: false, focus: null });
  useFocusOverlay.setState(FOCUS_OVERLAY_CLOSED);
  vi.useRealTimers();
});

describe('outside focus mode (focus.1)', () => {
  it('leaves every key to the page, F11 and Escape included', () => {
    useFullScreen.setState({ on: true, focus: null });
    expect(down('F11')).toBe(false);
    expect(down('Escape')).toBe(false);
    expect(up('F11')).toBe(false);
    expect(reached).toEqual(['keydown F11', 'keydown Escape', 'keyup F11']);
    expect(overlay().open).toBe(false);
  });
});

describe('the hold (focus.1)', () => {
  it('opens on a fresh F11, counts from that press, and asks main to release once the time is up', async () => {
    const start = Date.now();
    expect(down('F11')).toBe(true);
    expect(overlay()).toEqual({ open: true, holding: 'F11', heldCode: 'F11', since: start, leaving: false });
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000 - 1);
    expect(released).toBe(0);
    // The key repeats while it is held, kept from the page.
    expect(down('F11', { repeat: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(1);
    expect(overlay().leaving).toBe(true);
    await mainLeaves();
    expect(useFullScreen.getState()).toEqual({ on: false, focus: null });
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(reached).toEqual([]);
  });

  it('times the hold by what focus mode was entered with: 30 s, not 15', async () => {
    useFullScreen.setState({ on: true, focus: { holdSeconds: 30 } });
    down('F11');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(released).toBe(0);
    expect(overlay().holding).toBe('F11');
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(1);
  });

  /* focus.2: the two short holds, timed by the press as the others are; 5 s the default since focus.3. */
  it('times the hold by what focus mode was entered with: 5 s, the shortest and the default, and 10 s', async () => {
    useFullScreen.setState({ on: true, focus: { holdSeconds: 5 } });
    down('F11');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(released).toBe(0);
    expect(overlay().holding).toBe('F11');
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(1);
    await mainLeaves();
    expect(up('F11')).toBe(true);
    useFullScreen.setState({ on: true, focus: { holdSeconds: 10 } });
    down('Escape');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(released).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(2);
    expect(reached).toEqual([]);
  });

  it('closes when the key is let go early, and starts the count over next time', async () => {
    down('F11');
    await vi.advanceTimersByTimeAsync(5000);
    expect(up('F11')).toBe(true);
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(released).toBe(0);
    const again = Date.now();
    down('F11');
    expect(overlay().since).toBe(again);
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000 - 1);
    expect(released).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(1);
    expect(reached).toEqual([]);
  });

  it('closes on any other key, which never reaches the page: its press, its repeats or its release', async () => {
    down('F11');
    expect(down('a')).toBe(true);
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(down('a', { repeat: true })).toBe(true);
    expect(up('a')).toBe(true);
    // The F11 still held is the overlay's too, until it is let go.
    expect(down('F11', { repeat: true })).toBe(true);
    expect(up('F11')).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(released).toBe(0);
    expect(reached).toEqual([]);
    // Pressed afresh, a key is the page's again.
    expect(down('a')).toBe(false);
    expect(reached).toEqual(['keydown a']);
  });

  it('closes on a click anywhere and on the window losing the focus', () => {
    down('F11');
    resumeFocus();
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(up('F11')).toBe(true);
    down('Escape');
    expect(overlay().holding).toBe('Escape');
    target.dispatchEvent(new Event('blur'));
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(released).toBe(0);
  });

  it('starts on Escape only when nothing else takes it', () => {
    takers = { ...NOTHING, find: true };
    expect(down('Escape')).toBe(false);
    expect(overlay().open).toBe(false);
    expect(reached).toEqual(['keydown Escape']);
    takers = NOTHING;
    expect(down('Escape')).toBe(true);
    expect(overlay().holding).toBe('Escape');
  });

  it('never starts on a key held from before, nor on F11 or Escape with a modifier', () => {
    expect(down('F11', { repeat: true })).toBe(true);
    expect(down('Escape', { repeat: true })).toBe(true);
    expect(overlay().open).toBe(false);
    expect(down('F11', { shiftKey: true })).toBe(false);
    expect(down('Escape', { ctrlKey: true })).toBe(false);
    expect(overlay().open).toBe(false);
    expect(reached).toEqual(['keydown F11', 'keydown Escape']);
  });

  it('waits, opened by the button, until F11 or Escape is pressed afresh, and closes on any other key', async () => {
    showFocusOverlay();
    expect(overlay()).toEqual({ ...FOCUS_OVERLAY_CLOSED, open: true });
    expect(down('Escape', { repeat: true })).toBe(true);
    expect(overlay().holding).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(overlay().open).toBe(true);
    expect(released).toBe(0);
    expect(down('Escape')).toBe(true);
    expect(overlay().holding).toBe('Escape');
    // The other hold key pressed with it changes nothing.
    expect(down('F11')).toBe(true);
    expect(overlay().holding).toBe('Escape');
    expect(up('F11')).toBe(true);
    expect(overlay().open).toBe(true);
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000);
    expect(released).toBe(1);
    expect(reached).toEqual([]);
  });

  it('keeps an Escape held past the end of the hold from the page until it is let go', async () => {
    down('Escape');
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000);
    await mainLeaves();
    expect(overlay().open).toBe(false);
    expect(down('Escape', { repeat: true })).toBe(true);
    expect(down('Escape', { repeat: true })).toBe(true);
    expect(up('Escape')).toBe(true);
    expect(reached).toEqual([]);
    // Out of focus mode, a fresh Escape is the page's.
    expect(down('Escape')).toBe(false);
    expect(reached).toEqual(['keydown Escape']);
  });

  it('keeps every key from the page while main is asked to leave', async () => {
    down('F11');
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000);
    expect(overlay().leaving).toBe(true);
    expect(down('a')).toBe(true);
    expect(overlay().leaving).toBe(true);
    resumeFocus();
    target.dispatchEvent(new Event('blur'));
    expect(overlay().leaving).toBe(true);
    await mainLeaves();
    expect(overlay().open).toBe(false);
    expect(reached).toEqual([]);
  });

  it('says so in a card, and closes, when main cannot be asked', async () => {
    down('F11');
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000);
    releaseAnswer?.reject(new Error('The window has gone.'));
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(notes).toEqual(['Focus mode could not be left: The window has gone.']);
    expect(useFullScreen.getState().focus).toEqual(HOLD);
  });

  it('closes when main leaves focus mode on its own', () => {
    down('F11');
    useFullScreen.setState({ on: false, focus: null });
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
  });

  it('stops listening, and closes an overlay left open, when uninstalled', () => {
    down('F11');
    uninstall();
    uninstall = () => undefined;
    expect(overlay()).toEqual(FOCUS_OVERLAY_CLOSED);
    expect(down('F11')).toBe(false);
    expect(reached).toEqual(['keydown F11']);
  });
});

describe('a close or Restart now waiting on the hold (holdToLeave, focus.1)', () => {
  it('needs no hold outside focus mode', () => {
    useFullScreen.setState({ on: true, focus: null });
    expect(holdToLeave()).toBeNull();
    expect(overlay().open).toBe(false);
  });

  it('opens the overlay and goes on once the hold has left focus mode', async () => {
    const waiting = holdToLeave();
    expect(waiting).not.toBeNull();
    expect(overlay()).toEqual({ ...FOCUS_OVERLAY_CLOSED, open: true });
    down('F11');
    await vi.advanceTimersByTimeAsync(HOLD.holdSeconds * 1000);
    await mainLeaves();
    await expect(waiting).resolves.toBe(true);
  });

  it('stops when the overlay is closed instead', async () => {
    const waiting = holdToLeave();
    down('x');
    await expect(waiting).resolves.toBe(false);
    expect(useFullScreen.getState().focus).toEqual(HOLD);
  });

  it('joins a hold under way, and goes on when main leaves focus mode on its own', async () => {
    down('F11');
    const waiting = holdToLeave();
    expect(overlay().holding).toBe('F11');
    useFullScreen.setState({ on: false, focus: null });
    await expect(waiting).resolves.toBe(true);
  });
});

describe('focusKeyDown alone', () => {
  it('keeps a key from the page with preventDefault and stopImmediatePropagation', () => {
    const calls: string[] = [];
    focusKeyDown({
      key: 'F11',
      code: 'F11',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: () => void calls.push('preventDefault'),
      stopImmediatePropagation: () => void calls.push('stopImmediatePropagation')
    });
    expect(calls).toEqual(['preventDefault', 'stopImmediatePropagation']);
    expect(overlay().holding).toBe('F11');
  });
});
