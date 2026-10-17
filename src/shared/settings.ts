import {
  DEFAULT_SETTINGS,
  EFFORT_LEVELS,
  PROVIDERS,
  type EffortLevel,
  type Provider,
  type Settings
} from './types';
import { normalizeTheme } from './ui/theme';
import { normalizeZoom } from './ui/zoom';

/**
 * Settings as the app understands them, from whatever a settings.json holds
 * (PLAN 11.3 d). Tolerant: unknown keys are dropped and a bad value falls back to
 * its default, so a hand-edited or older file never stops the app starting.
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
  const manuscriptFolder = nullableString(raw['manuscriptFolder'], DEFAULT_SETTINGS.manuscriptFolder);
  return {
    manuscriptFolder,
    reviewsFolder: nullableString(raw['reviewsFolder'], DEFAULT_SETTINGS.reviewsFolder),
    guidelinesPath: nullableString(raw['guidelinesPath'], DEFAULT_SETTINGS.guidelinesPath),
    provider: isProvider(raw['provider']) ? raw['provider'] : DEFAULT_SETTINGS.provider,
    // Any model a file names is kept, even one the list no longer shows; empty means the default.
    model: typeof raw['model'] === 'string' && raw['model'] ? raw['model'] : DEFAULT_SETTINGS.model,
    // Empty is meaningful here ("the list's default"), so only a non-string falls back.
    openaiModel: typeof raw['openaiModel'] === 'string' ? raw['openaiModel'] : DEFAULT_SETTINGS.openaiModel,
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
    updateDownloadConsent: nullableString(raw['updateDownloadConsent'], null)
  };
}

/** A fresh copy of the first-run settings, safe to change. */
export function defaultSettings(): Settings {
  return normalizeSettings({});
}
