import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ColumnShares } from '../../src/shared/types';
import {
  COLUMN_STEP_PX,
  COLUMN_TITLE_STILL,
  columnAria,
  columnCaretPoints,
  columnCaretText,
  columnDragShare,
  columnDragTarget,
  columnHandleText,
  columnKeyAction,
  columnKeyWrite,
  columnLiveShares,
  columnMovable,
  columnMove,
  columnRoom,
  columnShare,
  type ColumnRoom
} from '../../src/shared/ui/columnHandle';
import {
  columnLayout,
  EDGE_STRIP_WIDTH,
  FILES_WIDTHS,
  keptWidth,
  PROSE_MIN,
  SIDE_WIDTHS,
  USUAL_COLUMN_WIDTHS,
  type Column,
  type ColumnLayout
} from '../../src/shared/ui/columns';
import { SPLIT_STEP_PX } from '../../src/shared/ui/split';

/* polish.5: the handles on the side columns' inner edges. The page draws
   them and follows the pointer and the keys (test/renderer/columnHandles.test.ts);
   these are the rules it applies. Window widths are CSS px inside the window
   at 100%: the default 1440 by 940 is 1424, the smallest 900 by 600 is 884
   (PLAN C.49). */

const DEFAULT = 1424;
const SMALL = 884;

/** The `columnWidths` setting with these widths, neither column folded away unless named. */
const set = (patch: Partial<ColumnShares>): ColumnShares => ({ ...USUAL_COLUMN_WIDTHS, ...patch });

const room = (width: number, column: Column, kept?: ColumnShares): ColumnRoom => {
  const found = columnRoom(columnLayout(width, kept), column);
  if (!found) throw new Error(`${column} is folded at ${width}`);
  return found;
};

describe('the room a handle has', () => {
  it('runs from the floor to what leaves the prose 480 px beside the other column, in the default window', () => {
    expect(room(DEFAULT, 'files')).toEqual({
      column: 'files',
      width: DEFAULT,
      current: 230,
      min: 150,
      max: 624
    });
    expect(room(DEFAULT, 'side')).toEqual({
      column: 'side',
      width: DEFAULT,
      current: 320,
      min: 200,
      max: 714
    });
    // With the side panel at its most, the list can only narrow.
    expect(room(DEFAULT, 'files', set({ side: 0.501404 }))).toMatchObject({ current: 230, max: 230 });
  });

  it('has none for a folded column, and the panel beside a folded list has the strip beside it', () => {
    expect(columnRoom(columnLayout(SMALL / 1.1), 'files')).toBeNull();
    expect(room(SMALL / 1.1, 'side')).toMatchObject({ current: 240, min: 200, max: 291 });
    expect(columnRoom(columnLayout(SMALL / 1.5), 'side')).toBeNull();
  });

  it('in the smallest window at 100%, lets the panel narrow 36 px and the list too little to be a control', () => {
    const files = room(SMALL, 'files');
    const side = room(SMALL, 'side');
    expect(files).toMatchObject({ current: 168, min: 150, max: 168 });
    expect(side).toMatchObject({ current: 236, min: 200, max: 236 });
    expect(columnMovable(files)).toBe(false);
    expect(columnMovable(side)).toBe(true);
  });

  it('has none for a column folded away, and the other column has the room it left (polish.26)', () => {
    expect(columnRoom(columnLayout(DEFAULT, set({ filesHidden: true })), 'files')).toBeNull();
    expect(columnRoom(columnLayout(DEFAULT, set({ sideHidden: true })), 'side')).toBeNull();
    // Beside the panel's 7 px edge strip, the list may take all but the prose's 480 px.
    expect(room(DEFAULT, 'files', set({ sideHidden: true }))).toEqual({
      column: 'files',
      width: DEFAULT,
      current: 230,
      min: 150,
      max: DEFAULT - PROSE_MIN - EDGE_STRIP_WIDTH
    });
    // In the smallest window at 100% the list folded away leaves the panel its
    // usual 240 px, and room to move: neither had to give way.
    const side = room(SMALL, 'side', set({ filesHidden: true }));
    expect(side).toMatchObject({ current: 240, min: 200, max: SMALL - PROSE_MIN - EDGE_STRIP_WIDTH });
    expect(columnMovable(side)).toBe(true);
  });

  it('moves in the steps the split moves in, and is a control only where it can move one', () => {
    expect(COLUMN_STEP_PX).toBe(SPLIT_STEP_PX);
    const at = (min: number, max: number): ColumnRoom => ({
      column: 'files',
      width: 1000,
      current: min,
      min,
      max
    });
    expect(columnMovable(at(150, 174))).toBe(true);
    expect(columnMovable(at(150, 173))).toBe(false);
  });
});

