import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* ui.1 (found by the M5 review): Escape did not close Settings, and the focus
   stayed on the toolbar behind it. Settings now closes on Escape as Review
   with AI does, takes the focus as it opens and hands it back when it closes;
   Escape behind any dialog no longer closes the find bar or the suggestion
   editor out of sight. The ui.1 review found the suggestion editor drawn over
   every dialog and still working there; it is now under them, and inert while
   one is open. The rules are pure and tested in
   test/shared/dialog.test.ts; the hooks touch the DOM and are checked in their
   source, since the tests run without one. The window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

/** The z-index of the one rule for exactly `selector` that sets one, with at-rules flattened away. */
function zIndexOf(css: string, selector: string): number {
  const found: number[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if ((match[1] ?? '').trim() !== selector) continue;
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/.exec(match[2] ?? '');
    if (z) found.push(Number(z[1]));
  }
  expect(found, selector).toHaveLength(1);
  return found[0] ?? Number.NaN;
}

describe('Settings is a modal (ui.1)', () => {
  const settings = read('components/SettingsDialog.tsx');
  const dialog = read('state/dialog.ts');

  it('puts the Escape and focus hooks on its box, which can take the focus', () => {
    expect(settings).toContain('useDialogEscape(boxRef, onClose);');
    expect(settings).toContain('useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);');
    // Its own class since polish.4, for the head and the foot that stay in view.
    expect(settings).toContain('<div className="modal modal--settings" ref={boxRef} tabIndex={-1}>');
  });

  it('notes where the focus was, then moves it into the box, or onto the field given, as the dialog opens', () => {
    const hook = dialog.slice(dialog.indexOf('export function useDialogFocus'));
    const end = hook.indexOf('}, [box, first]);');
    expect(end).toBeGreaterThan(-1);
    const opening = hook.slice(hook.indexOf('useLayoutEffect('), end);
    const active = opening.indexOf(
      'const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;'
    );
    expect(active).toBeGreaterThan(-1);
    const noted = opening.indexOf(
      'returnTo.current = focusBeforeOpening(active, inDialog, returnTo.current);'
    );
    expect(noted).toBeGreaterThan(active);
    // release.9 review: the focus already in the box, as on StrictMode's second opening, keeps what was noted.
    expect(opening).toContain(
      'const inDialog = active !== null && (box.current?.contains(active) ?? false);'
    );
    expect(
      opening.indexOf('(first?.current ?? box.current)?.focus({ preventScroll: true });')
    ).toBeGreaterThan(noted);
  });

  it('hands the focus back in the cleanup that runs once the dialog has gone', () => {
    const hook = dialog.slice(dialog.indexOf('export function useDialogFocus'));
    const closing = hook.slice(hook.indexOf('useEffect('));
    expect(closing).toMatch(/^useEffect\(\s*\(\) => \(\) => \{/);
    const fallback = closing.indexOf(
      'const fallback = firstFound(fallbackSelector, (s) => document.querySelector<HTMLElement>(s));'
    );
    expect(fallback).toBeGreaterThan(-1);
    expect(
      closing.indexOf('focusReturnTarget(returnTo.current, document.body, fallback)?.focus(')
    ).toBeGreaterThan(fallback);
    // StrictMode's pretend close runs the cleanup too: where the focus was is kept for the real one.
    expect(closing).not.toContain('returnTo.current = null');
  });

  it('finds the dialog a key was pressed in by the nearest role="dialog" around it', () => {
    const helper = dialog.slice(
      dialog.indexOf('function pressedInOtherDialog'),
      dialog.indexOf('export function useDialogEscape')
    );
    expect(helper).toContain(
      'const owner = event.target instanceof Element ? event.target.closest(\'[role="dialog"]\') : null;'
    );
    expect(helper).toContain('return inOtherDialog(owner, box);');
  });

  it('hands the focus back to the toolbar button the selector finds', () => {
    expect(read('components/Toolbar.tsx')).toMatch(
      /<button type="button" data-opens="settings" onClick=\{onSettings\}>\s*Settings\s*<\/button>/
    );
  });

  it('listens on the window in the capture phase and stops the key there', () => {
    expect(dialog).toContain("window.addEventListener('keydown', onKeyDown, true);");
    const listener = dialog.slice(dialog.indexOf('const onKeyDown'));
    const guard = listener.indexOf(
      'if (!dialogTakesEscape(event, over, pressedInOtherDialog(event, box.current))) return;'
    );
    expect(guard).toBeGreaterThan(-1);
    const read = listener.indexOf('const { confirmSpec, updateOverlay } = useApp.getState();');
    const over = listener.indexOf('const over = { question: confirmSpec !== null, overlay: updateOverlay };');
    expect(read).toBeGreaterThan(-1);
    expect(over).toBeGreaterThan(read);
    expect(guard).toBeGreaterThan(over);
    expect(listener.indexOf('event.stopPropagation();')).toBeGreaterThan(guard);
    expect(listener.indexOf('close.current();')).toBeGreaterThan(
      listener.indexOf('event.stopPropagation();')
    );
  });

  /* release.9 review: Escape under Restart now's overlay closed About under
     it, since the overlay is a role="alertdialog" beside the dialogs' layer
     and the rule saw no other dialog. The listener now reads the overlay from
     the store, as it reads the question, when the key comes. */
  it("leaves the dialog open under Restart now's overlay, read from the store when the key comes", () => {
    const listener = dialog.slice(
      dialog.indexOf('const onKeyDown'),
      dialog.indexOf("window.addEventListener('keydown'")
    );
    expect(listener).toContain('updateOverlay');
    expect(listener).toContain('overlay: updateOverlay');
    expect(read('components/UpdateOverlay.tsx')).toContain('role="alertdialog"');
  });

  it('adds the listener once, so a re-render cannot put it after a question', () => {
    expect(dialog).toMatch(/window\.removeEventListener\('keydown', onKeyDown, true\);\s*\}, \[box\]\);/);
  });

  it('relies on the question calling preventDefault on the Escape it answers', () => {
    const confirm = read('components/ConfirmDialog.tsx');
    const handler = confirm.slice(confirm.indexOf("if (event.key === 'Escape')"));
    expect(handler.indexOf('event.preventDefault();')).toBeGreaterThan(-1);
    expect(handler.indexOf('event.preventDefault();')).toBeLessThan(handler.indexOf("answer('cancel');"));
  });

  it('gives Review with AI the same Escape', () => {
    const review = read('components/ReviewDialog.tsx');
    expect(review).toContain('useDialogEscape(boxRef, onClose);');
    expect(review).toContain('<div className="modal" ref={boxRef} tabIndex={-1}>');
    expect(review).not.toContain("addEventListener('keydown'");
  });
});

