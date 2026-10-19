import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';
import { SPLIT_USUAL_SHARE } from '../../src/shared/ui/split';
import { createSplitWrites, type SplitIo } from '../../src/renderer/state/split';
import { useApp } from '../../src/renderer/state/store';

/* ui.6: the handle between the side panel's list and the region below. The
   writes are run here against a stand-in for main; the rest are source checks,
   as the tests run without a DOM or Electron. The window checks (a drag with
   real pointer events, a restart, the keys, both limits in both themes) are in
   PLAN (ui.6). */

const SRC = path.join(__dirname, '../../src');
const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (file: string): string => withoutComments(readFileSync(path.join(SRC, file), 'utf8'));

const SIDE_PANEL = read('renderer/components/SidePanel.tsx');
const HANDLE = read('renderer/state/splitHandle.ts');
const KEYBOARD = read('renderer/state/keyboard.ts');
const APP = read('renderer/App.tsx');
const CSS = readFileSync(path.join(SRC, 'renderer/styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHORT = /@media \(height < (\d+)px\) \{([\s\S]*?)\n\}/.exec(CSS);
const SHORT_BLOCK = SHORT?.[2] ?? '';
const BASE = SHORT ? CSS.replace(SHORT[0], '') : CSS;

/** The usual split's most, as app.css writes it. */
const USUAL_PERCENT = `${Math.round(SPLIT_USUAL_SHARE * 100)}%`;

/** Every declaration for exactly this selector in `css`, the last of each property winning. */
function declsFor(selector: string, css = BASE): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
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
  const io: SplitIo = {
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

const withSplit = (sideSplit: number | null): Settings => ({ ...defaultSettings(), sideSplit });

beforeEach(() => {
  useApp.setState({ settings: withSplit(null) });
});

describe('keeping the split (ui.6, 11.3 d)', () => {
  it('writes the share through settings:set and takes the settings main answers with', async () => {
    // Main holds a setting the page has not heard of yet, as after a zoom key.
    const main = mainSettings({ ...withSplit(null), zoom: 1.5 });
    const writes = createSplitWrites();
    await writes.save(0.3, main.io);
    expect(main.patches).toEqual([{ sideSplit: 0.3 }]);
    expect(main.disk().sideSplit).toBe(0.3);
    expect(useApp.getState().settings).toEqual(main.disk());
  });

  it('shows the split before the write ends', async () => {
    const main = mainSettings(withSplit(null));
    main.hold();
    const writes = createSplitWrites();
    const done = writes.save(0.4, main.io);
    expect(useApp.getState().settings?.sideSplit).toBe(0.4);
    let flushed = false;
    void writes.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    main.letGo();
    await done;
    expect(flushed).toBe(true);
    expect(main.disk().sideSplit).toBe(0.4);
  });

  it('writes a run of presses as the last, and an older answer never moves the handle back', async () => {
    const main = mainSettings(withSplit(null));
    main.hold();
    const writes = createSplitWrites();
    void writes.save(0.3, main.io);
    await Promise.resolve();
    void writes.save(0.34, main.io);
    void writes.save(0.38, main.io);
    void writes.save(0.42, main.io);
    expect(useApp.getState().settings?.sideSplit).toBe(0.42);
    // The first write ends while the presses are waiting: the page keeps the last.
    main.letGo();
    main.hold();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useApp.getState().settings?.sideSplit).toBe(0.42);
    main.letGo();
    await writes.flush();
    expect(main.patches).toEqual([{ sideSplit: 0.3 }, { sideSplit: 0.42 }]);
    expect(main.disk().sideSplit).toBe(0.42);
    expect(useApp.getState().settings?.sideSplit).toBe(0.42);
  });

  it('writes the usual split as null, and nothing for the split on screen', async () => {
    useApp.setState({ settings: withSplit(0.6) });
    const main = mainSettings(withSplit(0.6));
    const writes = createSplitWrites();
    await writes.save(0.6, main.io);
    expect(main.patches).toEqual([]);
    await writes.save(null, main.io);
    expect(main.patches).toEqual([{ sideSplit: null }]);
    expect(main.disk().sideSplit).toBeNull();
  });

  it('keeps the split on screen for the session when the write fails, and never rejects', async () => {
    const main = mainSettings(withSplit(null), { fail: true });
    const writes = createSplitWrites();
    await expect(writes.save(0.5, main.io)).resolves.toBeUndefined();
    expect(useApp.getState().settings?.sideSplit).toBe(0.5);
    await expect(writes.flush()).resolves.toBeUndefined();
  });

  it('writes nothing without settings loaded', async () => {
    useApp.setState({ settings: null });
    const main = mainSettings(withSplit(null));
    await createSplitWrites().save(0.5, main.io);
    expect(main.patches).toEqual([]);
  });

  it('is waited for by a close, with the review, paragraph and hint writes', () => {
    expect(APP).toContain(
      'Promise.all([flushReviewWrites(), flushDraftWrites(), flushHintWrites(), flushSplitWrites()])'
    );
  });
});

describe('the handle in the side panel', () => {
  it('sits between the list and the region below, and names the list it resizes', () => {
    const list = SIDE_PANEL.indexOf('className="side__section side__list" id={SPLIT_LIST_ID}');
    const handle = SIDE_PANEL.indexOf('<div {...handleProps} />');
    const lower = SIDE_PANEL.indexOf('className="side__lower"');
    expect(list).toBeGreaterThan(-1);
    expect(handle).toBeGreaterThan(list);
    expect(lower).toBeGreaterThan(handle);
    expect(SIDE_PANEL).toContain('<div className="side__regions" ref={regionsRef} {...regionsProps}>');
    expect(HANDLE).toContain("'aria-controls': SPLIT_LIST_ID");
  });

  it('is a focusable separator with a name, a value and a tooltip', () => {
    for (const part of [
      "role: 'separator'",
      "'aria-orientation': 'horizontal'",
      "'aria-label': SPLIT_LABEL",
      "'aria-valuenow': aria?.valueNow",
      "'aria-valuemin': aria?.valueMin",
      "'aria-valuemax': aria?.valueMax",
      "'aria-valuetext': aria?.valueText",
      'tabIndex: still ? -1 : 0',
      'title: still ? SPLIT_TITLE_STILL : SPLIT_TITLE'
    ]) {
      expect(HANDLE, part).toContain(part);
    }
  });

  it('is disabled and out of the Tab order where it cannot move an arrow step (C.59)', () => {
    expect(HANDLE).toContain('const still = room !== null && !splitMovable(room);');
    expect(HANDLE).toContain("'aria-disabled': still ? true : undefined");
    // A drag, a double-click and the keys ask whether the handle can move now.
    expect(HANDLE).toMatch(/return now && splitMovable\(now\) \? now : null;/);
    expect(HANDLE).toMatch(
      /onPointerDown:[\s\S]*?event\.preventDefault\(\);\s*const dragRoom = movableRoom\(\);\s*if \(!dragRoom\) return;[\s\S]*?setPointerCapture/
    );
    expect(HANDLE).toMatch(
      /onDoubleClick: \(\) => \{\s*if \(movableRoom\(\)\) void saveSplit\(null, SPLIT_IO\);/
    );
    // A still handle with the focus leaves the keys to the review keys, which then step.
    expect(HANDLE).toMatch(
      /onKeyDown:[\s\S]*?const keyRoom = movableRoom\(\);\s*if \(!keyRoom\) return;[\s\S]*?event\.preventDefault\(\);/
    );
  });

  it('follows a drag with the pointer captured, keeps the focus where it was, and keeps the split where it is let go', () => {
    expect(HANDLE).toMatch(
      /onPointerDown:[\s\S]*?event\.preventDefault\(\);[\s\S]*?setPointerCapture\(event\.pointerId\)/
    );
    expect(HANDLE).toMatch(
      /onPointerMove:[\s\S]*?splitMove\(d\.room, d\.room\.current \+ event\.clientY - d\.startY\)/
    );
    expect(HANDLE).toContain(
      'onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true)'
    );
    // A cancelled drag puts the handle back.
    expect(HANDLE).toContain(
      'onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, false)'
    );
    expect(HANDLE).toMatch(/if \(keep && last !== undefined\) void saveSplit\(last, SPLIT_IO\)/);
    expect(HANDLE).toContain("setSettings: (patch) => call('settings:set', patch)");
  });

  it('puts back the usual split on a double-click or Enter, and moves on the keys', () => {
    expect(HANDLE).toMatch(
      /onDoubleClick: \(\) => \{\s*if \(movableRoom\(\)\) void saveSplit\(null, SPLIT_IO\);/
    );
    expect(HANDLE).toMatch(/action\.kind === 'reset'\) \{\s*void saveSplit\(null, SPLIT_IO\);/);
    expect(HANDLE).toMatch(
      /onKeyDown:[\s\S]*?splitKeyAction\(event, keyRoom\.current\)[\s\S]*?event\.preventDefault\(\);/
    );
  });

  it('keeps the review keys from moving the focus while it takes the arrows', () => {
    const takes = KEYBOARD.indexOf('if (splitTakesKey(event.key,');
    expect(takes).toBeGreaterThan(-1);
    expect(takes).toBeLessThan(KEYBOARD.indexOf('switch (key)'));
  });

  it('is measured only when drawn, so the one scroller has no split', () => {
    expect(HANDLE).toMatch(/if \(handleHeight === 0\) return null;/);
    expect(HANDLE).toContain('useLayoutEffect(update);');
    expect(HANDLE).toContain('new ResizeObserver(update)');
  });
});

describe('the split in app.css', () => {
  it('draws a share between the limits the page measures, as splitHeight does', () => {
    const list = declsFor('.side__regions[data-split] > .side__list');
    expect(list.get('flex')).toBe('none');
    expect(list.get('max-height')).toBe('none');
    // The least is never more than the usual split's most, so where the two
    // limits cross a split set leaves the region below no less (C.59).
    expect(list.get('height')).toBe(
      `clamp(min(var(--split-min), ${USUAL_PERCENT}), calc(var(--split) * 100%), calc(100% - var(--split-gap)))`
    );
    // Until the page has measured: splitRoom's limits for the default window
    // at 100% (test/shared/split.test.ts), and the usual split's share.
    const regions = declsFor('.side__regions');
    expect(regions.get('--split-min')).toBe('103px');
    expect(regions.get('--split-gap')).toBe('93px');
    expect(regions.get('--split')).toBe('0.55');
    expect(HANDLE).toMatch(/'--split-min': `\$\{room\.min\}px`, '--split-gap': `\$\{room\.gap\}px`/);
    // The usual split is unchanged: the list takes what it needs up to 55%.
    expect(declsFor('.side__list').get('max-height')).toBe(USUAL_PERCENT);
  });

  it('gives the handle the row-resize pointer, a visible focus ring and a line in place of the border', () => {
    const handle = declsFor('.side__split');
    expect(handle.get('cursor')).toBe('row-resize');
    expect(handle.get('flex')).toBe('none');
    expect(handle.get('height')).toBe('7px');
    const ring = declsFor('.side__split:focus-visible');
    expect(ring.get('outline')).toBe('2px solid var(--accent)');
    // Inside the band, where neither region covers it.
    expect(ring.get('outline-offset')).toBe('-2px');
    expect(declsFor('.side__split::before').get('background')).toBe('var(--border)');
    // The grip in a grey with 3:1 on the panel (themeContrast.test.ts's faint pairs).
    expect(declsFor('.side__split::after').get('background')).toBe('var(--ink-faint)');
    expect(declsFor('.side__lower').has('border-top')).toBe(false);
    // Where it cannot move (C.59): the plain line, with no grip and the usual pointer.
    expect(declsFor(".side__split[aria-disabled='true']").get('cursor')).toBe('default');
    expect(declsFor(".side__split[aria-disabled='true']::after").get('display')).toBe('none');
    expect(declsFor(".side__split[aria-disabled='true']:hover::before").get('background')).toBe(
      'var(--border)'
    );
    // And the pointer keeps the shape while a drag crosses anything else.
    expect(declsFor(':root.splitting *').get('cursor')).toBe('row-resize !important');
    expect(HANDLE).toContain("document.documentElement.classList.add('splitting')");
  });

  it('ignores the split in the short window, where the panel is one scroller (C.49)', () => {
    expect(SHORT?.[1]).toBe('540');
    expect(declsFor('.side__split', SHORT_BLOCK).get('display')).toBe('none');
    expect(declsFor('.side__regions[data-split] > .side__list', SHORT_BLOCK).get('height')).toBe('auto');
    expect(declsFor('.side__lower', SHORT_BLOCK).get('border-top')).toBe('1px solid var(--border)');
  });
});
