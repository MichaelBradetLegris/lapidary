import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { ColumnShares, Settings } from '../../src/shared/types';
import { EDGE_STRIP_WIDTH, USUAL_COLUMN_WIDTHS } from '../../src/shared/ui/columns';
import { createColumnWrites, type ColumnIo } from '../../src/renderer/state/columnWidths';
import { useApp } from '../../src/renderer/state/store';

/* polish.26: the caret at the top of each column's handle folds the column
   away to the edge strip, whose caret brings it back. The writes run here
   against a stand-in for main; the rest are source checks, as the tests run
   without a DOM or Electron. The layout is in test/shared/columns.test.ts and
   the caret's words in test/shared/columnHandle.test.ts; the window checks (a
   fold, a restart and an unfold, the keys, both themes) are in PLAN
   (polish.26). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const APP = read('renderer/App.tsx');
const CARET = read('renderer/components/ColumnCaret.tsx');
const HANDLES = read('renderer/state/columnHandles.ts');
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

describe('folding a column away and back (polish.26, 11.3 d)', () => {
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

  it('shares the one writer with the widths, so a fold and a drag never write over each other', async () => {
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

describe('the carets on the page', () => {
  it("draws a column's caret beside its handle while it is in place, and its edge strip while it is folded away", () => {
    expect(APP).toContain(`{layout.files === 'full' ? <ColumnCaret column="files" hidden={false} /> : null}`);
    expect(APP).toContain(`{layout.files === 'hidden' ? <ColumnCaret column="files" hidden /> : null}`);
    expect(APP).toContain(`{layout.side === 'full' ? <ColumnCaret column="side" hidden={false} /> : null}`);
    expect(APP).toContain(`{layout.side === 'hidden' ? <ColumnCaret column="side" hidden /> : null}`);
  });

  it('puts each caret before its handle in the Tab order, and the edge strips where the columns were', () => {
    const order = [
      '<ColumnStrip column="files"',
      '<ColumnCaret column="files" hidden />',
      "id={drawerId('files')}",
      '<FileList',
      '<ColumnCaret column="files" hidden={false} />',
      '{filesHandle ? <div {...filesHandle} /> : null}',
      '<div className="center-col">',
      '<ColumnCaret column="side" hidden={false} />',
      '{sideHandle ? <div {...sideHandle} /> : null}',
      '<ColumnCaret column="side" hidden />',
      '<ColumnStrip column="side"',
      "id={drawerId('side')}",
      '<SidePanel'
    ].map((mark) => APP.indexOf(mark));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('is a plain button named for what it does, which a press by the pointer leaves the focus beside', () => {
    expect(CARET).toContain('const text = columnCaretText(column, hidden);');
    for (const part of [
      'type="button"',
      'aria-label={text}',
      'aria-controls={drawerId(column)}',
      'title={text}',
      'className={hidden ? `column-edge column-edge--${column}` : `column-caret column-caret--${column}`}',
      '<IconColumnCaret points={columnCaretPoints(column, hidden)} />'
    ]) {
      expect(CARET, part).toContain(part);
    }
    // No aria-expanded: the name says what a press does, and changes with it.
    expect(CARET).not.toContain('aria-expanded');
    expect(CARET).toMatch(
      /onPointerDown=\{\(event: PointerEvent<HTMLButtonElement>\) => \{\s*if \(event\.button === 0\) event\.preventDefault\(\);/
    );
    expect(CARET).toContain('onClick={(event) => setColumnHidden(column, !hidden, event.currentTarget)}');
  });

  it('lays the columns out again before the focus follows, to the caret taking its place or out of the column folded away', () => {
    expect(HANDLES).toMatch(
      /const active = document\.activeElement;\s*const follow =\s*active === pressed \|\| \(hidden && Boolean\(document\.getElementById\(drawerId\(column\)\)\?\.contains\(active\)\)\);\s*flushSync\(\(\) => \{\s*void saveColumnHidden\(column, hidden, COLUMN_IO\);\s*\}\);\s*if \(follow\) document\.querySelector<HTMLElement>\(caretSelector\(column, hidden\)\)\?\.focus\(\);/
    );
    expect(HANDLES).toMatch(
      /return hidden \? `button\.column-edge--\$\{column\}` : `button\.column-caret--\$\{column\}`;/
    );
  });
});

describe('the carets in app.css', () => {
  it("lies at the top of the handle's band, as wide, beside the first rows, above the band and under the drawers", () => {
    const caret = declsFor('.column-caret');
    const band = declsFor('.column-handle');
    expect(caret.get('position')).toBe('absolute');
    expect(caret.get('width')).toBe(band.get('width'));
    expect(caret.get('width')).toBe(`${EDGE_STRIP_WIDTH}px`);
    expect(caret.get('top')).toBe('8px');
    expect(caret.get('height')).toBe('24px');
    expect(Number(caret.get('z-index'))).toBeGreaterThan(Number(band.get('z-index')));
    expect(Number(caret.get('z-index'))).toBeLessThan(Number(declsFor('.column--drawer').get('z-index')));
    expect(declsFor('.column-caret--files').get('left')).toBe(declsFor('.column-handle--files').get('left'));
    expect(declsFor('.column-caret--side').get('right')).toBe(declsFor('.column-handle--side').get('right'));
  });

  it("draws the chevron in the grip's faint grey, the line and the chevron darker under the pointer", () => {
    const caret = declsFor('.column-caret');
    expect(caret.get('background')).toBe('none');
    expect(caret.get('border')).toBe('none');
    expect(caret.get('color')).toBe('var(--ink-faint)');
    expect(declsFor('.column-handle::after').get('background')).toBe('var(--ink-faint)');
    const hover = declsFor('button.column-caret:hover');
    expect(hover.get('border-left')).toBe('1px solid var(--border-strong)');
    expect(hover.get('color')).toBe('var(--ink-soft)');
    expect(hover.get('background')).toBe('var(--panel-alt)');
  });

  it("draws the edge strip in the column's colours, its border on the inner side, the chevron where the caret had it", () => {
    const edge = declsFor('.column-edge');
    expect(edge.get('background')).toBe('var(--panel)');
    expect(edge.get('color')).toBe('var(--ink-faint)');
    expect(edge.get('border')).toBe('none');
    expect(declsFor('.column-edge--files').get('border-right')).toBe('1px solid var(--border)');
    expect(declsFor('.column-edge--side').get('border-left')).toBe('1px solid var(--border)');
    // The chevron, 10 px tall, centred in the caret's 24 px from 8 px down: 15 px from the top.
    expect(edge.get('padding')).toBe('15px 0 0');
    expect(declsFor('button.column-edge:hover').get('background')).toBe('var(--panel-alt)');
    expect(declsFor('button.column-edge:hover').get('color')).toBe('var(--ink-soft)');
    // Its width is the grid column columnLayout gives it: no width of its own.
    expect(edge.has('width')).toBe(false);
  });

  it('leaves the focus ring to the browser on both', () => {
    expect(CSS).not.toMatch(/\.column-(caret|edge)[^{]*\{[^}]*outline/);
  });
});
