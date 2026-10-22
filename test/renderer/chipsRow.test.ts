import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHIPS_ARROW_WIDTH } from '../../src/shared/ui/chips';
import { chipFocused, toolbarFocusLeft, useChipFocus } from '../../src/renderer/state/chipFocus';

/* polish.10 (PLAN 7, C.98): one bar at the top. The category chips are in the
   toolbar's row, where the chapter's name was before it went to the window's
   title, compact, each one toggle with a menu of its own; they scroll
   sideways only when they overflow, with the wheel, ‹ and › over the row's
   ends and Tab, and a 2 px line under the row in place of a scrollbar.
   polish.6 had put them at the top of the centre column. Source checks, since
   the tests run without a DOM; the window checks (1424 by 900 and 900 by 600,
   both themes, 100% to 200%) are in PLAN (polish.10). The rules are in
   src/shared/ui/chips.ts, tested in test/shared/chips.test.ts, and the menu's
   keys in test/shared/menu.test.ts. */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const MAIN = APP.slice(APP.lastIndexOf('return ('));
const TOOLBAR = read('components/Toolbar.tsx');
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

describe('the chips are in the toolbar, where the name was (polish.10)', () => {
  it('draws them first in the toolbar, before the buttons, and nowhere in the columns', () => {
    expect(APP).not.toContain('<FilterChips');
    expect(TOOLBAR.split('<FilterChips').length - 1).toBe(1);
    const header = TOOLBAR.indexOf('<header');
    const chips = TOOLBAR.indexOf('<FilterChips');
    expect(chips).toBeGreaterThan(header);
    for (const next of [
      '{running ? (',
      'label={REVIEW_MENU.label}',
      'label={ACTIONS_MENU}',
      '{save.label}'
    ]) {
      expect(TOOLBAR.indexOf(next), next).toBeGreaterThan(chips);
    }
    // Nothing between the toolbar and the columns: all three start at its foot.
    const toolbar = MAIN.indexOf('{toolbar}');
    const body = MAIN.indexOf('<div className={bodyClassName(layout)}');
    expect(toolbar).toBeGreaterThan(0);
    expect(
      MAIN.slice(toolbar + '{toolbar}'.length, body)
        .replace(/\{\s*\}/g, '')
        .trim()
    ).toBe('');
  });

  it('draws them only with a review open and the chapter on screen, not behind Setup or the welcome guide', () => {
    expect(TOOLBAR).toContain('const chipShown = review !== null && !singleScreen;');
    expect(TOOLBAR).toContain(
      '{chipShown ? <FilterChips review={review} bulkOff={bulkOff} bulkTitle={bulkTitle} /> : null}'
    );
  });

  it('lets the chips take the room the buttons leave, give way first, and never wrap', () => {
    expect(Object.fromEntries(declsFor('.chips-bar'))).toMatchObject({
      position: 'relative',
      flex: '1 1 8em',
      'min-width': '0'
    });
    const row = declsFor('.chips');
    expect(row.get('flex-wrap')).toBe('nowrap');
    expect(row.get('overflow-x')).toBe('auto');
    expect(row.get('overflow-y')).toBe('hidden');
    expect(row.get('min-width')).toBe('0');
    // No scrollbar of its own: the line under it shows where it is.
    expect(row.get('scrollbar-width')).toBe('none');
    // Opaque, in the toolbar's colour (theme.1).
    expect(row.get('background')).toBe('var(--panel)');
    expect(declsFor('.toolbar').get('background')).toBe('var(--panel)');
    const chip = declsFor('.chip');
    expect(chip.get('flex')).toBe('0 0 auto');
    expect(chip.get('white-space')).toBe('nowrap');
  });

  it('keeps the chips compact: smaller type and padding, and no second row in the toolbar for them', () => {
    const toggle = declsFor('.chip__toggle');
    expect(toggle.get('font-size')).toBe('11.5px');
    expect(toggle.get('padding')).toBe('1px 5px');
    expect(declsFor('.chips').get('gap')).toBe('4px');
    // A chip's height (16 px of line, 2 of padding, 2 of border) and the row's
    // 6 px of padding stay under a button's, so the toolbar keeps its height.
    expect(toggle.get('line-height')).toBe('16px');
    expect(declsFor('.chips').get('padding')).toBe('3px 8px 3px 3px');
  });
});

