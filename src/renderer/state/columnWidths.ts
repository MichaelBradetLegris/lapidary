import type { ColumnShares } from '../../shared/types';
import type { Column } from '../../shared/ui/columns';
import { createSettingWrites, type SettingIo } from './settingWrites';
import { useApp } from './store';

/*
 * The side columns' widths kept in settings (polish.5, PLAN 11.3 d):
 * `columnWidths`, the chapter list's and the side panel's shares of the
 * window's width, null for either at its usual width, and whether either is
 * hidden by its button at an end of the toolbar (polish.28; `filesHidden` and
 * `sideHidden`, which polish.26's carets set).
 * Written as the side panel's split is (state/settingWrites.ts): the page
 * takes a new value at once, a run of key presses ends in one write of the
 * last, and a close waits for the writes (state/pageIo.ts). The widths and
 * the flags go through the one writer, so a fold and a drag never write over
 * each other, and a handle dragged to the window's edge (polish.27) writes the
 * flag with the width the column keeps, in one write.
 */

export type ColumnIo = SettingIo;

export interface ColumnWrites {
  /**
   * Keep `share` as `column`'s width, null for its usual width, and the rest
   * as it is. Resolves once written, or could not be; never rejects.
   */
  save(column: Column, share: number | null, io: ColumnIo): Promise<void>;
  /**
   * Hide `column`, or bring it back (polish.28), keeping both widths as they
   * are. Resolves once written, or could not be; never rejects.
   */
  hide(column: Column, hidden: boolean, io: ColumnIo): Promise<void>;
  /**
   * Hide `column`, snapped closed by its handle (polish.27), and keep `share`
   * as its width, the one it had before the drag, null for its usual width,
   * in one write. Resolves once written, or could not be; never rejects.
   */
  snap(column: Column, share: number | null, io: ColumnIo): Promise<void>;
  /** the writes still under way; never rejects */
  flush(): Promise<void>;
}

const sameShares = (a: ColumnShares, b: ColumnShares): boolean =>
  a.files === b.files &&
  a.side === b.side &&
  a.filesHidden === b.filesHidden &&
  a.sideHidden === b.sideHidden;

export function createColumnWrites(): ColumnWrites {
  const writes = createSettingWrites('columnWidths', sameShares);
  // Without settings loaded nothing is written (`SettingWrites.save`).
  const change = (patch: Partial<ColumnShares>, io: ColumnIo): Promise<void> => {
    const settings = useApp.getState().settings;
    if (!settings) return writes.flush();
    return writes.save({ ...settings.columnWidths, ...patch }, io);
  };
  return {
    save: (column, share, io) => change(column === 'files' ? { files: share } : { side: share }, io),
    hide: (column, hidden, io) =>
      change(column === 'files' ? { filesHidden: hidden } : { sideHidden: hidden }, io),
    snap: (column, share, io) =>
      change(
        column === 'files' ? { files: share, filesHidden: true } : { side: share, sideHidden: true },
        io
      ),
    flush: () => writes.flush()
  };
}

/** The app's one writer of the columns' widths. */
const writes = createColumnWrites();

/** Keep `share` as `column`'s width (`ColumnWrites.save`). */
export function saveColumnWidth(column: Column, share: number | null, io: ColumnIo): Promise<void> {
  return writes.save(column, share, io);
}

/** Hide `column`, or bring it back (`ColumnWrites.hide`). */
export function saveColumnHidden(column: Column, hidden: boolean, io: ColumnIo): Promise<void> {
  return writes.hide(column, hidden, io);
}

/** Hide `column`, snapped closed, keeping `share` as its width (`ColumnWrites.snap`, polish.27). */
export function saveColumnSnap(column: Column, share: number | null, io: ColumnIo): Promise<void> {
  return writes.snap(column, share, io);
}

/** The width writes under way, for a close to wait for with the other writes (apply.9). */
export function flushColumnWrites(): Promise<void> {
  return writes.flush();
}
