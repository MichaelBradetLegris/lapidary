import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ColumnShares } from '../../src/shared/types';
import {
  COLUMN_SNAP_PX,
  COLUMN_STEP_PX,
  COLUMN_TITLE_STILL,
  columnAria,
  columnDragShare,
  columnDragSnaps,
  columnDragTarget,
  columnDragWrite,
  columnHandleText,
  columnKeyAction,
  columnKeyPress,
  columnLiveShares,
  columnMovable,
  columnMove,
  columnRoom,
  columnShare,
  columnSnaps,
  type ColumnKeyRun,
  type ColumnRoom,
  type ColumnWrite
} from '../../src/shared/ui/columnHandle';
import {
  columnLayout,
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

  it('has none for a hidden column, and the other column has all the room it left (polish.28)', () => {
    expect(columnRoom(columnLayout(DEFAULT, set({ filesHidden: true })), 'files')).toBeNull();
    expect(columnRoom(columnLayout(DEFAULT, set({ sideHidden: true })), 'side')).toBeNull();
    // Beside the hidden panel, which leaves nothing at the edge, the list may
    // take all but the prose's 480 px: 944 in the default window (937 beside
    // polish.26's 7 px edge strip).
    expect(room(DEFAULT, 'files', set({ sideHidden: true }))).toEqual({
      column: 'files',
      width: DEFAULT,
      current: 230,
      min: 150,
      max: DEFAULT - PROSE_MIN
    });
    // In the smallest window at 100% the list hidden leaves the panel its
    // usual 240 px, and room to move: neither had to give way.
    const side = room(SMALL, 'side', set({ filesHidden: true }));
    expect(side).toMatchObject({ current: 240, min: 200, max: SMALL - PROSE_MIN });
    expect(columnMovable(side)).toBe(true);
    // Where a narrow window folds the list to its strip, 900 by 600 at 110%,
    // the hidden list leaves the panel the strip's 32 px more to move into.
    const narrow = SMALL / 1.1;
    const beside = room(narrow, 'side');
    expect(beside).toMatchObject({ current: 240, min: 200, max: 291 });
    expect(room(narrow, 'side', set({ filesHidden: true }))).toEqual({ ...beside, max: 323 });
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
    expect(columnKeyAction({ key: 'ArrowRight' }, files)).toEqual({ kind: 'step', by: 24 });
    expect(columnKeyAction({ key: 'ArrowLeft' }, files)).toEqual({ kind: 'step', by: -24 });
    // The side panel's edge going left widens it.
    expect(columnKeyAction({ key: 'ArrowLeft' }, side)).toEqual({ kind: 'step', by: 24 });
    expect(columnKeyAction({ key: 'ArrowRight' }, side)).toEqual({ kind: 'step', by: -24 });
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
    return action ? columnKeyPress(action, r, null, null).write : 'not taken';
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

/** The flag that hides `column` in `columnWidths`. */
const hiddenKey = (column: Column): 'filesHidden' | 'sideHidden' =>
  column === 'files' ? 'filesHidden' : 'sideHidden';

/**
 * `key` pressed `times` times on `column`'s handle as the page presses it:
 * each write taken into the settings at once, the columns laid out again
 * from them, and the run of presses carried from one to the next. Stops at a
 * snap, which leaves the column hidden and its handle gone.
 */
function pressKeys(width: number, kept: ColumnShares, column: Column, key: string, times: number) {
  let shares = kept;
  let run: ColumnKeyRun | null = null;
  const writes: (ColumnWrite | null)[] = [];
  for (let i = 0; i < times; i += 1) {
    const r = columnRoom(columnLayout(width, shares), column);
    if (!r) break;
    const action = columnKeyAction({ key }, r);
    if (!action) throw new Error(`${key} is not taken`);
    const press = columnKeyPress(action, r, shares[column], run);
    writes.push(press.write);
    run = press.run;
    if (press.write?.hide) shares = { ...shares, [column]: press.write.share, [hiddenKey(column)]: true };
    else if (press.write) shares = { ...shares, [column]: press.write.share };
  }
  return { writes, shares, run };
}

describe('snapping a column closed at the edge (polish.27)', () => {
  const files = room(DEFAULT, 'files');
  const side = room(DEFAULT, 'side');
  const snapped = (column: Column, share: number | null): ColumnWrite => ({ column, share, hide: true });

  it('snaps at 50 px or less, as the author asked, and not a pixel more', () => {
    expect(COLUMN_SNAP_PX).toBe(50);
    expect(columnSnaps(50)).toBe(true);
    expect(columnSnaps(50.5)).toBe(false);
    expect(columnSnaps(51)).toBe(false);
    expect(columnSnaps(0)).toBe(true);
    expect(columnSnaps(-300)).toBe(true);
  });

  it('snaps a drag let go where the column would be 50 px, and keeps it at its floor at 51', () => {
    // The list's edge from 230 px: 179 px left is 51 px, a near miss that
    // leaves the list at its floor; 180 px left is 50, and it goes.
    expect(columnDragSnaps(files, -179)).toBe(false);
    expect(columnDragWrite(files, -179, null)).toEqual({ column: 'files', share: columnShare(150, DEFAULT) });
    expect(columnDragSnaps(files, -180)).toBe(true);
    expect(columnDragWrite(files, -180, null)).toEqual(snapped('files', null));
    expect(columnDragWrite(files, -900, null)).toEqual(snapped('files', null));
    // The side panel's edge goes right, toward the window's right edge.
    expect(columnDragWrite(side, 269, null)).toEqual({ column: 'side', share: columnShare(200, DEFAULT) });
    expect(columnDragWrite(side, 270, null)).toEqual(snapped('side', null));
    expect(columnDragSnaps(side, 270)).toBe(true);
    // Until the release the column is drawn at its floor, faded.
    expect(columnDragShare(files, -180)).toBe(columnShare(150, DEFAULT));
    expect(columnDragShare(side, 270)).toBe(columnShare(200, DEFAULT));
  });

  it('keeps the width set before the drag, for the next show', () => {
    const set310 = room(DEFAULT, 'files', set({ files: 0.217697 }));
    expect(set310.current).toBe(310);
    expect(columnDragWrite(set310, -259, 0.217697)).toEqual({
      column: 'files',
      share: columnShare(150, DEFAULT)
    });
    expect(columnDragWrite(set310, -260, 0.217697)).toEqual(snapped('files', 0.217697));
    // From the floor, where the drag draws nothing new, a release past the threshold still snaps.
    const atFloor = room(DEFAULT, 'files', set({ files: columnShare(150, DEFAULT) }));
    expect(columnDragShare(atFloor, -100)).toBeNull();
    expect(columnDragWrite(atFloor, -99, atFloor.current / DEFAULT)).toBeNull();
    expect(columnDragWrite(atFloor, -100, 0.105337)).toEqual(snapped('files', 0.105337));
    // Shown again, the column is back at the width it had.
    const hidden = set({ files: 0.217697, filesHidden: true });
    expect(columnLayout(DEFAULT, hidden).files).toBe('hidden');
    expect(columnLayout(DEFAULT, { ...hidden, filesHidden: false }).filesWidth).toBe(310);
  });

  it('snaps on the arrow press that takes the column to 50 px or less, going on past the floor a step a press', () => {
    // The list from its usual 230 px: four presses to its floor, three more
    // past it with nothing to draw, and the eighth, at 38 px, hides it.
    const list = pressKeys(DEFAULT, USUAL_COLUMN_WIDTHS, 'files', 'ArrowLeft', 9);
    expect(list.writes).toEqual([
      { column: 'files', share: columnShare(206, DEFAULT) },
      { column: 'files', share: columnShare(182, DEFAULT) },
      { column: 'files', share: columnShare(158, DEFAULT) },
      { column: 'files', share: columnShare(150, DEFAULT) },
      null,
      null,
      null,
      snapped('files', null)
    ]);
    // Hidden, with the usual width it had before the first press.
    expect(list.shares).toEqual(set({ filesHidden: true }));
    expect(columnLayout(DEFAULT, set({})).filesWidth).toBe(230);
    expect(list.run).toBeNull();
  });

  it('misses at 51 px from the keys too, and snaps on the next press', () => {
    // The list at 195 px: the sixth press would make it 51 px, the seventh 27.
    const at195 = set({ files: columnShare(195, DEFAULT) });
    expect(room(DEFAULT, 'files', at195).current).toBe(195);
    const six = pressKeys(DEFAULT, at195, 'files', 'ArrowLeft', 6);
    expect(six.writes.some((w) => w?.hide)).toBe(false);
    expect(six.run).toEqual({ column: 'files', before: columnShare(195, DEFAULT), reach: 51 });
    expect(columnLayout(DEFAULT, six.shares).filesWidth).toBe(150);
    const seven = pressKeys(DEFAULT, at195, 'files', 'ArrowLeft', 7);
    expect(seven.writes.at(-1)).toEqual(snapped('files', columnShare(195, DEFAULT)));
    // The side panel at 219 px narrows on the right arrow: 51 px at the seventh, 27 at the eighth.
    const at219 = set({ side: columnShare(219, DEFAULT) });
    const panelSeven = pressKeys(DEFAULT, at219, 'side', 'ArrowRight', 7);
    expect(panelSeven.run).toMatchObject({ column: 'side', reach: 51 });
    expect(panelSeven.writes.some((w) => w?.hide)).toBe(false);
    const panelEight = pressKeys(DEFAULT, at219, 'side', 'ArrowRight', 8);
    expect(panelEight.writes.at(-1)).toEqual(snapped('side', columnShare(219, DEFAULT)));
    expect(columnLayout(DEFAULT, panelEight.shares).side).toBe('hidden');
    expect(columnLayout(DEFAULT, { ...panelEight.shares, sideHidden: false }).sideWidth).toBe(219);
  });

  it('starts again from the width drawn after any other key, another column or a column off its floor', () => {
    const atFloor = set({ files: columnShare(150, DEFAULT) });
    const floor = room(DEFAULT, 'files', atFloor);
    const left = columnKeyAction({ key: 'ArrowLeft' }, floor);
    if (!left) throw new Error('ArrowLeft is not taken');
    const run: ColumnKeyRun = { column: 'files', before: 0.2, reach: 54 };
    // The run goes on: 30 px, and it snaps, keeping the width from before the run.
    expect(columnKeyPress(left, floor, columnShare(150, DEFAULT), run).write).toEqual(snapped('files', 0.2));
    // The right arrow, Home, End and Enter each end it, and none snaps.
    for (const key of ['ArrowRight', 'Home', 'End', 'Enter']) {
      const action = columnKeyAction({ key }, floor);
      if (!action) throw new Error(`${key} is not taken`);
      const press = columnKeyPress(action, floor, columnShare(150, DEFAULT), run);
      expect(press.run, key).toBeNull();
      expect(press.write?.hide, key).toBeUndefined();
    }
    // The right arrow moves the edge from where it is drawn, not from 54 px.
    const right = columnKeyAction({ key: 'ArrowRight' }, floor);
    if (!right) throw new Error('ArrowRight is not taken');
    expect(columnKeyPress(right, floor, null, run).write).toEqual({
      column: 'files',
      share: columnShare(174, DEFAULT)
    });
    // Another column's run, or this one's once the column is off its floor, counts for nothing.
    const other: ColumnKeyRun = { column: 'side', before: 0.3, reach: 54 };
    expect(columnKeyPress(left, floor, 0.105337, other)).toEqual({
      write: null,
      run: { column: 'files', before: 0.105337, reach: 126 }
    });
    expect(columnKeyPress(left, files, null, run)).toEqual({
      write: { column: 'files', share: columnShare(206, DEFAULT) },
      run: { column: 'files', before: 0.2, reach: 206 }
    });
  });

  it('never snaps on Home, which gives the column its least width', () => {
    const home = columnKeyAction({ key: 'Home' }, files);
    expect(home).toEqual({ kind: 'move', target: Number.NEGATIVE_INFINITY });
    if (!home) throw new Error('Home is not taken');
    expect(columnKeyPress(home, files, null, null)).toEqual({
      write: { column: 'files', share: columnShare(150, DEFAULT) },
      run: null
    });
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

  // polish.27: the drag and the keys snap the column closed at the same 50 px.
  const near = fc.oneof(
    target,
    fc.integer({ min: 20, max: 80 }),
    fc.double({ min: 49, max: 52, noNaN: true }),
    fc.constantFrom(50, 51, 49.5, 50.5)
  );

  it('snaps a drag never above 50 px, always at or under, and keeps the width from before the drag', () => {
    fc.assert(
      fc.property(width, shares, column, near, share, (w, kept, c, t, before) => {
        const r = columnRoom(columnLayout(w, kept), c);
        if (!r) return;
        // The drag that would make the column `t` wide, by the pointer's way.
        const dx = c === 'files' ? t - r.current : r.current - t;
        const at = columnDragTarget(r, dx);
        const write = columnDragWrite(r, dx, before);
        expect(write?.hide === true).toBe(at <= COLUMN_SNAP_PX);
        // What the page fades during the drag is what the release does.
        expect(columnDragSnaps(r, dx)).toBe(write?.hide === true);
        if (write?.hide) {
          // The width the column comes back at is the one it had before the drag.
          expect(write).toEqual({ column: c, share: before, hide: true });
        } else {
          // Short of the threshold, the release writes what the drag drew.
          expect(write === null ? null : write.share).toBe(columnDragShare(r, dx));
        }
      })
    );
  });

  it('snaps a run of arrow presses at the same 50 px, keeping the width from before its first press', () => {
    fc.assert(
      fc.property(width, shares, column, (w, kept, c) => {
        const layout = columnLayout(w, kept);
        const first = columnRoom(layout, c);
        if (!first || !columnMovable(first)) return;
        const key = c === 'files' ? 'ArrowLeft' : 'ArrowRight';
        const before = kept[c];
        let shares = kept;
        let run: ColumnKeyRun | null = null;
        // The width the presses would make the column, nothing holding it at
        // its floor: from the width drawn, and while it is held at its floor
        // from where the presses had reached.
        let reach = first.current;
        let presses = 0;
        for (;;) {
          const r = columnRoom(columnLayout(w, shares), c);
          if (!r) throw new Error('the column went before a snap');
          const action = columnKeyAction({ key }, r);
          if (!action) throw new Error(`${key} is not taken`);
          reach =
            (presses > 0 && r.current <= r.min ? Math.min(reach, r.current) : r.current) - COLUMN_STEP_PX;
          const press = columnKeyPress(action, r, shares[c], run);
          presses += 1;
          if (press.write?.hide) {
            // Never above 50 px, and back at the width from before the run.
            expect(reach).toBeLessThanOrEqual(COLUMN_SNAP_PX);
            expect(press.write).toEqual({ column: c, share: before, hide: true });
            break;
          }
          // Always at or under: a press that reaches it snaps.
          expect(reach).toBeGreaterThan(COLUMN_SNAP_PX);
          expect(press.run).toEqual({ column: c, before, reach });
          if (press.write) shares = { ...shares, [c]: press.write.share };
          run = press.run;
          if (presses > 200) throw new Error('no snap in 200 presses');
        }
        // Where the column is drawn as set (the first step, or the panel beside
        // a folded or hidden list), each press takes 24 px from the width it
        // started at, so the snap comes at the first that leaves 50 px or less,
        // as a drag to the same place would.
        const asSet =
          layout.files === 'strip' ||
          ((layout.files === 'hidden' || layout.filesWidth === keptWidth(FILES_WIDTHS, kept.files, w)) &&
            (layout.side === 'hidden' || layout.sideWidth === keptWidth(SIDE_WIDTHS, kept.side, w)));
        if (asSet) {
          expect(presses).toBe(Math.ceil((first.current - COLUMN_SNAP_PX) / COLUMN_STEP_PX));
          expect(
            columnDragSnaps(first, c === 'files' ? -presses * COLUMN_STEP_PX : presses * COLUMN_STEP_PX)
          ).toBe(true);
          expect(
            columnDragSnaps(
              first,
              c === 'files' ? -(presses - 1) * COLUMN_STEP_PX : (presses - 1) * COLUMN_STEP_PX
            )
          ).toBe(false);
        }
      })
    );
  });

  it('ends a run on any other key, which never snaps', () => {
    const reach = fc.double({ min: -500, max: 1000, noNaN: true });
    const key = fc.constantFrom('ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter');
    fc.assert(
      fc.property(
        width,
        shares,
        column,
        column,
        share,
        reach,
        key,
        (w, kept, c, runColumn, before, at, k) => {
          const r = columnRoom(columnLayout(w, kept), c);
          if (!r) return;
          const action = columnKeyAction({ key: k }, r);
          if (!action) return;
          const narrows = action.kind === 'step' && action.by < 0;
          const press = columnKeyPress(action, r, kept[c], { column: runColumn, before, reach: at });
          if (!narrows) {
            expect(press.run).toBeNull();
            expect(press.write?.hide).toBeUndefined();
          } else if (press.write?.hide) {
            // A narrowing arrow snaps only on a run of this column's, the column at its floor.
            expect(runColumn).toBe(c);
            expect(r.current).toBeLessThanOrEqual(r.min);
            expect(Math.min(at, r.current) - COLUMN_STEP_PX).toBeLessThanOrEqual(COLUMN_SNAP_PX);
            expect(press.write).toEqual({ column: c, share: before, hide: true });
          }
        }
      )
    );
  });
});
