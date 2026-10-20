import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  NIL_STAGING_ID,
  STAGING_HEADER,
  chooseUpdateSource,
  createUpdateController,
  updaterLogger,
  type ProgressLike,
  type UpdateCheckLike,
  type UpdateController,
  type UpdateControllerDeps,
  type UpdaterLike,
  type UpdaterLogger,
  type UpdateSettings
} from '../../src/main/updates';
import type { UpdateMode, UpdateState, UpdateStatus } from '../../src/shared/updates';

/* release.8b: the updater's controller (PLAN 11.1 Updates, 11.3 n), driven
   with a scripted stand-in for electron-updater and fake timers. No request
   leaves: nothing here loads electron-updater. */

const REPO = 'owner/repo';

/** A scripted stand-in for electron-updater's `autoUpdater`. */
class StubUpdater implements UpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  disableWebInstaller = false;
  requestHeaders: Record<string, unknown> | null = { accept: '*/*' };
  logger: UpdaterLogger | null = null;
  checks = 0;
  downloads = 0;
  readonly installs: [boolean | undefined, boolean | undefined][] = [];
  /** what the next check gives */
  answer: () => Promise<UpdateCheckLike | null> = () => Promise.resolve(available('1.0.1'));
  /** the download under way */
  finishDownload: (() => void) | null = null;
  failDownload: ((err: Error) => void) | null = null;
  /** what quitAndInstall does besides recording the call */
  onInstall: () => void = () => undefined;
  private readonly progress = new Set<(info: ProgressLike) => void>();
  private readonly errors = new Set<(error: Error) => void>();

  checkForUpdates(): Promise<UpdateCheckLike | null> {
    this.checks += 1;
    return this.answer();
  }

  downloadUpdate(): Promise<unknown> {
    this.downloads += 1;
    return new Promise((resolve, reject) => {
      this.finishDownload = () => resolve(['installer.exe']);
      this.failDownload = reject;
    });
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.installs.push([isSilent, isForceRunAfter]);
    this.onInstall();
  }

  on(
    event: 'download-progress' | 'error',
    listener: ((info: ProgressLike) => void) | ((error: Error) => void)
  ): this {
    if (event === 'download-progress') this.progress.add(listener as (info: ProgressLike) => void);
    else this.errors.add(listener as (error: Error) => void);
    return this;
  }

  removeListener(_event: 'error', listener: (error: Error) => void): this {
    this.errors.delete(listener);
    return this;
  }

  emitProgress(percent: number, total = 1000): void {
    for (const listener of this.progress) listener({ percent, transferred: (total * percent) / 100, total });
  }

  emitError(err: Error): void {
    for (const listener of [...this.errors]) listener(err);
  }

  errorListeners(): number {
    return this.errors.size;
  }
}

function available(version: string, size: number | null = 114_007_945): UpdateCheckLike {
  return { isUpdateAvailable: true, updateInfo: { version, files: size === null ? [] : [{ size }] } };
}

function upToDate(version = '1.0.0'): UpdateCheckLike {
  return { isUpdateAvailable: false, updateInfo: { version, files: [] } };
}

