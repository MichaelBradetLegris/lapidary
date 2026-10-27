import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_HOLD_SECONDS,
  FOCUS_HOLD_SECONDS,
  FOCUS_OVERLAY_TITLE,
  FOCUS_RING_LABEL,
  focusCount,
  focusCountSpoken,
  focusHoldLabel,
  focusModeKey,
  focusOverlayLines,
  holdKeyOf,
  holdProgress,
  normalizeFocusHold,
  overlayKey
} from '../../src/shared/ui/focusMode';
import type { EscapeTakers, FullScreenKey } from '../../src/shared/ui/fullScreen';

/* focus.1: focus mode's rules, pure. The hold times, the overlay's words,
   count and ring, and what each key does in focus mode with the overlay
   closed and while it shows. Main's window driver is
   test/main/fullScreen.test.ts, the page's half test/renderer/focusMode.test.ts. */

function key(name: string, extra: Partial<FullScreenKey> = {}): FullScreenKey {
  return {
    key: name,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    ...extra
  };
}

const NOTHING: EscapeTakers = {
  modal: false,
  popup: false,
  hoverCard: false,
  find: false,
  editor: false,
  boxes: false,
  drawer: false
};

const MODIFIERS = ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'] as const;

describe('the hold times', () => {
  /* focus.2: 5 and 10 seconds added, 10 the default (30 until then). */
  it('are 5, 10, 15, 30 and 60 seconds, shortest first, 10 by default', () => {
    expect(FOCUS_HOLD_SECONDS).toEqual([5, 10, 15, 30, 60]);
    expect(DEFAULT_FOCUS_HOLD_SECONDS).toBe(10);
    expect(FOCUS_HOLD_SECONDS.map(focusHoldLabel)).toEqual([
      '5 seconds',
      '10 seconds',
      '15 seconds',
      '30 seconds',
      '60 seconds'
    ]);
  });

  it('keep a time Settings offers, and take the default for anything else', () => {
    for (const seconds of FOCUS_HOLD_SECONDS) expect(normalizeFocusHold(seconds)).toBe(seconds);
    const others: unknown[] = [0, 1, 4, 6, 9, 11, 20, 29, 31, 45, 90, -5, -10, 5.5, 10.5, NaN, Infinity];
    others.push('5', '10', true, null, undefined, {}, [10], [5]);
    others.forEach((other, i) => expect(normalizeFocusHold(other), `others[${i}]`).toBe(10));
  });

  it('keep the times focus.1 offered, 30, its default, among them, rather than take the new default', () => {
    expect(normalizeFocusHold(15)).toBe(15);
    expect(normalizeFocusHold(30)).toBe(30);
    expect(normalizeFocusHold(60)).toBe(60);
  });
});

describe("the overlay's words", () => {
  it("are the task's, the time set in the hold line", () => {
    expect([FOCUS_OVERLAY_TITLE, ...focusOverlayLines(30)].join(' ')).toBe(
      "You're in focus mode. Are you sure you want to exit? Hold F11 or Esc for 30 seconds to exit. Press any other key or click to resume."
    );
    expect(focusOverlayLines(15)[1]).toBe('Hold F11 or Esc for 15 seconds to exit.');
    expect(focusOverlayLines(60)[1]).toBe('Hold F11 or Esc for 60 seconds to exit.');
    // focus.2: the two short times, in the same words.
    expect(focusOverlayLines(5)[1]).toBe('Hold F11 or Esc for 5 seconds to exit.');
    expect(focusOverlayLines(10)[1]).toBe('Hold F11 or Esc for 10 seconds to exit.');
    for (const seconds of FOCUS_HOLD_SECONDS) {
      expect(focusOverlayLines(seconds)).toEqual([
        'Are you sure you want to exit?',
        `Hold F11 or Esc for ${focusHoldLabel(seconds)} to exit.`,
        'Press any other key or click to resume.'
      ]);
    }
  });

  it('count, fill and speak the two short times as the others (focus.2)', () => {
    expect(focusCount(0, 5)).toBe('0 / 5 s');
    expect(focusCount(4_999, 5)).toBe('4 / 5 s');
    expect(focusCount(5_000, 5)).toBe('5 / 5 s');
    expect(focusCount(9_000, 5)).toBe('5 / 5 s');
    expect(focusCount(7_500, 10)).toBe('7 / 10 s');
    expect(holdProgress(2_500, 5)).toBe(0.5);
    expect(holdProgress(5_000, 5)).toBe(1);
    expect(holdProgress(2_500, 10)).toBe(0.25);
    expect(focusCountSpoken(3_200, 5)).toBe('3 of 5 seconds held');
    expect(focusCountSpoken(12_000, 10)).toBe('10 of 10 seconds held');
  });

  it('count whole seconds held, of the time set, as "12 / 30 s"', () => {
    expect(focusCount(0, 30)).toBe('0 / 30 s');
    expect(focusCount(999, 30)).toBe('0 / 30 s');
    expect(focusCount(12_000, 30)).toBe('12 / 30 s');
    expect(focusCount(12_999, 30)).toBe('12 / 30 s');
    expect(focusCount(30_000, 30)).toBe('30 / 30 s');
    expect(focusCount(45_000, 30)).toBe('30 / 30 s');
    expect(focusCount(-500, 15)).toBe('0 / 15 s');
    expect(focusCount(14_000, 15)).toBe('14 / 15 s');
  });

  it('give the ring a name and a spoken value', () => {
    expect(FOCUS_RING_LABEL).toBe('Time held');
    expect(focusCountSpoken(12_400, 30)).toBe('12 of 30 seconds held');
    expect(focusCountSpoken(70_000, 60)).toBe('60 of 60 seconds held');
  });

  it('fill the ring from 0 to 1 as the time runs, and no further', () => {
    expect(holdProgress(0, 30)).toBe(0);
    expect(holdProgress(15_000, 30)).toBe(0.5);
    expect(holdProgress(15_000, 60)).toBe(0.25);
    expect(holdProgress(30_000, 30)).toBe(1);
    expect(holdProgress(31_000, 30)).toBe(1);
    expect(holdProgress(-1, 15)).toBe(0);
  });
});

