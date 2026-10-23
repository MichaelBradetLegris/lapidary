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

  /* polish.14: tags of different lengths started the rows' words in different
     places. Measured in the window: HOM, the widest of the fourteen, is 31.2
     CSS px in Segoe UI at 9 px with its border and 3 px of padding, SPE the
     narrowest 24.3. */
  it('is one width on every row, its three letters centred, so the words start in one column (polish.14)', () => {
    const tag = declsFor('.row__cat');
    expect(tag.get('width')).toBe('34px');
    expect(tag.get('display')).toBe('inline-block');
    expect(tag.get('text-align')).toBe('center');
    expect(tag.get('padding')).toBe('0 2px');
    expect(tag.has('min-width')).toBe(false);
    // HOM's letters are 23.2 px (31.2 less the 1 px border and 3 px padding a side it was measured
    // with); the box holds them with room for a fallback font a fifth wider.
    const width = Number(/^(\d+)px$/.exec(tag.get('width') ?? '')?.[1]);
    const pad = Number(/^0 (\d+)px$/.exec(tag.get('padding') ?? '')?.[1]);
    expect(tag.get('border')).toMatch(/^1px solid /);
    expect(width - 2 * 1 - 2 * pad).toBeGreaterThanOrEqual(23.2 * 1.2);
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

  /* polish.14: the thinner stroke "barely looks any different" (the author);
     the others now keep --row-fade of the faint grey, under 3:1 at rest by
     his choice (themeContrast.test.ts), and come back under the pointer. */
  it("fade the others to --row-fade of the row buttons' faint grey, and bring them back under the pointer (polish.14)", () => {
    expect(declsFor('.row__act').get('color')).toBe('var(--ink-faint)');
    expect([...declsFor('.row__act--faded')]).toEqual([
      ['color', 'color-mix(in srgb, var(--ink-faint) var(--row-fade), transparent)']
    ]);
    // Under the pointer a faded button is drawn as any row button, --ink on --border at the usual
    // stroke: the rule that does it is more specific than the fade's, and nothing outdoes it.
    const hover = declsFor('.row__act:hover:not(:disabled)');
    expect(hover.get('color')).toBe('var(--ink)');
    expect(hover.get('background')).toBe('var(--border)');
    expect(declsFor('.row__act--faded:hover:not(:disabled)').size).toBe(0);
    // With the keyboard's focus on one it is --ink too, beside the focus ring.
    expect([...declsFor('.row__act--faded:focus-visible')]).toEqual([['color', 'var(--ink)']]);
    // The fade is the colour alone: the stroke is the icon's own, and the focus ring is not faded.
    expect(CSS).not.toMatch(/\.row__act--faded[^{]*\{[^}]*(opacity|stroke-width)/);
  });

  it('draw every icon 16 px in its 18 px button, where it was 12 px with 3 px of padding (polish.14)', () => {
    const icon = declsFor('.row__act svg');
    expect(icon.get('width')).toBe('16px');
    expect(icon.get('height')).toBe('16px');
    expect(declsFor('.row__act').get('padding')).toBe('1px');
    expect(declsFor('.row__act').get('line-height')).toBe('0');
    // The legend's tick is drawn as a row's.
    expect(declsFor('.legend__swatch--tick svg').get('width')).toBe('16px');
    expect(declsFor('.legend__swatch--tick svg').get('height')).toBe('16px');
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

/* polish.12 review: in a narrow panel the tag and the status word never gave
   way, so the change was squeezed to nothing: in the smallest window (the
   list 235 CSS px wide, the row's button 133 px inside) a decided row could
   show only "HOMOPHONE ACCEPTED", and at 200% (97 px) ACCEPTED was drawn
   over the pencil by up to 37 px. The window check is in PLAN (polish.12);
   the tests run without a layout engine, so these hold the rules that give
   the order, and the sums they rest on with the widths measured there. */
describe('a narrow row keeps some of the change (polish.12 review)', () => {
  const main = declsFor('.row__main');
  const px = (value: string | undefined): number => {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
    if (!m) throw new Error(`not a px value: ${value}`);
    return Number(m[1]);
  };
  const FLOOR = px(main.get('--row-text-floor'));
  const GAP = px(main.get('gap'));
  const query = /@container side \(width < (\d+)px\) \{\s*\.row__status \{\s*display: none;\s*\}\s*\}/.exec(
    CSS
  );
  const THRESHOLD = Number(query?.[1]);
  // Measured in the window, in CSS px, which zoom leaves alone: the row's
  // button is 102 px narrower inside than the panel inside its border when
  // the list has its scrollbar (with the panel's own scrollbar in a short
  // window, the same; polish.14's bigger icons left the buttons 18 px); the
  // panel is 235 px inside in the smallest window and 199 at 200% in the
  // default one. The widest tag was WORD-CHOICE's, 76.7 px, until polish.14
  // made every tag one width.
  const BUTTON_IN_PANEL = 102;
  const SMALLEST = 235;
  const AT_200 = 199;
  const WIDEST_TAG = px(declsFor('.row__cat').get('width'));
  const TWO_LETTERS = 20; // "AC…" is 23 px at 10 px

  it('clips what the button holds, so nothing reaches the pencil', () => {
    expect(main.get('overflow')).toBe('clip');
    expect(main.get('min-width')).toBe('0');
    expect(main.get('flex')).toBe('1 1 auto');
  });

  it('gives the change a floor, and the room the others leave, so it never shrinks beside them', () => {
    expect(FLOOR).toBeGreaterThanOrEqual(30);
    const text = declsFor('.row__text');
    expect(text.get('flex')).toBe('1 1 0');
    expect(text.get('min-width')).toBe('var(--row-text-floor)');
    expect(text.get('overflow')).toBe('hidden');
    expect(text.get('text-overflow')).toBe('ellipsis');
  });

  it('lets the status word give way next, with an ellipsis, and the tag only past the floor', () => {
    const status = declsFor('.row__status');
    expect(status.get('flex')).toBe('0 1 auto');
    expect(status.get('min-width')).toBe('0');
    expect(status.get('overflow')).toBe('hidden');
    expect(status.get('text-overflow')).toBe('ellipsis');
    expect(status.get('white-space')).toBe('nowrap');
    const tag = declsFor('.row__cat');
    expect(tag.get('flex')).toBe('0 0 auto');
    // The tag never takes the floor or the gap after it.
    expect(tag.get('max-width')).toBe(`calc(100% - var(--row-text-floor) - ${GAP}px)`);
    expect(tag.get('overflow')).toBe('hidden');
    expect(tag.get('text-overflow')).toBe('ellipsis');
    expect(tag.get('white-space')).toBe('nowrap');
  });

  it("drops the status word from every row where one would show less than two letters, by the panel's width", () => {
    // The panel's width, which no chapter changes (C.49), not the row's, which the list's scrollbar does.
    expect(declsFor('.side').get('container')).toBe('side / inline-size');
    expect(main.has('container-type')).toBe(false);
    expect(query).not.toBeNull();
    // At the threshold the widest tag, the floor and two gaps leave the word two letters and the ellipsis,
    const room = (panel: number): number => panel - BUTTON_IN_PANEL - WIDEST_TAG - FLOOR - 2 * GAP;
    expect(room(THRESHOLD)).toBeGreaterThanOrEqual(TWO_LETTERS);
    // and not much more: a wider panel than needed would lose the words where they fit.
    expect(room(THRESHOLD - 1)).toBeLessThan(TWO_LETTERS + 8);
    // The usual panel, 320 px with its border, has them.
    expect(319).toBeGreaterThanOrEqual(THRESHOLD);
    // With three-letter tags (polish.14) the smallest window has room for the word, some 55 px of it;
    // at 200% it is still under the threshold, and no row writes the word there.
    expect(SMALLEST).toBeGreaterThanOrEqual(THRESHOLD);
    expect(room(SMALLEST)).toBeGreaterThan(50);
    expect(AT_200).toBeLessThan(THRESHOLD);
    // Both keep the tag whole, with more than the floor of the change beside it.
    expect(SMALLEST - BUTTON_IN_PANEL - WIDEST_TAG - GAP).toBeGreaterThan(FLOOR);
    expect(AT_200 - BUTTON_IN_PANEL - WIDEST_TAG - GAP).toBeGreaterThan(FLOOR);
  });
});

/* polish.12 review: a box that wrote the opposite of what it shows, or that
   wrote nowhere, passed every test, as the render test calls saveRowStates
   itself. The split, the columns and the save hint pin their writers the
   same way (split.test.ts, columnHandles.test.ts, saveHint.test.ts). */
describe('Show states writes what it shows (polish.12 review)', () => {
  const PANEL = read('renderer/components/SidePanel.tsx');

  it('keeps the box ticked as the setting, and writes the tick it is given', () => {
    const box = PANEL.slice(PANEL.indexOf('<label className="side__states"'));
    const input = box.slice(0, box.indexOf('</label>'));
    expect(input).toContain('type="checkbox"');
    expect(input).toContain('checked={showStates}');
    expect(input).toContain('onChange={(event) => void saveRowStates(event.target.checked, ROW_STATES_IO)}');
    expect(PANEL).toContain('const showStates = useApp((s) => s.settings?.showRowStates ?? true);');
  });

  it('writes through settings:set', () => {
    expect(PANEL).toMatch(
      /const ROW_STATES_IO: RowStatesIo = \{\s*setSettings: \(patch\) => call\('settings:set', patch\)\s*\};/
    );
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
