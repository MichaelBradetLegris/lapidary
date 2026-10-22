import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { ColumnShares, Settings } from '../../src/shared/types';
import { createColumnWrites, type ColumnIo } from '../../src/renderer/state/columnWidths';
import { useApp } from '../../src/renderer/state/store';

/* polish.5: the handles on the side columns' inner edges. The widths' writes
   are run here against a stand-in for main; the rest are source checks, as the
   tests run without a DOM or Electron. The rules are in
   test/shared/columnHandle.test.ts and the layout in test/shared/columns.test.ts;
   the window checks (real pointer drags, a restart, the keys, both limits in
   both themes) are in PLAN (polish.5). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const HANDLES = read('renderer/state/columnHandles.ts');
const COLUMNS = read('renderer/state/columns.ts');
const APP = read('renderer/App.tsx');
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
function mainSettings(initial: Settings, options: { fail?: boolean } = {}) {
  let disk = initial;
  const patches: Partial<Settings>[] = [];
  const holds: (() => void)[] = [];
  let holding = false;
  const io: ColumnIo = {
    setSettings: async (patch) => {
      patches.push(patch);
      if (holding) await new Promise<void>((resolve) => holds.push(resolve));
      if (options.fail) throw new Error('settings.json could not be read');
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

const withWidths = (columnWidths: ColumnShares): Settings => ({ ...defaultSettings(), columnWidths });
const USUAL: ColumnShares = { files: null, side: null };

beforeEach(() => {
  useApp.setState({ settings: withWidths(USUAL) });
});

describe('keeping the widths (polish.5, 11.3 d)', () => {
  it("writes a column's share through settings:set, the other column's as it was", async () => {
    useApp.setState({ settings: withWidths({ files: null, side: 0.3 }) });
    // Main holds a setting the page has not heard of yet, as after a zoom key.
    const main = mainSettings({ ...withWidths({ files: null, side: 0.3 }), zoom: 1.5 });
    const writes = createColumnWrites();
    await writes.save('files', 0.105337, main.io);
    expect(main.patches).toEqual([{ columnWidths: { files: 0.105337, side: 0.3 } }]);
    expect(main.disk().columnWidths).toEqual({ files: 0.105337, side: 0.3 });
    expect(useApp.getState().settings).toEqual(main.disk());
  });

  it('shows the width before the write ends, and a close waits for it', async () => {
    const main = mainSettings(withWidths(USUAL));
    main.hold();
    const writes = createColumnWrites();
    const done = writes.save('side', 0.4, main.io);
    expect(useApp.getState().settings?.columnWidths).toEqual({ files: null, side: 0.4 });
    let flushed = false;
    void writes.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    main.letGo();
    await done;
    expect(flushed).toBe(true);
    expect(main.disk().columnWidths).toEqual({ files: null, side: 0.4 });
  });

  it('writes a run of presses on both handles as the last, and an older answer never moves a handle back', async () => {
    const main = mainSettings(withWidths(USUAL));
    main.hold();
    const writes = createColumnWrites();
    void writes.save('files', 0.15, main.io);
    await Promise.resolve();
    void writes.save('files', 0.17, main.io);
    void writes.save('side', 0.3, main.io);
    void writes.save('files', 0.19, main.io);
    expect(useApp.getState().settings?.columnWidths).toEqual({ files: 0.19, side: 0.3 });
    main.letGo();
    main.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useApp.getState().settings?.columnWidths).toEqual({ files: 0.19, side: 0.3 });
    main.letGo();
    await writes.flush();
    expect(main.patches).toEqual([
      { columnWidths: { files: 0.15, side: null } },
      { columnWidths: { files: 0.19, side: 0.3 } }
    ]);
    expect(main.disk().columnWidths).toEqual({ files: 0.19, side: 0.3 });
    expect(useApp.getState().settings?.columnWidths).toEqual({ files: 0.19, side: 0.3 });
  });

  it('writes the usual width as null, and nothing for the widths on screen', async () => {
    useApp.setState({ settings: withWidths({ files: 0.2, side: 0.3 }) });
    const main = mainSettings(withWidths({ files: 0.2, side: 0.3 }));
    const writes = createColumnWrites();
    await writes.save('files', 0.2, main.io);
    expect(main.patches).toEqual([]);
    await writes.save('side', null, main.io);
    expect(main.patches).toEqual([{ columnWidths: { files: 0.2, side: null } }]);
    expect(main.disk().columnWidths).toEqual({ files: 0.2, side: null });
  });

  it('keeps the width on screen for the session when the write fails, and never rejects', async () => {
    const main = mainSettings(withWidths(USUAL), { fail: true });
    const writes = createColumnWrites();
    await expect(writes.save('files', 0.2, main.io)).resolves.toBeUndefined();
    expect(useApp.getState().settings?.columnWidths).toEqual({ files: 0.2, side: null });
    await expect(writes.flush()).resolves.toBeUndefined();
  });

  it('writes nothing without settings loaded', async () => {
    useApp.setState({ settings: null });
    const main = mainSettings(withWidths(USUAL));
    await createColumnWrites().save('files', 0.2, main.io);
    expect(main.patches).toEqual([]);
  });

  it('is waited for by a close, with the other page writes', () => {
    expect(read('renderer/state/pageIo.ts')).toMatch(/flushSplitWrites\(\),\s*flushColumnWrites\(\)/);
  });
});

describe('the handles on the page', () => {
  it('lays the columns out with a drag under way, or the widths in settings', () => {
    expect(COLUMNS).toContain(
      'const saved = useApp((s) => s.settings?.columnWidths ?? USUAL_COLUMN_WIDTHS);'
    );
    expect(COLUMNS).toContain('const [live, setLive] = useState<ColumnShares | null>(null);');
    expect(APP).toContain("const filesHandle = useColumnHandle('files', layout, setLiveWidths);");
    expect(APP).toContain("const sideHandle = useColumnHandle('side', layout, setLiveWidths);");
  });

  it('draws each handle after the list and before the side panel, in the Tab order too, and none for a folded column', () => {
    const order = [
      '<FileList',
      '{filesHandle ? <div {...filesHandle} /> : null}',
      '<div className="center-col">',
      '{sideHandle ? <div {...sideHandle} /> : null}',
      '<ColumnStrip column="side"',
      '<SidePanel'
    ].map((mark) => APP.indexOf(mark));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(HANDLES).toContain('const room = columnRoom(layout, column);');
    expect(HANDLES).toMatch(/if \(!room\) return null;/);
  });

  it('is a focusable vertical separator with a name, a value and a tooltip', () => {
    for (const part of [
      "role: 'separator'",
      "'aria-orientation': 'vertical'",
      "'aria-label': text.label",
      "'aria-controls': drawerId(column)",
      "'aria-valuenow': aria.valueNow",
      "'aria-valuemin': aria.valueMin",
      "'aria-valuemax': aria.valueMax",
      "'aria-valuetext': aria.valueText",
      "'aria-disabled': still ? true : undefined",
      'tabIndex: still ? -1 : 0',
      'title: text.title'
    ]) {
      expect(HANDLES, part).toContain(part);
    }
    expect(HANDLES).toContain('const still = !columnMovable(room);');
  });

  it('follows a drag with the pointer captured, keeps the focus where it was, and keeps the width where it is let go', () => {
    expect(HANDLES).toMatch(
      /onPointerDown:[\s\S]*?event\.preventDefault\(\);\s*const dragRoom = movableRoom\(\);\s*if \(!dragRoom\) return;[\s\S]*?setPointerCapture\(event\.pointerId\)/
    );
    expect(HANDLES).toMatch(
      /onPointerMove:[\s\S]*?columnMove\(d\.room, columnDragTarget\(d\.room, event\.clientX - d\.startX\)\)/
    );
    expect(HANDLES).toContain(
      'onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true)'
    );
    // A cancelled drag puts the edge back.
    expect(HANDLES).toContain(
      'onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, false)'
    );
    expect(HANDLES).toMatch(
      /if \(keep && last !== undefined\) void saveColumnWidth\(column, last, COLUMN_IO\);/
    );
    expect(HANDLES).toContain("setSettings: (patch) => call('settings:set', patch)");
    expect(HANDLES).toMatch(
      /const root = document\.documentElement;\s*root\.classList\.add\('column-resizing'\);/
    );
  });

  it('puts back the usual width on a double-click or Enter, moves on the keys, and does nothing where it cannot move', () => {
    expect(HANDLES).toMatch(
      /onDoubleClick: \(\) => \{\s*if \(movableRoom\(\)\) void saveColumnWidth\(column, null, COLUMN_IO\);/
    );
    expect(HANDLES).toMatch(
      /action\.kind === 'reset'\) \{\s*void saveColumnWidth\(column, null, COLUMN_IO\);/
    );
    expect(HANDLES).toMatch(
      /onKeyDown:[\s\S]*?const keyRoom = movableRoom\(\);\s*if \(!keyRoom\) return;\s*const action = columnKeyAction\(event, keyRoom\);\s*if \(!action\) return;\s*event\.preventDefault\(\);/
    );
    expect(HANDLES).toContain(
      'const movableRoom = (): ColumnRoom | null => (columnMovable(room) ? room : null);'
    );
  });

  it('ends a drag whose handle a fold takes away, at the release, keeping nothing', () => {
    expect(HANDLES).toMatch(
      /if \(!d \|\| d\.pointerId !== event\.pointerId \|\| d\.element\.isConnected\) return;\s*drag\.current = null;\s*liveShare\.current = undefined;\s*setDragging\(false\);\s*setLive\(null\);/
    );
    expect(HANDLES).toContain("window.addEventListener('pointerup', release);");
  });
});

describe('the handles in app.css', () => {
  it("lies on each column's own border, reaching into the side with no scrollbar", () => {
    const handle = declsFor('.column-handle');
    expect(handle.get('position')).toBe('absolute');
    expect(handle.get('width')).toBe('7px');
    expect(handle.get('top')).toBe('0');
    expect(handle.get('bottom')).toBe('0');
    expect(handle.get('cursor')).toBe('col-resize');
    // Under the drawers (10).
    expect(handle.get('z-index')).toBe('1');
    // The list's border is its last pixel; the panel's its first.
    expect(declsFor('.column-handle--files').get('left')).toBe('calc(var(--files-col) - 1px)');
    expect(declsFor('.column-handle--side').get('right')).toBe('calc(var(--side-col) - 7px)');
    expect(declsFor('.files').get('border-right')).toBe('1px solid var(--border)');
    expect(declsFor('.side').get('border-left')).toBe('1px solid var(--border)');
  });

  it('draws the line and a grip in the faint grey, both darker under the pointer, and the browser its focus ring', () => {
    const line = declsFor('.column-handle::before');
    expect(line.get('left')).toBe('0');
    expect(line.get('width')).toBe('1px');
    expect(line.get('background')).toBe('var(--border)');
    const grip = declsFor('.column-handle::after');
    expect(grip.get('background')).toBe('var(--ink-faint)');
    expect(grip.get('width')).toBe('3px');
    expect(grip.get('left')).toBe('-1px');
    expect(declsFor('.column-handle--dragging::before').get('background')).toBe('var(--border-strong)');
    expect(declsFor('.column-handle:hover::after').get('background')).toBe('var(--ink-soft)');
    expect(CSS).not.toMatch(/\.column-handle[^{]*\{[^}]*outline/);
  });

  it('is the plain border where it cannot move, and keeps the pointer col-resize through a drag', () => {
    expect(declsFor(".column-handle[aria-disabled='true']").get('cursor')).toBe('default');
    expect(declsFor(".column-handle[aria-disabled='true']::after").get('display')).toBe('none');
    expect(declsFor(".column-handle[aria-disabled='true']:hover::before").get('background')).toBe(
      'var(--border)'
    );
    expect(declsFor(':root.column-resizing *').get('cursor')).toBe('col-resize !important');
    expect(declsFor(':root.column-resizing *').get('user-select')).toBe('none');
  });
});
