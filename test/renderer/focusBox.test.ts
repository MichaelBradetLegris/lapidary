import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* ui.5: the focused suggestion is a box of fixed height at the top of the side
   panel, directly under the review selector and above the list, so the list and
   the comments below it never move as the focus does. Its Edit is the pencil on
   its heading line. These are source checks, as the tests run without a DOM or
   Electron; the window checks (both themes, a one-line and a five-line
   explanation, Tab, the comments region's height as the focus moves) are in
   PLAN (ui.5). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const SIDE_PANEL = read('renderer/components/SidePanel.tsx');
const KEYBOARD = read('renderer/state/keyboard.ts');
const SCROLL = read('renderer/state/scroll.ts');
const ICONS = read('renderer/components/icons.tsx');
const CSS = readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The short window's block, where the panel scrolls as one (PLAN C.49). */
const SHORT = /@media \(height < \d+px\) \{([\s\S]*?)\n\}/.exec(CSS);
const SHORT_BLOCK = SHORT?.[1] ?? '';
const BASE = SHORT ? CSS.replace(SHORT[0], '') : CSS;

/** Every declaration made for exactly this selector. */
function declsFor(selector: string, css = BASE): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

const px = (value: string | undefined): number => {
  const n = Number.parseFloat(value ?? '');
  if (!Number.isFinite(n)) throw new Error(`not a length: ${value}`);
  return n;
};

/** A `calc()` of sums and products of px lengths and custom properties. */
function evalCalc(expr: string, vars: Map<string, string>): number {
  const body = expr
    .replace(/^calc\(([\s\S]*)\)$/, '$1')
    .replace(/var\((--[a-z-]+)\)/g, (_, name: string) => vars.get(name) ?? 'NaN');
  return body
    .split('+')
    .reduce((sum, term) => sum + term.split('*').reduce((product, factor) => product * px(factor), 1), 0);
}

const at = (needle: string): number => {
  const i = SIDE_PANEL.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};

describe('where the box is (ui.5)', () => {
  it('sits under the review selector, at the top of the panel body, above the list and the comments', () => {
    const order = [
      'className={`side__head',
      'className="side__body"',
      'className="side__focus"',
      'className="side__focus-head"',
      '<h3>Focused suggestion</h3>',
      'className="side__focus-body"',
      'className="side__regions"',
      'className="side__section side__list"',
      'className="side__lower"',
      '<h3>Comments ({openComments.length})</h3>',
      'className="side__foot"'
    ].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The details are no longer between the list and the comments.
    expect(SIDE_PANEL.split('Focused suggestion').length).toBe(2);
    expect(SIDE_PANEL).not.toContain('detail__actions');
  });

  it('shows the category, Original, Suggested and the explanation in its body, and with nothing focused its present text', () => {
    const body = SIDE_PANEL.slice(at('className="side__focus-body"'), at('className="side__regions"'));
    for (const part of [
      'className={`detail__cat',
      '<dt>Original:</dt>',
      '<dt>Suggested:</dt>',
      '<p className="detail__reason">{focused.reason}</p>',
      '<p className="side__empty">Press j or click a row to focus a suggestion.</p>'
    ]) {
      expect(body).toContain(part);
    }
  });

  it('starts each newly focused suggestion at the top of the box, and follows only the row in the list', () => {
    expect(SIDE_PANEL).toMatch(
      /useEffect\(\(\) => \{\s*if \(focusBodyRef\.current\) focusBodyRef\.current\.scrollTop = 0;[\s\S]*?followFocus\([^;]*data-row-id[^;]*\);\s*\}, \[focusedHunkId\]\);/
    );
    expect(SCROLL).toContain('export function followFocus(row: Element | null | undefined): void {');
    expect(SIDE_PANEL).not.toContain('lowerRef');
  });
});

describe('Edit as an icon button on the heading line (ui.5)', () => {
  it('is the pencil the list rows use, named "Edit suggestion", and opens the editor as before', () => {
    const head = SIDE_PANEL.slice(at('className="side__focus-head"'), at('className="side__focus-body"'));
    expect(head).toMatch(
      /\{focused \? \(\s*<button\s+type="button"\s+className="row__act side__focus-edit"\s+aria-label="Edit suggestion"\s+title="Edit suggestion \(e\)"\s+onClick=\{\(\) => editHunk\(focused\.id\)\}\s*>\s*<IconPencil \/>\s*<\/button>\s*\) : null\}/
    );
    // The rows' own pencil is the same icon in the same class.
    expect(SIDE_PANEL).toMatch(
      /className="row__act"\s+aria-label="Edit this suggestion"[\s\S]*?<IconPencil \/>/
    );
  });

  it('leaves the e key as it was', () => {
    expect(KEYBOARD).toMatch(/case 'e':\s*if \(focused\) editHunk\(focused\);/);
  });
});

describe('the fixed height (ui.5)', () => {
  const box = declsFor('.side__focus');
  const vars = new Map([...box].filter(([name]) => name.startsWith('--')));

  it('never grows or shrinks with its contents, and scrolls inside below its heading line', () => {
    expect(box.get('flex')).toBe('none');
    expect(box.has('height')).toBe(true);
    for (const loose of ['min-height', 'max-height', 'overflow', 'overflow-y'])
      expect(box.has(loose), loose).toBe(false);
    const head = declsFor('.side__focus-head');
    expect(head.get('flex')).toBe('none');
    expect(head.get('height')).toBe('var(--focus-head)');
    const body = declsFor('.side__focus-body');
    expect(body.get('flex')).toBe('1 1 0');
    expect(body.get('min-height')).toBe('0');
    expect(body.get('overflow-y')).toBe('auto');
    expect(body.get('background')).toBe('var(--panel)');
  });

  it('gives every line in it a line height of its own, so no font changes the sum', () => {
    expect(declsFor('.side__focus-head h3').get('line-height')).toBe('var(--focus-head)');
    expect(declsFor('.side__focus-body .detail__cat').get('line-height')).toBe('var(--focus-cat)');
    expect(declsFor('.side__focus-body .pair dt').get('line-height')).toBe('var(--focus-pair)');
    expect(declsFor('.side__focus-body .pair dd').get('line-height')).toBe('var(--focus-pair)');
    expect(declsFor('.side__focus-body .detail__reason').get('line-height')).toBe('var(--focus-reason)');
    expect(declsFor('.side__focus-body .side__empty').get('line-height')).toBe('var(--focus-reason)');
    // The pencil fills the heading line exactly: a 12 px icon and 3 px of padding.
    expect(ICONS).toContain('export function IconPencil({ size = 12 }');
    expect(px(declsFor('.row__act').get('padding')) * 2 + 12).toBe(px(vars.get('--focus-head')));
  });

  it('is exactly the heading line, the category, Original and Suggested, two lines of explanation and what lies between', () => {
    const [padTop, , padBottom = padTop] = (box.get('padding') ?? '').split(/\s+/);
    const border = px(box.get('border-bottom'));
    const headGap = px(declsFor('.side__focus-head').get('margin-bottom'));
    const pairTop = px(declsFor('.side__focus-body .pair').get('margin'));
    const pairRowGap = px(declsFor('.pair').get('gap'));
    const reasonTop = px(declsFor('.side__focus-body .detail__reason').get('margin'));
    const line = (name: string): number => px(vars.get(name));
    const lines =
      line('--focus-head') + line('--focus-cat') + 2 * line('--focus-pair') + 2 * line('--focus-reason');
    const between = px(padTop) + headGap + pairTop + pairRowGap + reasonTop + px(padBottom) + border;
    expect(evalCalc(box.get('height') ?? '', vars)).toBe(lines + between);
    expect(lines + between).toBe(139);
  });
});

describe('the short window (ui.5, PLAN C.49)', () => {
  it('puts the box at the top of the one scroller, at the same height, with the list and the comments under it', () => {
    expect(SHORT_BLOCK).toMatch(/\.side__body \{[^}]*overflow-y: auto/);
    expect(SHORT_BLOCK).toMatch(/\.side__regions \{\s*display: block;\s*\}/);
    expect(SHORT_BLOCK).not.toContain('.side__focus');
    // In two regions, the list and the region below share what the box leaves.
    const regions = declsFor('.side__regions');
    expect(regions.get('flex')).toBe('1 1 0');
    expect(regions.get('min-height')).toBe('0');
    expect(regions.get('display')).toBe('flex');
    expect(regions.get('flex-direction')).toBe('column');
    expect(declsFor('.side__list').get('max-height')).toBe('55%');
  });
});
