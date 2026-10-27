import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { ColumnShares, Settings } from '../../src/shared/types';
import { USUAL_COLUMN_WIDTHS } from '../../src/shared/ui/columns';
import { createColumnWrites, type ColumnIo } from '../../src/renderer/state/columnWidths';
import { useApp } from '../../src/renderer/state/store';

/* polish.28: each side column's button at an end of the toolbar hides it and
   brings it back, in place of polish.26's carets on the handles and their
   edge strips; a hidden column is drawn as nothing. The writes run here
   against a stand-in for main; the rest are source and CSS checks, as the
   tests run without a DOM or Electron. The toolbar as drawn is in
   panelButtons.render.test.ts, the layout and the words in
   test/shared/columns.test.ts, and the window checks (each column hidden and
   both, in both themes at 1424 by 900 and 900 by 600, a restart, the keys) in
   PLAN (polish.28). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const APP = read('renderer/App.tsx');
const BUTTON = read('renderer/components/PanelButton.tsx');
const TOOLBAR = read('renderer/components/Toolbar.tsx');
const HANDLES = read('renderer/state/columnHandles.ts');
const ICONS = read('renderer/components/icons.tsx');
const CSS = readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration for exactly this selector in app.css, the last of each property winning. */
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

/** A stand-in for main's settings store: patches merge into what it holds, as settingsStore does. */
function mainSettings(initial: Settings) {
  let disk = initial;
  const patches: Partial<Settings>[] = [];
  const holds: (() => void)[] = [];
  let holding = false;
  const io: ColumnIo = {
    setSettings: async (patch) => {
      patches.push(patch);
      if (holding) await new Promise<void>((resolve) => holds.push(resolve));
      disk = normalizeSettings({ ...disk, ...patch });
      return disk;
    }
  };
  return {
    io,
    patches,
    disk: () => disk,
    hold: () => {
      holding = true;
    },
    letGo: () => {
      holding = false;
      for (const release of holds.splice(0)) release();
    }
  };
}

const set = (patch: Partial<ColumnShares>): ColumnShares => ({ ...USUAL_COLUMN_WIDTHS, ...patch });
const withWidths = (columnWidths: ColumnShares): Settings => ({ ...defaultSettings(), columnWidths });

beforeEach(() => {
  useApp.setState({ settings: withWidths(USUAL_COLUMN_WIDTHS) });
});

describe('hiding a column and bringing it back (polish.28, 11.3 d)', () => {
  it('writes the flag through settings:set, keeping both widths, so the column comes back at its own', async () => {
    useApp.setState({ settings: withWidths(set({ files: 0.217697, side: 0.3 })) });
    const main = mainSettings(withWidths(set({ files: 0.217697, side: 0.3 })));
    const writes = createColumnWrites();
    await writes.hide('files', true, main.io);
    expect(main.patches).toEqual([{ columnWidths: set({ files: 0.217697, side: 0.3, filesHidden: true }) }]);
    expect(useApp.getState().settings?.columnWidths).toEqual(main.disk().columnWidths);
    await writes.hide('side', true, main.io);
    await writes.hide('files', false, main.io);
    expect(main.disk().columnWidths).toEqual(set({ files: 0.217697, side: 0.3, sideHidden: true }));
    // The flag as it is writes nothing.
    await writes.hide('side', true, main.io);
    expect(main.patches).toHaveLength(3);
  });

  it('shares the one writer with the widths, so a hide and a drag never write over each other', async () => {
    const main = mainSettings(withWidths(USUAL_COLUMN_WIDTHS));
    main.hold();
    const writes = createColumnWrites();
    void writes.save('side', 0.25, main.io);
    await Promise.resolve();
    void writes.hide('files', true, main.io);
    void writes.save('side', 0.3, main.io);
    expect(useApp.getState().settings?.columnWidths).toEqual(set({ side: 0.3, filesHidden: true }));
    main.letGo();
    await writes.flush();
    expect(main.patches).toEqual([
      { columnWidths: set({ side: 0.25 }) },
      { columnWidths: set({ side: 0.3, filesHidden: true }) }
    ]);
    expect(main.disk().columnWidths).toEqual(set({ side: 0.3, filesHidden: true }));
  });

  it('writes nothing without settings loaded', async () => {
    useApp.setState({ settings: null });
    const main = mainSettings(withWidths(USUAL_COLUMN_WIDTHS));
    await createColumnWrites().hide('side', true, main.io);
    expect(main.patches).toEqual([]);
  });
});

