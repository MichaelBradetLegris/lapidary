import { app } from 'electron';
import type { Settings } from '../shared/types';
import { log } from './log';
import { createSettingsStore, type SettingsRead, type SettingsStore } from './settingsStore';

/**
 * The app's settings, through the store in settingsStore.ts, which holds the
 * rules for missing, corrupt and unreadable files (PLAN 11.3 d). The normaliser
 * itself is pure and lives in src/shared/settings.ts.
 */

export { normalizeSettings } from '../shared/settings';

let store: SettingsStore | null = null;

function theStore(): SettingsStore {
  store ??= createSettingsStore({ dir: app.getPath('userData'), logger: log });
  return store;
}

export function loadSettings(): Promise<Settings> {
  return theStore().load();
}

/** As `loadSettings`, and says whether settings.json could be read (`settings:get`, hardening.15). */
export function loadSettingsChecked(): Promise<SettingsRead> {
  return theStore().loadChecked();
}

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  return theStore().save(patch);
}

/** Test seam: forget the in-memory copy. */
export function resetSettingsCache(): void {
  theStore().reset();
}
