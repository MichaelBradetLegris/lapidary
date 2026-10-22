import type { ColumnShares } from '../../shared/types';
import type { Column } from '../../shared/ui/columns';
import { createSettingWrites, type SettingIo } from './settingWrites';
import { useApp } from './store';

/*
 * The side columns' widths kept in settings (polish.5, PLAN 11.3 d):
 * `columnWidths`, the chapter list's and the side panel's shares of the
 * window's width, null for either at its usual width. Written as the side
 * panel's split is (state/settingWrites.ts): the page takes a new width at
 * once, a run of key presses ends in one write of the last, and a close waits
 * for the writes (state/pageIo.ts).
 */

export type ColumnIo = SettingIo;

export interface ColumnWrites {
  /**
   * Keep `share` as `column`'s width, null for its usual width, and the other
   * column's as it is. Resolves once written, or could not be; never rejects.
   */
  save(column: Column, share: number | null, io: ColumnIo): Promise<void>;
  /** the writes still under way; never rejects */
  flush(): Promise<void>;
}

const sameShares = (a: ColumnShares, b: ColumnShares): boolean => a.files === b.files && a.side === b.side;

export function createColumnWrites(): ColumnWrites {
  const writes = createSettingWrites('columnWidths', sameShares);
  return {
    save(column, share, io) {
      const settings = useApp.getState().settings;
      // Without settings loaded nothing is written (`SettingWrites.save`).
      if (!settings) return writes.flush();
      return writes.save({ ...settings.columnWidths, [column]: share }, io);
    },
    flush: () => writes.flush()
  };
}

/** The app's one writer of the columns' widths. */
const writes = createColumnWrites();

/** Keep `share` as `column`'s width (`ColumnWrites.save`). */
export function saveColumnWidth(column: Column, share: number | null, io: ColumnIo): Promise<void> {
  return writes.save(column, share, io);
}

/** The width writes under way, for a close to wait for with the other writes (apply.9). */
export function flushColumnWrites(): Promise<void> {
  return writes.flush();
}
