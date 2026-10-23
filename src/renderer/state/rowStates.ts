import { createSettingWrites, type SettingIo } from './settingWrites';

/*
 * Show states beside the suggestions list's heading (polish.12, PLAN 11.3 d):
 * `showRowStates`, whether the decided rows have ACCEPTED or DISMISSED
 * written on them. Written as the side panel's split is
 * (state/settingWrites.ts): the list follows the box at once, quick presses
 * end in one write of the last, and a close waits for the writes
 * (state/pageIo.ts).
 */

export type RowStatesIo = SettingIo;

/** The app's one writer of the setting. */
const writes = createSettingWrites('showRowStates');

/** Keep `show` as the setting (`SettingWrites.save`). */
export function saveRowStates(show: boolean, io: RowStatesIo): Promise<void> {
  return writes.save(show, io);
}

/** The writes under way, for a close to wait for with the other writes (apply.9). */
export function flushRowStatesWrites(): Promise<void> {
  return writes.flush();
}
