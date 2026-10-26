import { describe, expect, it } from 'vitest';
import {
  FULL_SCREEN_ACTIONS,
  FULL_SCREEN_CLASS,
  FULL_SCREEN_KEY,
  escapeLeavesFullScreen,
  fullScreenButton,
  fullScreenToggle,
  isFullScreenAction,
  type EscapeTakers,
  type FullScreenKey
} from '../../src/shared/ui/fullScreen';

/* polish.23: full screen by F11 and a button before Settings. The page asks
   main (`window:full-screen`) and never uses its own Fullscreen API; F11
   toggles wherever the focus is, and Escape leaves when nothing else on the
   page takes it. Main's half is test/main/fullScreen.test.ts, the button and
   the wiring test/renderer/fullScreen.render.test.ts. */

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

describe('the words', () => {
  it('names the button by what it does, with F11 in the tooltip', () => {
    expect(fullScreenButton(false)).toEqual({ label: 'Full screen', title: 'Full screen (F11)' });
    expect(fullScreenButton(true)).toEqual({ label: 'Leave full screen', title: 'Leave full screen (F11)' });
    expect(FULL_SCREEN_KEY).toBe('F11');
  });

  it('marks the shell with one class', () => {
    expect(FULL_SCREEN_CLASS).toBe('app-shell--full-screen');
  });
});

describe('what the page may ask of main', () => {
  it('is toggle, leave or current, and nothing else', () => {
    expect(FULL_SCREEN_ACTIONS).toEqual(['toggle', 'leave', 'current']);
    for (const action of FULL_SCREEN_ACTIONS) expect(isFullScreenAction(action), action).toBe(true);
    for (const other of ['enter', 'Toggle', '', ' toggle', null, undefined, 1, true, {}, ['toggle']]) {
      expect(isFullScreenAction(other), JSON.stringify(other)).toBe(false);
    }
  });
});

describe('F11', () => {
  it('toggles alone, and does nothing more while held down', () => {
    expect(fullScreenToggle(key('F11'))).toBe('toggle');
    expect(fullScreenToggle(key('F11', { repeat: true }))).toBe('ignore');
  });

  it('leaves F11 with Ctrl, Alt, Shift or the Windows key, and every other key, to others', () => {
    for (const modifier of ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'] as const) {
      expect(fullScreenToggle(key('F11', { [modifier]: true })), modifier).toBe('pass');
    }
    for (const other of ['F10', 'F12', 'f', 'Escape', 'Enter', 'f11']) {
      expect(fullScreenToggle(key(other)), other).toBe('pass');
    }
  });
});

describe('Escape', () => {
  it('leaves full screen when nothing else takes it', () => {
    expect(escapeLeavesFullScreen(key('Escape'), true, NOTHING)).toBe(true);
  });

  it('does nothing out of full screen, where nothing is there to leave', () => {
    expect(escapeLeavesFullScreen(key('Escape'), false, NOTHING)).toBe(false);
  });

  it('waits behind everything that takes the key, one at a time', () => {
    for (const taker of Object.keys(NOTHING) as (keyof EscapeTakers)[]) {
      expect(escapeLeavesFullScreen(key('Escape'), true, { ...NOTHING, [taker]: true }), taker).toBe(false);
    }
  });

  it('does nothing once something has answered the key, or when it ends a composition', () => {
    expect(escapeLeavesFullScreen(key('Escape', { defaultPrevented: true }), true, NOTHING)).toBe(false);
    expect(escapeLeavesFullScreen(key('Escape', { isComposing: true }), true, NOTHING)).toBe(false);
  });

  it('is the only key that leaves: F11 toggles, and no other key does either', () => {
    for (const other of ['F11', 'Esc', 'Backspace', 'q', 'Enter']) {
      expect(escapeLeavesFullScreen(key(other), true, NOTHING), other).toBe(false);
    }
  });
});
