import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILES_WIDTHS, NARROW_PANE_PADDING, SIDE_WIDTHS } from '../../src/shared/ui/columns';

/* ui.3 (found by the M5 review): the side columns give way to the prose in a
   narrow window. The layout is `columnLayout`, tested in
   test/shared/columns.test.ts; these are source checks of how the page
   applies it, since the tests run without a DOM. The window checks (900 by 600
   from 100% to 200%, both themes) are in PLAN (ui.3). */

const RENDERER = path.join(__dirname, '../../src/renderer');
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));

const APP = read('App.tsx');
const HOOK = read('state/columns.ts');
const STRIP = read('components/ColumnStrip.tsx');
const KEYS = read('state/keyboard.ts');
const HINT = read('components/SaveHint.tsx');
// A menu's behaviour is useMenu's since polish.10 (the toolbar's and a chip's).
const MENU =
  read('components/ToolbarMenu.tsx') + read('components/useMenu.ts') + read('components/MenuList.tsx');
const STATUS = read('components/StatusBar.tsx');
const FIND = read('components/FindBar.tsx');
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

const z = (selector: string): number => Number(declsFor(selector).get('z-index'));

describe('the page measures itself and lays the columns out (ui.3)', () => {
  it('measures .body, which spans the window, and renders the new layout before the frame is painted', () => {
    expect(HOOK).toContain('const [width, setWidth] = useState(() => window.innerWidth);');
    expect(HOOK).toMatch(
      /new ResizeObserver\(\(\) => flushSync\(\(\) => setWidth\(element\.clientWidth\)\)\);\s*observer\.observe\(element\);\s*return \(\) => observer\.disconnect\(\);/
    );
    // With the widths kept in settings, or a drag's while it lasts (polish.5).
    expect(HOOK).toContain('const kept = live ?? saved;');
    expect(HOOK).toContain('const layout = useMemo(() => columnLayout(width, kept), [width, kept]);');
    expect(APP).toContain('<div className={bodyClassName(layout)} style={columnStyle} ref={measureBody}>');
  });

  it('hands app.css the widths as the custom properties it lays the grid out with', () => {
    for (const [name, field] of [
      ['--files-col', 'filesWidth'],
      ['--side-col', 'sideWidth'],
      ['--files-drawer', 'filesDrawer'],
      ['--side-drawer', 'sideDrawer']
    ]) {
      expect(HOOK).toContain(`'${name}': \`\${layout.${field}}px\``);
    }
    const body = declsFor('.body');
    expect(body.get('grid-template-columns')).toBe('var(--files-col) minmax(0, 1fr) var(--side-col)');
    expect(body.get('position')).toBe('relative');
    // Until the page sets them: the widths before ui.3, which columnLayout keeps.
    expect(body.get('--files-col')).toBe(
      `clamp(${FILES_WIDTHS.min}px, ${FILES_WIDTHS.share * 100}vw, ${FILES_WIDTHS.max}px)`
    );
    expect(body.get('--side-col')).toBe(
      `clamp(${SIDE_WIDTHS.min}px, ${SIDE_WIDTHS.share * 100}vw, ${SIDE_WIDTHS.max}px)`
    );
  });

  it('forgets a drawer once its column is drawn in place again', () => {
    expect(HOOK).toContain('const shown = shownDrawer(open, layout, hasReview);');
    expect(HOOK).toMatch(
      /useEffect\(\(\) => \{\s*if \(open !== null && shown === null\) useDrawer\.getState\(\)\.setOpen\(null\);\s*\}, \[open, shown\]\);/
    );
  });
});

