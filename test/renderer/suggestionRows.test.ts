import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

  it('say the decision alone: no rule draws a status word since polish.17', () => {
    expect(CSS).not.toContain('.row__status');
  });
});

/* polish.20 (the author: "at a glance, it's not super easy to tell which rows
   are complete and which are not"): both of his ways, a pending row's buttons
   stronger and a decided row shaded, its words softer. The colours' pairs are
   in themeContrast.test.ts. */
describe('pending and decided rows told apart at a glance (polish.20)', () => {
  /** Where a rule for exactly this selector list starts in the CSS, comments removed. */
  const at = (selectors: string): number => {
    const found = [...CSS.matchAll(/([^{}]+)\{/g)].find(
      (m) => (m[1] ?? '').replace(/\s+/g, ' ').trim() === selectors
    );
    return found?.index ?? -1;
  };

  it("draws a pending row's three buttons in --ink-soft, and leaves the focused suggestion's pencil --ink-faint", () => {
    expect([...declsFor('.row--pending .row__act')]).toEqual([['color', 'var(--ink-soft)']]);
    // The base every row button and the focused box's pencil share is unchanged.
    expect(declsFor('.row__act').get('color')).toBe('var(--ink-faint)');
    expect(read('renderer/components/SidePanel.tsx')).toContain('className="row__act side__focus-edit"');
    // Under the pointer a pending row's button is --ink on --border, as any row button: the
    // hover's rule (a class and two pseudo-classes) outweighs the pending row's (two classes).
    expect(declsFor('.row__act:hover:not(:disabled)').get('color')).toBe('var(--ink)');
    expect(declsFor('.row--pending .row__act:hover:not(:disabled)').size).toBe(0);
  });

  it('shades a decided row, accepted or dismissed alike, and a step further under the pointer', () => {
    expect([...declsFor('.row--accepted')]).toEqual([['background', 'var(--row-decided-bg)']]);
    expect([...declsFor('.row--dismissed')]).toEqual([['background', 'var(--row-decided-bg)']]);
    expect(at('.row--accepted, .row--dismissed')).toBeGreaterThan(-1);
    expect([...declsFor('.row--accepted:hover')]).toEqual([['background', 'var(--row-decided-hover-bg)']]);
    expect([...declsFor('.row--dismissed:hover')]).toEqual([['background', 'var(--row-decided-hover-bg)']]);
    // A pending row under the pointer is as before, and a pending row at rest has no shade.
    expect(declsFor('.row:hover').get('background')).toBe('var(--panel-alt)');
    expect(declsFor('.row--pending').has('background')).toBe(false);
    expect(declsFor('.row').has('background')).toBe(false);
  });

  it('keeps the focused row --focus-bg, decided or not, by its rule coming after the shade', () => {
    expect([...declsFor('.row--focused')]).toEqual([['background', 'var(--focus-bg)']]);
    // The two rules weigh the same (one class), so the later wins.
    expect(at('.row--focused')).toBeGreaterThan(at('.row--accepted, .row--dismissed'));
    // Under the pointer a row takes the hover's step, focused or not, as it did before.
    expect(at('.row--accepted:hover, .row--dismissed:hover')).toBeGreaterThan(-1);
    expect(declsFor('.row--focused:hover').size).toBe(0);
  });

  it("writes a decided row's words in --ink-soft, a dismissed one struck through", () => {
    expect([...declsFor('.row--accepted .row__text')]).toEqual([['color', 'var(--ink-soft)']]);
    expect(declsFor('.row--dismissed .row__text').get('color')).toBe('var(--ink-soft)');
    expect(declsFor('.row--dismissed .row__text').get('text-decoration')).toBe('line-through');
    // --ink-faint, which a dismissed row's words were, is under 4.5:1 on the shade.
    expect(CSS).not.toMatch(/\.row--dismissed \.row__text\s*\{[^}]*--ink-faint/);
  });
});

/* polish.17: the heading had Show states beside it on a line of their own
   (`.side__list-head`) from polish.12, and in a narrow panel the box went
   under it; with the box gone the heading is the line again, as before
   polish.12, and the split measures it. */
describe('the heading (polish.17)', () => {
  it('is alone on its line, and the split measures it as the heading', () => {
    expect(declsFor('.side__list > h3').get('padding')).toBe('0 10px');
    expect(declsFor('.side__section h3').get('margin')).toBe('0 0 6px');
    expect(CSS).not.toContain('.side__list-head');
    expect(CSS).not.toContain('.side__states');
    expect(HANDLE).toContain("list.querySelector<HTMLElement>(':scope > h3')");
    expect(HANDLE).not.toContain('side__list-head');
  });
});

/* polish.12 review: in a narrow panel the tag and the status word never gave
   way, so the change was squeezed to nothing: in the smallest window (the
   list 235 CSS px wide, the row's button 133 px inside) a decided row could
   show only "HOMOPHONE ACCEPTED", and at 200% (97 px) ACCEPTED was drawn
   over the pencil by up to 37 px. The window check is in PLAN (polish.12);
   the tests run without a layout engine, so these hold the rules that give
   the order, and the sums they rest on with the widths measured there.
   polish.17 took the status word away, and with it the container query that
   left it out of a narrow panel: the change and the tag are what is left. */
describe('a narrow row keeps some of the change (polish.12 review)', () => {
  const main = declsFor('.row__main');
  const px = (value: string | undefined): number => {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
    if (!m) throw new Error(`not a px value: ${value}`);
    return Number(m[1]);
  };
  const FLOOR = px(main.get('--row-text-floor'));
  const GAP = px(main.get('gap'));
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

  it('lets the tag give way only past the floor, with an ellipsis', () => {
    const tag = declsFor('.row__cat');
    expect(tag.get('flex')).toBe('0 0 auto');
    // The tag never takes the floor or the gap after it.
    expect(tag.get('max-width')).toBe(`calc(100% - var(--row-text-floor) - ${GAP}px)`);
    expect(tag.get('overflow')).toBe('hidden');
    expect(tag.get('text-overflow')).toBe('ellipsis');
    expect(tag.get('white-space')).toBe('nowrap');
  });

  it('keeps the tag whole beside more than the floor of the change, in the smallest window and at 200%', () => {
    // Every row is a tag and a change since polish.17, a decided one as a pending one.
    const change = (panel: number): number => panel - BUTTON_IN_PANEL - WIDEST_TAG - GAP;
    expect(change(SMALLEST)).toBeGreaterThan(FLOOR);
    expect(change(AT_200)).toBeGreaterThan(FLOOR);
    // Some 57 px of change at 200%, and 93 in the smallest window (PLAN C.110).
    expect(change(AT_200)).toBeGreaterThan(50);
    expect(change(SMALLEST)).toBeGreaterThan(90);
  });

  it("has no container query: the status word's went with it (polish.17)", () => {
    // The panel is no container (themeCss.test.ts fails one, C.49), and no row reads one.
    expect(declsFor('.side').has('container')).toBe(false);
    expect(main.has('container-type')).toBe(false);
    expect(CSS).not.toMatch(/@container/);
  });
});

/* polish.17: Show states went whole, its box, its setting and its writer
   (polish.12 had pinned the box's wiring here). Nothing in the source names
   them now; a settings.json that still holds the key is read in
   test/shared/settings.test.ts and test/main/settingsStore.test.ts. */
describe('Show states is gone (polish.17)', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [full] : [];
    });
  }

  it('leaves no box, setting, writer or status word in the source', () => {
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(50);
    expect(existsSync(path.join(SRC, 'renderer/state/rowStates.ts'))).toBe(false);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const name of [
        'showRowStates',
        'saveRowStates',
        'flushRowStatesWrites',
        'SHOW_STATES',
        'side__states',
        'row__status',
        'STATUS_MARK'
      ]) {
        expect(text.includes(name), `${path.relative(SRC, file)} names ${name}`).toBe(false);
      }
    }
  });
});

