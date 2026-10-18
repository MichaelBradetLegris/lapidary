import { describe, expect, it } from 'vitest';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { THEMES, normalizeTheme } from '../../src/shared/ui/theme';

/* hardening.3a: every 1.0 setting normalised in one place (PLAN 11.3 d). */

describe('normalizeSettings', () => {
  it('fills a first run from the defaults, with Default as the Claude model', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(defaultSettings().model).toBe('default');
    expect(defaultSettings().theme).toBe('system');
    expect(defaultSettings().checkForUpdates).toBe(true);
  });

  it('keeps a model the file names, and maps an empty one to the default', () => {
    expect(normalizeSettings({ model: 'opus' }).model).toBe('opus');
    expect(normalizeSettings({ model: 'claude-some-future-model' }).model).toBe('claude-some-future-model');
    expect(normalizeSettings({ model: '' }).model).toBe('default');
    expect(normalizeSettings({ model: 5 }).model).toBe('default');
  });

  it('treats a settings file from before 1.0 as onboarded when it names a folder', () => {
    expect(normalizeSettings({ manuscriptFolder: 'C:/Novel' }).onboardingDone).toBe(true);
    expect(normalizeSettings({ manuscriptFolder: null }).onboardingDone).toBe(false);
    expect(normalizeSettings({ manuscriptFolder: 'C:/Novel', onboardingDone: false }).onboardingDone).toBe(
      false
    );
  });

  it('keeps dismissed hints unique and drops anything that is not a non-empty string', () => {
    expect(normalizeSettings({ dismissedHints: ['save', 'save', '', 3, 'theme'] }).dismissedHints).toEqual([
      'save',
      'theme'
    ]);
    expect(normalizeSettings({ dismissedHints: 'save' }).dismissedHints).toEqual([]);
  });

  it('reads the update settings', () => {
    expect(normalizeSettings({ checkForUpdates: false }).checkForUpdates).toBe(false);
    expect(normalizeSettings({ checkForUpdates: 'no' }).checkForUpdates).toBe(true);
    expect(normalizeSettings({ updateDownloadConsent: '1.0.1' }).updateDownloadConsent).toBe('1.0.1');
    expect(normalizeSettings({ updateDownloadConsent: '' }).updateDownloadConsent).toBeNull();
  });

  it('keeps the side panel split as a share, and the usual split as null (ui.6)', () => {
    expect(defaultSettings().sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: 0.3125 }).sideSplit).toBe(0.3125);
    expect(normalizeSettings({ sideSplit: 1.2 }).sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: '0.4' }).sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: null }).sideSplit).toBeNull();
  });

  it('drops unknown keys and never shares the default array', () => {
    const settings = normalizeSettings({ surprise: 1 });
    expect(settings).not.toHaveProperty('surprise');
    settings.dismissedHints.push('x');
    expect(defaultSettings().dismissedHints).toEqual([]);
    expect(DEFAULT_SETTINGS.dismissedHints).toEqual([]);
  });
});

describe('normalizeTheme', () => {
  it('accepts the three themes and falls back to system', () => {
    for (const theme of THEMES) expect(normalizeTheme(theme)).toBe(theme);
    expect(normalizeTheme('Dark')).toBe('system');
    expect(normalizeTheme(undefined)).toBe('system');
  });
});