function coded(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

interface Harness {
  controller: UpdateController;
  updater: StubUpdater;
  loads: () => number;
  settings: UpdateSettings;
  pushed: UpdateStatus[];
  phases: () => string[];
  logged: { level: string; event: string; fields: Readonly<Record<string, unknown>> | undefined }[];
  calls: string[];
  takeBack: ReturnType<typeof vi.fn>;
}

function setup(
  options: {
    mode?: UpdateMode;
    settings?: Partial<UpdateSettings>;
    deps?: Partial<UpdateControllerDeps>;
  } = {}
): Harness {
  const updater = new StubUpdater();
  let loads = 0;
  const settings: UpdateSettings = {
    checkForUpdates: true,
    updateDownloadConsent: null,
    ...options.settings
  };
  const pushed: UpdateStatus[] = [];
  const logged: Harness['logged'] = [];
  const calls: string[] = [];
  const takeBack = vi.fn(() => calls.push('takeBack'));
  const mode = options.mode ?? 'auto';
  const controller = createUpdateController({
    mode,
    offReason: mode === 'off' ? 'development' : null,
    current: '1.0.0',
    repository: REPO,
    loadUpdater: () => {
      loads += 1;
      return updater;
    },
    settings: () => Promise.resolve({ ...settings }),
    saveConsent: (version) => {
      calls.push(`saveConsent:${version}`);
      settings.updateDownloadConsent = version;
      return Promise.resolve();
    },
    push: (status) => pushed.push(status),
    install: {
      allowNextClose: (reason) => {
        calls.push(`allowNextClose:${reason}`);
        return takeBack;
      },
      abortAll: () => {
        calls.push('abortAll');
        return 0;
      },
      writesSettled: () => {
        calls.push('writesSettled');
        return Promise.resolve(true);
      },
      stopWatching: () => calls.push('stopWatching'),
      resumeWatching: () => calls.push('resumeWatching')
    },
    log: (level, event, fields) => logged.push({ level, event, fields }),
    now: () => new Date('2026-10-20T12:00:00Z'),
    ...options.deps
  });
  return {
    controller,
    updater,
    loads: () => loads,
    settings,
    pushed,
    phases: () => pushed.map((s) => s.state.phase),
    logged,
    calls,
    takeBack
  };
}

/** Check, offer `version` and press Download: a download under way. */
async function downloading(h: Harness, version = '1.0.1'): Promise<void> {
  h.updater.answer = () => Promise.resolve(available(version));
  await h.controller.check(true);
  await h.controller.download(version);
}

/** As `downloading`, and the download ends. */
async function downloaded(h: Harness, version = '1.0.1'): Promise<void> {
  await downloading(h, version);
  h.updater.finishDownload?.();
  await vi.advanceTimersByTimeAsync(0);
}

function state(h: Harness): UpdateState {
  return h.controller.status().state;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('off', () => {
  it('starts no timer, checks nothing and never loads the updater', async () => {
    const h = setup({ mode: 'off' });
    h.controller.start();
    expect(vi.getTimerCount()).toBe(0);
    const status = await h.controller.check(true);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(status).toMatchObject({ mode: 'off', offReason: 'development', state: { phase: 'idle' } });
    expect(h.loads()).toBe(0);
    expect(h.updater.checks).toBe(0);
    expect(h.pushed).toEqual([]);
    expect(h.logged).toEqual([
      { level: 'info', event: 'update.mode', fields: { mode: 'off', reason: 'development' } }
    ]);
  });

  it('refuses a download and an install', async () => {
    const h = setup({ mode: 'off' });
    await expect(h.controller.download('1.0.1')).rejects.toBeInstanceOf(AppFailure);
    await expect(h.controller.install()).rejects.toMatchObject({ code: 'not-found' });
    expect(h.loads()).toBe(0);
  });
});

describe('the timer', () => {
  it('checks 15 s after launch and every 24 hours after, while the setting is on', async () => {
    const h = setup();
    h.controller.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1);
    expect(h.updater.checks).toBe(0);
    expect(h.loads()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.updater.checks).toBe(1);
    expect(FIRST_CHECK_DELAY_MS).toBe(15_000);
    expect(CHECK_INTERVAL_MS).toBe(86_400_000);
    h.updater.answer = () => Promise.resolve(upToDate());
    await h.controller.check(true);
    const before = h.updater.checks;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(h.updater.checks).toBe(before + 1);
    h.controller.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks nothing on its own while the setting is off, though Check for updates still does', async () => {
    const h = setup({ settings: { checkForUpdates: false } });
    h.controller.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(h.updater.checks).toBe(0);
    expect(h.loads()).toBe(0);
    expect(h.logged.filter((l) => l.event === 'update.check.skipped').map((l) => l.fields)).toEqual([
      { reason: 'setting' },
      { reason: 'setting' }
    ]);
    await h.controller.check(true);
    expect(h.updater.checks).toBe(1);
  });

  it('does not check again on its own while a version is on offer, so its card stays put', async () => {
    const h = setup();
    await h.controller.check(true);
    expect(state(h).phase).toBe('available');
    h.controller.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(h.updater.checks).toBe(1);
    expect(h.phases()).toEqual(['checking', 'available']);
  });

  it('starts once, however often it is asked', async () => {
    const h = setup();
    h.controller.start();
    h.controller.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(h.updater.checks).toBe(1);
  });
});

describe('the updater', () => {
  it('is loaded once, on the first check, and set as the plan says', async () => {
    const h = setup();
    await h.controller.check(false);
    await h.controller.check(true);
    expect(h.loads()).toBe(1);
    expect(h.updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowPrerelease: false,
      allowDowngrade: false,
      disableWebInstaller: true
    });
    expect(h.updater.logger).not.toBeNull();
    expect(h.logged.find((l) => l.event === 'update.updater-loaded')?.fields).toEqual({ mode: 'auto' });
  });

  it('sends the nil id where electron-updater would send a random id of the install', async () => {
    const h = setup();
    await h.controller.check(false);
    expect(h.updater.requestHeaders).toEqual({ accept: '*/*', [STAGING_HEADER]: NIL_STAGING_ID });
    expect(NIL_STAGING_ID).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('a check', () => {
  it('offers a newer version with the size of its installer', async () => {
    const h = setup();
    const status = await h.controller.check(false);
    expect(h.phases()).toEqual(['checking', 'available']);
    expect(status).toEqual({
      mode: 'auto',
      offReason: null,
      current: '1.0.0',
      state: { phase: 'available', version: '1.0.1', size: 114_007_945 },
      checkedAt: '2026-10-20T12:00:00.000Z',
      releaseUrl: 'https://github.com/owner/repo/releases/tag/v1.0.1'
    });
    expect(h.pushed.at(-1)).toEqual(status);
    expect(h.logged.find((l) => l.event === 'update.available')?.fields).toEqual({
      version: '1.0.1',
      size: 114_007_945
    });
  });

  it('gives no size when the feed has none, and drops a leading v', async () => {
    const h = setup();
    h.updater.answer = () => Promise.resolve(available('v1.0.2', null));
    expect((await h.controller.check(false)).state).toEqual({
      phase: 'available',
      version: '1.0.2',
      size: null
    });
  });

  it('only says where to get it in notify mode, and never downloads', async () => {
    const h = setup({ mode: 'notify' });
    const status = await h.controller.check(false);
    expect(status.state).toEqual({ phase: 'notify', version: '1.0.1' });
    expect(status.releaseUrl).toBe('https://github.com/owner/repo/releases/tag/v1.0.1');
    await expect(h.controller.download('1.0.1')).rejects.toMatchObject({ code: 'invalid-input' });
    expect(h.updater.downloads).toBe(0);
  });

  it('says up to date, and drops a consent left from an update since installed', async () => {
    const h = setup({ settings: { updateDownloadConsent: '1.0.0' } });
    h.updater.answer = () => Promise.resolve(upToDate('1.0.0'));
    const status = await h.controller.check(true);
    expect(status.state).toEqual({ phase: 'up-to-date', manual: true });
    expect(status.releaseUrl).toBe('https://github.com/owner/repo/releases');
    expect(h.calls).toEqual(['saveConsent:null']);
  });

  it('writes nothing when up to date with no consent', async () => {
    const h = setup();
    h.updater.answer = () => Promise.resolve(upToDate());
    await h.controller.check(false);
    expect(h.calls).toEqual([]);
  });

  it('says the updater is not active, as in an unpacked build, by going back to idle', async () => {
    const h = setup();
    h.updater.answer = () => Promise.resolve(null);
    expect((await h.controller.check(true)).state).toEqual({ phase: 'idle' });
    expect(h.logged.some((l) => l.event === 'update.inactive')).toBe(true);
  });

  it('classifies a failure, keeps whether the author asked, and keeps the consent', async () => {
    const h = setup({ settings: { updateDownloadConsent: '1.0.1' } });
    h.updater.answer = () =>
      Promise.reject(coded('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'));
    const status = await h.controller.check(true);
    expect(status.state).toEqual({
      phase: 'failed',
      stage: 'check',
      kind: 'no-releases',
      manual: true,
      version: null
    });
    expect(status.checkedAt).toBe('2026-10-20T12:00:00.000Z');
    expect(h.settings.updateDownloadConsent).toBe('1.0.1');
    const failed = h.logged.find((l) => l.event === 'update.check.failed');
    expect(failed?.level).toBe('info');
    expect(failed?.fields).toMatchObject({ kind: 'no-releases' });
    h.updater.answer = () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'));
    expect((await h.controller.check(false)).state).toMatchObject({ kind: 'offline', manual: false });
    h.updater.answer = () => Promise.reject(new Error('sha512 checksum mismatch'));
    await h.controller.check(false);
    expect(h.logged.at(-1)).toMatchObject({
      level: 'warn',
      event: 'update.check.failed',
      fields: { kind: 'failed' }
    });
  });

  it('runs one check at a time, and one the author asks for during the timer’s counts as theirs', async () => {
    const h = setup();
    let answer!: (result: UpdateCheckLike) => void;
    h.updater.answer = () => new Promise((resolve) => (answer = resolve));
    const timer = h.controller.check(false);
    await vi.advanceTimersByTimeAsync(0);
    const asked = h.controller.check(true);
    expect(state(h)).toEqual({ phase: 'checking', manual: true });
    h.updater.answer = () => Promise.resolve(upToDate());
    answer(upToDate());
    const [a, b] = await Promise.all([timer, asked]);
    expect(h.updater.checks).toBe(1);
    expect(a.state).toEqual({ phase: 'up-to-date', manual: true });
    expect(b).toEqual(a);
  });

  it('does not check while a download or an install is under way', async () => {
    const h = setup();
    await downloading(h);
    const checks = h.updater.checks;
    expect((await h.controller.check(true)).state.phase).toBe('downloading');
    h.updater.finishDownload?.();
    await vi.advanceTimersByTimeAsync(0);
    expect((await h.controller.check(true)).state.phase).toBe('downloaded');
    expect(h.updater.checks).toBe(checks);
  });
});

describe('the download', () => {
  it('starts on Download, remembers the consent first, and counts whole percents', async () => {
    const h = setup();
    await h.controller.check(false);
    const status = await h.controller.download('1.0.1');
    expect(h.calls).toEqual(['saveConsent:1.0.1']);
    expect(status.state).toEqual({
      phase: 'downloading',
      version: '1.0.1',
      percent: 0,
      transferred: 0,
      total: 0
    });
    expect(h.updater.downloads).toBe(1);
    const pushes = h.pushed.length;
    h.updater.emitProgress(0.4);
    h.updater.emitProgress(12.2);
    h.updater.emitProgress(12.9);
    h.updater.emitProgress(13);
    expect(
      h.pushed.slice(pushes).map((s) => (s.state.phase === 'downloading' ? s.state.percent : -1))
    ).toEqual([0, 12, 13]);
    h.updater.finishDownload?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(state(h)).toEqual({ phase: 'downloaded', version: '1.0.1' });
    expect(h.logged.find((l) => l.event === 'update.download')?.fields).toEqual({
      version: '1.0.1',
      resumed: false
    });
  });

  it('refuses a version that is not on offer', async () => {
    const h = setup();
    await expect(h.controller.download('1.0.1')).rejects.toMatchObject({ code: 'not-found' });
    await h.controller.check(false);
    await expect(h.controller.download('1.0.2')).rejects.toMatchObject({ code: 'not-found' });
    expect(h.updater.downloads).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('answers a second Download for the version under way without starting another', async () => {
    const h = setup();
    await downloading(h);
    await h.controller.download('v1.0.1');
    expect(h.updater.downloads).toBe(1);
  });

  it('says so when it fails, and Download tries again', async () => {
    const h = setup();
    await downloading(h);
    h.updater.failDownload?.(new Error('net::ERR_CONNECTION_RESET'));
    await vi.advanceTimersByTimeAsync(0);
    expect(state(h)).toEqual({
      phase: 'failed',
      stage: 'download',
      kind: 'offline',
      manual: false,
      version: '1.0.1'
    });
    await h.controller.download('1.0.1');
    expect(h.updater.downloads).toBe(2);
    expect(state(h).phase).toBe('downloading');
  });

  it('goes on without asking for the version consented to, after a restart', async () => {
    const h = setup({ settings: { updateDownloadConsent: '1.0.1' } });
    await h.controller.check(false);
    expect(h.phases()).toEqual(['checking', 'downloading']);
    expect(h.updater.downloads).toBe(1);
    expect(h.calls).toEqual([]);
    expect(h.logged.find((l) => l.event === 'update.download')?.fields).toEqual({
      version: '1.0.1',
      resumed: true
    });
  });

  it('asks again for a newer version than the one consented to, and drops the old consent', async () => {
    const h = setup({ settings: { updateDownloadConsent: '1.0.1' } });
    h.updater.answer = () => Promise.resolve(available('1.0.2'));
    await h.controller.check(false);
    expect(state(h)).toMatchObject({ phase: 'available', version: '1.0.2' });
    expect(h.updater.downloads).toBe(0);
    expect(h.calls).toEqual(['saveConsent:null']);
  });

  it('downloads even when the consent cannot be written', async () => {
    const h = setup({ deps: { saveConsent: () => Promise.reject(new Error('settings.json is held open')) } });
    await h.controller.check(false);
    await h.controller.download('1.0.1');
    expect(h.updater.downloads).toBe(1);
    expect(h.logged.some((l) => l.event === 'update.consent-unsaved')).toBe(true);
  });
});

describe('Restart now', () => {
  it('is refused until an update is downloaded', async () => {
    const h = setup();
    await expect(h.controller.install()).rejects.toMatchObject({ code: 'not-found' });
    await downloading(h);
    await expect(h.controller.install()).rejects.toMatchObject({ code: 'not-found' });
    expect(h.updater.installs).toEqual([]);
  });

  it('installs through runUpdateInstall: the close allowed first, then quitAndInstall(false, true)', async () => {
    const h = setup();
    await downloaded(h);
    h.updater.onInstall = () => h.calls.push('quitAndInstall');
    expect((await h.controller.install()).state).toEqual({ phase: 'installing', version: '1.0.1' });
    expect(h.calls.slice(1)).toEqual([
      'allowNextClose:update',
      'abortAll',
      'writesSettled',
      'stopWatching',
      'quitAndInstall'
    ]);
    expect(h.updater.installs).toEqual([[false, true]]);
    expect(state(h)).toEqual({ phase: 'installing', version: '1.0.1' });
    expect(h.takeBack).not.toHaveBeenCalled();
  });

  it('takes the allowance back and shows the error when the installer cannot start', async () => {
    const h = setup();
    await downloaded(h);
    const errorsBefore = h.updater.errorListeners();
    // electron-updater raises the error event and returns, rather than throwing.
    h.updater.onInstall = () =>
      h.updater.emitError(new Error('No update filepath provided, can’t quit and install'));
    expect((await h.controller.install()).state).toMatchObject({ phase: 'failed', stage: 'install' });
    expect(state(h)).toEqual({
      phase: 'failed',
      stage: 'install',
      kind: 'failed',
      manual: false,
      version: '1.0.1'
    });
    expect(h.takeBack).toHaveBeenCalledTimes(1);
    expect(h.calls.slice(-2)).toEqual(['takeBack', 'resumeWatching']);
    expect(h.updater.errorListeners()).toBe(errorsBefore);
    expect(h.logged.filter((l) => l.event === 'update.install.failed')).toHaveLength(1);
  });

  it('can be pressed again after an install that failed', async () => {
    const h = setup();
    await downloaded(h);
    h.updater.onInstall = () => h.updater.emitError(new Error('busy'));
    await h.controller.install();
    h.updater.onInstall = () => undefined;
    await h.controller.install();
    expect(h.updater.installs).toHaveLength(2);
    expect(state(h).phase).toBe('installing');
  });

  it('takes the allowance back when the installer fails after it had started', async () => {
    const h = setup();
    await downloaded(h);
    await h.controller.install();
    h.updater.emitError(Object.assign(new Error('spawn EACCES'), { code: 'EACCES', syscall: 'spawn' }));
    expect(h.takeBack).toHaveBeenCalledTimes(1);
    expect(state(h)).toMatchObject({ phase: 'failed', stage: 'install', version: '1.0.1' });
  });

  it('ignores an error event that is not about an install', async () => {
    const h = setup();
    await h.controller.check(false);
    const pushes = h.pushed.length;
    h.updater.emitError(new Error('Cannot check for updates'));
    expect(h.pushed.length).toBe(pushes);
    expect(state(h).phase).toBe('available');
  });
});

describe('chooseUpdateSource', () => {
  const base = { packaged: true, platform: 'win32', feedExists: () => true, fakeUpdate: null };

  it('follows updateModeFor for an installed build with a feed', () => {
    expect(chooseUpdateSource(base)).toEqual({
      mode: 'auto',
      offReason: null,
      fake: null,
      fakeIgnored: false
    });
    expect(chooseUpdateSource({ ...base, platform: 'darwin' }).mode).toBe('notify');
  });

  it('is off in development, without looking for a feed', () => {
    const feedExists = vi.fn(() => true);
    expect(chooseUpdateSource({ ...base, packaged: false, feedExists })).toEqual({
      mode: 'off',
      offReason: 'development',
      fake: null,
      fakeIgnored: false
    });
    expect(feedExists).not.toHaveBeenCalled();
  });

  it('is off for an installed build with no app-update.yml, as a package:dir build has (C.88)', () => {
    expect(chooseUpdateSource({ ...base, feedExists: () => false })).toMatchObject({
      mode: 'off',
      offReason: 'no-feed'
    });
  });

  it('puts the fake in a development run with a switch it can read, in the mode an installed build would have', () => {
    expect(chooseUpdateSource({ ...base, packaged: false, fakeUpdate: '1.0.1' })).toEqual({
      mode: 'auto',
      offReason: null,
      fake: { version: '1.0.1', outcome: 'available' },
      fakeIgnored: false
    });
    expect(
      chooseUpdateSource({ ...base, packaged: false, platform: 'linux', fakeUpdate: 'offline' }).mode
    ).toBe('notify');
  });

  it('turns the fake off for a switch it cannot read, and in an installed build', () => {
    expect(chooseUpdateSource({ ...base, packaged: false, fakeUpdate: 'soon' })).toEqual({
      mode: 'off',
      offReason: 'development',
      fake: null,
      fakeIgnored: true
    });
    expect(chooseUpdateSource({ ...base, fakeUpdate: '1.0.1' })).toMatchObject({ mode: 'auto', fake: null });
  });
});

describe('updaterLogger', () => {
  function lines(): { logger: UpdaterLogger; logged: [string, string, unknown][] } {
    const logged: [string, string, unknown][] = [];
    return { logger: updaterLogger((level, event, fields) => logged.push([level, event, fields])), logged };
  }

  it("keeps the first line of electron-updater's messages, under `updater`", () => {
    const { logger, logged } = lines();
    logger.info('Checking for update');
    logger.info('Full: 108.6 MB, To download: 3.1 MB (3%)');
    logger.warn('Cannot parse releases feed: Error\n    at parse (feed.js:1:1)\nXML:\n<feed>');
    logger.debug?.('updater cache dir: somewhere');
    expect(logged).toEqual([
      ['info', 'updater', { text: 'Checking for update' }],
      ['info', 'updater', { text: 'Full: 108.6 MB, To download: 3.1 MB (3%)' }],
      ['warn', 'updater', { text: 'Cannot parse releases feed: Error' }]
    ]);
  });

  it('drops the echo of an error event, which the controller logs through the error policy', () => {
    const { logger, logged } = lines();
    logger.error('Error: Error: net::ERR_INTERNET_DISCONNECTED\n    at SimpleURLLoaderWrapper');
    logger.error('Cannot download differentially, fallback to full download: Error: Cannot find blockmap');
    expect(logged).toEqual([
      [
        'warn',
        'updater',
        { text: 'Cannot download differentially, fallback to full download: Error: Cannot find blockmap' }
      ]
    ]);
  });

  it('logs what is not a string as text', () => {
    const { logger, logged } = lines();
    logger.info(new Error('first\nsecond'));
    logger.info(42);
    expect(logged.map(([, , fields]) => fields)).toEqual([{ text: 'first' }, { text: '42' }]);
  });
});
