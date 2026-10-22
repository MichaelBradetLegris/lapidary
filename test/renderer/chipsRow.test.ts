import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* polish.6 (PLAN 7, C.98): the category chips are the centre column's alone,
   one row under the toolbar that scrolls sideways, so the chapter list and the
   side panel start at the toolbar's foot. Source checks, since the tests run
   without a DOM; the window checks (1440 by 940 and 900 by 600, both themes,
   100%, 150% and 200%) are in PLAN (polish.6). The wheel's rule is
   `chipsWheelLeft`, tested in test/shared/chips.test.ts. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const MAIN = APP.slice(APP.lastIndexOf('return ('));
const CHIPS = read('components/FilterChips.tsx');
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

describe("the chips are the centre column's alone (polish.6)", () => {
  it('draws them once, inside the centre column and above the manuscript pane, not across the window', () => {
    expect(APP.split('<FilterChips').length - 1).toBe(1);
    const toolbar = MAIN.indexOf('{toolbar}');
    const body = MAIN.indexOf('<div className={bodyClassName(layout)}');
    const column = MAIN.indexOf('<div className="center-col">');
    const chips = MAIN.indexOf('<FilterChips review={review} />');
    const wrap = MAIN.indexOf('<div className={`center-wrap');
    expect(toolbar).toBeGreaterThan(0);
    // Nothing between the toolbar and the columns, so both side columns start at its foot.
    // (A JSX comment is left as {} once its text is taken out.)
    expect(
      MAIN.slice(toolbar + '{toolbar}'.length, body)
        .replace(/\{\s*\}/g, '')
        .trim()
    ).toBe('');
    expect(column).toBeGreaterThan(body);
    expect(chips).toBeGreaterThan(column);
    expect(wrap).toBeGreaterThan(chips);
    // The find bar, the cards and the lock card stay in the wrapper under the chips.
    for (const name of ['<FindBar />', '<NotificationCards', '<LockCard']) {
      expect(MAIN.indexOf(name), name).toBeGreaterThan(wrap);
    }
  });

  it('lays the centre column out as the chips over the pane, which takes the rest of the height', () => {
    const column = declsFor('.center-col');
    expect(column.get('display')).toBe('flex');
    expect(column.get('flex-direction')).toBe('column');
    expect(column.get('min-height')).toBe('0');
    expect(column.get('min-width')).toBe('0');
    const wrap = declsFor('.center-wrap');
    expect(wrap.get('flex')).toBe('1 1 auto');
    expect(wrap.get('min-height')).toBe('0');
    // The cards and the lock card are pinned to the wrapper, under the chips.
    expect(wrap.get('position')).toBe('relative');
    expect(declsFor('.chips').get('flex')).toBe('0 0 auto');
  });

  it('keeps the chips on one row that scrolls sideways when they do not fit', () => {
    const row = declsFor('.chips');
    expect(row.get('flex-wrap')).toBe('nowrap');
    expect(row.get('overflow-x')).toBe('auto');
    expect(row.get('overflow-y')).toBe('hidden');
    // A chip keeps its width and its words on one line rather than shrink.
    const chip = declsFor('.chip');
    expect(chip.get('flex')).toBe('0 0 auto');
    expect(chip.get('white-space')).toBe('nowrap');
  });

  it('turns an up-and-down wheel over the row into a sideways scroll, in a listener that can stop it', () => {
    expect(CHIPS).toContain('ref={sidewaysWheel}');
    expect(CHIPS).toContain("row.addEventListener('wheel', onWheel, { passive: false });");
    expect(CHIPS).toContain("return () => row.removeEventListener('wheel', onWheel);");
    expect(CHIPS).toMatch(
      /const left = chipsWheelLeft\(event, row\);\s*if \(left === null\) return;\s*event\.preventDefault\(\);\s*row\.scrollLeft = left;/
    );
  });

  it('brings a chip the keyboard reaches wholly into view, and leaves the row still under a click', () => {
    expect(CHIPS).toContain('onFocus={revealChip}');
    // Only a focus the keyboard gave: a press must not slide the row before its release.
    expect(CHIPS).toContain(
      "if (!(target instanceof HTMLElement) || !target.matches(':focus-visible')) return;"
    );
    expect(CHIPS).toContain("const chip = target.closest('.chip');");
    expect(CHIPS).toMatch(
      /const left = chipsRevealLeft\(row, \{ left: edges\.left \+ offset, right: edges\.right \+ offset \}\);\s*if \(left !== null\) row\.scrollLeft = left;/
    );
  });
});
