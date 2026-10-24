import {
  DEFAULT_SETTINGS,
  EFFORT_LEVELS,
  PROVIDERS,
  type EffortLevel,
  type Provider,
  type Settings
} from './types';
import { extensionOf, hasNul, isAbsolutePath } from './paths';
import { normalizeColumnWidths } from './ui/columns';
import { normalizeSplit } from './ui/split';
import { normalizeTheme } from './ui/theme';
import { normalizeZoom } from './ui/zoom';

/**
 * Settings as the app understands them, from whatever a settings.json holds
 * (PLAN 11.3 d). Tolerant: unknown keys are dropped and a bad value falls back to
 * its default, so a hand-edited or older file never stops the app starting. So a
 * file from before codex.6 loses `openaiModel` at the next save, and its
 * `provider: "openai"`, a provider no longer offered, reads as the default.
 *
 * Pure (CLAUDE.md rule 4); reading and writing the file is src/main/settingsStore.ts.
 */

function isEffort(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

function isProvider(value: unknown): value is Provider {
  return typeof value === 'string' && (PROVIDERS as readonly string[]).includes(value);
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * A folder the settings name, kept only when it is an absolute path with no
 * NUL in it; anything else is dropped to null, the usual folder (hardening.8).
 * A relative path would be read from whatever folder the app was started in.
 */
function folderSetting(value: unknown): string | null {
  return typeof value === 'string' && isAbsolutePath(value) && !hasNul(value) ? value : null;
}

/** The file types the guidelines file may be, as `assertGuidelinesFile` in main allows. */
const GUIDELINES_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.txt']);

/**
 * The guidelines file the settings name, kept only when it is an absolute path
 * to a .md or .txt file; anything else is dropped to null, the GUIDELINES.md in
 * the manuscript folder (hardening.8).
 */
function guidelinesSetting(value: unknown): string | null {
  const file = folderSetting(value);
  return file !== null && GUIDELINES_EXTENSIONS.has(extensionOf(file)) ? file : null;
}

/** The settings that name a folder or a file, which the normaliser drops when it cannot use them. */
export type PathSettingKey = 'manuscriptFolder' | 'reviewsFolder' | 'backupsFolder' | 'guidelinesPath';

const PATH_SETTING_KEYS: readonly PathSettingKey[] = [
  'manuscriptFolder',
  'reviewsFolder',
  'backupsFolder',
  'guidelinesPath'
];

/**
 * The first folder or file in `patch` that `normalizeSettings` would drop to
 * null, or null when there is none. Null itself is kept (the usual folder or
 * file), and a key the patch leaves out, or sends as undefined, is not looked
 * at. The drop is for a settings.json read from disk; main refuses a patch
 * this names rather than save null over what was chosen before (hardening.8
 * review, PLAN 11.3 d).
 */
export function droppedPathSetting(patch: object): PathSettingKey | null {
  for (const key of PATH_SETTING_KEYS) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    const kept = key === 'guidelinesPath' ? guidelinesSetting(value) : folderSetting(value);
    if (kept === null) return key;
  }
  return null;
}

/** Unique non-empty strings, in their first order. */
function stringSet(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) seen.add(item);
  }
  return [...seen];
}

export function normalizeSettings(input: unknown): Settings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const manuscriptFolder = folderSetting(raw['manuscriptFolder']);
  return {
    manuscriptFolder,
    reviewsFolder: folderSetting(raw['reviewsFolder']),
    // Kept on the same terms as the reviews folder; whether it lies in the
    // manuscript folder is main's to refuse, as it saves (setup.18).
    backupsFolder: folderSetting(raw['backupsFolder']),
    guidelinesPath: guidelinesSetting(raw['guidelinesPath']),
    provider: isProvider(raw['provider']) ? raw['provider'] : DEFAULT_SETTINGS.provider,
    // Any model a file names is kept, even one the list no longer shows; empty means the default.
    model: typeof raw['model'] === 'string' && raw['model'] ? raw['model'] : DEFAULT_SETTINGS.model,
    // Empty is meaningful for ChatGPT's (codex.3), "the list's default", so only a non-string falls back.
    chatgptModel:
      typeof raw['chatgptModel'] === 'string' ? raw['chatgptModel'] : DEFAULT_SETTINGS.chatgptModel,
    effort: isEffort(raw['effort']) ? raw['effort'] : DEFAULT_SETTINGS.effort,
    zoom: normalizeZoom(raw['zoom']),
    theme: normalizeTheme(raw['theme']),
    // A settings file from before 1.0 has no such key: someone who already chose
    // a folder has been through setup and should not see the welcome guide.
    onboardingDone:
      typeof raw['onboardingDone'] === 'boolean' ? raw['onboardingDone'] : manuscriptFolder !== null,
    dismissedHints: stringSet(raw['dismissedHints']),
    checkForUpdates:
      typeof raw['checkForUpdates'] === 'boolean' ? raw['checkForUpdates'] : DEFAULT_SETTINGS.checkForUpdates,
    updateDownloadConsent: nullableString(raw['updateDownloadConsent'], null),
    sideSplit: normalizeSplit(raw['sideSplit']),
    columnWidths: normalizeColumnWidths(raw['columnWidths'])
  };
}

/** A fresh copy of the first-run settings, safe to change. */
export function defaultSettings(): Settings {
  return normalizeSettings({});
}
