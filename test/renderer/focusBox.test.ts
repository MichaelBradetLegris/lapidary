import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrowsScrollBox, type KeyTarget } from '../../src/shared/ui/scroll';

/* ui.5: the focused suggestion is a box of fixed height at the top of the side
   panel, directly under the review selector and above the list, so the list and
   the comments below it never move as the focus does. Its Edit is the pencil on
   its heading line. Apart from the arrow rule in src/shared, which is called,
   these are source checks, as the tests run without a DOM or Electron; the
   window checks (both themes, a one-line and a five-line
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

/** Every declaration made for exactly this selector, in source order. */
function declListFor(selector: string, css = BASE): [string, string][] {
  const out: [string, string][] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.push([decl.slice(0, colon).trim(), decl.slice(colon + 1).trim()]);
    }
  }
  return out;
}

/** The same, the last one of each property winning. */
const declsFor = (selector: string, css = BASE): Map<string, string> => new Map(declListFor(selector, css));

const px = (value: string | undefined): number => {
  const n = Number.parseFloat(value ?? '');
  if (!Number.isFinite(n)) throw new Error(`not a length: ${value}`);
  return n;
};

/** A border's width: `none`, `0` or a shorthand that starts with a length. */
const borderWidth = (value: string): number => (/^(none|0)\b/.test(value) ? 0 : px(value.split(/\s+/)[0]));

/**
 * The top and bottom of an element's margin, padding or border, from the
 * rules that match it, given from the least specific to the most, so a later
 * one wins: shorthands and the -top and -bottom longhands alike. A property
 * no rule sets is 0, so a box rule must set the margin of an element the
 * browser gives one (`dl`, `p`); the test below checks that it does.
 */
function sides(selectors: string[], prop: 'margin' | 'padding' | 'border'): [number, number] {
  const width = prop === 'border' ? borderWidth : px;
  let top = 0;
  let bottom = 0;
  for (const selector of selectors) {
    for (const [name, value] of declListFor(selector)) {
      const parts = value.split(/\s+/);
      const first = parts[0] ?? '';
      if (name === prop) {
        if (prop === 'border') top = bottom = width(value);
        else {
          top = width(first);
          bottom = width(parts[2] ?? first);
        }
      } else if (name === `${prop}-top` || name === `${prop}-block-start`) top = width(value);
      else if (name === `${prop}-bottom` || name === `${prop}-block-end`) bottom = width(value);
      else if (name === `${prop}-block`) {
        top = width(first);
        bottom = width(parts[1] ?? first);
      }
    }
  }
  return [top, bottom];
}

/** What an element adds to a line height above and below it: its margin, padding and border. */
function around(selectors: string[]): { margin: [number, number]; inside: number } {
  const [padTop, padBottom] = sides(selectors, 'padding');
  const [borderTop, borderBottom] = sides(selectors, 'border');
  return { margin: sides(selectors, 'margin'), inside: padTop + padBottom + borderTop + borderBottom };
}

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
      '<h3>{commentsHeading(review.comments)}</h3>',
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

/* ui.5 review: a box with more text than it shows is a Tab stop of its own
   between the pencil and the list, as Chromium makes a scroller with nothing
   focusable in it one. There the arrows moved the focus to the next
   suggestion, which also sent the box back to its top, so a keyboard user who
   tabbed in to read the explanation could scroll it only with Space. */
