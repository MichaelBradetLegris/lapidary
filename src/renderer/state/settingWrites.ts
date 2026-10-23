import type { Settings } from '../../shared/types';
import { useApp } from './store';

/*
 * A setting the page changes as the author drags or presses keys, such as the
 * side panel's split (ui.6, state/split.ts) or the side columns' widths
 * (polish.5, state/columnWidths.ts). It reaches main through `settings:set`,
 * as zoom and the dismissed hints do, so it survives a restart.
 *
 * The page takes a new value at once, before anything is written. Writes run
 * one after another, and while one is under way the next waits and then
 * writes the value as it then stands, so a run of key presses ends in one
 * write of the last, and an older answer from main never moves the value
 * back. A write that fails keeps the value for the session; the next start
 * has the one last written. A close waits for the writes (state/pageIo.ts).
 *
 * It reaches main through `SettingIo`, so this module needs no DOM and is
 * tested in node.
 */

export interface SettingIo {
  /** `settings:set`: writes the patch and answers with the settings as saved */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

export interface SettingWrites<K extends keyof Settings> {
  /**
   * Keep `value` as the setting. Resolves once it is written, or could not
   * be; never rejects. The value on screen writes nothing, and nor does
   * anything without settings loaded.
   */
  save(value: Settings[K], io: SettingIo): Promise<void>;
  /** the writes still under way; never rejects */
  flush(): Promise<void>;
}

/** The writer of one setting, `key`, whose values `same` compares. */
export function createSettingWrites<K extends keyof Settings>(
  key: K,
  same: (a: Settings[K], b: Settings[K]) => boolean = (a, b) => a === b
): SettingWrites<K> {
  let chain: Promise<void> = Promise.resolve();
  /** a write that has not started, which will write the value as it stands when it does */
  let waiting = false;
  const app = useApp.getState;

  function save(value: Settings[K], io: SettingIo): Promise<void> {
    const before = app().settings;
    if (!before || same(before[key], value)) return chain;
    app().setSettings({ ...before, [key]: value });
    if (waiting) return chain;
    waiting = true;

    chain = chain.then(async () => {
      waiting = false;
      const now = app().settings;
      if (!now) return;
      const patch: Partial<Settings> = {};
      patch[key] = now[key];
      try {
        const saved = await io.setSettings(patch);
        // Main answers with every setting as saved. A value asked for since
        // stays on screen; the write waiting behind this one writes it.
        const latest = app().settings;
        const kept: Settings = { ...saved };
        kept[key] = latest ? latest[key] : saved[key];
        app().setSettings(kept);
      } catch {
        // Kept on screen for this session.
      }
    });
    return chain;
  }

  return { save, flush: () => chain };
}
