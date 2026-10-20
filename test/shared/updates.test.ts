import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_REPOSITORY } from '../../src/shared/branding';
import {
  IDLE,
  classifyUpdateError,
  formatDownloadSize,
  isVersion,
  keptConsent,
  parseFakeUpdate,
  plainVersion,
  releasePageUrl,
  shouldAutoResumeDownload,
  updateCardFor,
  updateModeFor,
  updateStatusLine,
  type UpdateState,
  type UpdateStatus
} from '../../src/shared/updates';

/* release.8b: the updater's rules and words, without Electron (PLAN 11.3 n). */

/** An error as electron-updater's `newError` makes one: a message and a string code. */
function updaterError(message: string, code?: string): Error {
  const err = new Error(message);
  if (code !== undefined) Object.assign(err, { code });
  return err;
}

/** builder-util-runtime's HttpError, as far as its fields go. */
function httpError(statusCode: number): Error {
  const err = new Error(`${statusCode} Not Found\nHeaders: {}`);
  Object.assign(err, { name: 'HttpError', statusCode, code: `HTTP_ERROR_${statusCode}` });
  return err;
}

function statusWith(state: UpdateState, mode: UpdateStatus['mode'] = 'auto'): UpdateStatus {
  return {
    mode,
    offReason: mode === 'off' ? 'development' : null,
    current: '1.0.0',
    state,
    checkedAt: null,
    releaseUrl: releasePageUrl(APP_REPOSITORY, null)
  };
}

describe('updateModeFor', () => {
  it('is off in development, whatever the platform', () => {
    for (const platform of ['win32', 'darwin', 'linux']) expect(updateModeFor(false, platform)).toBe('off');
  });

  it('installs on Windows and only tells elsewhere', () => {
    expect(updateModeFor(true, 'win32')).toBe('auto');
    expect(updateModeFor(true, 'darwin')).toBe('notify');
    expect(updateModeFor(true, 'linux')).toBe('notify');
    expect(updateModeFor(true, 'freebsd')).toBe('notify');
  });
});

describe('classifyUpdateError', () => {
  it('reads no published release from the codes the plan names', () => {
    expect(
      classifyUpdateError(
        updaterError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS')
      )
    ).toBe('no-releases');
    expect(
      classifyUpdateError(
        updaterError('Unable to find latest version on GitHub', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND')
      )
    ).toBe('no-releases');
  });

  it('reads an empty releases feed as no published release, and other missing XML as a failure', () => {
    expect(
      classifyUpdateError(updaterError('No published versions on GitHub', 'ERR_XML_MISSED_ELEMENT'))
    ).toBe('no-releases');
    expect(classifyUpdateError(updaterError('No element "link"', 'ERR_XML_MISSED_ELEMENT'))).toBe('failed');
  });

  it('reads a 404 as no published release: a repository that is missing or not public', () => {
    expect(classifyUpdateError(httpError(404))).toBe('no-releases');
    expect(classifyUpdateError(updaterError('404', 'HTTP_ERROR_404'))).toBe('no-releases');
    expect(classifyUpdateError(Object.assign(new Error('Not found'), { statusCode: 404 }))).toBe(
      'no-releases'
    );
    expect(classifyUpdateError(httpError(500))).toBe('failed');
    expect(classifyUpdateError(httpError(403))).toBe('failed');
  });

  it("reads Electron's network failures and Node's connection codes as offline", () => {
    for (const message of [
      'net::ERR_INTERNET_DISCONNECTED',
      'net::ERR_NAME_NOT_RESOLVED',
      'Error: net::ERR_CONNECTION_RESET at ...'
    ]) {
      expect(classifyUpdateError(new Error(message)), message).toBe('offline');
    }
    for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH']) {
      expect(classifyUpdateError(updaterError('connect failed', code)), code).toBe('offline');
    }
  });

  it('reads a missing app-update.yml as no feed, and any other missing file as a failure', () => {
    expect(
      classifyUpdateError(
        updaterError("ENOENT: no such file or directory, open 'C:\\app\\resources\\app-update.yml'", 'ENOENT')
      )
    ).toBe('no-feed');
    expect(classifyUpdateError(updaterError("ENOENT: no such file, open 'installer.exe'", 'ENOENT'))).toBe(
      'failed'
    );
  });

  it('calls anything else a failure, things that are not errors included', () => {
    expect(classifyUpdateError(updaterError('sha512 checksum mismatch', 'ERR_CHECKSUM_MISMATCH'))).toBe(
      'failed'
    );
    expect(classifyUpdateError(new Error('something'))).toBe('failed');
    expect(classifyUpdateError('net::ERR_INTERNET_DISCONNECTED')).toBe('failed');
    expect(classifyUpdateError(null)).toBe('failed');
    expect(classifyUpdateError(undefined)).toBe('failed');
  });
});

