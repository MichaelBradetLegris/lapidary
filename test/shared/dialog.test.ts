import { describe, expect, it } from 'vitest';
import {
  dialogTakesEscape,
  focusReturnTarget,
  SETTINGS_BUTTON_SELECTOR,
  type Focusable
} from '../../src/shared/ui/dialog';

/* ui.1 (found by the M5 review): Escape did not close Settings, and the focus
   stayed on the toolbar behind it. These are the rules the dialog hooks apply;
   the hooks themselves are checked in test/renderer/dialog.test.ts. */

const escape = { key: 'Escape', isComposing: false, defaultPrevented: false };

describe('dialogTakesEscape (ui.1)', () => {
  it('closes the dialog on Escape with nothing over it', () => {
    expect(dialogTakesEscape(escape, false, false)).toBe(true);
  });

  it('ignores every other key', () => {
    for (const key of ['Enter', 'f', 'a', 'ArrowDown', 'Esc', 'escape']) {
      expect(dialogTakesEscape({ ...escape, key }, false, false), key).toBe(false);
    }
  });

  it('leaves Escape to a question asked over the dialog', () => {
    expect(dialogTakesEscape(escape, true, false)).toBe(false);
  });

  it('stays open when the question answered first and has gone by the time it looks', () => {
    // The question cancels on Escape and calls preventDefault, so a dialog
    // whose listener runs after it does not close as well.
    expect(dialogTakesEscape({ ...escape, defaultPrevented: true }, false, false)).toBe(false);
  });

  it('leaves Escape pressed in another dialog, the suggestion editor, to that dialog', () => {
    expect(dialogTakesEscape(escape, false, true)).toBe(false);
  });

  it('lets Escape end an IME composition without closing the dialog', () => {
    expect(dialogTakesEscape({ ...escape, isComposing: true }, false, false)).toBe(false);
  });
});

describe('focusReturnTarget (ui.1)', () => {
  const element = (isConnected: boolean): Focusable => ({ isConnected, focus: () => undefined });
  const body = element(true);

  it('goes back where the focus was when that is still on the page', () => {
    const previous = element(true);
    expect(focusReturnTarget(previous, body, element(true))).toBe(previous);
  });

  it('goes to the fallback when where it was has gone, or was nothing', () => {
    const fallback = element(true);
    expect(focusReturnTarget(element(false), body, fallback)).toBe(fallback);
    expect(focusReturnTarget(body, body, fallback)).toBe(fallback);
    expect(focusReturnTarget(null, body, fallback)).toBe(fallback);
  });

  it('moves nothing when the fallback is missing too', () => {
    expect(focusReturnTarget(element(false), body, null)).toBeNull();
    expect(focusReturnTarget(null, body, element(false))).toBeNull();
  });

  it('names the toolbar Settings button as the fallback for Settings', () => {
    expect(SETTINGS_BUTTON_SELECTOR).toBe('[data-opens="settings"]');
  });
});
