import { describe, expect, it } from 'vitest';
import {
  dialogTakesEscape,
  focusReturnTarget,
  inOtherDialog,
  MANUAL_REVIEW_BUTTON_SELECTOR,
  NEW_CHAPTER_BUTTON_SELECTOR,
  REVIEW_BUTTON_SELECTOR,
  SETTINGS_BUTTON_SELECTOR,
  shellInert,
  type DialogOwner,
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

  it('leaves Escape pressed in another dialog, such as a question over it, to that dialog', () => {
    expect(dialogTakesEscape(escape, false, true)).toBe(false);
  });

  it('lets Escape end an IME composition without closing the dialog', () => {
    expect(dialogTakesEscape({ ...escape, isComposing: true }, false, false)).toBe(false);
  });
});

describe('inOtherDialog (ui.1 review)', () => {
  // A dialog element as the rule sees it: what it holds, by identity.
  const dialog = (...holds: object[]): DialogOwner => ({
    contains: (node) => holds.includes(node as object)
  });
  const box = { name: 'Settings box' };

  it('counts a key pressed outside every dialog as no other dialog', () => {
    expect(inOtherDialog(null, box)).toBe(false);
  });

  it('counts a key pressed in the dialog itself, whose backdrop holds its box, as its own', () => {
    expect(inOtherDialog(dialog(box), box)).toBe(false);
  });

  it('counts a key pressed in a dialog that does not hold the box, such as a question over it, as another', () => {
    expect(inOtherDialog(dialog({ name: 'question box' }), box)).toBe(true);
    expect(inOtherDialog(dialog(), box)).toBe(true);
  });

  it('counts any dialog as another when there is no box to compare', () => {
    expect(inOtherDialog(dialog(box), null)).toBe(true);
    expect(inOtherDialog(dialog(box), undefined)).toBe(true);
    expect(inOtherDialog(null, null)).toBe(false);
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

  it('names the opener of each other dialog as its fallback, one selector each (ui.4)', () => {
    expect(REVIEW_BUTTON_SELECTOR).toBe('[data-opens="review"]');
    expect(MANUAL_REVIEW_BUTTON_SELECTOR).toBe('[data-opens="manual-review"]');
    expect(NEW_CHAPTER_BUTTON_SELECTOR).toBe('[data-opens="new-chapter"]');
    const all = [
      SETTINGS_BUTTON_SELECTOR,
      REVIEW_BUTTON_SELECTOR,
      MANUAL_REVIEW_BUTTON_SELECTOR,
      NEW_CHAPTER_BUTTON_SELECTOR
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

/* ui.4 (found by theme.8's Tab walk): Tab from a dialog's last control went
   on to the toolbar behind its backdrop, and Shift+Tab from its first to the
   status bar's Zoom in. */
describe('shellInert (ui.4)', () => {
  it('leaves everything live with nothing open', () => {
    expect(shellInert({ dialog: false, question: false })).toEqual({ page: false, dialogs: false });
  });

  it('makes the page inert under a dialog, and leaves the dialogs live', () => {
    expect(shellInert({ dialog: true, question: false })).toEqual({ page: true, dialogs: false });
  });

  it('makes the page and the dialogs inert under a question, with or without a dialog open', () => {
    expect(shellInert({ dialog: false, question: true })).toEqual({ page: true, dialogs: true });
    expect(shellInert({ dialog: true, question: true })).toEqual({ page: true, dialogs: true });
  });

  it('never leaves the page live while anything covers it, nor makes a dialog inert with no question over it', () => {
    for (const dialog of [false, true]) {
      for (const question of [false, true]) {
        const inert = shellInert({ dialog, question });
        expect(inert.page, `dialog ${dialog}, question ${question}`).toBe(dialog || question);
        expect(inert.dialogs, `dialog ${dialog}, question ${question}`).toBe(question);
      }
    }
  });
});