describe('versions and the release page', () => {
  it('compares versions without a leading v or spaces', () => {
    expect(plainVersion('v1.0.1')).toBe('1.0.1');
    expect(plainVersion(' 1.0.1 ')).toBe('1.0.1');
    expect(plainVersion('V2.0.0-rc.1')).toBe('2.0.0-rc.1');
    expect(plainVersion('version')).toBe('version');
  });

  it('knows a version as the release workflow tags it', () => {
    expect(isVersion('1.0.1')).toBe(true);
    expect(isVersion('v1.0.1')).toBe(true);
    expect(isVersion('0.9.0-rc.1')).toBe(true);
    expect(isVersion('1.0')).toBe(false);
    expect(isVersion('1.0.1 now')).toBe(false);
    expect(isVersion('')).toBe(false);
  });

  it("points at a version's own release page, or at the list", () => {
    expect(releasePageUrl('owner/repo', '1.0.1')).toBe('https://github.com/owner/repo/releases/tag/v1.0.1');
    expect(releasePageUrl('owner/repo', 'v1.0.1')).toBe('https://github.com/owner/repo/releases/tag/v1.0.1');
    expect(releasePageUrl('owner/repo', null)).toBe('https://github.com/owner/repo/releases');
  });

  it('gives a size in megabytes as Windows counts them', () => {
    expect(formatDownloadSize(114_007_945)).toBe('108.7 MB');
    expect(formatDownloadSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatDownloadSize(10)).toBe('0.1 MB');
  });
});

describe('the download consent', () => {
  it('resumes only the very version consented to, and only on Windows', () => {
    expect(shouldAutoResumeDownload({ mode: 'auto', consent: '1.0.1', version: '1.0.1' })).toBe(true);
    expect(shouldAutoResumeDownload({ mode: 'auto', consent: 'v1.0.1', version: '1.0.1' })).toBe(true);
    expect(shouldAutoResumeDownload({ mode: 'auto', consent: '1.0.1', version: '1.0.2' })).toBe(false);
    expect(shouldAutoResumeDownload({ mode: 'auto', consent: null, version: '1.0.1' })).toBe(false);
    expect(shouldAutoResumeDownload({ mode: 'notify', consent: '1.0.1', version: '1.0.1' })).toBe(false);
    expect(shouldAutoResumeDownload({ mode: 'off', consent: '1.0.1', version: '1.0.1' })).toBe(false);
  });

  it('keeps the consent while its version is on offer and drops it otherwise', () => {
    expect(keptConsent('1.0.1', '1.0.1')).toBe('1.0.1');
    expect(keptConsent('1.0.1', 'v1.0.1')).toBe('1.0.1');
    expect(keptConsent('1.0.1', '1.0.2')).toBeNull();
    expect(keptConsent('1.0.1', null)).toBeNull();
    expect(keptConsent(null, '1.0.1')).toBeNull();
  });
});

