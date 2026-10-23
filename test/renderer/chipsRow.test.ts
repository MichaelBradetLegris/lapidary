import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHIP_STEPS, CHIPS_ARROW_WIDTH, CHIPS_ROW_PADDING } from '../../src/shared/ui/chips';
import {
  chipFocused,
  toolbarFocusLeft,
  useChipFocus,
  watchToolbarFocus,
  type WatchedPage
} from '../../src/renderer/state/chipFocus';

/* polish.10 (PLAN 7, C.98): one bar at the top. The category chips are in the
   toolbar's row, where the chapter's name was before it went to the window's
   title, compact, each one toggle with a menu of its own; they scroll
   sideways only when they overflow, with the wheel, ‹ and › over the row's
   ends and Tab, and a 2 px line under the row in place of a scrollbar.
   polish.6 had put them at the top of the centre column. polish.11 (C.107):
   each chip is a menu button, the ▾ gone; an eye before them shows or hides
   them all; the author's own edits have a chip, You; and the chips keep the
   size they had before polish.10 until they must shrink, in steps, to fit.
   Source checks, since the tests run without a DOM; the window checks (1424
   by 900 and 900 by 600, both themes) are in PLAN (polish.10, polish.11).
   The rules are in
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
const MENU = read('components/useMenu.ts');

type Specificity = [number, number, number];

/**
 * A selector's specificity, as CSS Selectors 4 counts it, for the selectors
 * app.css gives a chip: ids; classes, attributes and pseudo-classes; types and
 * pseudo-elements. `:where()` counts nothing, and `:is()`, `:not()` and
 * `:has()` count their most specific argument.
 */