describe('the hold keys', () => {
  it('are F11 and Escape alone, with no modifier and no composition', () => {
    expect(holdKeyOf(key('F11'))).toBe('F11');
    expect(holdKeyOf(key('Escape'))).toBe('Escape');
    for (const modifier of MODIFIERS) {
      expect(holdKeyOf(key('F11', { [modifier]: true })), modifier).toBeNull();
      expect(holdKeyOf(key('Escape', { [modifier]: true })), modifier).toBeNull();
    }
    expect(holdKeyOf(key('Escape', { isComposing: true }))).toBeNull();
    for (const other of ['Esc', 'F10', 'F12', 'f11', 'Enter', ' ', 'a', 'Shift', 'Alt', 'Tab']) {
      expect(holdKeyOf(key(other)), other).toBeNull();
    }
  });
});

describe('a key in focus mode, the overlay closed', () => {
  it('starts the hold on a fresh F11, wherever the focus is', () => {
    expect(focusModeKey(key('F11'), NOTHING)).toBe('hold');
    expect(focusModeKey(key('F11'), { ...NOTHING, modal: true, boxes: true })).toBe('hold');
  });

  it('keeps a held F11 from the page without starting a hold: a hold starts on a fresh press', () => {
    expect(focusModeKey(key('F11', { repeat: true }), NOTHING)).toBe('swallow');
  });

  it('starts the hold on a fresh Escape when nothing else takes it, and keeps its repeats', () => {
    expect(focusModeKey(key('Escape'), NOTHING)).toBe('hold');
    expect(focusModeKey(key('Escape', { repeat: true }), NOTHING)).toBe('swallow');
  });

  it('leaves Escape to whatever else takes it, one thing at a time', () => {
    for (const taker of Object.keys(NOTHING) as (keyof EscapeTakers)[]) {
      expect(focusModeKey(key('Escape'), { ...NOTHING, [taker]: true }), taker).toBe('pass');
    }
    expect(focusModeKey(key('Escape', { defaultPrevented: true }), NOTHING)).toBe('pass');
  });

  it('leaves F11 or Escape with a modifier, and every other key, to the page', () => {
    for (const modifier of MODIFIERS) {
      expect(focusModeKey(key('F11', { [modifier]: true }), NOTHING), modifier).toBe('pass');
      expect(focusModeKey(key('Escape', { [modifier]: true }), NOTHING), modifier).toBe('pass');
    }
    for (const other of ['a', 'j', 'Enter', 'F10', 'F12', 'Tab', 'Alt', 'ArrowDown']) {
      expect(focusModeKey(key(other), NOTHING), other).toBe('pass');
    }
  });
});

describe('a key while the overlay shows', () => {
  it('starts the count on a fresh F11 or Escape while it waits', () => {
    expect(overlayKey(key('F11'), null)).toBe('hold');
    expect(overlayKey(key('Escape'), null)).toBe('hold');
  });

  it('changes nothing for the key held, repeating, or the other hold key, or a key held from before', () => {
    expect(overlayKey(key('F11', { repeat: true }), 'F11')).toBe('keep');
    expect(overlayKey(key('Escape'), 'F11')).toBe('keep');
    expect(overlayKey(key('F11'), 'Escape')).toBe('keep');
    expect(overlayKey(key('Escape', { repeat: true }), null)).toBe('keep');
  });

  it('resumes on any other key, a hold key with a modifier included, holding or waiting', () => {
    for (const holding of [null, 'F11', 'Escape'] as const) {
      for (const other of ['a', 'Enter', ' ', 'Shift', 'Alt', 'Control', 'Meta', 'Tab', 'F10', 'F4']) {
        expect(overlayKey(key(other), holding), `${other} ${holding}`).toBe('resume');
      }
      for (const modifier of MODIFIERS) {
        expect(overlayKey(key('F11', { [modifier]: true }), holding), modifier).toBe('resume');
      }
      expect(overlayKey(key('Escape', { isComposing: true }), holding)).toBe('resume');
    }
  });
});