describe('updateCardFor', () => {
  it('says nothing for a check, whatever it found, or while Restart now runs', () => {
    const quiet: UpdateState[] = [
      IDLE,
      { phase: 'checking', manual: false },
      { phase: 'checking', manual: true },
      { phase: 'up-to-date', manual: true },
      { phase: 'installing', version: '1.0.1' },
      { phase: 'failed', stage: 'check', kind: 'offline', manual: true, version: null },
      { phase: 'failed', stage: 'check', kind: 'no-releases', manual: false, version: null },
      { phase: 'failed', stage: 'check', kind: 'failed', manual: false, version: null }
    ];
    for (const state of quiet) expect(updateCardFor(statusWith(state)), state.phase).toBeNull();
  });

  it('offers the version with its size and Download', () => {
    expect(updateCardFor(statusWith({ phase: 'available', version: '1.0.1', size: 114_007_945 }))).toEqual({
      tone: 'info',
      text: `${APP_NAME} 1.0.1 is available: a download of up to 108.7 MB.`,
      action: 'update-download'
    });
    expect(updateCardFor(statusWith({ phase: 'available', version: '1.0.1', size: null }))?.text).toBe(
      `${APP_NAME} 1.0.1 is available.`
    );
  });

  it('counts the download in whole percent, with no button', () => {
    const card = updateCardFor(
      statusWith({ phase: 'downloading', version: '1.0.1', percent: 45.7, transferred: 1, total: 2 })
    );
    expect(card).toEqual({ tone: 'info', text: `Downloading ${APP_NAME} 1.0.1: 45%.` });
    expect(
      updateCardFor(
        statusWith({ phase: 'downloading', version: '1.0.1', percent: 140, transferred: 1, total: 1 })
      )?.text
    ).toBe(`Downloading ${APP_NAME} 1.0.1: 100%.`);
  });

  it('offers Restart now once downloaded', () => {
    expect(updateCardFor(statusWith({ phase: 'downloaded', version: '1.0.1' }))).toEqual({
      tone: 'info',
      text: `${APP_NAME} 1.0.1 is ready to install. Restart now closes ${APP_NAME}, installs it and opens ${APP_NAME} again.`,
      action: 'update-restart'
    });
  });

  it('points at the release page in notify mode', () => {
    expect(updateCardFor(statusWith({ phase: 'notify', version: '1.0.1' }, 'notify'))).toEqual({
      tone: 'info',
      text: `${APP_NAME} 1.0.1 is available. Its release page has the download.`,
      action: 'update-open-page'
    });
  });

  it('offers Download again after a download failed, saying when GitHub could not be reached', () => {
    const offline = updateCardFor(
      statusWith({ phase: 'failed', stage: 'download', kind: 'offline', manual: false, version: '1.0.1' })
    );
    expect(offline?.tone).toBe('warn');
    expect(offline?.action).toBe('update-download');
    expect(offline?.text).toContain('GitHub could not be reached');
    const other = updateCardFor(
      statusWith({ phase: 'failed', stage: 'download', kind: 'failed', manual: false, version: '1.0.1' })
    );
    expect(other?.text).toBe(
      `${APP_NAME} 1.0.1 could not be downloaded. Press Download to try again; the log has the details.`
    );
  });

  it('offers Restart now again after an install failed, and says the app goes on as it was', () => {
    expect(
      updateCardFor(
        statusWith({ phase: 'failed', stage: 'install', kind: 'failed', manual: false, version: '1.0.1' })
      )
    ).toEqual({
      tone: 'error',
      text: `${APP_NAME} 1.0.1 could not be installed, and ${APP_NAME} is still running as it was. Press Restart now to try again, or install it from the release page.`,
      action: 'update-restart'
    });
  });
});