describe('the legend (polish.12)', () => {
  it('explains the tags, the tick and the x and the count, after the chips, and no longer Show states (polish.17)', () => {
    const chip = STATUS_BAR.indexOf('legend__swatch--chip');
    const tick = STATUS_BAR.indexOf('legend__swatch--tick');
    expect(chip).toBeGreaterThan(0);
    expect(tick).toBeGreaterThan(chip);
    const item = STATUS_BAR.slice(tick, STATUS_BAR.indexOf('</li>', tick)).replace(/\s+/g, ' ');
    for (const words of [
      '<IconCheck />',
      '<b>The suggestions list.</b>',
      'a tag in its chip&apos;s colour',
      'its row is shaded and its words turn grey',
      'a bold green if you accepted it',
      'its x red if you dismissed it',
      'other buttons fade',
      'click the tick or the x again to put it back',
      'The Suggestions heading counts the suggestions you have decided'
    ]) {
      expect(item, words).toContain(words);
    }
    // What the legend says, its comments aside.
    const said = STATUS_BAR.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(said).not.toContain('Show states');
    expect(said).not.toMatch(/ACCEPTED|DISMISSED/);
    expect(declsFor('.legend__swatch--tick').get('color')).toBe('var(--accept-strong)');
    expect(declsFor('.legend__swatch--tick svg').get('stroke-width')).toBe('2.6');
  });
});
