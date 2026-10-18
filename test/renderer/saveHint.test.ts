import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.12: the first-use hint's wiring, the empty page and the CSS that keeps
   it off the toolbar's buttons, the notification cards and the find bar.
   Source checks, since the tests run without a DOM; the words, when it shows
   and its placement are tested in test/shared/saveHint.test.ts, the setting in
   test/renderer/hints.test.ts, and the window checks (both themes, the sizes
   and zooms, the toolbar's, the cards' and the find bar's buttons left
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
      /saveHintVisible\(\{\s*dismissedHints,\s*dismissedThisSession: hintDismissedThisSession\(SAVE_HINT_ID\),\s*hasChapter: input\.hasChapter,\s*unsavedDecisions: input\.unsavedDecisions,\s*locked,\s*saving,\s*sideFolded,\s*editingParagraph: editing > 0,\s*setAside: hintSetAside\s*\}\)/
    );
    expect(TOOLBAR).toContain('useApp((s) => s.settings?.dismissedHints ?? null)');
    expect(TOOLBAR).toContain('const editing = useApp((s) => Object.keys(s.drafts).length);');
    expect(TOOLBAR).toContain('const hintSetAside = useSaveHintAside((s) => s.setAside);');
  });

  it('points the hint at Save to chapter, with the chapter on screen in its words', () => {
    expect(TOOLBAR).toMatch(/<button\s+ref=\{saveRef\}\s+type="button"\s+className="primary"/);
    expect(TOOLBAR).toMatch(
      /<SaveHint\s+anchor=\{saveRef\}\s+text=\{saveHintText\(review\.sourcePath\)\}\s+overProse=\{sideFolded\}\s+onGotIt=\{onSaveHintDone\}\s*\/>/
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
    expect(HINT).toContain('hint.style.width = `${placed.width}px`;');
    expect(HINT).toContain('{SAVE_HINT_GOT_IT}');
    expect(HINT).toContain('onClick={onGotIt}');
    // It takes no focus, so the review keys go on working while it shows.
    expect(HINT).not.toMatch(/\.focus\(|autoFocus/);
  });

  it('keeps it to the side panel column and its arrow off the buttons under Save to chapter', () => {
    expect(HINT).toContain("const side = document.querySelector('.body .side')?.getBoundingClientRect();");
    expect(HINT).toContain('column: side && side.width > 0 ? span(side) : null,');
    // The toolbar's items on later rows than Save's, the hint itself left out.
    expect(HINT).toMatch(
      /\[\.\.\.bar\.children\]\s*\.filter\(\(item\) => item !== hint && item\.getClientRects\(\)\.length > 0\)/
    );
    expect(HINT).toContain('.filter((r) => r.top >= s.bottom - 1)');
    expect(HINT).toMatch(
      /if \(placed\.arrow === null\) \{\s*hint\.dataset\.arrow = 'none';\s*\} else \{\s*delete hint\.dataset\.arrow;/
    );
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

describe('the CSS keeps it off the toolbar, the cards and the find bar (apply.12)', () => {
  it('hangs it below the whole toolbar, which it is placed in', () => {
    expect(declsFor('.toolbar').get('position')).toBe('relative');
    const hint = declsFor('.save-hint');
    expect(hint.get('position')).toBe('absolute');
    expect(hint.get('top')).toMatch(/^calc\(100% \+ \d+px\)$/);
    expect(hint.get('visibility')).toBe('hidden');
    expect(hint.get('width')).toBe('min(300px, calc(100% - 16px))');
    expect(hint.get('--save-hint-arrow')).toBeDefined();
  });

  it('drops its arrow when the placement finds no clear part of the button', () => {
    expect(declsFor(".save-hint[data-arrow='none']::before").get('display')).toBe('none');
  });

  it('under the notification cards, so a card wins, above the page, and under every dialog, menu and the hover card', () => {
    const z = Number(declsFor('.save-hint').get('z-index'));
    expect(z).toBeLessThan(Number(declsFor('.notes').get('z-index')));
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(Number(declsFor('.modal-backdrop').get('z-index')));
    expect(z).toBeLessThan(Number(declsFor('.menu__list').get('z-index')));
    expect(z).toBeLessThan(Number(declsFor('.tip').get('z-index')));
    // Nothing else shares its layer.
    expect(zIndexes().filter((n) => n === z)).toHaveLength(1);
  });

  it('stays clear of the cards and the find bar, which live in the centre column beside the side panel', () => {
    // The hint keeps to `.body .side` (above). The find bar and the cards are
    // in `.center-wrap`, the column before it, and never reach out of it: the
    // find bar is a strip in its flow, and the cards are pinned inside it.
    // With the side panel folded to a strip (ui.3), its drawer's column lies
    // over the prose's edge, so there the hint may meet them: see
    // test/renderer/columns.test.ts.
    const wrap = APP.indexOf('<div className={`center-wrap');
    const find = APP.indexOf('<FindBar />');
    const cards = APP.indexOf('<NotificationCards');
    const lock = APP.indexOf('<LockCard');
    const side = APP.indexOf('<SidePanel');
    expect(wrap).toBeGreaterThan(0);
    expect(find).toBeGreaterThan(wrap);
    expect(cards).toBeGreaterThan(find);
    expect(lock).toBeGreaterThan(cards);
    expect(side).toBeGreaterThan(lock);
    expect(APP.slice(lock, side)).toMatch(/\/>\s*<\/div>/);
    expect(declsFor('.center-wrap').get('position')).toBe('relative');
    expect(declsFor('.notes').get('position')).toBe('absolute');
    expect(parseFloat(declsFor('.notes').get('right') ?? '')).toBeGreaterThanOrEqual(0);
    expect(declsFor('.findbar').get('position')).toBeUndefined();
  });

  it('draws in tokens only, so both themes reach it', () => {
    const hint = declsFor('.save-hint');
    expect(hint.get('background')).toBe('var(--panel)');
    expect(hint.get('color')).toBe('var(--ink)');
    expect(hint.get('border-left')).toBe('3px solid var(--accent)');
    expect(declsFor('.save-hint::before').get('background')).toBe('var(--panel)');
  });
});
