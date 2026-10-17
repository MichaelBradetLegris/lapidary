import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* apply.4: the count on the Save button, the dot before the chapter name and
   the status bar, all from `unsavedDecisionCount` through `src/shared/ui/save.ts`
   (whose words are tested in test/shared/save.test.ts), with `store.dirty` gone.
   These are source checks: the tests run without a DOM, and the window checks
   (1100 px at 125%, a 40-character chapter name, 0, 1 and 12 changes, both
   themes) are in PLAN (apply.4). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const TOOLBAR = read('components/Toolbar.tsx');
const STATUS_BAR = read('components/StatusBar.tsx');
const STORE = read('state/store.ts');
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

describe('the Save button and the dot (apply.4)', () => {
  it('takes the label, tooltip and disabled state from saveButtonState', () => {
    expect(TOOLBAR).toMatch(/saveButtonState\(\{/);
    expect(TOOLBAR).toContain('unsavedDecisions: unsaved');
    expect(TOOLBAR).toContain('unsavedDecisionCount(review.hunks)');
    expect(TOOLBAR).toContain('changedParagraphCount(s.drafts)');
    expect(TOOLBAR).toContain('{save.label}');
    expect(TOOLBAR).toContain('title={save.title}');
    expect(TOOLBAR).toContain('disabled={save.disabled}');
    expect(TOOLBAR).not.toMatch(/accepted changes/i);
    expect(TOOLBAR).not.toContain("'Save to chapter'");
  });

  it('puts the dot before the chapter name, labelled, only when saveButtonState says so', () => {
    const dot = TOOLBAR.indexOf('className="unsaved-dot"');
    const name = TOOLBAR.indexOf('className="toolbar__name"');
    expect(dot).toBeGreaterThan(0);
    expect(name).toBeGreaterThan(dot);
    expect(TOOLBAR).toMatch(/\{save\.dot \? <span className="unsaved-dot"/);
    expect(TOOLBAR).toContain('aria-label={dotLabel}');
    expect(TOOLBAR).toContain('unsavedDotLabel(unsaved)');
    expect(TOOLBAR).toMatch(/className="toolbar__name" title=\{title\}/);
  });

  it('cuts the chapter name short with an ellipsis and keeps every button on one line', () => {
    expect(Object.fromEntries(declsFor('.toolbar__title'))).toMatchObject({ 'min-width': '0' });
    expect(Object.fromEntries(declsFor('.toolbar__name'))).toMatchObject({
      'min-width': '0',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap'
    });
    expect(declsFor('.toolbar button').get('white-space')).toBe('nowrap');
    expect(declsFor('.toolbar .progress').get('white-space')).toBe('nowrap');
    // Nothing else in the row may wrap or shrink below its label.
    expect(declsFor('.toolbar').get('flex-wrap')).toBeUndefined();
  });

  it('paints the dot in --unsaved, a token of its own', () => {
    expect(Object.fromEntries(declsFor('.unsaved-dot'))).toMatchObject({
      flex: 'none',
      'border-radius': '50%',
      background: 'var(--unsaved)'
    });
    expect(declsFor('.toolbar__dirty').size).toBe(0);
    expect(TOOLBAR).not.toContain('toolbar__dirty');
  });
});

describe('the status bar (apply.4)', () => {
  it('counts what is not saved to the chapter, in --unsaved, and only when there is something', () => {
    expect(STATUS_BAR).toContain('unsavedPhrase(review ? unsavedDecisionCount(review.hunks) : 0)');
    expect(STATUS_BAR).toMatch(
      /\{unsaved \? \(\s*<span className="statusbar__unsaved" title=\{KEPT_TOOLTIP\}>/
    );
    expect(declsFor('.statusbar__unsaved').get('color')).toBe('var(--unsaved)');
  });

  it('says "Decisions kept" with the tooltip, never "Review saved"', () => {
    expect(STATUS_BAR).toContain('<span title={KEPT_TOOLTIP}>{keptPhrase(reviewSavedAt)}</span>');
    expect(STATUS_BAR).not.toContain('Review saved');
    expect(STATUS_BAR).not.toContain('toLocaleTimeString');
  });

  it('has a legend that explains the dot and no longer offers the removed selection edit', () => {
    expect(STATUS_BAR).toContain('legend__swatch--unsaved');
    expect(STATUS_BAR).toContain('Not saved to chapter.');
    expect(STATUS_BAR).not.toMatch(/selecting words/i);
    expect(STATUS_BAR).not.toMatch(/pressing e\b/i);
    expect(STATUS_BAR).toContain('or the e key, lets you rewrite it');
    expect(declsFor('.legend__swatch--unsaved').get('background')).toBe('var(--unsaved)');
  });

  it('keeps the longer legend inside a short window, scrolling rather than running off the top', () => {
    expect(Object.fromEntries(declsFor('.legend'))).toMatchObject({
      'max-height': 'calc(100vh - 40px)',
      'overflow-y': 'auto',
      background: 'var(--panel)'
    });
    // The gap above the last paragraph, which `.legend p` used to take away.
    expect(declsFor('.legend .legend__foot').get('margin')).toBe('9px 0 0');
  });
});

describe('the store (apply.4)', () => {
  it('has no dirty flag: the unsaved count is the one measure', () => {
    expect(STORE).not.toMatch(/\bdirty\b/);
  });
});