describe('moving a handle', () => {
  const files = room(DEFAULT, 'files');
  const side = room(DEFAULT, 'side');

  it('widens the chapter list as its edge goes right, and the side panel as its edge goes left', () => {
    expect(columnDragTarget(files, 40)).toBe(270);
    expect(columnDragTarget(files, -40)).toBe(190);
    expect(columnDragTarget(side, -40)).toBe(360);
    expect(columnDragTarget(side, 40)).toBe(280);
  });

  it('keeps a move between the limits, and does nothing for a move of under half a pixel', () => {
    expect(columnMove(files, 300)).toBe(300);
    expect(columnMove(files, 10)).toBe(150);
    expect(columnMove(files, 5000)).toBe(624);
    expect(columnMove(files, 230.4)).toBeNull();
    const atMost = { ...files, current: 624 };
    expect(columnMove(atMost, 700)).toBeNull();
  });

  it('never moves against the pointer or the key', () => {
    // A column wider than its most, as a window narrowed under a drag can leave it.
    const over: ColumnRoom = { ...files, current: 700 };
    expect(columnMove(over, 710)).toBeNull();
    expect(columnMove(over, 690)).toBe(624);
  });

  it('writes a width as its share of the window to six places, never 0 or 1', () => {
    expect(columnShare(150, DEFAULT)).toBe(0.105337);
    expect(columnShare(624, DEFAULT)).toBe(0.438202);
    expect(columnShare(714, DEFAULT)).toBe(0.501404);
    expect(columnShare(0, DEFAULT)).toBe(0.000001);
    expect(columnShare(DEFAULT, DEFAULT)).toBe(0.999999);
    expect(columnShare(100, 0)).toBe(0.5);
  });
});

describe('the keys', () => {
  const files = room(DEFAULT, 'files');
  const side = room(DEFAULT, 'side');

  it('move the edge a step the way the arrow points', () => {
    expect(columnKeyAction({ key: 'ArrowRight' }, files)).toEqual({ kind: 'move', target: 254 });
    expect(columnKeyAction({ key: 'ArrowLeft' }, files)).toEqual({ kind: 'move', target: 206 });
    // The side panel's edge going left widens it.
    expect(columnKeyAction({ key: 'ArrowLeft' }, side)).toEqual({ kind: 'move', target: 344 });
    expect(columnKeyAction({ key: 'ArrowRight' }, side)).toEqual({ kind: 'move', target: 296 });
  });

  it('give the column its least width on Home and its most on End, and the usual width on Enter', () => {
    for (const r of [files, side]) {
      const home = columnKeyAction({ key: 'Home' }, r);
      const end = columnKeyAction({ key: 'End' }, r);
      expect(home?.kind === 'move' ? columnMove(r, home.target) : null).toBe(r.min);
      expect(end?.kind === 'move' ? columnMove(r, end.target) : null).toBe(r.max);
      expect(columnKeyAction({ key: 'Enter' }, r)).toEqual({ kind: 'reset' });
    }
  });

  it('leave the up and down arrows to the suggestions, and every key pressed with Ctrl, Alt or Cmd', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'j', 'k', ' ', 'Escape', 'Tab']) {
      expect(columnKeyAction({ key }, files)).toBeNull();
    }
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) {
      expect(columnKeyAction({ key: 'ArrowRight', [modifier]: true }, files)).toBeNull();
    }
  });
});