describe('each column is in place, or a strip and a drawer (ui.3)', () => {
  it('keeps both wrappers in the tree whatever the layout, so a column keeps its state', () => {
    for (const column of ['files', 'side']) {
      expect(APP).toMatch(
        new RegExp(
          `<div\\s+id=\\{drawerId\\('${column}'\\)\\}\\s+className=\\{columnClassName\\('${column}', layout, shown\\)\\}\\s+inert=\\{layout\\.${column} === 'strip' && shown !== '${column}'\\}\\s*>`
        )
      );
    }
    // The strips come before their drawers, so Tab goes from a strip into its drawer.
    const order = [
      '<ColumnStrip column="files"',
      "id={drawerId('files')}",
      '<FileList',
      '<div className="center-col">',
      '<div className={`center-wrap',
      '<ColumnStrip column="side"',
      "id={drawerId('side')}",
      '<SidePanel'
    ].map((mark) => APP.indexOf(mark));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('gives the side panel no strip button while nothing is open', () => {
    expect(APP).toMatch(
      /review \? \(\s*<ColumnStrip column="side" open=\{shown === 'side'\} onToggle=\{\(\) => toggleDrawer\('side'\)\} \/>\s*\) : \(\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<div className="strip strip--side strip--empty" \/>/
    );
  });

  it('draws a strip as one button that names its column and says whether its drawer is open', () => {
    expect(STRIP).toContain('aria-label={text.label}');
    expect(STRIP).toContain('aria-expanded={open}');
    expect(STRIP).toContain('aria-controls={drawerId(column)}');
    expect(STRIP).toContain('title={text.title}');
    expect(STRIP).toContain('className={`strip strip--${column}`}');
    expect(STRIP).toContain('<span className="strip__label" aria-hidden="true">');
  });

  it('lays a column in place out as before, and a folded one over the edge of the prose beside its strip', () => {
    expect(declsFor('.column').get('display')).toBe('contents');
    const drawer = declsFor('.column--drawer');
    expect(drawer.get('position')).toBe('absolute');
    expect(drawer.get('top')).toBe('0');
    expect(drawer.get('bottom')).toBe('0');
    expect(drawer.get('visibility')).toBe('hidden');
    expect(declsFor('.column--open').get('visibility')).toBe('visible');
    expect(declsFor('.column--files.column--drawer').get('left')).toBe('var(--files-col)');
    expect(declsFor('.column--files.column--drawer').get('width')).toBe('var(--files-drawer)');
    expect(declsFor('.column--side.column--drawer').get('right')).toBe('var(--side-col)');
    expect(declsFor('.column--side.column--drawer').get('width')).toBe('var(--side-drawer)');
  });

  /* ui.3 review: while a review of the chapter runs the side panel fades,
     its own background with it, and a drawer without one let the prose show
     through it. */
  it('gives a drawer the page background that lies under the column in place, so a faded panel hides the prose', () => {
    expect(declsFor('.side--locked').get('opacity')).toBe('0.4');
    expect(declsFor('.column--drawer').get('background')).toBe('var(--bg)');
    expect(declsFor('body').get('background')).toBe('var(--bg)');
  });

  it('puts a drawer above the page but under the hint, the cards and everything else that floats', () => {
    const drawer = z('.column--drawer');
    expect(drawer).toBeGreaterThan(0);
    expect(drawer).toBeLessThan(z('.save-hint'));
    expect(drawer).toBeLessThan(z('.notes'));
    expect(drawer).toBeLessThan(z('.lock-card'));
    expect(drawer).toBeLessThan(z('.menu__list'));
    expect(drawer).toBeLessThan(z('.modal-backdrop'));
    expect([...CSS.matchAll(/z-index:\s*(\d+)/g)].filter((m) => Number(m[1]) === drawer)).toHaveLength(1);
  });

  it('narrows the pane padding when even both strips leave the centre less than PROSE_MIN', () => {
    const narrow = declsFor('.body--narrow .pane');
    expect(narrow.get('padding-left')).toBe(`${NARROW_PANE_PADDING}px`);
    expect(narrow.get('padding-right')).toBe(`${NARROW_PANE_PADDING}px`);
  });
});

describe('how a drawer closes (ui.3)', () => {
  it('from its strip, which opens one drawer at a time', () => {
    expect(HOOK).toMatch(/const next = toggledDrawer\(now, column\);[\s\S]*?setOpen\(next\);/);
    expect(APP).toContain("onToggle={() => toggleDrawer('files')}");
  });

  it('with a press in the prose', () => {
    // In every mode (rr.2): the scroller is the same element, its class naming
    // the mode, and it keeps each mode's place (`useModePlaces`, its ref and
    // onScroll spread onto it).
    expect(APP).toMatch(
      /<main\s+\{\.\.\.modePlaces\}\s+className=\{`center center--\$\{mode\}`\}\s+onPointerDown=\{closeDrawerOnPress\}\s*>/
    );
    expect(APP).toContain('const modePlaces = useModePlaces(mode, review?.sourcePath ?? null);');
    expect(HOOK).toMatch(
      /export function closeDrawerOnPress\(\): void \{\s*if \(useDrawer\.getState\(\)\.open !== null\) useDrawer\.getState\(\)\.setOpen\(null\);\s*\}/
    );
  });

  it("and on Full edit's foot under the scroller, which was in it until rr.7 (rr.7 review)", () => {
    // Done and Cancel close the drawer as well as doing their own work, as they did in the scroller.
    expect(APP).toContain('<FullEditFoot onPointerDown={closeDrawerOnPress} />');
    expect(read('components/FullEdit.tsx')).toMatch(
      /export function FullEditFoot\(\{ onPointerDown \}: \{ onPointerDown: \(\) => void \}\)[\s\S]*?<div className="fulledit__foot" onPointerDown=\{onPointerDown\}>/
    );
  });

  it('once a chapter is chosen from the list, or made with its +', () => {
    expect(APP).toMatch(
      /const openFromList = useCallback\(\s*\(file: ChapterFile\) => \{\s*closeDrawer\('files'\);\s*openChapter\(file\);\s*\},\s*\[openChapter\]\s*\);/
    );
    expect(APP).toContain('onOpen={openFromList}');
    expect(APP).toMatch(/openChapter\(file\);\s*closeDrawer\('files'\);\s*notify\('info', `Created/);
  });

  it('with Escape: first when the focus is in it or on its strip, else after the suggestion editor and the find bar', () => {
    const first = KEYS.indexOf('if (drawerEscape && inOpenDrawer(event.target)) {');
    const editor = KEYS.indexOf("if (event.key === 'Escape' && state.editor && !isModalOpen(state)) {");
    const find = KEYS.indexOf("if (event.key === 'Escape' && state.find.open && !isModalOpen(state)) {");
    const last = KEYS.indexOf('if (drawerEscape) {');
    expect(first).toBeGreaterThan(0);
    expect(editor).toBeGreaterThan(first);
    expect(find).toBeGreaterThan(editor);
    expect(last).toBeGreaterThan(find);
    expect(KEYS.match(/drawerEscape/g)).toHaveLength(3);
  });

  /* ui.3 review: with a drawer open and the focus in the find box, one Escape
     closed the find bar and the drawer. The box's own handler runs first, at
     React's root, and closes the bar; the window listener then found the bar
     closed and went on to the drawer. With the Bulk menu (now Actions, and
     Review beside it, polish.7) or the legend open,
     whose window listeners close them on Escape, the same press closed the
     drawer as well, or the drawer under the legend first. */
  it('with Escape, one thing a press: never behind a dialog, never one something else has taken, never under a menu', () => {
    expect(KEYS).toMatch(
      /const drawerEscape =\s*event\.key === 'Escape' &&\s*useDrawer\.getState\(\)\.open !== null &&\s*!isModalOpen\(state\) &&\s*!event\.defaultPrevented &&\s*!popupTakesEscape\(\);/
    );
    // What popupTakesEscape looks for is what the toolbar's menus (polish.7) and the legend draw.
    expect(HOOK).toContain("const CLOSES_ON_ESCAPE = '.menu__list, .legend';");
    expect(HOOK).toMatch(
      /export function popupTakesEscape\(\): boolean \{\s*return document\.querySelector\(CLOSES_ON_ESCAPE\) !== null;\s*\}/
    );
    expect(MENU).toMatch(
      /<div\s+ref=\{listRef\}\s+className=\{className \? `menu__list \$\{className\}` : 'menu__list'\}\s+role="menu"\s[^>]*onKeyDown=\{onListKey\}[^>]*>/
    );
    expect(STATUS).toContain('<div className="legend" ref={ref} role="dialog"');
    // Each takes the press it closes on, so it closes no drawer whichever runs first.
    for (const source of [MENU, STATUS]) {
      expect(source).toMatch(
        /const onKeyDown = \(event: KeyboardEvent\): void => \{\s*if \(event\.key !== 'Escape'\) return;\s*event\.preventDefault\(\);/
      );
    }
    // The find bar's box takes it before the window listener runs.
    expect(FIND).toMatch(/event\.key === 'Escape'\) \{\s*event\.preventDefault\(\);\s*close\(\);/);
  });

  it('hands the focus to the strip when it was inside the drawer', () => {
    expect(HOOK).toMatch(
      /const focusInside = drawer !== null && drawer\.contains\(document\.activeElement\);\s*setOpen\(null\);\s*if \(focusInside\) document\.querySelector<HTMLElement>\(`button\.strip--\$\{open\}`\)\?\.focus\(\);/
    );
  });
});

describe('the first-use hint keeps to the side panel wherever it is drawn (ui.3)', () => {
  it('measures the panel inside its wrapper, in place or as a drawer, open or not', () => {
    expect(HINT).toContain("document.querySelector('.body .side')?.getBoundingClientRect()");
    expect(HINT).not.toContain('.body > .side');
  });

  it('is placed again when the columns are laid out again, which the toolbar may not notice', () => {
    expect(HINT).toMatch(
      /for \(const column of document\.querySelectorAll\('\.body \.side, \.body > \.center-col'\)\) \{\s*observer\.observe\(column\);\s*\}/
    );
  });
});

/* ui.3 review: with the side panel folded the hint hung over the prose until
   Got it, at 200% in a 900 by 600 window over most of it, the paragraph
   editor's text and Done included. When it shows is `saveHintVisible`
   (test/shared/saveHint.test.ts) and the set-aside flag `saveHintGivesWay`
   (test/renderer/hints.test.ts); these check how the page feeds them. */
describe('the first-use hint gives way to the prose with the side panel folded (ui.3 review)', () => {
  it('knows the panel is folded, on the main layout only', () => {
    // Neither the Setup screen nor the welcome guide (setup.11) has a side panel.
    expect(APP).toContain('const singleScreen = setupOpen || welcomeOpen;');
    expect(APP).toContain("const sideFolded = layout.side === 'strip' && !singleScreen;");
    expect(APP).toContain('sideFolded={sideFolded}');
  });

  it('says it is over the prose while it is, and takes a press anywhere but on itself as the author going on', () => {
    expect(HINT).toMatch(
      /useEffect\(\(\) => \{\s*if \(!overProse\) return undefined;\s*useSaveHintAside\.setState\(\{ overProse: true \}\);/
    );
    expect(HINT).toMatch(
      /if \(event\.target instanceof Node && ref\.current\?\.contains\(event\.target\)\) return;\s*saveHintGivesWay\(\);/
    );
    expect(HINT).toContain("window.addEventListener('pointerdown', onPointerDown, true);");
    expect(HINT).toMatch(
      /window\.removeEventListener\('pointerdown', onPointerDown, true\);\s*useSaveHintAside\.setState\(\{ overProse: false \}\);\s*\};\s*\}, \[overProse\]\);/
    );
  });

  it('takes a review key, after it has acted, as the author going on', () => {
    const keys = KEYS.slice(KEYS.indexOf('switch (key)'));
    expect(keys).toMatch(
      /default:\s*return;\s*\}\s*event\.preventDefault\(\);\s*saveHintGivesWay\(\);\s*\};/
    );
  });

  it('takes a drawer opened, from the keyboard too, as the author going on', () => {
    expect(HOOK).toMatch(
      /const next = toggledDrawer\(now, column\);\s*if \(next !== null\) saveHintGivesWay\(\);\s*setOpen\(next\);/
    );
  });
});
