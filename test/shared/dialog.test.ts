import { describe, expect, it } from 'vitest';
import {
  dialogTakesEscape,
  firstFound,
  focusBeforeOpening,
  focusReturnTarget,
  inOtherDialog,
  NEW_CHAPTER_BUTTON_SELECTOR,
  REVIEW_BUTTON_SELECTOR,
  SETTINGS_BUTTON_SELECTOR,
  shellInert,
  UPDATE_CARD_BUTTON_SELECTOR,
  UPDATE_OVERLAY_FOCUS_FALLBACK,
  type DialogOwner,
  type Focusable
} from '../../src/shared/ui/dialog';

/* ui.1 (found by the M5 review): Escape did not close Settings, and the focus
   stayed on the toolbar behind it. These are the rules the dialog hooks apply;
   the hooks themselves are checked in test/renderer/dialog.test.ts. */

const escape = { key: 'Escape', isComposing: false, defaultPrevented: false };
const NOTHING = { question: false, overlay: false };
const QUESTION = { question: true, overlay: false };
const OVERLAY = { question: false, overlay: true };

describe('dialogTakesEscape (ui.1)', () => {
  it('closes the dialog on Escape with nothing over it', () => {
    expect(dialogTakesEscape(escape, NOTHING, false)).toBe(true);
  });

  it('ignores every other key', () => {
    for (const key of ['Enter', 'f', 'a', 'ArrowDown', 'Esc', 'escape']) {
      expect(dialogTakesEscape({ ...escape, key }, NOTHING, false), key).toBe(false);
    }
  });

  it('leaves Escape to a question asked over the dialog', () => {
    expect(dialogTakesEscape(escape, QUESTION, false)).toBe(false);
  });

  it('stays open when the question answered first and has gone by the time it looks', () => {
    // The question cancels on Escape and calls preventDefault, so a dialog
    // whose listener runs after it does not close as well.
    expect(dialogTakesEscape({ ...escape, defaultPrevented: true }, NOTHING, false)).toBe(false);
  });

  it('leaves Escape pressed in another dialog, such as a question over it, to that dialog', () => {
    expect(dialogTakesEscape(escape, NOTHING, true)).toBe(false);
  });

  it('lets Escape end an IME composition without closing the dialog', () => {
    expect(dialogTakesEscape({ ...escape, isComposing: true }, NOTHING, false)).toBe(false);
  });

  /* release.9 review: Escape under Restart now's overlay closed About, the one
     dialog Restart now can be pressed from. The key is pressed on the
     overlay's box, which is no role="dialog", so inOtherDialog said no. */
  it("leaves the dialog open under Restart now's overlay, with or without a question over both", () => {
    expect(dialogTakesEscape(escape, OVERLAY, false)).toBe(false);
    expect(dialogTakesEscape(escape, { question: true, overlay: true }, false)).toBe(false);
    expect(dialogTakesEscape(escape, OVERLAY, true)).toBe(false);
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

describe('firstFound (release.9 review)', () => {
  // A page as querySelector sees it: the selectors it finds, in the page's order.
  const page =
    (...present: string[]) =>
    (selector: string) =>
      present.includes(selector) ? selector : null;

  it('takes the first selector found in the order given, not the order of the page', () => {
    expect(firstFound(['a', 'b', 'c'], page('c', 'b'))).toBe('b');
    expect(firstFound(['a', 'b', 'c'], page('c'))).toBe('c');
    expect(
      firstFound(UPDATE_OVERLAY_FOCUS_FALLBACK, page(SETTINGS_BUTTON_SELECTOR, '.app-shell__dialogs .modal'))
    ).toBe('.app-shell__dialogs .modal');
  });

  it('takes one selector as a list of one, and finds nothing when nothing is there', () => {
    expect(firstFound(SETTINGS_BUTTON_SELECTOR, page(SETTINGS_BUTTON_SELECTOR))).toBe(
      SETTINGS_BUTTON_SELECTOR
    );
    expect(firstFound(SETTINGS_BUTTON_SELECTOR, page())).toBeNull();
    expect(firstFound(['a', 'b'], page())).toBeNull();
    expect(firstFound([], page('a'))).toBeNull();
  });

  it('asks for no selector after the first one found', () => {
    const asked: string[] = [];
    firstFound(['a', 'b', 'c'], (s) => {
      asked.push(s);
      return s === 'b' ? s : null;
    });
    expect(asked).toEqual(['a', 'b']);
  });
});

/* release.9 review: in a development window the focus never went back where
   it was, only to each dialog's fallback, because StrictMode opens a dialog
   twice and the second time the focus was in the dialog already. */
describe('focusBeforeOpening (release.9 review)', () => {
  const button = { name: 'Restart now' };
  const box = { name: 'overlay box' };

  it('notes what has the focus as the dialog opens', () => {
    expect(focusBeforeOpening(button, false, null)).toBe(button);
    expect(focusBeforeOpening(null, false, button)).toBeNull();
  });

  it('keeps what it noted when the focus is in the dialog already, as on StrictMode’s second opening', () => {
    expect(focusBeforeOpening(box, true, button)).toBe(button);
    expect(focusBeforeOpening(box, true, null)).toBeNull();
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

  it("hands the focus from Restart now's overlay to a dialog's box, the update card's button or Settings, in that order (release.9 review)", () => {
    expect(UPDATE_CARD_BUTTON_SELECTOR).toBe('.note--update .note__action');
    expect(UPDATE_OVERLAY_FOCUS_FALLBACK).toEqual([
      '.app-shell__dialogs .modal',
      UPDATE_CARD_BUTTON_SELECTOR,
      SETTINGS_BUTTON_SELECTOR
    ]);
  });

  /* polish.7: Review with AI and Submit manual review both open from the
     toolbar's Review menu, so they share its selector. */
  it('names the opener of each other dialog as its fallback, one selector each (ui.4)', () => {
    expect(REVIEW_BUTTON_SELECTOR).toBe('[data-opens="review"]');
    expect(NEW_CHAPTER_BUTTON_SELECTOR).toBe('[data-opens="new-chapter"]');
    const all = [SETTINGS_BUTTON_SELECTOR, REVIEW_BUTTON_SELECTOR, NEW_CHAPTER_BUTTON_SELECTOR];
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

  it("makes the page and the dialogs inert under Restart now's overlay (release.9)", () => {
    for (const dialog of [false, true]) {
      for (const question of [false, true]) {
        expect(shellInert({ dialog, question, overlay: true })).toEqual({ page: true, dialogs: true });
        expect(shellInert({ dialog, question, overlay: false })).toEqual(shellInert({ dialog, question }));
      }
    }
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
