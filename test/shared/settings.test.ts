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

  /* focus.1: off unless the file says true, with a hold time Settings offers. */
  it('keeps focus mode off unless the file says true, and a hold time of 15, 30 or 60 seconds', () => {
    expect(defaultSettings().focusMode).toBe(false);
    expect(defaultSettings().focusHoldSeconds).toBe(30);
    expect(normalizeSettings({ focusMode: true }).focusMode).toBe(true);
    for (const other of [false, 'true', 1, 'yes', null, {}]) {
      expect(normalizeSettings({ focusMode: other }).focusMode, JSON.stringify(other)).toBe(false);
    }
    for (const seconds of [15, 30, 60]) {
      expect(normalizeSettings({ focusHoldSeconds: seconds }).focusHoldSeconds).toBe(seconds);
    }
    for (const other of [10, 45, 120, '15', null, -15]) {
      expect(normalizeSettings({ focusHoldSeconds: other }).focusHoldSeconds, JSON.stringify(other)).toBe(30);
    }
  });

  it('keeps the side panel split as a share, and the usual split as null (ui.6)', () => {
    expect(defaultSettings().sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: 0.3125 }).sideSplit).toBe(0.3125);
    expect(normalizeSettings({ sideSplit: 1.2 }).sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: '0.4' }).sideSplit).toBeNull();
    expect(normalizeSettings({ sideSplit: null }).sideSplit).toBeNull();
  });

  it("keeps each side column's width as a share of the window, and the usual width as null (polish.5)", () => {
    expect(defaultSettings().columnWidths).toEqual({ files: null, side: null });
    expect(normalizeSettings({ columnWidths: { files: 0.105337, side: 0.501404 } }).columnWidths).toEqual({
      files: 0.105337,
      side: 0.501404
    });
    // Each is read on its own: a bad one is the usual width, the other kept.
    expect(normalizeSettings({ columnWidths: { files: 1.2, side: 0.3 } }).columnWidths).toEqual({
      files: null,
      side: 0.3
    });
    expect(normalizeSettings({ columnWidths: { files: '0.2', side: 0 } }).columnWidths).toEqual({
      files: null,
      side: null
    });
    // Anything but an object, and unknown keys, are dropped.
    for (const bad of [null, 0.2, 'wide', [0.2, 0.3]]) {
      expect(normalizeSettings({ columnWidths: bad }).columnWidths).toEqual({ files: null, side: null });
    }
    expect(normalizeSettings({ columnWidths: { files: 0.2, centre: 0.5 } }).columnWidths).toEqual({
      files: 0.2,
      side: null
    });
  });

  /* polish.17: Show states went, and with it `showRowStates`, which polish.12
     kept. A settings.json written in between still holds the key, and is read
     as a file with any key the app does not know: the key is dropped, and
     the rest is read as ever (settingsStore.test.ts: the next write leaves it out). */
  it('drops showRowStates, which Show states kept until polish.17, whatever its value', () => {
    expect(Object.keys(defaultSettings())).not.toContain('showRowStates');
    for (const value of [false, true, 'false', 0, null, {}]) {
      const read = normalizeSettings({ showRowStates: value, zoom: 1.25, sideSplit: 0.4 });
      expect(Object.keys(read), JSON.stringify(value)).not.toContain('showRowStates');
      expect(read).toEqual({ ...defaultSettings(), zoom: 1.25, sideSplit: 0.4 });
    }
  });

  /* codex.6: the OpenAI API key went, and with it `openaiModel` and the
     `openai` provider. A settings.json written before then is read as a file
     with a key the app does not know and a provider it does not know: the
     model is dropped, the provider reads as Claude, the default, and the rest
     is read as ever (settingsStore.test.ts: the next write leaves both out). */
  it('drops openaiModel and reads the openai provider as Claude, as codex.6 took out the key', () => {
    expect(Object.keys(defaultSettings())).not.toContain('openaiModel');
    const read = normalizeSettings({
      provider: 'openai',
      openaiModel: 'gpt-5-mini',
      chatgptModel: 'gpt-5.5',
      zoom: 1.25
    });
    expect(Object.keys(read)).not.toContain('openaiModel');
    expect(read).toEqual({ ...defaultSettings(), provider: 'claude', chatgptModel: 'gpt-5.5', zoom: 1.25 });
    expect(normalizeSettings({ provider: 'chatgpt' }).provider).toBe('chatgpt');
  });

  /* hardening.8: a folder or a guidelines file the app cannot use is dropped
     to null, the usual one; the backups folder since setup.18 too. */
  const NUL = '\u0000';
  const FOLDERS = ['manuscriptFolder', 'reviewsFolder', 'backupsFolder'] as const;

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

  /* setup.18: a settings.json from before has no backups folder, which reads
     as the one in the data folder. Whether one lies in the manuscript folder
     is main's to refuse as it saves, not the normaliser's. */
  it('reads a settings.json with no backups folder as the data folder, and keeps one inside the manuscript folder', () => {
    expect(normalizeSettings({ manuscriptFolder: 'C:\\Novel' }).backupsFolder).toBeNull();
    expect(
      normalizeSettings({ manuscriptFolder: 'C:\\Novel', backupsFolder: 'C:\\Novel\\Backups' }).backupsFolder
    ).toBe('C:\\Novel\\Backups');
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
  const KEYS = ['manuscriptFolder', 'reviewsFolder', 'backupsFolder', 'guidelinesPath'] as const;

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