describe('what the page draws during a drag and writes', () => {
  const files = room(DEFAULT, 'files');
  const side = room(DEFAULT, 'side');
  const keyWrite = (key: string, r: ColumnRoom) => {
    const action = columnKeyAction({ key }, r);
    return action ? columnKeyWrite(action, r) : 'not taken';
  };

  it("writes the key's column, at the width the key moves it to, as its share of the window", () => {
    // In the default window: the list's 230 px a step right is 254 px, the panel's 320 a step left 344.
    expect(keyWrite('ArrowRight', files)).toEqual({ column: 'files', share: 0.178371 });
    expect(keyWrite('ArrowLeft', files)).toEqual({ column: 'files', share: 0.144663 });
    expect(keyWrite('ArrowLeft', side)).toEqual({ column: 'side', share: 0.241573 });
    expect(keyWrite('ArrowRight', side)).toEqual({ column: 'side', share: 0.207865 });
    expect(keyWrite('Home', files)).toEqual({ column: 'files', share: 0.105337 });
    expect(keyWrite('End', files)).toEqual({ column: 'files', share: 0.438202 });
    expect(keyWrite('Home', side)).toEqual({ column: 'side', share: 0.140449 });
    expect(keyWrite('End', side)).toEqual({ column: 'side', share: 0.501404 });
  });

  it('writes the usual width on Enter, and nothing for a key toward a limit the column is at', () => {
    expect(keyWrite('Enter', files)).toEqual({ column: 'files', share: null });
    expect(keyWrite('Enter', side)).toEqual({ column: 'side', share: null });
    const listAtMost: ColumnRoom = { ...files, current: files.max };
    expect(keyWrite('End', listAtMost)).toBeNull();
    expect(keyWrite('ArrowRight', listAtMost)).toBeNull();
    expect(keyWrite('ArrowLeft', listAtMost)).toEqual({ column: 'files', share: 0.421348 });
    const panelAtLeast: ColumnRoom = { ...side, current: side.min };
    expect(keyWrite('Home', panelAtLeast)).toBeNull();
    expect(keyWrite('ArrowRight', panelAtLeast)).toBeNull();
    expect(keyWrite('ArrowDown', files)).toBe('not taken');
  });

  it('gives a drag the share of the width it has reached, and none back where it started', () => {
    // As in the window check (PLAN polish.5): the list's edge 80 px right is 310 px.
    expect(columnDragShare(files, 80)).toBe(0.217697);
    expect(columnDragShare(side, -100)).toBe(columnShare(420, DEFAULT));
    expect(columnDragShare(files, 900)).toBe(columnShare(624, DEFAULT));
    expect(columnDragShare(side, 900)).toBe(columnShare(200, DEFAULT));
    expect(columnDragShare(files, 0)).toBeNull();
    expect(columnDragShare(files, 0.4)).toBeNull();
  });

  it("draws the dragged column at the drag's width and the other where it is set", () => {
    const saved = set({ side: 0.3 });
    const live = columnLiveShares(saved, 'files', 0.217697);
    expect(live).toEqual(set({ files: 0.217697, side: 0.3 }));
    const before = columnLayout(DEFAULT, saved);
    const during = columnLayout(DEFAULT, live ?? saved);
    expect(during.filesWidth).toBe(310);
    expect(during.sideWidth).toBe(before.sideWidth);
    expect(before.sideWidth).toBe(427);
    expect(columnLiveShares(set({ files: 0.2 }), 'side', 0.25)).toEqual(set({ files: 0.2, side: 0.25 }));
    // A column folded away stays folded away while the other is dragged (polish.26).
    expect(columnLiveShares(set({ sideHidden: true }), 'files', 0.25)).toEqual(
      set({ files: 0.25, sideHidden: true })
    );
    // Back where it started, the columns are laid out from settings.
    expect(columnLiveShares(saved, 'files', null)).toBeNull();
    // Settings' own object is left as it is.
    expect(saved).toEqual(set({ side: 0.3 }));
  });
});

describe('what a caret says, and which way it points (polish.26)', () => {
  it('folds a column away from its handle and brings it back from the edge strip, in the plan words', () => {
    expect(columnCaretText('files', false)).toBe('Hide the chapter list');
    expect(columnCaretText('side', false)).toBe('Hide the side panel');
    expect(columnCaretText('files', true)).toBe('Show the chapter list');
    expect(columnCaretText('side', true)).toBe('Show the side panel');
  });

  it("points at the window's edge on the handle, and in from it on the edge strip", () => {
    expect(columnCaretPoints('files', false)).toBe('left');
    expect(columnCaretPoints('side', false)).toBe('right');
    expect(columnCaretPoints('files', true)).toBe('right');
    expect(columnCaretPoints('side', true)).toBe('left');
  });
});

