import { createSettingWrites, type SettingIo, type SettingWrites } from './settingWrites';

/*
 * The side panel's split kept in settings (ui.6, PLAN 11.3 d): `sideSplit`,
 * the list's share of the height under the focused suggestion's box, or null
 * for the usual split. It reaches main through `settings:set`, as zoom and the
 * dismissed hints do, so it survives a restart.
 *
 * The page takes a new split at once, before anything is written. Writes run
 * one after another, and while one is under way the next waits and then
 * writes the split as it then stands, so a run of arrow presses ends in one
 * write of the last, and an older answer from main never moves the handle
 * back. A write that fails keeps the split for the session; the next start
 * has the one last written. A close waits for the writes (App's page writes).
 * The writer is state/settingWrites.ts's, which the side columns' widths
 * share (polish.5).
 *
 * It reaches main through `SplitIo`, so this module needs no DOM and is tested
 * in node.
 */

export type SplitIo = SettingIo;

/** The split's writes: `save(share, io)` keeps a share, null for the usual split. */
export type SplitWrites = SettingWrites<'sideSplit'>;

export function createSplitWrites(): SplitWrites {
  return createSettingWrites('sideSplit');
}

/** The app's one writer of the split. */
const writes = createSplitWrites();

/** Keep `share` as the side panel's split (`SplitWrites.save`). */
export function saveSplit(share: number | null, io: SplitIo): Promise<void> {
  return writes.save(share, io);
}

/** The split writes under way, for a close to wait for with the other writes (apply.9). */
export function flushSplitWrites(): Promise<void> {
  return writes.flush();
}
