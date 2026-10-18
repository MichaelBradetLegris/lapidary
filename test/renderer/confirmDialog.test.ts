import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.6 review: questions are asked from inside other dialogs (Replace the
   open review from Submit manual review; apply.20 from Review with AI) and with
   the suggestion editor open (apply.9's close prompt), so the confirm dialog
   sits above every other surface. Its default shows its focus ring even when a
   mouse click opened the question, because Enter answers that button and in a
   three-way question it is not the blue one. These are source checks: the
   tests run without a DOM, and the window checks are in PLAN (apply.6). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const read = (file: string): string => readFileSync(path.join(RENDERER, file), 'utf8');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const CSS = withoutComments(read('styles/app.css'));
const CONFIRM = withoutComments(read('components/ConfirmDialog.tsx'));
const APP = withoutComments(read('App.tsx'));
const REVIEW_DIALOG = withoutComments(read('components/ReviewDialog.tsx'));

/** Every rule that sets a z-index, with at-rules such as @media flattened away. */
function zIndices(css: string): { selector: string; z: number }[] {
  const out: { selector: string; z: number }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/.exec(match[2] ?? '');
    if (z) out.push({ selector: (match[1] ?? '').trim(), z: Number(z[1]) });
  }
  return out;
}

describe('confirm dialog layer (apply.6 review)', () => {
  const layers = zIndices(CSS);
  const confirm = layers.filter((l) => l.selector === '.modal-backdrop--confirm');
  const others = layers.filter((l) => l.selector !== '.modal-backdrop--confirm');

  it('reads the layers it compares against, the editor and the tooltip among them', () => {
    expect(others.map((l) => l.selector)).toEqual(
      expect.arrayContaining(['.modal-backdrop', '.editor', '.tip'])
    );
  });

  it('puts the confirm backdrop above every other layer in app.css', () => {
    expect(confirm).toHaveLength(1);
    for (const other of others) {
      expect(confirm[0]?.z, `${other.selector} is at ${other.z}`).toBeGreaterThan(other.z);
    }
  });

  it('gives the confirm dialog that backdrop', () => {
    expect(CONFIRM).toContain('className="modal-backdrop modal-backdrop--confirm"');
  });

  it('renders the confirm dialog last in each layout, after every dialog and the editor', () => {
    // The four dialogs are made just before the two returns (ui.4): the
    // Setup screen's (setup.7) and the main view's.
    const made = APP.slice(APP.indexOf('const newChapterDialog = '));
    const components = [...made.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]);
    expect(components).toEqual(
      expect.arrayContaining([
        'EditPopover',
        'NewChapterDialog',
        'ManualReviewDialog',
        'ReviewDialog',
        'SettingsDialog'
      ])
    );
    const setupStart = made.indexOf('if (setupOpen) {');
    const mainStart = made.lastIndexOf('return (');
    expect(setupStart).toBeGreaterThan(0);
    for (const layout of [made.slice(setupStart, mainStart), made.slice(mainStart)]) {
      const names = [...layout.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]);
      expect(names.at(-1)).toBe('ConfirmDialog');
      expect(names.filter((name) => name === 'ConfirmDialog')).toHaveLength(1);
      expect(layout.indexOf('{settingsDialog}')).toBeLessThan(layout.indexOf('<ConfirmDialog />'));
    }
    const main = made.slice(mainStart);
    expect(main.indexOf('<EditPopover')).toBeLessThan(main.indexOf('{newChapterDialog}'));
  });

  it('focuses the default with its focus ring showing, however the question was opened', () => {
    expect(CONFIRM).toMatch(/focusVisible:\s*true/);
    expect(CONFIRM).toMatch(/\]\?\.focus\(FOCUS_WITH_RING\)/);
  });

  it('leaves Escape to a question asked over Review with AI', () => {
    // `useDialogEscape` refuses Escape while a question is open (dialog.test.ts, ui.1).
    expect(REVIEW_DIALOG).toContain('useDialogEscape(boxRef, onClose);');
  });
});

/* apply.7 review: Tab from the leave question reached the toolbar's Save
   behind it, and Enter there saved the chapter with the question still open. */
describe('the question holds the keyboard (apply.7 review), and so does every dialog (ui.4)', () => {
  const main = APP.slice(APP.lastIndexOf('return ('));
  const page = '<div className="app-shell__page" inert={inert.page}>';
  const dialogs = '<div className="app-shell__dialogs" inert={inert.dialogs}>';

  it('makes everything in the window but the dialogs and the question inert while either is open', () => {
    expect(APP).toContain('const questionOpen = useApp((s) => s.confirmSpec !== null);');
    // What is open is what is drawn, so the page is never inert under nothing.
    expect(APP).toMatch(
      /const inert = shellInert\(\{\s*dialog: \[newChapterDialog, manualReviewDialog, reviewDialog, settingsDialog\]\.some\(\(d\) => d !== null\),\s*question: questionOpen\s*\}\);/
    );
    expect(main.indexOf(page)).toBeGreaterThan(main.indexOf('<div className="app-shell">'));
    const inside = main.slice(main.indexOf(page), main.indexOf(dialogs));
    for (const name of [
      '{toolbar}',
      '<FilterChips',
      '<FileList',
      '<ReviewPane',
      '<NotificationCards',
      '<SidePanel',
      '<StatusBar',
      '<HunkTooltip',
      '<EditPopover'
    ]) {
      expect(inside.indexOf(name), name).toBeGreaterThan(0);
    }
    // The page closes just before the dialogs' wrapper, which holds the four
    // dialogs and closes just before the question, which stays outside both
    // (each `{}` is a JSX comment with its text taken out).
    expect(main).toMatch(
      /<\/div>\s*(\{\s*\}\s*)?<div className="app-shell__dialogs" inert=\{inert\.dialogs\}>\s*\{newChapterDialog\}\s*\{manualReviewDialog\}\s*\{reviewDialog\}\s*\{settingsDialog\}\s*<\/div>\s*(\{\s*\}\s*)?<ConfirmDialog \/>\s*<\/div>\s*\);\s*\}\s*$/
    );
    for (const name of ['<NewChapterDialog', '<ManualReviewDialog', '<ReviewDialog', '<SettingsDialog']) {
      expect(main, name).not.toContain(name);
    }
  });

  it('makes each dialog only where it is drawn, from the flag that opens it', () => {
    const made = APP.slice(
      APP.indexOf('const newChapterDialog = '),
      APP.indexOf('const inert = shellInert(')
    );
    expect(made).toMatch(/const newChapterDialog = newChapterOpen \? \(\s*<NewChapterDialog/);
    expect(made).toMatch(
      /const manualReviewDialog =\s*manualReviewOpen && review\?\.sourcePath \? \(\s*<ManualReviewDialog/
    );
    expect(made).toMatch(
      /const reviewDialog =\s*reviewDialogOpen && review && settings \? \(\s*<ReviewDialog/
    );
    expect(made).toMatch(/const settingsDialog =\s*settingsOpen && settings \? \(\s*<SettingsDialog/);
  });

  it('gives both wrappers no box, so the layout is as it was', () => {
    expect(CSS).toMatch(/\.app-shell__page\s*\{\s*display:\s*contents;\s*\}/);
    expect(CSS).toMatch(/\.app-shell__dialogs\s*\{\s*display:\s*contents;\s*\}/);
  });

  it('puts the focus back where it was when the question closes, if that is still there', () => {
    expect(CONFIRM).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(open\) returnTo\.current = document\.activeElement;/
    );
    expect(CONFIRM).toMatch(/if \(back instanceof HTMLElement && back\.isConnected\) back\.focus\(/);
  });
});