describe('the buttons in the source', () => {
  it("draws them in the toolbar, at its two ends, and nothing at the columns' edges", () => {
    expect(TOOLBAR).toContain("import { PanelButton } from './PanelButton';");
    expect(TOOLBAR).toContain('const panels = !singleScreen;');
    const order = [
      '<header',
      '<span className="toolbar__end">',
      '<PanelButton column="files" />',
      '<div className="toolbar__main">',
      '<ModeSelect />',
      'data-opens="settings"',
      '</div>',
      '<span className="toolbar__end">',
      'className="toolbar__icon toolbar__full-screen"',
      '{panels ? <PanelButton column="side" /> : null}',
      '</header>'
    ];
    let at = -1;
    for (const mark of order) {
      const next = TOOLBAR.indexOf(mark, at + 1);
      expect(next, mark).toBeGreaterThan(at);
      at = next;
    }
    expect(TOOLBAR).toMatch(
      /\{panels \? \(\s*<span className="toolbar__end">\s*<PanelButton column="files" \/>\s*<\/span>\s*\) : null\}/
    );
    expect(TOOLBAR.split('<PanelButton').length - 1).toBe(2);
    // The carets and their edge strips are gone, from the page and its styles.
    expect(existsSync(path.join(SRC, 'renderer/components/ColumnCaret.tsx'))).toBe(false);
    for (const gone of [
      'ColumnCaret',
      'column-caret',
      'column-edge',
      'IconColumnCaret',
      'EDGE_STRIP_WIDTH'
    ]) {
      expect(APP, gone).not.toContain(gone);
      expect(CSS, gone).not.toContain(gone);
      expect(ICONS, gone).not.toContain(gone);
      expect(HANDLES, gone).not.toContain(gone);
    }
    expect(APP).not.toContain('PanelButton');
  });

  it('is a plain button named for what it does, which hides its column or brings it back', () => {
    expect(BUTTON).toContain(
      'const hidden = useApp((s) => columnHidden(s.settings?.columnWidths ?? USUAL_COLUMN_WIDTHS, column));'
    );
    expect(BUTTON).toContain('const text = panelButtonText(column, hidden);');
    for (const part of [
      'type="button"',
      'className={`toolbar__icon toolbar__panel toolbar__panel--${column}`}',
      'aria-label={text}',
      'aria-controls={drawerId(column)}',
      'title={text}',
      'onClick={() => setColumnHidden(column, !hidden)}',
      '<Icon filled={!hidden} />'
    ]) {
      expect(BUTTON, part).toContain(part);
    }
    expect(BUTTON).toContain("const Icon = column === 'files' ? IconPanelLeft : IconPanelRight;");
    expect(BUTTON).not.toContain('aria-expanded');
    expect(BUTTON).not.toContain('aria-pressed');
    // A press takes the focus, as every toolbar button's does.
    expect(BUTTON).not.toContain('onPointerDown');
  });

  it('lays the columns out again before the focus follows from the column hidden or from what the layout took away', () => {
    expect(HANDLES).toMatch(
      /export function setColumnHidden\(column: Column, hidden: boolean\): void \{\s*const active = document\.activeElement;\s*const inColumn = hidden && Boolean\(active && document\.getElementById\(drawerId\(column\)\)\?\.contains\(active\)\);\s*flushSync\(\(\) => \{\s*void saveColumnHidden\(column, hidden, COLUMN_IO\);\s*\}\);\s*const takenAway = active !== null && !active\.isConnected;\s*if \(takenAway \|\| inColumn\) document\.querySelector<HTMLElement>\(panelButtonSelector\(column\)\)\?\.focus\(\);\s*\}/
    );
    expect(HANDLES).toMatch(/return `button\.toolbar__panel--\$\{column\}`;/);
    // The handle is drawn only while its column is in place, so a hide takes it away.
    expect(APP).toContain('{filesHandle ? <div {...filesHandle} /> : null}');
    expect(APP).toContain('{sideHandle ? <div {...sideHandle} /> : null}');
  });
});