describe('the box as a Tab stop (ui.5 review)', () => {
  const element = (className: string, scrollHeight: number, clientHeight: number): KeyTarget => ({
    classList: { contains: (name: string) => name === className },
    scrollHeight,
    clientHeight
  });
  const overflowing = element('side__focus-body', 172, 100);

  it('leaves the arrows to the box while it has the focus and more text than it shows', () => {
    expect(arrowsScrollBox('ArrowDown', overflowing)).toBe(true);
    expect(arrowsScrollBox('ArrowUp', overflowing)).toBe(true);
    // j and k, and every other review key, still act from the box.
    for (const key of ['j', 'k', 'a', 'u', 'd', 'e', 'n'])
      expect(arrowsScrollBox(key, overflowing), key).toBe(false);
    // A box that shows its whole text is no scroller and no Tab stop: the arrows step.
    expect(arrowsScrollBox('ArrowDown', element('side__focus-body', 100, 100))).toBe(false);
    // Any other scroller, and an element that is none, keep them as review keys.
    expect(arrowsScrollBox('ArrowDown', element('side__lower', 400, 100))).toBe(false);
    expect(arrowsScrollBox('ArrowUp', null)).toBe(false);
  });

  it('is asked before the review keys act, with the key and the element it went to', () => {
    const guard = KEYBOARD.indexOf(
      'if (arrowsScrollBox(event.key, event.target instanceof HTMLElement ? event.target : null)) return;'
    );
    expect(guard).toBeGreaterThan(KEYBOARD.indexOf('if (!review) return;'));
    expect(guard).toBeLessThan(KEYBOARD.indexOf('switch (event.key) {'));
    expect(KEYBOARD).toMatch(/case 'j':\s*case 'ArrowDown':\s*state\.moveFocus\(1\);/);
    expect(KEYBOARD).toMatch(/case 'k':\s*case 'ArrowUp':\s*state\.moveFocus\(-1\);/);
    // The box takes no tabindex of its own: it is a Tab stop only while it scrolls.
    const body = SIDE_PANEL.slice(at('className="side__focus-body"'), at('className="side__regions"'));
    expect(body).not.toMatch(/tabIndex/);
    expect(SIDE_PANEL).toContain('<div className="side__focus-body" ref={focusBodyRef}>');
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

  /* Every rule that adds height in the box counts, wherever it is declared:
     the base rules (`.pair dt` has 2 px of padding on top, which the box
     takes off) and the box's own, around the lines and between them (ui.5
     review: the body's padding and that padding were left out, and a box 4 px
     short of its text passed). */
  it('is exactly the heading line, the category, Original and Suggested, two lines of explanation and what lies between', () => {
    const line = (name: string): number => px(vars.get(name));
    const inBox = (base: string): string[] => [base, `.side__focus-body ${base}`];
    // Margins between blocks collapse to the larger; the body is a scroller,
    // so the first and last margins stay inside it.
    const collapse = (bottom: number, top: number): number => Math.max(bottom, top);

    // The browser gives a `dl` and a `p` margins of their own.
    expect(declsFor('.side__focus-body .pair').has('margin')).toBe(true);
    expect(declsFor('.side__focus-body .detail__reason').has('margin')).toBe(true);

    const frame = around(['.side__focus']);
    const head = around(['.side__focus-head']);
    const body = around(['.side__focus-body']);
    const cat = around(inBox('.detail__cat'));
    const pair = around(inBox('.pair'));
    const reason = around(inBox('.detail__reason'));
    // A row of the pair is as tall as the taller of its dt and its dd.
    const cell = (part: 'dt' | 'dd'): number => {
      const { margin, inside } = around(inBox(`.pair ${part}`));
      return margin[0] + inside + line('--focus-pair') + margin[1];
    };
    const row = Math.max(cell('dt'), cell('dd'));
    const gaps = [...declListFor('.pair'), ...declListFor('.side__focus-body .pair')]
      .filter(([name]) => name === 'gap' || name === 'row-gap')
      .map(([, value]) => px(value.split(/\s+/)[0]));
    const rowGap = gaps[gaps.length - 1] ?? 0;

    const headLine = head.margin[0] + line('--focus-head') + head.margin[1];
    const bodyText =
      body.inside +
      cat.margin[0] +
      cat.inside +
      line('--focus-cat') +
      collapse(cat.margin[1], pair.margin[0]) +
      pair.inside +
      2 * row +
      rowGap +
      collapse(pair.margin[1], reason.margin[0]) +
      reason.inside +
      2 * line('--focus-reason') +
      reason.margin[1];
    const whole = frame.inside + headLine + bodyText;

    expect(evalCalc(box.get('height') ?? '', vars)).toBe(whole);
    expect(whole).toBe(139);
    // The pieces the sum above relies on, spelt out.
    expect(declsFor('.side__focus-body .pair dt').get('padding-top')).toBe('0');
    expect(body.inside).toBe(0);
    expect(cat).toEqual({ margin: [0, 0], inside: 0 });
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
