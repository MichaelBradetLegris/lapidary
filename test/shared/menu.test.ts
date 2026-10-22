import { describe, expect, it } from 'vitest';
import {
  ACTIONS_MENU,
  firstEnabled,
  lastEnabled,
  menuButtonKey,
  menuItemKey,
  nextEnabled,
  REVIEW_MENU,
  WITH_AI_IN_MENU,
  type MenuKey
} from '../../src/shared/ui/menu';

/* polish.7: the toolbar's Review and Actions menus. The keys of a proper
   menu, worked out here and applied by src/renderer/components/ToolbarMenu.tsx;
   the window walk is in PLAN (polish.7). */

const key = (k: string, extra: Partial<MenuKey> = {}): MenuKey => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...extra
});

const ACTIONS = ['Accept all', 'Dismiss all', 'Reset', 'Copy result', 'Show backups'];
const ALL = [true, true, true, true, true];
// While a paragraph is open for editing, the bulk items wait.
const EDITING = [false, false, false, true, true];

describe('the menus and their names (polish.7)', () => {
  it('names Review, its two items, and Actions', () => {
    expect(REVIEW_MENU).toEqual({ label: 'Review', withAi: 'With AI', manual: 'Manual' });
    expect(ACTIONS_MENU).toBe('Actions');
    expect(WITH_AI_IN_MENU).toBe('With AI, in the Review menu,');
  });
});

describe('nextEnabled, firstEnabled and lastEnabled', () => {
  it('steps to the next item that can be used, round the end of the list', () => {
    expect(nextEnabled(ALL, 0, 1)).toBe(1);
    expect(nextEnabled(ALL, 4, 1)).toBe(0);
    expect(nextEnabled(ALL, 0, -1)).toBe(4);
    expect(nextEnabled(EDITING, 4, 1)).toBe(3);
    expect(nextEnabled(EDITING, 3, -1)).toBe(4);
  });

  it('starts from before the first and after the last', () => {
    expect(nextEnabled(ALL, -1, 1)).toBe(0);
    expect(nextEnabled(ALL, ALL.length, -1)).toBe(4);
    expect(firstEnabled(EDITING)).toBe(3);
    expect(lastEnabled([true, true, false])).toBe(1);
  });

  it('finds nothing in a list with nothing to use, or no list', () => {
    expect(nextEnabled([false, false], 0, 1)).toBe(-1);
    expect(firstEnabled([])).toBe(-1);
    expect(lastEnabled([false])).toBe(-1);
  });

  it('comes back to the one item there is', () => {
    expect(nextEnabled([false, true, false], 1, 1)).toBe(1);
    expect(nextEnabled([false, true, false], 1, -1)).toBe(1);
  });
});

describe('menuItemKey: a key pressed in the open list', () => {
  it('moves with the arrows, round from the last to the first and back', () => {
    expect(menuItemKey(key('ArrowDown'), 0, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 1 });
    expect(menuItemKey(key('ArrowDown'), 4, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 0 });
    expect(menuItemKey(key('ArrowUp'), 0, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 4 });
    expect(menuItemKey(key('ArrowUp'), 2, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 1 });
  });

  it('skips the items that cannot be used now', () => {
    expect(menuItemKey(key('ArrowDown'), 4, EDITING, ACTIONS)).toEqual({ kind: 'focus', index: 3 });
    expect(menuItemKey(key('ArrowUp'), 3, EDITING, ACTIONS)).toEqual({ kind: 'focus', index: 4 });
    expect(menuItemKey(key('Home'), 4, EDITING, ACTIONS)).toEqual({ kind: 'focus', index: 3 });
  });

  it('starts at the first or the last when no item has the focus', () => {
    expect(menuItemKey(key('ArrowDown'), -1, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 0 });
    expect(menuItemKey(key('ArrowUp'), -1, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 4 });
  });

  it('goes to the first and the last with Home and End', () => {
    expect(menuItemKey(key('Home'), 3, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 0 });
    expect(menuItemKey(key('End'), 0, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 4 });
  });

  it('closes on Escape, giving the focus back to the button, and leaves on Tab, forwards or back', () => {
    expect(menuItemKey(key('Escape'), 2, ALL, ACTIONS)).toEqual({ kind: 'close' });
    expect(menuItemKey(key('Tab'), 2, ALL, ACTIONS)).toEqual({ kind: 'leave' });
    // Shift is not read: Shift+Tab leaves too, and the browser goes back from the button.
    const shiftTab = { ...key('Tab'), shiftKey: true } as MenuKey;
    expect(menuItemKey(shiftTab, 2, ALL, ACTIONS)).toEqual({ kind: 'leave' });
  });

  it('goes to the next item a letter starts, in either case, after the focused one', () => {
    expect(menuItemKey(key('c'), 0, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 3 });
    expect(menuItemKey(key('S'), 0, ALL, ACTIONS)).toEqual({ kind: 'focus', index: 4 });
    expect(menuItemKey(key('w'), 1, [true, true], ['With AI', 'Manual'])).toEqual({
      kind: 'focus',
      index: 0
    });
    // Two items starting with the same letter: each press goes on to the next.
    const two = ['Dismiss all', 'Delete', 'Reset'];
    expect(menuItemKey(key('d'), 0, [true, true, true], two)).toEqual({ kind: 'focus', index: 1 });
    expect(menuItemKey(key('d'), 1, [true, true, true], two)).toEqual({ kind: 'focus', index: 0 });
  });

  it('takes a letter no item starts with, or one whose item cannot be used, so it never acts on the chapter', () => {
    // a accepts the focused suggestion and j moves it, behind the menu.
    expect(menuItemKey(key('j'), 0, ALL, ACTIONS)).toEqual({ kind: 'swallow' });
    expect(menuItemKey(key('a'), 4, EDITING, ACTIONS)).toEqual({ kind: 'swallow' });
    expect(menuItemKey(key('ArrowDown'), -1, [false, false], ['A', 'B'])).toEqual({ kind: 'swallow' });
  });

  it('leaves Enter and Space to the item, and Ctrl, Alt and Meta keys to the page', () => {
    expect(menuItemKey(key('Enter'), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    expect(menuItemKey(key(' '), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    // Ctrl+S saves from anywhere (keyboard.ts).
    expect(menuItemKey(key('s', { ctrlKey: true }), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    expect(menuItemKey(key('ArrowDown', { altKey: true }), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    expect(menuItemKey(key('c', { metaKey: true }), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    expect(menuItemKey(key('Tab', { ctrlKey: true }), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
    expect(menuItemKey(key('F5'), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
  });

  it('leaves a key that ends an IME composition alone', () => {
    expect(menuItemKey(key('Escape', { isComposing: true }), 0, ALL, ACTIONS)).toEqual({ kind: 'pass' });
  });
});

describe('menuButtonKey: a key pressed on the menu button', () => {
  it('opens the list on its first item with the down arrow and on its last with the up arrow', () => {
    expect(menuButtonKey(key('ArrowDown'))).toBe('first');
    expect(menuButtonKey(key('ArrowUp'))).toBe('last');
  });

  it('leaves Enter and Space to the button, which opens on the first item, and every other key to the page', () => {
    for (const k of ['Enter', ' ', 'Escape', 'Tab', 'j', 'a', 'ArrowLeft']) {
      expect(menuButtonKey(key(k)), k).toBeNull();
    }
    expect(menuButtonKey(key('ArrowDown', { ctrlKey: true }))).toBeNull();
    expect(menuButtonKey(key('ArrowDown', { isComposing: true }))).toBeNull();
  });
});