describe('the toolbar and the columns in app.css', () => {
  it('keeps its ends out of the row that wraps, beside its first line, on its baseline', () => {
    const bar = declsFor('.toolbar');
    expect(bar.get('display')).toBe('flex');
    expect(bar.has('flex-wrap')).toBe(false);
    // The row's first item's words and an end's strut stand on one baseline,
    // so the ends stand where a button with words would on the first line,
    // whatever that line holds (in the window: the eye's own device pixel rows
    // at every zoom, and the select's middle with Review on the second row).
    expect(bar.get('align-items')).toBe('baseline');
    expect(bar.get('gap')).toBe('8px');
    expect(Object.fromEntries(declsFor('.toolbar__main'))).toMatchObject({
      flex: '1 1 auto',
      'min-width': '0',
      display: 'flex',
      'flex-wrap': 'wrap',
      'justify-content': 'flex-end',
      'align-items': 'center',
      gap: '6px 8px'
    });
    expect(Object.fromEntries(declsFor('.toolbar__end'))).toEqual({
      flex: 'none',
      display: 'flex',
      'align-items': 'center'
    });
    // The strut, the end's first item: a button's line, its padding above and
    // below and its border, unseen, with a button's baseline.
    expect(CSS.match(/\.toolbar__end::before/g)).toHaveLength(1);
    const strut = declsFor('.toolbar__end::before');
    expect(strut.get('content')).toBe(String.raw`'\200b'`);
    expect(strut.get('width')).toBe('0');
    expect(strut.get('padding-block')).toBe(declsFor('button').get('padding')?.split(' ')[0]);
    expect(strut.get('border-block')).toBe('1px solid');
    expect(declsFor('button').get('border')).toBe('1px solid var(--border)');
    expect(strut.get('visibility')).toBe('hidden');
    expect(declsFor('.toolbar__end > button + button').get('margin-left')).toBe('8px');
  });

  it("draws the three icon buttons at the eye's size and in its colour", () => {
    const icon = declsFor('.toolbar__icon');
    const eye = declsFor('.chips__eye');
    expect(icon.get('padding')).toBe('4px 6px');
    expect(icon.get('padding')).toBe(eye.get('padding'));
    expect(icon.get('color')).toBe('var(--ink-soft)');
    expect(icon.get('color')).toBe(eye.get('color'));
    expect(icon.get('flex')).toBe('none');
    expect(declsFor('.toolbar__icon svg').get('display')).toBe('block');
    expect(declsFor('.toolbar__full-screen').size).toBe(0);
    // Their 16 px icons.
    expect(ICONS).toMatch(/export function IconPanelLeft\(\{ size = 16, filled \}: PanelIconProps\)/);
    expect(ICONS).toMatch(/export function IconPanelRight\(\{ size = 16, filled \}: PanelIconProps\)/);
  });

  it("names the centre column's grid column, so a hidden list leaves the first one empty", () => {
    expect(declsFor('.center-col').get('grid-column')).toBe('2');
    expect(declsFor('.body').get('grid-template-columns')).toBe(
      'var(--files-col) minmax(0, 1fr) var(--side-col)'
    );
  });

  it('leaves the focus ring to the browser', () => {
    expect(CSS).not.toMatch(/\.toolbar__(icon|panel|end)[^{]*\{[^}]*outline/);
  });
});