describe('updateStatusLine', () => {
  it('says "Up to date", as the release checklist expects (PLAN 11.4)', () => {
    expect(updateStatusLine(statusWith({ phase: 'up-to-date', manual: true }))).toBe('Up to date');
  });

  it('says why updates are off', () => {
    expect(updateStatusLine(statusWith(IDLE, 'off'))).toBe('Updates are off in a development run.');
    expect(updateStatusLine({ ...statusWith(IDLE, 'off'), offReason: 'no-feed' })).toBe(
      `This copy of ${APP_NAME} cannot update itself: it has no update feed.`
    );
  });

  it('has a line for every state', () => {
    const lines: [UpdateState, string][] = [
      [IDLE, 'Not checked yet.'],
      [{ phase: 'checking', manual: true }, 'Checking for updates…'],
      [
        { phase: 'available', version: '1.0.1', size: 3 * 1024 * 1024 },
        `${APP_NAME} 1.0.1 is available: a download of up to 3.0 MB.`
      ],
      [
        { phase: 'downloading', version: '1.0.1', percent: 9.99, transferred: 0, total: 0 },
        `Downloading ${APP_NAME} 1.0.1: 9%.`
      ],
      [{ phase: 'downloaded', version: '1.0.1' }, `${APP_NAME} 1.0.1 is ready to install.`],
      [{ phase: 'installing', version: '1.0.1' }, `Installing ${APP_NAME} 1.0.1…`],
      [{ phase: 'notify', version: '1.0.1' }, `${APP_NAME} 1.0.1 is available on its release page.`],
      [
        { phase: 'failed', stage: 'check', kind: 'no-releases', manual: true, version: null },
        'No release has been published yet.'
      ],
      [
        { phase: 'failed', stage: 'check', kind: 'offline', manual: true, version: null },
        'GitHub could not be reached. Check the internet connection and try again.'
      ],
      [
        { phase: 'failed', stage: 'check', kind: 'no-feed', manual: true, version: null },
        `This copy of ${APP_NAME} cannot update itself: it has no update feed.`
      ],
      [
        { phase: 'failed', stage: 'check', kind: 'failed', manual: true, version: null },
        'The check for updates failed. The log has the details.'
      ]
    ];
    for (const [state, line] of lines) expect(updateStatusLine(statusWith(state)), state.phase).toBe(line);
  });

  it('words a failed download or install as its card does', () => {
    for (const state of [
      { phase: 'failed', stage: 'download', kind: 'offline', manual: false, version: '1.0.1' },
      { phase: 'failed', stage: 'install', kind: 'failed', manual: false, version: '1.0.1' }
    ] as const) {
      expect(updateStatusLine(statusWith(state))).toBe(updateCardFor(statusWith(state))?.text);
    }
  });

  it('never says "accepted changes"', () => {
    const states: UpdateState[] = [
      { phase: 'downloaded', version: '1.0.1' },
      { phase: 'failed', stage: 'install', kind: 'failed', manual: false, version: '1.0.1' }
    ];
    for (const state of states) {
      expect(updateStatusLine(statusWith(state))).not.toMatch(/accepted changes/i);
      expect(updateCardFor(statusWith(state))?.text).not.toMatch(/accepted changes/i);
    }
  });
});

describe('parseFakeUpdate', () => {
  it('reads a version as an update that downloads and installs', () => {
    expect(parseFakeUpdate('1.0.1')).toEqual({ version: '1.0.1', outcome: 'available' });
    expect(parseFakeUpdate(' v1.0.1 ')).toEqual({ version: '1.0.1', outcome: 'available' });
  });

  it('reads a version with what goes wrong', () => {
    expect(parseFakeUpdate('1.0.1 download-fails')).toEqual({ version: '1.0.1', outcome: 'download-fails' });
    expect(parseFakeUpdate('1.0.1  install-fails')).toEqual({ version: '1.0.1', outcome: 'install-fails' });
  });

  it('reads the three outcomes that need no version', () => {
    expect(parseFakeUpdate('up-to-date')).toEqual({ version: null, outcome: 'up-to-date' });
    expect(parseFakeUpdate('no-releases')).toEqual({ version: null, outcome: 'no-releases' });
    expect(parseFakeUpdate('offline')).toEqual({ version: null, outcome: 'offline' });
  });

  it('turns the fake off for anything else', () => {
    for (const text of [
      null,
      '',
      'yes',
      '1',
      '1.0',
      '1.0.1 later',
      '1.0.1 install-fails now',
      'offline 1.0.1',
      'up-to-date 1.0.1'
    ]) {
      expect(parseFakeUpdate(text), String(text)).toBeNull();
    }
  });
});
