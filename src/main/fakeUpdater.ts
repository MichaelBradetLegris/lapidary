import type { FakeUpdatePlan } from '../shared/updates';
import type { ProgressLike, UpdateCheckLike, UpdaterLike, UpdaterLogger } from './updates';

/**
 * The fake update (`MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`, `release.8b`, PLAN
 * 11.3 b): a stand-in for electron-updater in a development run, so the
 * update cards, Restart now and the page's tests can be seen and driven with
 * no release, no installer and no request to GitHub. It plays its plan
 * (`parseFakeUpdate`) through the same calls and events the controller uses:
 *
 * - a check takes 1.5 s and finds the version, or nothing newer, or no
 *   published release, or no connection;
 * - a download reports 10% every 0.3 s and ends after 3 s, or breaks off at
 *   40% for `download-fails`;
 * - Restart now's `quitAndInstall` does what electron-updater 6.8.10's does
 *   once a download is there: it returns, and quits the app on the next turn
 *   of the event loop (`setImmediate`), where the real one starts the
 *   installer. For `install-fails` it raises the `error` event in between
 *   (`process.nextTick`), as the real one does when the installer's spawn
 *   fails, and still quits; the controller holds that quit. Like the real
 *   one, it starts one install a run and ignores every later call.
 *
 * Each step is said on the terminal (`say`), as "[fake update] ...".
 *
 * No electron import: the quit comes in, so test/main/fakeUpdater.test.ts
 * drives it with fake timers.
 */

export const FAKE_CHECK_MS = 1_500;
export const FAKE_STEP_MS = 300;
export const FAKE_STEPS = 10;
/** About the size of the real installer (PLAN 11.5, Update size). */
export const FAKE_INSTALLER_BYTES = 114_000_000;

export interface FakeUpdaterDeps {
  plan: FakeUpdatePlan;
  /** the version running now, which an `up-to-date` check reports */
  current: string;
  /** `app.quit()` */
  quit(): void;
  say(line: string): void;
}

/** An error as electron-updater gives it: a message and a code. */
function updaterError(message: string, code?: string): Error {
  const err = new Error(message);
  if (code) Object.assign(err, { code });
  return err;
}

export function createFakeUpdater(deps: FakeUpdaterDeps): UpdaterLike {
  const { plan } = deps;
  const progress = new Set<(info: ProgressLike) => void>();
  const errors = new Set<(error: Error) => void>();
  const say = (line: string): void => deps.say(`[fake update] ${line}`);

  function raise(err: Error): void {
    for (const listener of [...errors]) listener(err);
  }

  function checkForUpdates(): Promise<UpdateCheckLike | null> {
    say('checking');
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        if (plan.outcome === 'no-releases') {
          say('check: no published release');
          reject(updaterError('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'));
        } else if (plan.outcome === 'offline') {
          say('check: GitHub could not be reached');
          reject(updaterError('net::ERR_INTERNET_DISCONNECTED'));
        } else if (plan.version === null || plan.outcome === 'up-to-date') {
          say('check: nothing newer');
          resolve({ isUpdateAvailable: false, updateInfo: { version: deps.current, files: [] } });
        } else {
          say(`check: ${plan.version} is available`);
          resolve({
            isUpdateAvailable: true,
            updateInfo: { version: plan.version, files: [{ size: FAKE_INSTALLER_BYTES }] }
          });
        }
      }, FAKE_CHECK_MS);
    });
  }

  function downloadUpdate(): Promise<unknown> {
    say(`downloading ${plan.version ?? ''}`.trimEnd());
    return new Promise((resolve, reject) => {
      let step = 0;
      const tick = (): void => {
        step += 1;
        const percent = (step * 100) / FAKE_STEPS;
        if (plan.outcome === 'download-fails' && percent > 40) {
          say('download broke off at 40%');
          reject(updaterError('net::ERR_CONNECTION_RESET'));
          return;
        }
        const transferred = Math.round((FAKE_INSTALLER_BYTES * step) / FAKE_STEPS);
        for (const listener of [...progress]) {
          listener({ percent, transferred, total: FAKE_INSTALLER_BYTES, bytesPerSecond: 0 });
        }
        if (step >= FAKE_STEPS) {
          say('downloaded');
          resolve(['fake-installer.exe']);
          return;
        }
        setTimeout(tick, FAKE_STEP_MS);
      };
      setTimeout(tick, FAKE_STEP_MS);
    });
  }

  /** BaseUpdater's `quitAndInstallCalled`: set by the first install, and never cleared in this run. */
  let installCalled = false;

  function quitAndInstall(isSilent = false, isForceRunAfter = false): void {
    if (installCalled) {
      say('install call ignored: an install was already started in this run');
      return;
    }
    installCalled = true;
    if (plan.outcome === 'install-fails') {
      say('install: the installer could not be started; the quit electron-updater queued follows');
      process.nextTick(() => raise(updaterError('spawn EPERM (fake update)', 'EPERM')));
    } else {
      say(
        `install: the installer would start now (silent ${isSilent}, run after ${isForceRunAfter}); quitting instead`
      );
    }
    setImmediate(() => deps.quit());
  }

  const updater: UpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: true,
    allowPrerelease: false,
    allowDowngrade: false,
    disableWebInstaller: false,
    requestHeaders: null,
    logger: null as UpdaterLogger | null,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    on(
      event: 'download-progress' | 'error',
      listener: ((info: ProgressLike) => void) | ((error: Error) => void)
    ) {
      if (event === 'download-progress') progress.add(listener as (info: ProgressLike) => void);
      else errors.add(listener as (error: Error) => void);
      return updater;
    },
    removeListener(_event: 'error', listener: (error: Error) => void) {
      errors.delete(listener);
      return updater;
    }
  };
  return updater;
}