describe('a chip is one toggle with a menu of its own (polish.10)', () => {
  it('toggles its filter from anywhere on its name and count, which name it', () => {
    expect(CHIPS).toMatch(
      /<button\s+ref=\{toggleRef\}\s+type="button"\s+className="chip__toggle"\s+aria-pressed=\{!off\}\s+title=\{chipTitle\(off\)\}\s+onClick=\{onToggle\}/
    );
    expect(CHIPS).toContain('{category} <span className="chip__count">{count}</span>');
    expect(CHIPS).not.toContain('chip__bulk');
    expect(CHIPS).not.toContain('IconCheck');
  });

  it('opens its menu by a right-click, the menu key or Shift+F10, and the ▾, which is no Tab stop', () => {
    expect(CHIPS).toMatch(/onContextMenu=\{onContextMenu\}/);
    expect(CHIPS).toMatch(
      /const onContextMenu = \(event: React\.MouseEvent\): void => \{\s*if \(event\.defaultPrevented\) return;\s*event\.preventDefault\(\);\s*openMenu\(\);/
    );
    expect(CHIPS).toMatch(
      /if \(!contextMenuKey\(event\)\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openMenu\(\);/
    );
    expect(CHIPS).toContain('onKeyDown={onToggleKey}');
    expect(CHIPS).toMatch(
      /className="chip__more"\s+tabIndex=\{-1\}\s+aria-haspopup="menu"\s+aria-expanded=\{shown\}\s+aria-controls=\{shown \? listId : undefined\}\s+title=\{label\}\s+onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/
    );
  });

  it('behaves as the toolbar menus do, gives the focus back to the chip, and goes while the chapter is read-only', () => {
    expect(CHIPS).toMatch(/useMenu\(\s*items,\s*toggleRef,\s*locked\s*\)/);
    expect(CHIPS).toMatch(
      /<MenuList\s+id=\{listId\}\s+label=\{label\}\s+items=\{items\}\s+className="chip__menu"\s+listRef=\{listRef\}\s+\{\.\.\.list\}\s+\/>/
    );
    // Accept all and Dismiss all of the category, off when the toolbar's are.
    expect(CHIPS).toMatch(
      /label: chipBulkLabel\('accept', category\),\s*onSelect: \(\) => onBulk\('accept'\),\s*disabled: bulkOff,\s*title: bulkTitle/
    );
    expect(CHIPS).toMatch(
      /label: chipBulkLabel\('dismiss', category\),\s*onSelect: \(\) => onBulk\('dismiss'\),\s*disabled: bulkOff,\s*title: bulkTitle/
    );
    expect(CHIPS).toContain('onBulk={(action) => runBulk(action, category)}');
  });

  it('places the list in the window under the chip, as the row clips, and closes it when the row scrolls', () => {
    expect(CHIPS).toContain(
      'const at = chipMenuPlacement(chip, menu.offsetWidth, document.documentElement.clientWidth);'
    );
    expect(Object.fromEntries(declsFor('.menu__list.chip__menu'))).toMatchObject({
      position: 'fixed',
      right: 'auto',
      visibility: 'hidden'
    });
    expect(CHIPS).toMatch(/const onScroll = \(\): void => close\(true\);/);
  });

  it('shows the ▾ on hover or a keyboard focus, growing over the gap so nothing after it moves', () => {
    const more = declsFor('.chip__more');
    expect(more.get('width')).toBe('0');
    expect(more.get('opacity')).toBe('0');
    const shown = declsFor('.chip:hover > .chip__more');
    expect(shown.get('width')).toBe('8px');
    expect(shown.get('opacity')).toBe('1');
    for (const state of ['.chip:has(:focus-visible) > .chip__more', '.chip--menu > .chip__more']) {
      expect(Object.fromEntries(declsFor(state)), state).toEqual(Object.fromEntries(shown));
    }
    // As much given back as the ▾ takes.
    for (const state of ['.chip:hover', '.chip:has(:focus-visible)', '.chip--menu']) {
      expect(declsFor(state).get('margin-right'), state).toBe(`-${shown.get('width')}`);
      expect(declsFor(state).get('box-shadow'), state).toBe('0 0 0 2px var(--panel)');
    }
    // The chip whose menu is open is at the menus' layer, as its list is drawn inside it.
    expect(declsFor('.chip--menu').get('z-index')).toBe(declsFor('.menu__list').get('z-index'));
  });

  it("fades a hidden category's chip, but not the menu drawn inside it", () => {
    expect(declsFor('.chip--off').get('opacity')).toBeUndefined();
    expect(declsFor('.chip--off > .chip__toggle').get('opacity')).toBe('0.4');
    expect(declsFor('.chip--off > .chip__more').get('opacity')).toBe('0.4');
  });
});

describe('only when the chips overflow: wheel, arrows, Tab and the line (polish.10)', () => {
  it('turns an up-and-down wheel over the row into a sideways scroll, in a listener that can stop it', () => {
    expect(CHIPS).toContain('ref={attachRow}');
    expect(CHIPS).toContain('const off = sidewaysWheel(row);');
    expect(CHIPS).toContain("row.addEventListener('wheel', onWheel, { passive: false });");
    expect(CHIPS).toContain("return () => row.removeEventListener('wheel', onWheel);");
    expect(CHIPS).toMatch(
      /const left = chipsWheelLeft\(event, row\);\s*if \(left === null\) return;\s*event\.preventDefault\(\);\s*row\.scrollLeft = left;/
    );
  });

  it('brings a chip the keyboard reaches wholly into view, and leaves the row still under a click or for its menu', () => {
    expect(CHIPS).toContain('onFocus={revealChip}');
    expect(CHIPS).toContain(
      "if (!(target instanceof HTMLElement) || !target.classList.contains('chip__toggle')) return;"
    );
    expect(CHIPS).toContain("if (!target.matches(':focus-visible')) return;");
    expect(CHIPS).toMatch(
      /const left = chipsRevealLeft\(row, \{ left: edges\.left \+ offset, right: edges\.right \+ offset \}\);\s*if \(left !== null\) row\.scrollLeft = left;/
    );
  });

  it('lays ‹ and › over the ends with chips out of sight, which page the row and take no focus', () => {
    expect(CHIPS).toContain('{view.start ? (');
    expect(CHIPS).toContain('{view.end ? (');
    for (const [end, direction] of [
      ['start', '-1'],
      ['end', '1']
    ]) {
      expect(CHIPS).toMatch(
        new RegExp(
          `className="chips__arrow chips__arrow--${end}"\\s+tabIndex=\\{-1\\}\\s+aria-label="[^"]+"\\s+onMouseDown=\\{\\(event\\) => event\\.preventDefault\\(\\)\\}\\s+onClick=\\{\\(\\) => page\\(${direction}\\)\\}`
        )
      );
    }
    expect(CHIPS).toMatch(
      /const left = chipsPageLeft\(row, direction\);\s*if \(left !== null\) scrollContainerTo\(row, left, 'left'\);/
    );
    const arrow = declsFor('.chips__arrow');
    expect(arrow.get('width')).toBe(`${CHIPS_ARROW_WIDTH}px`);
    expect(arrow.get('position')).toBe('absolute');
    // Translucent, over a raised chip and under the menus.
    expect(arrow.get('background')).toBe('color-mix(in srgb, var(--panel) 80%, transparent)');
    expect(Number(arrow.get('z-index'))).toBeGreaterThan(Number(declsFor('.chip:hover').get('z-index')));
    expect(Number(arrow.get('z-index'))).toBeLessThan(Number(declsFor('.menu__list').get('z-index')));
    expect(declsFor('.chips__arrow--start').get('left')).toBe('0');
    expect(declsFor('.chips__arrow--end').get('right')).toBe('0');
  });

  it('draws a 2 px line under the row while the chips overflow, its thumb where the row stands', () => {
    expect(CHIPS).toContain(
      'const next: RowView = { ...ends, thumb: chipsIndicator(row, row.clientWidth) };'
    );
    expect(CHIPS).toContain('{view.thumb ? (');
    expect(CHIPS).toContain(
      '<div className="chips__thumb" style={{ left: view.thumb.left, width: view.thumb.width }} />'
    );
    const line = declsFor('.chips__line');
    expect(line.get('height')).toBe('2px');
    expect(line.get('pointer-events')).toBe('none');
    expect(declsFor('.chips__thumb').get('background')).toBe('var(--ink-faint)');
    // Measured on every render, scroll and resize of the row.
    expect(CHIPS).toContain('useLayoutEffect(measure);');
    expect(CHIPS).toContain('const observer = new ResizeObserver(measure);');
    expect(CHIPS).toContain("row.addEventListener('scroll', onScroll, { passive: true });");
  });
});

describe('Actions lists the chip the focus was last on (polish.10)', () => {
  afterEach(() => {
    useChipFocus.setState({ category: null });
  });

  it('remembers the chip while the focus stays in the toolbar, and forgets it once it leaves', () => {
    chipFocused('punctuation');
    toolbarFocusLeft(true, true);
    expect(useChipFocus.getState().category).toBe('punctuation');
    // A window that loses the focus keeps it, as the focus comes back to the same place.
    toolbarFocusLeft(null, false);
    expect(useChipFocus.getState().category).toBe('punctuation');
    // Somewhere else in the page.
    toolbarFocusLeft(false, true);
    expect(useChipFocus.getState().category).toBeNull();
    // To nothing, in a window that still has the focus.
    chipFocused('grammar');
    toolbarFocusLeft(null, true);
    expect(useChipFocus.getState().category).toBeNull();
    // Elsewhere, as the window loses the focus too.
    chipFocused('typo');
    toolbarFocusLeft(false, false);
    expect(useChipFocus.getState().category).toBeNull();
  });

  it('adds its two items after Reset, for a chip that is drawn, and forgets it as the focus leaves the toolbar', () => {
    expect(TOOLBAR).toContain('const lastChip = useChipFocus((s) => s.category);');
    expect(TOOLBAR).toMatch(
      /const focusedChip =\s*chipShown && lastChip !== null && chips\.some\(\(\[category\]\) => category === lastChip\) \? lastChip : null;/
    );
    expect(TOOLBAR).toMatch(
      /label: chipBulkLabel\('accept', focusedChip\),\s*onSelect: \(\) => runBulk\('accept', focusedChip\),\s*disabled: bulkOff,\s*title: bulkTitle,\s*separated: true/
    );
    expect(TOOLBAR).toMatch(
      /label: chipBulkLabel\('dismiss', focusedChip\),\s*onSelect: \(\) => runBulk\('dismiss', focusedChip\),\s*disabled: bulkOff,\s*title: bulkTitle/
    );
    const reset = TOOLBAR.indexOf("{ label: 'Reset'");
    const chip = TOOLBAR.indexOf('...chipItems,');
    const copy = TOOLBAR.indexOf("{ label: 'Copy result'");
    expect(chip).toBeGreaterThan(reset);
    expect(copy).toBeGreaterThan(chip);
    expect(TOOLBAR).toMatch(
      /onBlur=\{\(event\) => \{\s*const next = event\.relatedTarget;\s*toolbarFocusLeft\(\s*next instanceof Node \? event\.currentTarget\.contains\(next\) : null,\s*document\.hasFocus\(\)\s*\);/
    );
    expect(CHIPS).toContain('onFocus={() => chipFocused(category)}');
  });
});
