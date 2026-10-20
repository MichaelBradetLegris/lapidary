import { describe, expect, it } from 'vitest';
import { defaultSettings, droppedPathSetting, normalizeSettings } from '../../src/shared/settings';
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

  /* hardening.8: a folder or a guidelines file the app cannot use is dropped to null, the usual one. */
  const NUL = '\u0000';
  const FOLDERS = ['manuscriptFolder', 'reviewsFolder'] as const;

  it('keeps a folder given as an absolute path, on Windows or POSIX', () => {
    for (const key of FOLDERS) {
      for (const folder of [
        'C:\\Novel',
        'c:/Novel',
        'D:\\',
        '\\\\srv\\share\\Novel',
        '//srv/share',
        '/srv/novel'
      ]) {
        expect(normalizeSettings({ [key]: folder })[key], `${key} ${folder}`).toBe(folder);
      }
      expect(normalizeSettings({ [key]: null })[key]).toBeNull();
    }
  });

  it('drops a folder that is relative, empty, not a string or holds a NUL', () => {
    for (const key of FOLDERS) {
      for (const folder of [
        'Novel',
        '.\\Novel',
        './Novel',
        '..\\Novel',
        '~/Novel',
        'C:Novel',
        'C:',
        ' C:\\Novel',
        '',
        '   ',
        `C:\\Novel${NUL}`,
        `C:\\No${NUL}vel\\Part 1`,
        5,
        true,
        ['C:\\Novel'],
        { path: 'C:\\Novel' }
      ]) {
        expect(normalizeSettings({ [key]: folder })[key], `${key} ${JSON.stringify(folder)}`).toBeNull();
      }
    }
  });

  it('shows the welcome guide again when the only manuscript folder named is dropped', () => {
    expect(normalizeSettings({ manuscriptFolder: 'Novel' }).onboardingDone).toBe(false);
    expect(normalizeSettings({ manuscriptFolder: 'Novel', onboardingDone: true }).onboardingDone).toBe(true);
  });

  it('keeps a guidelines file given as an absolute path to a .md or .txt file, in any case', () => {
    for (const file of [
      'C:\\Novel\\GUIDELINES.md',
      'C:\\Novel\\House style.MD',
      'D:/Notes/rules.txt',
      '\\\\srv\\share\\Style.Txt',
      '/srv/novel/style.md',
      'C:\\Novel\\..md',
      'C:\\Novel\\notes.v2.md'
    ]) {
      expect(normalizeSettings({ guidelinesPath: file }).guidelinesPath, file).toBe(file);
    }
    expect(normalizeSettings({ guidelinesPath: null }).guidelinesPath).toBeNull();
  });

  it('drops a guidelines file that is not .md or .txt, is relative, or holds a NUL', () => {
    for (const file of [
      'C:\\Novel\\rules.docx',
      'C:\\Novel\\GUIDELINES',
      'C:\\Novel\\GUIDELINES.md.bak',
      'C:\\Novel\\GUIDELINES.md ',
      'C:\\Novel\\.md',
      'C:\\Novel.md\\rules',
      'C:\\Novel\\',
      'GUIDELINES.md',
      '.\\GUIDELINES.md',
      'C:GUIDELINES.md',
      `C:\\Novel\\GUIDELINES.md${NUL}`,
      `C:\\Novel\\GUIDE${NUL}.txt`,
      '',
      7
    ]) {
      expect(normalizeSettings({ guidelinesPath: file }).guidelinesPath, JSON.stringify(file)).toBeNull();
    }
  });

  it('drops only the value it cannot use, keeping the rest of the file', () => {
    const settings = normalizeSettings({
      manuscriptFolder: 'C:\\Novel',
      reviewsFolder: 'Reviews',
      guidelinesPath: 'C:\\Novel\\style.pdf',
      model: 'opus',
      onboardingDone: true
    });
    expect(settings).toMatchObject({
      manuscriptFolder: 'C:\\Novel',
      reviewsFolder: null,
      guidelinesPath: null,
      model: 'opus',
      onboardingDone: true
    });
  });

  it('drops unknown keys and never shares the default array', () => {
    const settings = normalizeSettings({ surprise: 1 });
    expect(settings).not.toHaveProperty('surprise');
    settings.dismissedHints.push('x');
    expect(defaultSettings().dismissedHints).toEqual([]);
    expect(DEFAULT_SETTINGS.dismissedHints).toEqual([]);
  });
});

/* hardening.8 review: a save that names a folder or guidelines file the
   normaliser would drop is refused in main, so droppedPathSetting has to name
   exactly the values the normaliser drops. */
describe('droppedPathSetting', () => {
  const NUL = '\u0000';
  const VALUES: unknown[] = [
    'C:\\Novel',
    'D:/Notes/rules.txt',
    'C:\\Novel\\GUIDELINES.md',
    'C:\\Novel\\House style.MD',
    '\\\\srv\\share\\Style.Txt',
    '/srv/novel/style.md',
    'C:\\Novel\\rules.docx',
    'C:\\Novel\\GUIDELINES',
    'C:\\Novel\\GUIDELINES.md ',
    'C:\\Novel\\.md',
    'C:\\Novel\\notes.md\\',
    'Novel',
    'GUIDELINES.md',
    '.\\Reviews',
    'C:Novel',
    '',
    `C:\\Novel${NUL}`,
    `C:\\Novel\\GUIDE${NUL}.txt`,
    5,
    false,
    ['C:\\Novel'],
    { path: 'C:\\Novel' }
  ];
  const KEYS = ['manuscriptFolder', 'reviewsFolder', 'guidelinesPath'] as const;

  it('names a value exactly when normalizeSettings would drop it to null', () => {
    for (const key of KEYS) {
      for (const value of VALUES) {
        const dropped = normalizeSettings({ [key]: value })[key] === null;
        expect(droppedPathSetting({ [key]: value }), `${key} ${JSON.stringify(value)}`).toBe(
          dropped ? key : null
        );
      }
    }
  });

  it('takes null, the usual folder or file, and passes over a key left out or sent as undefined', () => {
    expect(
      droppedPathSetting({ manuscriptFolder: null, reviewsFolder: null, guidelinesPath: null })
    ).toBeNull();
    expect(droppedPathSetting({ reviewsFolder: undefined, zoom: 1.25, model: 'opus' })).toBeNull();
    expect(droppedPathSetting({})).toBeNull();
  });

  it('names the first such setting, whatever comes with it', () => {
    expect(
      droppedPathSetting({ manuscriptFolder: 'C:\\Novel', guidelinesPath: 'C:\\Novel\\style.pdf' })
    ).toBe('guidelinesPath');
    expect(droppedPathSetting({ reviewsFolder: 'Reviews', guidelinesPath: 'C:\\Novel\\style.pdf' })).toBe(
      'reviewsFolder'
    );
  });
});

describe('normalizeTheme', () => {
  it('accepts the three themes and falls back to system', () => {
    for (const theme of THEMES) expect(normalizeTheme(theme)).toBe(theme);
    expect(normalizeTheme('Dark')).toBe('system');
    expect(normalizeTheme(undefined)).toBe('system');
  });
});
