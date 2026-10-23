import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/* polish.12: how app.css draws the suggestions list's rows, and the source
   around them, read as text: the tests run without a DOM. The rows as the
   side panel renders them are in suggestionRows.render.test.ts. */

const SRC = path.join(__dirname, '../../src');
const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');
const CSS = read('renderer/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const HANDLE = read('renderer/state/splitHandle.ts');
const STATUS_BAR = read('renderer/components/StatusBar.tsx');

/** Every declaration for exactly this selector, the last of each property winning. */
function declsFor(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (
      !(match[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(selector)
    )
      continue;
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
  }
  return out;
}

describe('the tag (polish.12)', () => {
  it('is drawn as the YOU tag was, in capitals, on the panel whatever the row', () => {
    const tag = declsFor('.row__cat');
    expect(tag.get('color')).toBe('var(--cat)');
    expect(tag.get('text-transform')).toBe('uppercase');
    expect(tag.get('border')).toBe('1px solid color-mix(in srgb, var(--cat) 40%, transparent)');
    // In dark four categories are under 4.5:1 as text on the focused row's --focus-bg.
    expect(tag.get('background')).toBe('var(--panel)');
    expect(tag.get('flex')).toBe('0 0 auto');
    // The row's words still give way, not the tag.
    expect(declsFor('.row__text').get('text-overflow')).toBe('ellipsis');
    expect(CSS).not.toContain('.row__dot');
    expect(CSS).not.toContain('.row__you');
  });

  it('keeps its colour once the suggestion is decided, as the chip does: no rule draws it but its own', () => {
    const selectors = [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap((m) => (m[1] ?? '').split(',').map((s) => s.trim()))
      .filter((s) => s.includes('row__cat'));
    expect(selectors).toEqual(['.row__cat']);
  });
});

describe("a decided row's buttons (polish.12)", () => {
  it('draw the tick in the stronger green and the x in red, bolder, kept under the pointer', () => {
    expect(declsFor('.row__act--accepted').get('color')).toBe('var(--accept-strong)');
    expect(declsFor('.row__act--accepted:hover:not(:disabled)').get('color')).toBe('var(--accept-strong)');
    expect(declsFor('.row__act--dismissed').get('color')).toBe('var(--danger)');
    expect(declsFor('.row__act--dismissed:hover:not(:disabled)').get('color')).toBe('var(--danger)');
    expect(declsFor('.row__act--accepted svg').get('stroke-width')).toBe('2.6');
    expect(declsFor('.row__act--dismissed svg').get('stroke-width')).toBe('2.6');
    // The icons' own stroke, which a pending row keeps.
    expect(read('renderer/components/icons.tsx')).toContain('strokeWidth: 1.8,');
  });

  it("fade the others by a thinner stroke in the row buttons' faint grey, which holds 3:1, and not by opacity", () => {
    expect(declsFor('.row__act').get('color')).toBe('var(--ink-faint)');
    expect(declsFor('.row__act--faded').size).toBe(0);
    expect(declsFor('.row__act--faded svg').get('stroke-width')).toBe('1.2');
    expect(declsFor('.row__act--faded:hover:not(:disabled) svg').get('stroke-width')).toBe('1.8');
    expect(CSS).not.toMatch(/\.row__act--faded[^{]*\{[^}]*opacity/);
  });

  it('write the status word in capitals while Show states is on', () => {
    expect(declsFor('.row__status').get('text-transform')).toBe('uppercase');
  });
});

describe('the heading line (polish.12)', () => {
  it('holds the heading and Show states, and the split measures it as the heading', () => {
    expect(declsFor('.side__list-head').get('flex-wrap')).toBe('wrap');
    expect(declsFor('.side__list-head').get('margin')).toBe('0 0 6px');
    expect(declsFor('.side__list-head > h3').get('margin')).toBe('0');
    expect(declsFor('.side__list > .side__list-head').get('padding')).toBe('0 10px');
    // The box is no taller than the heading's line, so the line is as tall as the heading was.
    expect(declsFor('.side__states input').get('height')).toBe('12px');
    expect(declsFor('.side__states input').get('margin')).toBe('0');
    expect(HANDLE).toContain("list.querySelector<HTMLElement>(':scope > .side__list-head')");
    expect(HANDLE).not.toContain("':scope > h3'");
  });
});

describe('the legend (polish.12)', () => {
  it('explains the tags, the tick and the x, Show states and the count, after the chips', () => {
    const chip = STATUS_BAR.indexOf('legend__swatch--chip');
    const tick = STATUS_BAR.indexOf('legend__swatch--tick');
    expect(chip).toBeGreaterThan(0);
    expect(tick).toBeGreaterThan(chip);
    const item = STATUS_BAR.slice(tick, STATUS_BAR.indexOf('</li>', tick)).replace(/\s+/g, ' ');
    for (const words of [
      '<IconCheck />',
      '<b>The suggestions list.</b>',
      'a tag in its chip&apos;s colour',
      'a bold green if you accepted it',
      'its x red if you dismissed it',
      'other buttons fade',
      'click the tick or the x again to put it back',
      'Show states',
      'ACCEPTED or DISMISSED',
      'the heading counts the suggestions you have decided'
    ]) {
      expect(item, words).toContain(words);
    }
    expect(declsFor('.legend__swatch--tick').get('color')).toBe('var(--accept-strong)');
    expect(declsFor('.legend__swatch--tick svg').get('stroke-width')).toBe('2.6');
  });
});
