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
    expect(settings).toContain('<div className="modal" ref={boxRef} tabIndex={-1}>');
  });

  it('notes where the focus was, then moves it into the box as the dialog opens', () => {
    const hook = dialog.slice(dialog.indexOf('export function useDialogFocus'));
    const opening = hook.slice(hook.indexOf('useLayoutEffect('), hook.indexOf('}, [box]);'));
    const noted = opening.indexOf('const active = document.activeElement;');
    expect(noted).toBeGreaterThan(-1);
    expect(opening).toContain('returnTo.current = active instanceof HTMLElement ? active : null;');
    expect(opening.indexOf('box.current?.focus({ preventScroll: true });')).toBeGreaterThan(noted);
  });

  it('hands the focus back in the cleanup that runs once the dialog has gone', () => {
    const hook = dialog.slice(dialog.indexOf('export function useDialogFocus'));
    const closing = hook.slice(hook.indexOf('useEffect('));
    expect(closing).toMatch(/^useEffect\(\s*\(\) => \(\) => \{/);
    const fallback = closing.indexOf(
      'const fallback = document.querySelector<HTMLElement>(fallbackSelector);'
    );
    expect(fallback).toBeGreaterThan(-1);
    expect(
      closing.indexOf('focusReturnTarget(returnTo.current, document.body, fallback)?.focus(')
    ).toBeGreaterThan(fallback);
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
      'if (!dialogTakesEscape(event, questionOpen, pressedInOtherDialog(event, box.current))) return;'
    );
    expect(guard).toBeGreaterThan(-1);
    expect(listener).toContain('const questionOpen = useApp.getState().confirmSpec !== null;');
    expect(listener.indexOf('event.stopPropagation();')).toBeGreaterThan(guard);
    expect(listener.indexOf('close.current();')).toBeGreaterThan(
      listener.indexOf('event.stopPropagation();')
    );
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
    expect(review).toContain('<div className="modal" ref={boxRef}>');
    expect(review).not.toContain("addEventListener('keydown'");
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
