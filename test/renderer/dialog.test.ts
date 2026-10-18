import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* ui.1 (found by the M5 review): Escape did not close Settings, and the focus
   stayed on the toolbar behind it. Settings now closes on Escape as Review
   with AI does, takes the focus as it opens and hands it back when it closes;
   Escape behind any dialog no longer closes the find bar or the suggestion
   editor out of sight. The rules are pure and tested in
   test/shared/dialog.test.ts; the hooks touch the DOM and are checked in their
   source, since the tests run without one. The window checks are in PLAN. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

describe('Settings is a modal (ui.1)', () => {
  const settings = read('components/SettingsDialog.tsx');
  const dialog = read('state/dialog.ts');

  it('closes on Escape and moves the focus into its box and back', () => {
    expect(settings).toContain('useDialogEscape(boxRef, onClose);');
    expect(settings).toContain('useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);');
    expect(settings).toContain('<div className="modal" ref={boxRef} tabIndex={-1}>');
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

describe('Escape behind a dialog (ui.1)', () => {
  const keyboard = read('state/keyboard.ts');

  it('closes neither the suggestion editor nor the find bar while a dialog is open', () => {
    expect(keyboard).toContain("if (event.key === 'Escape' && state.editor && !isModalOpen(state)) {");
    expect(keyboard).toContain("if (event.key === 'Escape' && state.find.open && !isModalOpen(state)) {");
    // The older guard, which let the find bar close behind every dialog but a question, is gone.
    expect(keyboard).not.toContain('!state.confirmSpec');
  });
});