/* ui.4 (found by theme.8's Tab walk): Tab from a dialog's last control went
   on to the toolbar behind its backdrop, and Shift+Tab from its first to the
   status bar's Zoom in, in every dialog but the question. The page is now
   inert under each of them (`shellInert`, checked with App's layout in
   confirmDialog.test.ts), which leaves Tab nowhere to go but round the
   dialog; each takes the focus as it opens and hands it back to its opener
   when it closes. The window checks are in PLAN. */
describe('Every dialog takes the focus and hands it back (ui.4)', () => {
  const dialogs = [
    {
      file: 'components/SettingsDialog.tsx',
      hook: 'useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);',
      box: '<div className="modal modal--settings" ref={boxRef} tabIndex={-1}>'
    },
    {
      file: 'components/ReviewDialog.tsx',
      hook: 'useDialogFocus(boxRef, REVIEW_BUTTON_SELECTOR);',
      box: '<div className="modal" ref={boxRef} tabIndex={-1}>'
    },
    {
      // Opened from the Review menu's Manual, as Review with AI from its With AI (polish.7).
      file: 'components/ManualReviewDialog.tsx',
      hook: 'useDialogFocus(boxRef, REVIEW_BUTTON_SELECTOR);',
      box: '<div className="modal modal--wide" ref={boxRef} tabIndex={-1}>'
    },
    {
      file: 'components/NewChapterDialog.tsx',
      hook: 'useDialogFocus(boxRef, NEW_CHAPTER_BUTTON_SELECTOR, nameRef);',
      box: '<div className="modal" ref={boxRef} tabIndex={-1}>'
    },
    // About replaces Settings, so the focus goes back to Settings' toolbar button (release.9).
    {
      file: 'components/AboutDialog.tsx',
      hook: 'useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);',
      box: '<div className="modal modal--about" ref={boxRef} tabIndex={-1}>'
    },
    // Restart now's overlay hands the focus back to the Restart now pressed, when an install fails (release.9 review).
    {
      file: 'components/UpdateOverlay.tsx',
      hook: 'useDialogFocus(boxRef, UPDATE_OVERLAY_FOCUS_FALLBACK);',
      box: '<div className="modal modal--narrow update-overlay" ref={boxRef} tabIndex={-1} aria-busy="true">'
    }
  ];

  for (const { file, hook, box } of dialogs) {
    it(`${file}: focus hook on a box that can take the focus`, () => {
      const source = read(file);
      expect(source).toContain(hook);
      expect(source).toContain(box);
      expect(source.match(/useDialogFocus\(/g)).toHaveLength(1);
    });
  }

  it("puts the focus in Restart now's overlay through the hook only, so it is handed back when the overlay goes", () => {
    const source = read('components/UpdateOverlay.tsx');
    expect(source).not.toMatch(/\.focus\(/);
    expect(source).not.toContain('useLayoutEffect');
  });

  it("finds the overlay's fallbacks: About's box in the dialogs' layer, and the update card's button", () => {
    const app = read('App.tsx');
    expect(app).toMatch(
      /<div className="app-shell__dialogs" inert=\{inert\.dialogs\}>[^<]*(\{\w+\}\s*)*\{aboutDialog\}/
    );
    const cards = read('components/NotificationCards.tsx');
    expect(cards).toContain("note.key === UPDATE_CARD_KEY ? ' note--update' : ''");
    expect(cards).toContain('className="link note__action"');
  });

  it('puts the focus of New chapter in its name field through the hook only', () => {
    const source = read('components/NewChapterDialog.tsx');
    expect(source).toMatch(/<input\s+ref=\{nameRef\}\s+type="text"/);
    expect(source).not.toContain('nameRef.current?.focus(');
  });

  it('marks each opener for its selector', () => {
    // polish.7: the Review menu's button, whose With AI and Manual open the two dialogs.
    const toolbar = read('components/Toolbar.tsx');
    expect(toolbar).toMatch(
      /<ToolbarMenu\s+label=\{REVIEW_MENU\.label\}\s+opens="review"[\s\S]*?onSelect: onReviewWithAi,[\s\S]*?onSelect: onManualReview,/
    );
    expect(toolbar).not.toContain('data-opens="manual-review"');
    const menu = read('components/ToolbarMenu.tsx');
    expect(menu).toMatch(/<button\s+ref=\{buttonRef\}\s+type="button"[^>]*\sdata-opens=\{opens\}/);
    expect(read('components/FileList.tsx')).toMatch(
      /<button\s+type="button"\s+className="files__act"\s+data-opens="new-chapter"\s+aria-label="New chapter"[^>]*onClick=\{onNewChapter\}\s*>/
    );
  });

  it("moves the focus to the menu's button before its item goes, so a question or a dialog hands it back there", () => {
    // How a menu behaves is useMenu's since polish.10, which a chip's menu shares;
    // the toolbar's menus hand it their button.
    const hook = read('components/useMenu.ts');
    const close = hook.slice(hook.indexOf('const close = '), hook.indexOf('const run = '));
    const focus = close.indexOf('if (giveFocusBack) invoker.current?.focus({ preventScroll: true });');
    expect(focus).toBeGreaterThan(-1);
    expect(close.indexOf('setOpen(false);')).toBeGreaterThan(focus);
    expect(hook).toMatch(
      /const run = \(item: MenuItem\): void => \{\s*close\(true\);\s*item\.onSelect\(\);\s*\};/
    );
    const menu = read('components/ToolbarMenu.tsx');
    expect(menu).toMatch(/useMenu\(\s*items,\s*buttonRef,\s*disabled\s*\)/);
    expect(menu).toMatch(/<span\s+className="menu"\s+ref=\{ref\}[\s\S]*?>\s*<button\s+ref=\{buttonRef\}/);
  });

  it('leaves Build review enabled while its question is open, so Cancel can hand the focus back to it', () => {
    const manual = read('components/ManualReviewDialog.tsx');
    expect(manual).toContain('<button type="button" className="primary" disabled={saving} onClick={build}>');
    expect(manual).not.toMatch(/\bbusy\b/);
  });
});

describe('The suggestion editor under a dialog (ui.1 review)', () => {
  const css = withoutComments(readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8'));

  it('draws every dialog over the editor, the legend and the menus, and under the hover card and a question', () => {
    const backdrop = zIndexOf(css, '.modal-backdrop');
    for (const below of ['.editor', '.legend', '.menu__list', '.lock-card', '.notes']) {
      expect(backdrop, below).toBeGreaterThan(zIndexOf(css, below));
    }
    for (const above of ['.tip', '.modal-backdrop--confirm']) {
      expect(backdrop, above).toBeLessThan(zIndexOf(css, above));
    }
  });

  it('makes the editor inert while a dialog is open, so nothing in it acts behind the dialog', () => {
    const popover = read('components/EditPopover.tsx');
    expect(popover).toContain('const covered = useApp(isModalOpen);');
    expect(popover).toMatch(/<div\s+className="editor"\s+ref=\{panelRef\}[^>]*\sinert=\{covered\}/);
  });
});

describe('Escape behind a dialog (ui.1)', () => {
  const keyboard = read('state/keyboard.ts');

  it('closes neither the suggestion editor nor the find bar while a dialog is open', () => {
    expect(keyboard).toContain("if (event.key === 'Escape' && state.editor && !isModalOpen(state)) {");
    expect(keyboard).toContain("if (event.key === 'Escape' && state.find.open && !isModalOpen(state)) {");
    // The older guard, which let the find bar close behind every dialog but a question, is gone.
    expect(keyboard).not.toContain('!state.confirmSpec');
  });
});