function specificity(selector: string): Specificity {
  const total: Specificity = [0, 0, 0];
  let rest = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  rest = rest.replace(/:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_all, args: string) => {
    const most = args
      .split(',')
      .map((arg) => specificity(arg.trim()))
      .reduce((a, b) => (compareSpecificity(a, b) >= 0 ? a : b));
    total[0] += most[0];
    total[1] += most[1];
    total[2] += most[2];
    return '';
  });
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  total[2] += (rest.match(/::[\w-]+|(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return total;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

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
      display: 'flex',
      flex: '1 1 8em',
      'min-width': '0'
    });
    // The row's box, which holds the arrows and the line, fills what the eye leaves.
    expect(Object.fromEntries(declsFor('.chips-view'))).toMatchObject({
      position: 'relative',
      flex: '1 1 auto',
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
});

describe('the chips keep their old size, and shrink in steps only to fit (polish.11)', () => {
  it('draws each step as CHIP_STEPS has it, from the size before polish.10 to its compact size', () => {
    CHIP_STEPS.forEach((step, at) => {
      expect(declsFor(`[data-chip-step='${at}']`).get('gap'), `step ${at}`).toBe(`${step.gap}px`);
      expect(Object.fromEntries(declsFor(`[data-chip-step='${at}'] .chip__button`)), `step ${at}`).toEqual({
        padding: step.padding,
        'font-size': `${step.fontSize}px`,
        'line-height': step.lineHeight
      });
    });
    expect(declsFor(`[data-chip-step='${CHIP_STEPS.length}']`).size).toBe(0);
    // The row's padding at its two ends, which the room for the chips leaves out.
    const [vertical, horizontal] = (declsFor('.chips').get('padding') ?? '').split(' ');
    expect(2 * parseFloat(horizontal ?? '')).toBe(CHIPS_ROW_PADDING);
    expect(vertical).toBe('2px');
  });

  it('keeps the row as tall as a toolbar button at the largest step, so no step changes the toolbar', () => {
    // A button: 13 px on a normal line, 4 px of padding and a 1 px border above and below.
    const button = declsFor('button');
    expect(button.get('font')).toBe('inherit');
    expect(declsFor('body').get('font-size')).toBe('13px');
    expect(button.get('padding')).toBe('4px 9px');
    expect(button.get('border')).toBe('1px solid var(--border)');
    // The chip at the largest step: the same type and line, its padding, its
    // border and the row's padding, which come to the same.
    const first = CHIP_STEPS[0];
    expect(first?.fontSize).toBe(13);
    expect(first?.lineHeight).toBe('normal');
    const chipPad = parseFloat(first?.padding ?? '');
    const rowPad = parseFloat(declsFor('.chips').get('padding') ?? '');
    expect(declsFor('.chip').get('border')).toBe('1px solid var(--border)');
    expect(chipPad + 1 + rowPad).toBe(4 + 1);
    // The smaller steps are no taller.
    for (const step of CHIP_STEPS.slice(1)) {
      expect(step.fontSize).toBeLessThan(13);
      expect(parseFloat(step.padding)).toBeLessThanOrEqual(chipPad);
    }
  });

  it('decides the step from the row and a copy of the chips at every step, out of sight', () => {
    expect(CHIPS).toContain('const [step, setStep] = useState(0);');
    expect(CHIPS).toMatch(
      /const room = row\.getBoundingClientRect\(\)\.width - CHIPS_ROW_PADDING;\s*setStep\(chipsStep\(room, naturalWidths\(copyRef\.current\)\)\);/
    );
    expect(CHIPS).toMatch(/className="chips"\s+data-chip-step=\{step\}/);
    // One row of the copy for each step, its chips as the row's, with their words.
    expect(CHIPS).toMatch(
      /<div ref=\{copyRef\} className="chips__measure" aria-hidden="true">\s*\{CHIP_STEPS\.map\(\(_, at\) => \(\s*<div key=\{at\} className="chips__measure-row" data-chip-step=\{at\}>\s*\{chips\.map\(\(\[key, count\]\) => \(\s*<span key=\{key\} className=\{`chip cat-\$\{key\}`\}>\s*<span className="chip__button">\s*\{chipName\(key\)\} <span className="chip__count">\{count\}<\/span>/
    );
    expect(Object.fromEntries(declsFor('.chips__measure'))).toMatchObject({
      position: 'absolute',
      width: '0',
      height: '0',
      overflow: 'hidden',
      visibility: 'hidden',
      'pointer-events': 'none'
    });
    expect(declsFor('.chips__measure-row').get('width')).toBe('max-content');
    // Measured again when the copy changes size, as when the fonts come in.
    expect(CHIPS).toContain('for (const copy of copyRef.current?.children ?? []) observer.observe(copy);');
  });
});

describe('a chip is a menu button (polish.11)', () => {
  it('is one button named by its words, whose description says whether its suggestions are shown', () => {
    expect(CHIPS).toMatch(
      /<button\s+ref=\{buttonRef\}\s+type="button"\s+className="chip__button"\s+aria-haspopup="menu"\s+aria-expanded=\{shown\}\s+aria-controls=\{shown \? listId : undefined\}\s+title=\{chipTitle\(chip, off\)\}\s+onClick=\{\(\) => \(shown \? close\(false\) : openOn\('first'\)\)\}/
    );
    expect(CHIPS).toContain('{chipName(chip)} <span className="chip__count">{count}</span>');
    // A menu button, not a toggle: aria-pressed would make Chromium call it a toggle button.
    expect(CHIPS).not.toContain('aria-pressed');
    // The ▾ went: the whole chip opens the menu.
    expect(CHIPS).not.toContain('chip__more');
    expect(CHIPS).not.toContain('IconChevronDown');
    expect(CSS).not.toContain('chip__more');
    expect(CSS).not.toContain('chip__toggle');
  });

  it('opens its menu by a click, Enter, Space, the arrows, the menu key, Shift+F10 and a right-click', () => {
    expect(CHIPS).toMatch(/onContextMenu=\{onContextMenu\}/);
    expect(CHIPS).toMatch(
      /const onContextMenu = \(event: React\.MouseEvent\): void => \{\s*if \(event\.defaultPrevented\) return;\s*event\.preventDefault\(\);\s*openMenu\(\);/
    );
    expect(CHIPS).toMatch(
      /const where = contextMenuKey\(event\) \? 'first' : menuButtonKey\(event\);\s*if \(where === null\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*openMenu\(where\);/
    );
    expect(CHIPS).toContain('onKeyDown={onChipKey}');
    expect(CHIPS).toMatch(
      /const openMenu = \(where: 'first' \| 'last' = 'first'\): void => \{\s*if \(shown\) focusItem\(where === 'first' \? firstEnabled\(enabled\) : lastEnabled\(enabled\)\);\s*else openOn\(where\);/
    );
  });

  it('holds Hide or Show, Show only, and Accept all and Dismiss all with the count under a line', () => {
    expect(CHIPS).toMatch(
      /const items: MenuItem\[\] = \[\s*\{ label: labels\.toggle, onSelect: onToggle \},\s*\{ label: labels\.only, onSelect: onShowOnly \},\s*\.\.\.\(bulk \? \[\{ \.\.\.bulkItem\(bulk, 'accept'\), separated: true \}, bulkItem\(bulk, 'dismiss'\)\] : \[\]\)\s*\];/
    );
    expect(CHIPS).toContain('const labels = chipMenuLabels(off, bulk?.pending ?? 0);');
    // Off when the toolbar's bulk items are, and with nothing pending, the tooltip saying why.
    expect(CHIPS).toMatch(
      /label: labels\[action\],\s*onSelect: \(\) => of\.run\(action\),\s*disabled: bulkOff \|\| of\.pending === 0,\s*title: bulkOff \? bulkTitle : of\.pending === 0 \? of\.emptyNotes\[action\] : undefined/
    );
    // The count and the notes are the question's own (bulkPlan).
    expect(CHIPS).toMatch(
      /accept: bulkPlan\(review\.hunks, 'accept', key\),\s*dismiss: bulkPlan\(review\.hunks, 'dismiss', key\)/
    );
    expect(CHIPS).toContain('pending: plan?.accept.count ?? 0,');
    expect(CHIPS).toContain('onToggle={() => toggleCategory(key)}');
    expect(CHIPS).toContain('onShowOnly={() => setHiddenCategories(showOnlyHidden(keys, key))}');
    expect(CHIPS).toContain('run: (action) => runBulk(action, suggestions)');
  });

  it('gives the comments chip Hide or Show and Show only alone (polish.13)', () => {
    // No bulk items for a chip that is not one of suggestions: suggestionChip is null for it alone.
    expect(CHIPS).toContain('const suggestions = suggestionChip(key);');
    expect(CHIPS).toMatch(/bulk=\{\s*suggestions === null\s*\? null\s*:/);
    expect(CHIPS).toMatch(/const key = suggestionChip\(row\);\s*if \(key === null\) return \[\];/);
    // Counted from the review's comments as well as its suggestions.
    expect(CHIPS).toContain('chipCounts(review.hunks, review.comments)');
    expect(TOOLBAR).toContain('chipCounts(review.hunks, review.comments)');
  });

  it('behaves as the toolbar menus do, gives the focus back to the chip, and goes while the chapter is read-only', () => {
    expect(CHIPS).toMatch(/useMenu\(\s*items,\s*buttonRef,\s*locked\s*\)/);
    expect(CHIPS).toMatch(
      /<MenuList\s+id=\{listId\}\s+label=\{chipMenuLabel\(chip\)\}\s+items=\{items\}\s+className="chip__menu"\s+listRef=\{listRef\}\s+\{\.\.\.list\}\s+\/>/
    );
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

  it('moves nothing on hover or focus, and lights the chip whose menu is open', () => {
    for (const state of ['.chip:hover', '.chip:has(:focus-visible)']) {
      expect(declsFor(state).size, state).toBe(0);
    }
    expect(declsFor('.chip.chip--menu').get('margin-right')).toBeUndefined();
    expect(declsFor('.chip--menu > .chip__button').get('background')).toBe('var(--panel-alt)');
  });

  it('raises the chip whose menu is open to the menus, over the cards (polish.10 review)', () => {
    /* Its list is drawn inside it. polish.10 raised a chip by 1 under the
       pointer or the keyboard's focus as well, and the open chip's rule once
       lost to those (0,1,0 against 0,2,0), so its menu opened under the
       notification cards. The ▾ went with polish.11, and those rules with it;
       any rule that sets a chip's z-index again must lose to the open chip's. */
    const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((match) => {
      const body = match[2] ?? '';
      const z = /(?:^|;)\s*z-index\s*:\s*(\d+)/.exec(body);
      if (!z) return [];
      return (match[1] ?? '')
        .split(',')
        .map((selector) => selector.trim())
        .filter((selector) => /^\.chip(?:--menu)?(?=[.:]|$)/.test(selector))
        .filter((selector) => !/[\s>+~]/.test(selector.replace(/\([^()]*\)/g, '')))
        .map((selector) => ({ selector, at: match.index, z: Number(z[1]) }));
    });
    // The helper counts as CSS does.
    expect(specificity('.chip--menu')).toEqual([0, 1, 0]);
    expect(specificity('.chip:hover')).toEqual([0, 2, 0]);
    expect(specificity('.chip:has(:focus-visible)')).toEqual([0, 2, 0]);
    expect(specificity('.chip.chip--menu')).toEqual([0, 2, 0]);
    expect(specificity('#a :where(.b) p::before')).toEqual([1, 0, 2]);
    const open = rules.filter((rule) => rule.selector.includes('chip--menu'));
    const others = rules.filter((rule) => !rule.selector.includes('chip--menu'));
    expect(open).toHaveLength(1);
    expect(others).toEqual([]);
    const menu = open[0] ?? { selector: '', at: -1, z: 0 };
    expect(menu.selector).toBe('.chip.chip--menu');
    for (const other of others) {
      const order = compareSpecificity(specificity(menu.selector), specificity(other.selector));
      expect(
        order > 0 || (order === 0 && menu.at > other.at),
        `${menu.selector} over ${other.selector}`
      ).toBe(true);
    }
    // At the menus' layer, over the notification cards, the lock card, the first-use hint and a drawer.
    expect(menu.z).toBe(Number(declsFor('.menu__list').get('z-index')));
    for (const card of ['.notes', '.lock-card', '.save-hint', '.column--drawer']) {
      expect(menu.z, card).toBeGreaterThan(Number(declsFor(card).get('z-index')));
    }
  });

  it('shows the list only once it is placed, before its first item takes the focus (polish.10 review)', () => {
    // Placed under the chip, then shown: it is hidden until then (app.css), and a hidden item takes no focus.
    expect(CHIPS).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!shown\) return;\s*const place = \(\): void => \{\s*const chip = ref\.current\?\.getBoundingClientRect\(\);\s*const menu = listRef\.current;\s*if \(!chip \|\| !menu\) return;\s*const at = chipMenuPlacement\(chip, menu\.offsetWidth, document\.documentElement\.clientWidth\);\s*menu\.style\.left = `\$\{at\.left\}px`;\s*menu\.style\.top = `\$\{at\.top\}px`;\s*menu\.style\.visibility = 'visible';\s*\};\s*place\(\);/
    );
    // That layout effect runs as the list is drawn, inside openOn's flushSync, so before the item is focused.
    expect(MENU).toMatch(
      /const openOn = \(where: 'first' \| 'last'\): void => \{\s*flushSync\(\(\) => setOpen\(true\)\);\s*focusItem\(where === 'first' \? firstEnabled\(enabled\) : lastEnabled\(enabled\)\);/
    );
  });

  it('fades a hidden chip, but not the menu drawn inside it', () => {
    expect(declsFor('.chip--off').get('opacity')).toBeUndefined();
    expect(declsFor('.chip--off > .chip__button').get('opacity')).toBe('0.4');
  });
});

describe('the eye and the You chip (polish.11)', () => {
  it('puts the eye first, before the row, open while every chip is shown, named by what it does', () => {
    const bar = CHIPS.indexOf('<div className={`chips-bar');
    const eye = CHIPS.indexOf('className="chips__eye"');
    const view = CHIPS.indexOf('<div className="chips-view">');
    expect(bar).toBeGreaterThan(0);
    expect(eye).toBeGreaterThan(bar);
    expect(view).toBeGreaterThan(eye);
    expect(CHIPS).toMatch(
      /className="chips__eye"\s+aria-label=\{eye\}\s+title=\{eye\}\s+onClick=\{\(\) => \(allShown \? setHiddenCategories\(keys\) : clearCategoryFilter\(\)\)\}\s*>\s*\{allShown \? <IconEye \/> : <IconEyeClosed \/>\}/
    );
    expect(CHIPS).toContain('const allShown = allChipsShown(keys, hidden);');
    expect(CHIPS).toContain('const eye = eyeLabel(allShown);');
    // In the bar, so it is faded and inert with the chips while a review of the chapter runs.
    expect(CHIPS).toContain("<div className={`chips-bar${locked ? ' chips--locked' : ''}`} inert={locked}>");
    expect(declsFor('.chips__eye').get('flex')).toBe('none');
  });

  it('draws You in the colour of the YOU tag on its rows', () => {
    // Since polish.12 every row's tag takes its chip's colour, the YOU tag You's.
    expect(declsFor('.row__cat').get('color')).toBe('var(--cat)');
    expect(declsFor('.cat-you').get('--cat')).toBe('var(--accent)');
    expect(declsFor('.chip__button').get('color')).toBe('var(--cat, var(--ink))');
    expect(CHIPS).toContain('className={`chip cat-${chip}');
  });

  it("draws the comments chip in the colour of a margin card's head (polish.13)", () => {
    // A card's category word is var(--cat, var(--ink-soft)): --ink-soft for every comment category without a colour.
    expect(declsFor('.cat-comments').get('--cat')).toBe('var(--ink-soft)');
    expect(declsFor('.note-card__cat').get('color')).toBe('var(--cat, var(--ink-soft))');
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
      "if (!(target instanceof HTMLElement) || !target.classList.contains('chip__button')) return;"
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
    // Translucent, over the chips and under the menus.
    expect(arrow.get('background')).toBe('color-mix(in srgb, var(--panel) 80%, transparent)');
    expect(Number(arrow.get('z-index'))).toBeGreaterThan(0);
    expect(Number(arrow.get('z-index'))).toBeLessThan(Number(declsFor('.menu__list').get('z-index')));
    expect(declsFor('.chips__arrow--start').get('left')).toBe('0');
    expect(declsFor('.chips__arrow--end').get('right')).toBe('0');
  });

  it('draws a 2 px line under the row while the chips overflow, its thumb where the row stands', () => {
    // What the row shows, from chipsView, kept while it draws the same (test/shared/chips.test.ts).
    expect(CHIPS).toContain('const [view, setView] = useState<ChipsView>(CHIPS_FIT);');
    expect(CHIPS).toMatch(
      /const next = chipsView\(row\);\s*setView\(\(prev\) => \(sameChipsView\(prev, next\) \? prev : next\)\);/
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

describe("Actions lists the chip the focus was last on (polish.10), and the eye's two (polish.11)", () => {
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
    chipFocused('you');
    toolbarFocusLeft(false, false);
    expect(useChipFocus.getState().category).toBeNull();
  });

  it('adds its two items after Reset, for a chip that is drawn, and forgets it as the focus leaves the toolbar', () => {
    expect(TOOLBAR).toContain('const lastChip = useChipFocus((s) => s.category);');
    // Not for the comments chip, which has neither (polish.13): suggestionChip gives null for it.
    expect(TOOLBAR).toMatch(
      /const focusedChip =\s*chipShown && lastChip !== null && chips\.includes\(lastChip\) \? suggestionChip\(lastChip\) : null;/
    );
    expect(TOOLBAR).toMatch(
      /label: chipBulkLabel\('accept', focusedChip\),\s*onSelect: \(\) => runBulk\('accept', focusedChip\),\s*disabled: bulkOff,\s*title: bulkTitle,\s*separated: true/
    );
    expect(TOOLBAR).toMatch(
      /label: chipBulkLabel\('dismiss', focusedChip\),\s*onSelect: \(\) => runBulk\('dismiss', focusedChip\),\s*disabled: bulkOff,\s*title: bulkTitle/
    );
    const reset = TOOLBAR.indexOf("{ label: 'Reset'");
    const chip = TOOLBAR.indexOf('...chipItems,');
    const categories = TOOLBAR.indexOf('...categoryItems,');
    const copy = TOOLBAR.indexOf("{ label: 'Copy result'");
    expect(chip).toBeGreaterThan(reset);
    expect(categories).toBeGreaterThan(chip);
    expect(copy).toBeGreaterThan(categories);
    expect(TOOLBAR).toMatch(
      /onBlur=\{\(event\) => \{\s*const next = event\.relatedTarget;\s*toolbarFocusLeft\(\s*next instanceof Node \? event\.currentTarget\.contains\(next\) : null,\s*document\.hasFocus\(\)\s*\);/
    );
    expect(CHIPS).toContain('onFocus={() => chipFocused(chip)}');
    // And watches the page for the way out onBlur misses (below).
    expect(TOOLBAR).toContain('ref={headerRef}');
    expect(TOOLBAR).toMatch(
      /useEffect\(\(\) => \{\s*const header = headerRef\.current;\s*if \(!header\) return undefined;\s*return watchToolbarFocus\(document, \(target\) => target instanceof Node && header\.contains\(target\)\);\s*\}, \[\]\);/
    );
  });

  it('lists Show all categories and Hide all categories under a line while the chips are drawn, each off when it would do nothing', () => {
    expect(TOOLBAR).toMatch(
      /const categoryItems: MenuItem\[\] =\s*chipShown && chips\.length > 0\s*\? \[\s*\{\s*label: SHOW_ALL_CATEGORIES,\s*onSelect: clearCategoryFilter,\s*disabled: allChipsShown\(chips, hidden\),\s*separated: true\s*\},\s*\{\s*label: HIDE_ALL_CATEGORIES,\s*onSelect: \(\) => setHiddenCategories\(chips\),\s*disabled: allChipsHidden\(chips, hidden\)\s*\}\s*\]\s*: \[\];/
    );
  });
});

describe('the toolbar watches the page for the focus leaving it (polish.10 review)', () => {
  /* A menu open in the toolbar closes on a press outside before the press
     moves the focus, so its focused item leaves the page first and the
     toolbar's onBlur hears nothing: after a right-click on a chip and a click
     in the chapter's text, Actions still listed the chip's items. The page is
     a stand-in for `document`; the toolbar holds the chip and an item of its
     menu, and the text and a margin mark (which keeps the focus where it is,
     as a press on it is stopped) are outside. */
  const CHIP = { is: 'chip' };
  const ITEM = { is: 'menu item' };
  const TEXT = { is: 'text' };
  const MARK = { is: 'margin mark' };
  const inToolbar = (target: unknown): boolean => target === CHIP || target === ITEM;
  type Listener = (event: { target: unknown }) => void;

  function page(): WatchedPage & {
    activeElement: unknown;
    focused: boolean;
    listeners: Map<string, Listener>;
    send: (type: 'focusin' | 'pointerdown', target: unknown) => void;
  } {
    const listeners = new Map<string, Listener>();
    return {
      activeElement: ITEM,
      body: { is: 'body' },
      focused: true,
      listeners,
      hasFocus() {
        return this.focused;
      },
      addEventListener(type, listener, capture) {
        // In the capture phase, so a press a handler stops still counts.
        expect(capture).toBe(true);
        listeners.set(type, listener);
      },
      removeEventListener(type, listener, capture) {
        if (capture && listeners.get(type) === listener) listeners.delete(type);
      },
      send(type, target) {
        listeners.get(type)?.({ target });
      }
    };
  }

  afterEach(() => {
    vi.useRealTimers();
    useChipFocus.setState({ category: null });
  });

  it('forgets the chip once a press outside has closed the menu whose item had the focus', () => {
    vi.useFakeTimers();
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    chipFocused('homophone');
    doc.send('pointerdown', TEXT);
    // Not yet: the press has not moved the focus.
    expect(useChipFocus.getState().category).toBe('homophone');
    // The menu closes, its item goes, and the press lands on what takes no focus.
    doc.activeElement = doc.body;
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBeNull();
    stop();
  });

  it('forgets it when the press gives the focus to something outside', () => {
    vi.useFakeTimers();
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    chipFocused('typo');
    doc.send('pointerdown', TEXT);
    doc.activeElement = TEXT;
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBeNull();
    stop();
  });

  it('keeps it for a press outside that leaves the focus in the toolbar, or in a window that lost the focus', () => {
    vi.useFakeTimers();
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    chipFocused('grammar');
    doc.activeElement = CHIP;
    doc.send('pointerdown', MARK);
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBe('grammar');
    // The focus on nothing, as the window itself has lost it.
    doc.activeElement = doc.body;
    doc.focused = false;
    doc.send('pointerdown', TEXT);
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBe('grammar');
    stop();
  });

  it('leaves a press in the toolbar to the toolbar', () => {
    vi.useFakeTimers();
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    chipFocused('tense');
    doc.activeElement = doc.body;
    doc.send('pointerdown', CHIP);
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBe('tense');
    stop();
  });

  it('forgets it as the focus arrives anywhere outside the toolbar, and not inside it', () => {
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    chipFocused('spelling');
    doc.send('focusin', ITEM);
    expect(useChipFocus.getState().category).toBe('spelling');
    doc.send('focusin', TEXT);
    expect(useChipFocus.getState().category).toBeNull();
    stop();
  });

  it('stops watching, a press still settling included, when the toolbar goes', () => {
    vi.useFakeTimers();
    const doc = page();
    const stop = watchToolbarFocus(doc, inToolbar);
    expect([...doc.listeners.keys()].sort()).toEqual(['focusin', 'pointerdown']);
    chipFocused('other');
    doc.send('pointerdown', TEXT);
    doc.activeElement = doc.body;
    stop();
    vi.runAllTimers();
    expect(useChipFocus.getState().category).toBe('other');
    expect(doc.listeners.size).toBe(0);
  });
});

/* polish.13: the source around the comments chip. What the toolbar, the
   review pane and the side panel draw with it is rendered in
   test/renderer/commentsChip.render.test.ts. */
describe('the comments chip, in the source (polish.13)', () => {
  it('hands the margin no card while the comments are hidden, and so no margin column', () => {
    const PANE = read('components/ReviewPane.tsx');
    expect(PANE).toContain('const commentsOff = commentsHidden(hiddenCategories);');
    expect(PANE).toMatch(/\(\) => \(commentsOff \? \[\] : gutterCommentsOf\(review\.comments\)\),/);
    expect(PANE).toContain(
      'const showGutter = layout.width >= GUTTER_MIN_WIDTH && gutterComments.length > 0;'
    );
    expect(PANE).toMatch(/<MarginNotes\s+comments=\{gutterComments\}/);
  });

  it('lets n go nowhere while they are hidden', () => {
    const KEYS = read('state/keyboard.ts');
    expect(KEYS).toContain(
      'const next = nextComment(review.comments, current, commentsHidden(state.hiddenCategories));'
    );
    expect(KEYS).toMatch(/if \(!next\) return;\s*state\.setActiveComment\(next\.id\);/);
  });

  it('says so in the legend, beside the chips and the eye', () => {
    const LEGEND = read('components/StatusBar.tsx').replace(/\s+/g, ' ');
    expect(LEGEND).toContain('The comments chip, before You, counts the open comments;');
    expect(LEGEND).toContain('hiding it hides the comments in the margin and in the side panel');
    expect(LEGEND).toContain('shows or hides them all, the comments included.');
  });
});