describe('what a handle says', () => {
  it('names its column and says what a drag, a double-click and Enter do', () => {
    expect(columnHandleText('files', false)).toEqual({
      label: 'Width of the chapter list',
      title:
        'Drag to make the chapter list wider or narrower. Double-click it, or press Enter, for the usual width.'
    });
    expect(columnHandleText('side', false)).toEqual({
      label: 'Width of the side panel',
      title:
        'Drag to make the side panel wider or narrower. Double-click it, or press Enter, for the usual width.'
    });
    expect(columnHandleText('side', true)).toEqual({
      label: 'Width of the side panel',
      title: COLUMN_TITLE_STILL
    });
    expect(COLUMN_TITLE_STILL).toBe(
      'The window is too narrow to move this line. Make the window wider, or zoom out, to give it room.'
    );
  });

  it("gives a screen reader the column's share of the window and its limits, in per cent", () => {
    expect(columnAria(room(DEFAULT, 'files'))).toEqual({
      valueMin: 11,
      valueMax: 44,
      valueNow: 16,
      valueText: "Chapter list 16% of the window's width"
    });
    expect(columnAria(room(DEFAULT, 'side')).valueText).toBe("Side panel 22% of the window's width");
    // A width outside the limits is still in range.
    const over: ColumnRoom = { column: 'files', width: 1000, current: 700, min: 150, max: 600 };
    expect(columnAria(over)).toMatchObject({ valueNow: 70, valueMax: 70 });
  });
});

describe('properties', () => {
  const width = fc.double({ min: 300, max: 4000, noNaN: true });
  const share = fc.option(fc.double({ min: 0.000001, max: 0.999999, noNaN: true }), { nil: null });
  const shares: fc.Arbitrary<ColumnShares> = fc.record({
    files: share,
    side: share,
    filesHidden: fc.boolean(),
    sideHidden: fc.boolean()
  });
  const column = fc.constantFrom<Column>('files', 'side');
  const target = fc.double({ min: -1000, max: 5000, noNaN: true });

  it('never takes the prose under 480 px beside the other column, nor a column under its floor', () => {
    fc.assert(
      fc.property(width, shares, column, target, (w, kept, c, t) => {
        const layout = columnLayout(w, kept);
        const r = columnRoom(layout, c);
        if (!r) return;
        const next = columnMove(r, t);
        if (next === null) return;
        const other = c === 'files' ? layout.sideWidth : layout.filesWidth;
        expect(w - next - other).toBeGreaterThanOrEqual(PROSE_MIN);
        expect(next).toBeGreaterThanOrEqual(r.min);
      })
    );
  });

  it('lands a move where it is put, the other column where it was, wherever the widths set are drawn', () => {
    fc.assert(
      fc.property(width, shares, column, target, (w, kept, c, t) => {
        const layout = columnLayout(w, kept);
        const r = columnRoom(layout, c);
        if (!r || !columnMovable(r)) return;
        const next = columnMove(r, Math.round(t));
        if (next === null) return;
        const after = columnLayout(w, { ...kept, [c]: columnShare(next, w) });
        const drawn = (l: ColumnLayout, col: Column): number =>
          col === 'files' ? l.filesWidth : l.sideWidth;
        const other: Column = c === 'files' ? 'side' : 'files';
        // Both columns drawn at the widths set, or folded away (step 1), or the list folded (step 3).
        const asSet =
          layout.files === 'strip' ||
          ((layout.files === 'hidden' || layout.filesWidth === keptWidth(FILES_WIDTHS, kept.files, w)) &&
            (layout.side === 'hidden' || layout.sideWidth === keptWidth(SIDE_WIDTHS, kept.side, w)));
        if (asSet) {
          expect(drawn(after, c)).toBe(next);
          expect(drawn(after, other)).toBe(drawn(layout, other));
        }
        // Where the columns had given way (step 2), a column moved narrower is
        // drawn no wider than it was put, and the other column gets back what
        // it gave before the prose gets more (PLAN C.104).
        if (next < r.current) {
          expect(drawn(after, c)).toBeLessThanOrEqual(next);
          expect(drawn(after, other)).toBeGreaterThanOrEqual(drawn(layout, other));
        }
      })
    );
  });
});
