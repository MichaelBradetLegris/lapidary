import type { Settings } from '../../shared/types';
import { useApp } from './store';

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
 *
 * It reaches main through `SplitIo`, so this module needs no DOM and is tested
 * in node.
 */

export interface SplitIo {
  /** `settings:set`: writes the patch and answers with the settings as saved */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

export interface SplitWrites {
  /**
   * Keep `share` as the split, null for the usual one. Resolves once it is
   * written, or could not be; never rejects. The split on screen writes
   * nothing, and nor does anything without settings loaded.
   */
  save(share: number | null, io: SplitIo): Promise<void>;
  /** the writes still under way; never rejects */
  flush(): Promise<void>;
}

export function createSplitWrites(): SplitWrites {
  let chain: Promise<void> = Promise.resolve();
  /** a write that has not started, which will write the split as it stands when it does */
  let waiting = false;
  const app = useApp.getState;

  function save(share: number | null, io: SplitIo): Promise<void> {
    const before = app().settings;
    if (!before || before.sideSplit === share) return chain;
    app().setSettings({ ...before, sideSplit: share });
    if (waiting) return chain;
    waiting = true;

    chain = chain.then(async () => {
      waiting = false;
      const wanted = app().settings?.sideSplit ?? null;
      try {
        const saved = await io.setSettings({ sideSplit: wanted });
        // Main answers with every setting as saved. A split asked for since
        // stays on screen; the write waiting behind this one writes it.
        const latest = app().settings;
        app().setSettings({ ...saved, sideSplit: latest ? latest.sideSplit : saved.sideSplit });
      } catch {
        // Kept on screen for this session.
      }
    });
    return chain;
  }

  return { save, flush: () => chain };
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
