import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.12: the first-use hint's wiring, the empty page and the CSS that keeps
   it off the toolbar's buttons. Source checks, since the tests run without a
   DOM; the words, when it shows and its placement are tested in
   test/shared/saveHint.test.ts, the setting in test/renderer/hints.test.ts, and
   the window checks (both themes, 100% and 150%, the toolbar's buttons left
   uncovered) are in PLAN (apply.12). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const TOOLBAR = read('components/Toolbar.tsx');
const HINT = read('components/SaveHint.tsx');
const APP = read('App.tsx');
const CSS = read('styles/app.css');

/** Every declaration made for exactly this selector, across app.css. */
function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

const zIndexes = (): number[] => [...CSS.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));

describe('the toolbar shows the hint (apply.12)', () => {
  it('decides with saveHintVisible from what it already draws Save to chapter with', () => {
    expect(TOOLBAR).toMatch(
      /saveHintVisible\(\{\s*dismissedHints,\s*dismissedThisSession: hintDismissedThisSession\(SAVE_HINT_ID\),\s*hasChapter: input\.hasChapter,\s*unsavedDecisions: input\.unsavedDecisions,\s*locked,\s*saving\s*\}\)/
    );
    expect(TOOLBAR).toContain('useApp((s) => s.settings?.dismissedHints ?? null)');
  });

  it('points the hint at Save to chapter, with the chapter on screen in its words', () => {
    expect(TOOLBAR).toMatch(/<button\s+ref=\{saveRef\}\s+type="button"\s+className="primary"/);
    expect(TOOLBAR).toContain(
      '<SaveHint anchor={saveRef} text={saveHintText(review.sourcePath)} onGotIt={onSaveHintDone} />'
    );
  });

  it('puts the hint after every button, inside the toolbar it hangs from', () => {
    const hint = TOOLBAR.indexOf('<SaveHint');
    const settings = TOOLBAR.indexOf('Settings\n');
    const end = TOOLBAR.indexOf('</header>');
    expect(settings).toBeGreaterThan(0);
    expect(hint).toBeGreaterThan(settings);
    expect(end).toBeGreaterThan(hint);
  });

  it('places it from saveHintPlacement, measured again when the toolbar or the button changes size', () => {
    expect(HINT).toContain('saveHintPlacement({');
    expect(HINT).toContain('const bar = hint?.offsetParent;');
    expect(HINT).toContain('observer.observe(bar);');
    expect(HINT).toContain('observer.observe(button);');
    expect(HINT).toContain("hint.style.setProperty('--save-hint-arrow'");
    expect(HINT).toContain('{SAVE_HINT_GOT_IT}');
    expect(HINT).toContain('onClick={onGotIt}');
    // It takes no focus, so the review keys go on working while it shows.
    expect(HINT).not.toMatch(/\.focus\(|autoFocus/);
  });
});

describe('App puts it away for good (apply.12)', () => {
  it('on Got it', () => {
    expect(APP).toContain('onSaveHintDone={() => void dismissHint(SAVE_HINT_ID, HINT_IO)}');
    expect(APP).toContain("setSettings: (patch) => call('settings:set', patch)");
  });

  it('on every Save to chapter that reaches the file, before anything else it does', () => {
    expect(APP).toMatch(/onSaved: \(saved, onScreen\) => \{\s*void dismissHint\(SAVE_HINT_ID, HINT_IO\);/);
  });

  it('and a close waits for that write with the others', () => {
    expect(APP).toContain('Promise.all([flushReviewWrites(), flushDraftWrites(), flushHintWrites()])');
  });

  it('the empty page says nothing reaches the chapter until Save', () => {
    const empty = APP.slice(APP.indexOf('<h1>Nothing open</h1>'));
    expect(empty.slice(0, empty.indexOf('</div>'))).toContain('{NOTHING_UNTIL_SAVE}');
  });
});

describe('the CSS keeps it off the toolbar (apply.12)', () => {
  it('hangs it below the whole toolbar, which it is placed in', () => {
    expect(declsFor('.toolbar').get('position')).toBe('relative');
    const hint = declsFor('.save-hint');
    expect(hint.get('position')).toBe('absolute');
    expect(hint.get('top')).toMatch(/^calc\(100% \+ \d+px\)$/);
    expect(hint.get('visibility')).toBe('hidden');
    expect(hint.get('width')).toBe('min(300px, calc(100% - 16px))');
    expect(hint.get('--save-hint-arrow')).toBeDefined();
  });

  it('above the notification cards, under every dialog, menu and the hover card', () => {
    const z = Number(declsFor('.save-hint').get('z-index'));
    expect(z).toBeGreaterThan(Number(declsFor('.notes').get('z-index')));
    expect(z).toBeLessThan(Number(declsFor('.modal-backdrop').get('z-index')));
    expect(z).toBeLessThan(Number(declsFor('.menu__list').get('z-index')));
    expect(z).toBeLessThan(Number(declsFor('.tip').get('z-index')));
    // Nothing else shares its layer.
    expect(zIndexes().filter((n) => n === z)).toHaveLength(1);
  });

  it('draws in tokens only, so both themes reach it', () => {
    const hint = declsFor('.save-hint');
    expect(hint.get('background')).toBe('var(--panel)');
    expect(hint.get('color')).toBe('var(--ink)');
    expect(hint.get('border-left')).toBe('3px solid var(--accent)');
    expect(declsFor('.save-hint::before').get('background')).toBe('var(--panel)');
  });
});
