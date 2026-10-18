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
    expect(HOOK).toContain('const layout = useMemo(() => columnLayout(width), [width]);');
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
    expect(HOOK).toMatch(/setOpen\(toggledDrawer\(now, column\)\)/);
    expect(APP).toContain("onToggle={() => toggleDrawer('files')}");
  });

  it('with a press in the prose', () => {
    expect(APP).toMatch(
      /<main\s+className="center"\s+onPointerDown=\{\(\) => \{\s*if \(useDrawer\.getState\(\)\.open !== null\) useDrawer\.getState\(\)\.setOpen\(null\);\s*\}\}\s*>/
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
    const first = KEYS.indexOf("if (event.key === 'Escape' && drawerOpen && inOpenDrawer(event.target)) {");
    const editor = KEYS.indexOf("if (event.key === 'Escape' && state.editor && !isModalOpen(state)) {");
    const find = KEYS.indexOf("if (event.key === 'Escape' && state.find.open && !isModalOpen(state)) {");
    const last = KEYS.indexOf("if (event.key === 'Escape' && drawerOpen) {");
    expect(first).toBeGreaterThan(0);
    expect(editor).toBeGreaterThan(first);
    expect(find).toBeGreaterThan(editor);
    expect(last).toBeGreaterThan(find);
    // Never behind a dialog, whose Escape it is.
    expect(KEYS).toContain('const drawerOpen = useDrawer.getState().open !== null && !isModalOpen(state);');
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
      /for \(const column of document\.querySelectorAll\('\.body \.side, \.body > \.center-wrap'\)\) \{\s*observer\.observe\(column\);\s*\}/
    );
  });
});
