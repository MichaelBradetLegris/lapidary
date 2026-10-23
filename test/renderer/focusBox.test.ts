import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { arrowsScrollBox, type KeyTarget } from '../../src/shared/ui/scroll';

/* ui.5: the focused suggestion is a box of fixed height at the top of the side
   panel, directly under the review selector and above the list, so the list and
   the comments below it never move as the focus does. Its Edit is the pencil on
   its heading line, which since polish.8 names the category too, so the box is
   a line shorter. Apart from the arrow rule in src/shared, which is called,
   these are source checks, as the tests run without a DOM or Electron; the
   heading line as drawn is in focusHead.render.test.ts, and the window checks
   (both themes, a one-line and a five-line explanation, Tab, the comments
   region's height as the focus moves, the accessibility tree) are in PLAN
   (ui.5, polish.8). */

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
      '<span className="side__focus-title">Focused suggestion</span>',
      'className={`side__focus-cat',
      'className="row__act side__focus-edit"',
      'className="side__focus-body"',
      'className="side__regions"',
      'className="side__section side__list"',
      'className="side__lower"',
      '<h3>{commentsHeading(review.comments)}</h3>'
    ].map(at);
    // Show backups left the panel's footer for the toolbar's Actions menu (polish.7).
    expect(SIDE_PANEL).not.toContain('side__foot');
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The details are no longer between the list and the comments.
    expect(SIDE_PANEL.split('Focused suggestion').length).toBe(2);
    expect(SIDE_PANEL).not.toContain('detail__actions');
  });

  it('shows Original, Suggested and the explanation in its body, and with nothing focused its present text', () => {
    const body = SIDE_PANEL.slice(at('className="side__focus-body"'), at('className="side__regions"'));
    // The category is on the heading line since polish.8, not on a line of its own.
    expect(body).not.toContain('detail__cat');
    expect(body).not.toContain('focused.category');
    expect(body).toMatch(/\{focused \? \(\s*<>\s*<dl className="pair">/);
    for (const part of [
      '<dt>Original:</dt>',
      '<dt>Suggested:</dt>',
      '<p className="detail__reason">{focused.reason}</p>',
      'Press j or click a row to focus a suggestion. Shift+J goes to the next pending one.'
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

/* polish.8: the author found the box "a bit big", and the heading and the
   category line under it became one line. In a narrow panel the heading's
   words give way before the category's, which ui.5 had kept on a line of its
   own so that neither would be cut short. */
describe('the category on the heading line (polish.8)', () => {
  const head = (): string =>
    SIDE_PANEL.slice(at('className="side__focus-head"'), at('className="side__focus-body"'));

  it('reads "Focused suggestion · <category>", the category in its colour, with the anchor when it is not exact', () => {
    expect(head()).toMatch(
      /<h3>\s*<span className="side__focus-title">Focused suggestion<\/span>\s*\{focused \? \(\s*<span className=\{`side__focus-cat cat-\$\{focused\.category \?\? 'other'\}`\}>\s*<span className="side__focus-sep"> · <\/span>\s*\{isAuthored\(focused\) \? 'your edit' : \(focused\.category \?\? 'change'\)\}\s*\{focused\.anchor !== 'exact' \? \(\s*<span className="detail__anchor"> \{focused\.anchor\}<\/span>\s*\) : null\}\s*<\/span>\s*\) : null\}\s*<\/h3>/
    );
    // The pencil ends the line, after the heading.
    expect(head().indexOf('</h3>')).toBeLessThan(head().indexOf('side__focus-edit'));
  });

  it('keeps the line to one row, the heading giving way before the category', () => {
    const h3 = declsFor('.side__focus-head h3');
    expect(h3.get('display')).toBe('flex');
    expect(h3.get('white-space')).toBe('nowrap');
    expect(h3.get('overflow')).toBe('hidden');
    expect(h3.get('min-width')).toBe('0');
    // The heading's words shrink, to an ellipsis and then to nothing.
    const title = declsFor('.side__focus-title');
    expect(title.get('flex')).toBe('0 1 auto');
    expect(title.get('min-width')).toBe('0');
    expect(title.get('overflow')).toBe('hidden');
    expect(title.get('text-overflow')).toBe('ellipsis');
    // The category does not: a share of the shrinking, however small, cut it
    // short with an ellipsis for a fraction of a pixel ("word-choice
    // ambiguous" in the default window, seen in the polish.8 window check).
    // Wider than the whole line, it is cut at the line's end with an ellipsis.
    const cat = declsFor('.side__focus-cat');
    expect(cat.get('flex')).toBe('none');
    expect(cat.get('max-width')).toBe('100%');
    expect(cat.get('overflow')).toBe('hidden');
    expect(cat.get('text-overflow')).toBe('ellipsis');
    // The separator, at the start of the category's box, keeps the spaces
    // round its dot, on screen and when spoken.
    expect(declsFor('.side__focus-sep').get('white-space')).toBe('pre');
  });

  it("draws the category in the category's colour and the rest in the heading's", () => {
    expect(declsFor('.side__focus-cat').get('color')).toBe('var(--cat, var(--ink-soft))');
    expect(declsFor('.side__focus-head h3').get('color')).toBe('var(--ink-faint)');
    expect(declsFor('.side__focus-sep').get('color')).toBe('var(--ink-faint)');
    expect(declsFor('.detail__anchor').get('color')).toBe('var(--warn)');
    // The category's own line and its rules are gone.
    expect(CSS).not.toContain('.detail__cat');
    expect(CSS).not.toContain('--focus-cat');
  });
});

describe('Edit as an icon button on the heading line (ui.5)', () => {
  it('is the pencil the list rows use, named "Edit suggestion", and opens the editor as before', () => {
    const head = SIDE_PANEL.slice(at('className="side__focus-head"'), at('className="side__focus-body"'));
    expect(head).toMatch(
      /\{focused \? \(\s*<button\s+type="button"\s+className="row__act side__focus-edit"\s+aria-label="Edit suggestion"\s+title="Edit suggestion \(e\)"\s+onClick=\{\(\) => editHunk\(focused\.id\)\}\s*>\s*<IconPencil \/>\s*<\/button>\s*\) : null\}/
    );
    // The rows' own pencil is the same icon in the same class, faded on a decided row (polish.12).
    expect(SIDE_PANEL).toMatch(
      /className=\{actClass\(hunk\.status, 'edit'\)\}\s+aria-label="Edit this suggestion"[\s\S]*?<IconPencil \/>/
    );
    expect(SIDE_PANEL).toContain("if (look === 'plain') return 'row__act';");
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
    expect(guard).toBeLessThan(KEYBOARD.indexOf('switch (key) {'));
    expect(KEYBOARD).toMatch(/case 'j':\s*case 'ArrowDown':\s*state\.moveFocus\(1, /);
    expect(KEYBOARD).toMatch(/case 'k':\s*case 'ArrowUp':\s*state\.moveFocus\(-1, /);
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
    // The heading's parts take the h3's line height and add no box of their own.
    for (const part of ['.side__focus-title', '.side__focus-sep', '.side__focus-cat']) {
      const decls = declsFor(part);
      for (const loose of ['line-height', 'font-size', 'padding', 'margin', 'border', 'height', 'display'])
        expect(decls.has(loose), `${part} ${loose}`).toBe(false);
    }
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
     short of its text passed). Until polish.8 the category had a line of its
     own, 16 px and the 4 under it, in a box of 139 px. */
  it('is exactly the heading line, Original and Suggested, two lines of explanation and what lies between', () => {
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
      pair.margin[0] +
      pair.inside +
      2 * row +
      rowGap +
      collapse(pair.margin[1], reason.margin[0]) +
      reason.inside +
      2 * line('--focus-reason') +
      reason.margin[1];
    const whole = frame.inside + headLine + bodyText;

    expect(evalCalc(box.get('height') ?? '', vars)).toBe(whole);
    expect(whole).toBe(119);
    // The pieces the sum above relies on, spelt out: Original starts 4 px under
    // the heading line, as the category did, and the explanation 4 px under
    // Suggested.
    expect(declsFor('.side__focus-body .pair dt').get('padding-top')).toBe('0');
    expect(body.inside).toBe(0);
    expect(head.margin).toEqual([0, 4]);
    expect(pair.margin).toEqual([0, 0]);
    expect(reason.margin).toEqual([4, 0]);
    expect([...vars.keys()].sort()).toEqual(['--focus-head', '--focus-pair', '--focus-reason']);
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
