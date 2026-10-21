import { createRequire } from 'node:module';
import { APP_NAME } from '../shared/branding';
import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { RequestChannel, RequestPayload, ResponsePayload } from '../shared/ipc';
import {
  IDLE,
  classifyUpdateError,
  keptConsent,
  parseFakeUpdate,
  plainVersion,
  releasePageUrl,
  shouldAutoResumeDownload,
  updateModeFor,
  type FakeUpdatePlan,
  type UpdateMode,
  type UpdateOffReason,
  type UpdateState,
  type UpdateStatus
} from '../shared/updates';
import { fail } from './errors';
import { createFakeUpdater } from './fakeUpdater';
import type { LogLevel } from './log';
import { runUpdateInstall, type UpdateInstallDeps } from './updateInstall';

/**
 * The updater, main side (`release.8b`; PLAN 11.1 Updates, 11.3 n).
 *
 * One controller keeps where the updater is (`UpdateState`) and pushes every
 * change to the page as `update:state`; the page asks for it once it loads
 * (`update:get`), checks when the author asks (`update:check`), downloads on
 * the author's word (`update:download`) and installs by Restart now
 * (`update:install`, `runUpdateInstall` in updateInstall.ts).
 *
 * - **When it checks.** 15 s after launch and every 24 hours after that, each
 *   time only while the `checkForUpdates` setting is on; Check for updates
 *   checks whatever the setting says. Never in a development run, and never
 *   in an installed build without `resources/app-update.yml` (a `package:dir`
 *   build, C.88): the mode is then `off`, and electron-updater is not even
 *   loaded.
 * - **What it asks.** The GitHub provider of the build's `app-update.yml`,
 *   with no token: the releases feed and the newest release's `latest.yml`.
 *   electron-updater sends a random id of the install's own with every
 *   request, for staged roll-outs, which this app does not use; the
 *   controller sends the nil id in its place, so no request tells one install
 *   from another (Appendix C "What the updater sends and keeps").
 * - **Download on consent.** A version on offer waits for Download, which
 *   records the version in `updateDownloadConsent`, so a download cut short by
 *   a restart, or done and not installed, goes on at the next check without a
 *   second press (`shouldAutoResumeDownload`). A newer version asks again.
 * - **Install only by Restart now**, with the installer's progress window
 *   showing (`quitAndInstall(false, true)`); never on quit
 *   (`autoInstallOnAppQuit` false), since an install that the shutdown of the
 *   computer cuts short can leave half an app. electron-updater 6.8.10 starts
 *   the installer and queues the app's quit for the next turn of the event
 *   loop, and only then hears whether the installer could start. When it
 *   says it could not, the controller cancels that quit (`beforeQuit`, from
 *   main's `before-quit`), takes the close allowance back and starts the
 *   watcher again; when no quit comes at all, it does the same. Either way
 *   electron-updater starts no second install in this run, so the card points
 *   at the release page (Appendix C "What the updater settled where the plan
 *   left it open").
 * - **Notify only off Windows.** A check says a newer version is out and
 *   points at its release page; nothing is downloaded.
 * - **The fake** (`MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`, development runs only)
 *   puts `createFakeUpdater` in electron-updater's place: the same states,
 *   timed, with no request at all, for the page's tests and a look at the
 *   cards.
 *
 * electron-updater's own lines go to the app log as `updater` with their
 * first line only (`updaterLogger`); the controller logs each step as
 * `update.*`, errors through `loggableErrorFields`.
 *
 * No electron import: `src/main/ipc.ts` hands in the app's facts and the IPC,
 * so test/main/updates.test.ts drives the controller with a fake updater and
 * fake timers.
 */

/** The first check, after launch. */
export const FIRST_CHECK_DELAY_MS = 15_000;

/**
 * How long after `quitAndInstall` has returned the controller waits for the
 * quit electron-updater queues for the next turn of the event loop. With no
 * quit by then the install has failed; and a quit held after the installer
 * failed to start is let go then, so it never holds one the author asks for.
 */
export const INSTALL_QUIT_WAIT_MS = 1_000;

/** Every check after the first. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** electron-updater's header for staged roll-outs, which carries a random id of the install's own. */
export const STAGING_HEADER = 'x-user-staging-id';

/** What the controller sends in its place: the nil UUID, the same for every install. */
export const NIL_STAGING_ID = '00000000-0000-0000-0000-000000000000';

/** electron-updater's logger interface. */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

/** What a check found, as electron-updater's `UpdateCheckResult` gives it. */
export interface UpdateCheckLike {
  readonly isUpdateAvailable: boolean;
  readonly updateInfo: { readonly version: string; readonly files?: readonly { readonly size?: number }[] };
}

/** `download-progress`, as electron-updater's `ProgressInfo` gives it. */
export interface ProgressLike {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond?: number;
}

/**
 * The part of electron-updater's `AppUpdater` the controller uses. The fake
 * (`createFakeUpdater`) has the same.
 */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  autoRunAppAfterInstall: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  requestHeaders: Record<string, unknown> | null;
  logger: UpdaterLogger | null;
  /** null when the updater is not active, as in an unpacked build */
  checkForUpdates(): Promise<UpdateCheckLike | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: 'download-progress', listener: (info: ProgressLike) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
}

type Log = (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/**
 * electron-updater's lines in the app log, as `updater` with the first line
 * only: "Checking for update", "Found version 1.0.1 (url: ...)", "Full: 108.6
 * MB, To download: 3.1 MB (3%)" and the like, scrubbed and cut by the log
 * as any field is. The later lines of a message are a stack or a dump of the
 * releases feed, and are dropped. Its error lines that begin "Error: " echo
 * an `error` event, which the controller logs itself, through the error
 * policy (`update.check.failed` and the rest), so they are dropped too.
 */
export function updaterLogger(log: Log): UpdaterLogger {
  const firstLine = (message: unknown): string => {
    const text =
      typeof message === 'string' ? message : message instanceof Error ? message.message : String(message);
    return text.split(/\r?\n/, 1)[0] ?? '';
  };
  return {
    info: (message) => log('info', 'updater', { text: firstLine(message) }),
    warn: (message) => log('warn', 'updater', { text: firstLine(message) }),
    error: (message) => {
      const text = firstLine(message);
      if (!text.startsWith('Error: ')) log('warn', 'updater', { text });
    },
    debug: () => undefined
  };
}

/** The size of the installer on offer, in bytes, or null when the feed does not give one. */
function installerSize(info: UpdateCheckLike['updateInfo']): number | null {
  const size = info.files?.[0]?.size;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
}

/** The setting values the controller reads. */
export interface UpdateSettings {
  checkForUpdates: boolean;
  updateDownloadConsent: string | null;
}

export interface UpdateControllerDeps {
  mode: UpdateMode;
  offReason: UpdateOffReason | null;
  /** the version running now */
  current: string;
  /** `APP_REPOSITORY`, for the release page */
  repository: string;
  /** electron-updater's `autoUpdater`, or the fake; called once, the first time the updater is needed */
  loadUpdater(): UpdaterLike;
  /** rejects while settings.json cannot be read (`checkedUpdateSettings`) */
  settings(): Promise<UpdateSettings>;
  /** write `updateDownloadConsent` (through `trackWrite`, writes.ts) */
  saveConsent(version: string | null): Promise<unknown>;
  /** `update:state` to every window */
  push(status: UpdateStatus): void;
  /** Restart now's steps, apart from the updater's own `quitAndInstall` and the log */
  install: Omit<UpdateInstallDeps, 'quitAndInstall' | 'log'>;
  log: Log;
  now(): Date;
}

export interface UpdateController {
  status(): UpdateStatus;
  /** Log the mode and, unless it is `off`, start the timer: 15 s, then every 24 hours. */
  start(): void;
  /** Stop the timer. */
  stop(): void;
  /** Check now; one check at a time, and none while a download or an install is under way. */
  check(manual: boolean): Promise<UpdateStatus>;
  /** Download the version on offer, which must be `version`, and remember the consent. */
  download(version: string): Promise<UpdateStatus>;
  /** Restart now: install the downloaded version (`runUpdateInstall`); `installing`, or `failed` when it could not start. */
  install(): Promise<UpdateStatus>;
  /**
   * Main's `before-quit`. True when this quit is the one electron-updater
   * queued before it said the installer could not start: main cancels it, and
   * the app goes on as it was. Otherwise false, and Restart now's quit has
   * come.
   */
  beforeQuit(): boolean;
}

/** Restart now, from `update:install` until the app quits or the install fails. */
interface InstallRun {
  version: string;
  /** takes back the close allowance; kept as soon as `runUpdateInstall` has made it, before `quitAndInstall` */
  takeBack: (() => void) | null;
  /** `quitAndInstall` returned with no error raised inside it, so electron-updater has queued its quit */
  returned: boolean;
  /** the app has begun to quit (`before-quit`): the installer is on its way */
  quitting: boolean;
  /** fails the install when no quit has come `INSTALL_QUIT_WAIT_MS` after `quitAndInstall` returned */
  timer: ReturnType<typeof setTimeout> | null;
}

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  let state: UpdateState = IDLE;
  let checkedAt: string | null = null;
  let updater: UpdaterLike | null = null;
  let checking: Promise<UpdateStatus> | null = null;
  let firstTimer: ReturnType<typeof setTimeout> | null = null;
  let dailyTimer: ReturnType<typeof setInterval> | null = null;
  /** an `error` event raised inside `quitAndInstall` itself, which `runUpdateInstall` hears as a throw */
  let insideQuitAndInstall = false;
  /** Restart now under way */
  let run: InstallRun | null = null;
  /** set after the installer failed to start: the quit electron-updater queued is to be cancelled */
  let quitHold: ReturnType<typeof setTimeout> | null = null;
  /**
   * An install failed after electron-updater had started it. It starts one
   * install a run, so Restart now cannot try again, and no check runs until
   * the app is opened again, since the card it would bring back could not work.
   */
  let installSpent = false;

  function status(): UpdateStatus {
    const offered = 'version' in state ? state.version : null;
    return {
      mode: deps.mode,
      offReason: deps.offReason,
      current: deps.current,
      state,
      checkedAt,
      releaseUrl: releasePageUrl(deps.repository, offered)
    };
  }

  function set(next: UpdateState): void {
    state = next;
    deps.push(status());
  }

  function theUpdater(): UpdaterLike {
    if (updater) return updater;
    const loaded = deps.loadUpdater();
    loaded.logger = updaterLogger(deps.log);
    loaded.autoDownload = false;
    loaded.autoInstallOnAppQuit = false;
    loaded.autoRunAppAfterInstall = true;
    loaded.allowPrerelease = false;
    loaded.allowDowngrade = false;
    loaded.disableWebInstaller = true;
    loaded.requestHeaders = { ...(loaded.requestHeaders ?? {}), [STAGING_HEADER]: NIL_STAGING_ID };
    loaded.on('download-progress', onProgress);
    loaded.on('error', onUpdaterError);
    updater = loaded;
    deps.log('info', 'update.updater-loaded', { mode: deps.mode });
    return loaded;
  }

  function onProgress(info: ProgressLike): void {
    if (state.phase !== 'downloading') return;
    const percent = Math.max(0, Math.min(100, Math.floor(Number(info.percent) || 0)));
    const total = Number(info.total) || 0;
    // One push per whole percent, so the card's text changes no faster than it can be read.
    if (percent === state.percent && total === state.total) return;
    set({ ...state, percent, transferred: Number(info.transferred) || 0, total });
  }

  /**
   * electron-updater's `error` event. A check's and a download's errors also
   * reject their promise, which handles them, and one raised inside
   * `quitAndInstall` is the wrapper's; this acts only on an install that
   * failed after `quitAndInstall` had returned, which is how 6.8.10 reports an
   * installer that could not be started (`failInstallLate`). Once the app has
   * begun to quit it is only logged: the windows are already closing.
   */
  function onUpdaterError(err: Error): void {
    if (insideQuitAndInstall) return;
    const current = run;
    if (!current?.returned || state.phase !== 'installing') return;
    if (current.quitting) {
      deps.log('error', 'update.install.failed', { late: true, quitting: true, ...loggableErrorFields(err) });
      return;
    }
    failInstallLate(current, err);
  }

  function releaseQuit(): void {
    if (quitHold !== null) clearTimeout(quitHold);
    quitHold = null;
  }

  /** Cancel the quit electron-updater has queued, if it comes within `INSTALL_QUIT_WAIT_MS`. */
  function holdQuit(): void {
    releaseQuit();
    quitHold = setTimeout(() => {
      quitHold = null;
    }, INSTALL_QUIT_WAIT_MS);
  }

  /**
   * Restart now failed after `quitAndInstall` had returned: the installer
   * could not be started (`err`), and the quit electron-updater queued is
   * held; or no quit came (`err` null), and there is none to hold. Either
   * way the allowance goes back, the watcher starts again (11.3 n), and the
   * card points at the release page, since electron-updater starts no second
   * install in this run.
   */
  function failInstallLate(current: InstallRun, err: unknown): void {
    if (run !== current) return;
    run = null;
    if (current.timer !== null) clearTimeout(current.timer);
    installSpent = true;
    if (err !== null) holdQuit();
    current.takeBack?.();
    deps.install.resumeWatching();
    if (err === null) deps.log('error', 'update.install.no-quit', { waitedMs: INSTALL_QUIT_WAIT_MS });
    else deps.log('error', 'update.install.failed', { late: true, ...loggableErrorFields(err) });
    set({
      phase: 'failed',
      stage: 'install',
      kind: err === null ? 'failed' : classifyUpdateError(err),
      manual: false,
      version: current.version,
      retry: false
    });
  }

  function beforeQuit(): boolean {
    if (quitHold !== null) {
      releaseQuit();
      deps.log('info', 'update.install.quit-held');
      return true;
    }
    const current = run;
    if (current?.returned && !current.quitting) {
      current.quitting = true;
      if (current.timer !== null) clearTimeout(current.timer);
      current.timer = null;
    }
    return false;
  }

  async function readSettings(): Promise<UpdateSettings | null> {
    try {
      return await deps.settings();
    } catch (err) {
      deps.log('warn', 'update.settings-unread', loggableErrorFields(err));
      return null;
    }
  }

  async function writeConsent(version: string | null): Promise<void> {
    try {
      await deps.saveConsent(version);
    } catch (err) {
      // The download goes ahead: the consent only spares a second press after a restart.
      deps.log('warn', 'update.consent-unsaved', loggableErrorFields(err));
    }
  }

  function wasManual(fallback: boolean): boolean {
    return state.phase === 'checking' ? state.manual : fallback;
  }

  async function runCheck(manual: boolean): Promise<UpdateStatus> {
    set({ phase: 'checking', manual });
    deps.log('info', 'update.check', { manual });
    let result: UpdateCheckLike | null;
    try {
      result = await theUpdater().checkForUpdates();
    } catch (err) {
      checkedAt = deps.now().toISOString();
      const kind = classifyUpdateError(err);
      deps.log(kind === 'failed' ? 'warn' : 'info', 'update.check.failed', {
        kind,
        ...loggableErrorFields(err)
      });
      set({ phase: 'failed', stage: 'check', kind, manual: wasManual(manual), version: null, retry: true });
      return status();
    }
    checkedAt = deps.now().toISOString();
    if (result === null) {
      deps.log('info', 'update.inactive');
      set(IDLE);
      return status();
    }
    // While settings.json cannot be read the consent is not known and counts
    // as none: nothing resumes without a press, and nothing is written over it.
    const consent = (await readSettings())?.updateDownloadConsent ?? null;
    if (!result.isUpdateAvailable) {
      deps.log('info', 'update.none', { latest: result.updateInfo.version });
      if (consent !== null) await writeConsent(null);
      set({ phase: 'up-to-date', manual: wasManual(manual) });
      return status();
    }
    const version = plainVersion(result.updateInfo.version);
    const size = installerSize(result.updateInfo);
    deps.log('info', 'update.available', { version, size });
    if (deps.mode === 'notify') {
      set({ phase: 'notify', version });
      return status();
    }
    if (consent !== keptConsent(consent, version)) await writeConsent(null);
    if (shouldAutoResumeDownload({ mode: deps.mode, consent, version })) {
      startDownload(version, true);
      return status();
    }
    set({ phase: 'available', version, size });
    return status();
  }

  async function check(manual: boolean): Promise<UpdateStatus> {
    if (deps.mode === 'off') return status();
    if (checking) {
      // A check the author asks for while the timer's runs shares it, and its answer counts as theirs.
      if (manual && state.phase === 'checking' && !state.manual) set({ phase: 'checking', manual: true });
      return checking;
    }
    if (state.phase === 'downloading' || state.phase === 'downloaded' || state.phase === 'installing') {
      return status();
    }
    if (installSpent) {
      deps.log('info', 'update.check.skipped', { reason: 'install-failed', manual });
      return status();
    }
    checking = runCheck(manual).finally(() => {
      checking = null;
    });
    return checking;
  }

  function startDownload(version: string, resumed: boolean): void {
    set({ phase: 'downloading', version, percent: 0, transferred: 0, total: 0 });
    deps.log('info', 'update.download', { version, resumed });
    let download: Promise<unknown>;
    try {
      download = theUpdater().downloadUpdate();
    } catch (err) {
      download = Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    void download.then(
      () => {
        if (state.phase !== 'downloading' || state.version !== version) return;
        deps.log('info', 'update.downloaded', { version });
        set({ phase: 'downloaded', version });
      },
      (err: unknown) => {
        if (state.phase !== 'downloading' || state.version !== version) return;
        const kind = classifyUpdateError(err);
        deps.log('warn', 'update.download.failed', { version, kind, ...loggableErrorFields(err) });
        set({ phase: 'failed', stage: 'download', kind, manual: false, version, retry: true });
      }
    );
  }

  async function download(version: string): Promise<UpdateStatus> {
    if (deps.mode === 'off') throw fail('invalid-input', 'Updates are off in this copy of the app.');
    if (deps.mode === 'notify') {
      throw fail(
        'invalid-input',
        'This copy of the app does not download updates itself; its release page has them.'
      );
    }
    const wanted = plainVersion(version);
    if ((state.phase === 'downloading' || state.phase === 'downloaded') && state.version === wanted) {
      return status();
    }
    const offered =
      state.phase === 'available' || (state.phase === 'failed' && state.stage === 'download')
        ? state.version
        : null;
    if (offered === null || offered !== wanted) {
      throw fail('not-found', `Version ${wanted} is not on offer now. Check for updates again.`);
    }
    await writeConsent(offered);
    startDownload(offered, false);
    return status();
  }

  /**
   * `autoUpdater.quitAndInstall(false, true)` for `current`. electron-updater
   * raises an `error` event inside the call, not a throw, only when it has no
   * downloaded file to run, and this turns that into a throw for
   * `runUpdateInstall`. Otherwise it has started the installer and queued the
   * app's quit (or, after an install it started and lost, ignored the call),
   * so the wait for that quit begins here.
   */
  function quitAndInstall(current: InstallRun): void {
    const target = theUpdater();
    const raised: Error[] = [];
    const record = (err: Error): void => {
      raised.push(err);
    };
    target.on('error', record);
    insideQuitAndInstall = true;
    try {
      target.quitAndInstall(false, true);
    } finally {
      insideQuitAndInstall = false;
      target.removeListener('error', record);
    }
    const first = raised[0];
    if (first) throw first;
    current.returned = true;
    current.timer = setTimeout(() => failInstallLate(current, null), INSTALL_QUIT_WAIT_MS);
  }

  async function install(): Promise<UpdateStatus> {
    if (state.phase === 'failed' && state.stage === 'install' && !state.retry) {
      throw fail(
        'invalid-input',
        `Restart now can try again once ${APP_NAME} has been closed and opened again. The release page has the installer.`
      );
    }
    const version =
      state.phase === 'downloaded' || (state.phase === 'failed' && state.stage === 'install')
        ? state.version
        : null;
    if (version === null) throw fail('not-found', 'There is no downloaded update to install.');
    const current: InstallRun = { version, takeBack: null, returned: false, quitting: false, timer: null };
    run = current;
    set({ phase: 'installing', version });
    const outcome = await runUpdateInstall({
      ...deps.install,
      // Kept before quitAndInstall runs, so an installer that fails in the
      // same turn still finds the allowance to take back.
      allowNextClose: (reason) => {
        current.takeBack = deps.install.allowNextClose(reason);
        return current.takeBack;
      },
      quitAndInstall: () => quitAndInstall(current),
      log: deps.log
    });
    if (outcome.started) return status();
    // runUpdateInstall has taken the allowance back and started the watcher again.
    if (run === current) run = null;
    set({
      phase: 'failed',
      stage: 'install',
      kind: classifyUpdateError(outcome.error),
      manual: false,
      version,
      retry: true
    });
    return status();
  }

  /**
   * The timer's check: only while the setting is on, and not while a version
   * is on offer, whose card would otherwise go and come back with the check.
   * Check for updates still checks then. While settings.json cannot be read
   * the setting is not known, so the timer does not check (C.86).
   */
  async function scheduledCheck(): Promise<void> {
    const settings = await readSettings();
    if (settings === null) {
      deps.log('info', 'update.check.skipped', { reason: 'settings-unread' });
      return;
    }
    if (!settings.checkForUpdates) {
      deps.log('info', 'update.check.skipped', { reason: 'setting' });
      return;
    }
    if (state.phase === 'available' || state.phase === 'notify') {
      deps.log('info', 'update.check.skipped', { reason: 'offered' });
      return;
    }
    await check(false);
  }

  function start(): void {
    deps.log('info', 'update.mode', { mode: deps.mode, reason: deps.offReason });
    if (deps.mode === 'off' || firstTimer !== null) return;
    firstTimer = setTimeout(() => void scheduledCheck(), FIRST_CHECK_DELAY_MS);
    dailyTimer = setInterval(() => void scheduledCheck(), CHECK_INTERVAL_MS);
  }

  function stop(): void {
    if (firstTimer !== null) clearTimeout(firstTimer);
    if (dailyTimer !== null) clearInterval(dailyTimer);
    firstTimer = null;
    dailyTimer = null;
  }

  return { status, start, stop, check, download, install, beforeQuit };
}

/**
 * The controller's `settings()` from the store's `loadChecked`: a
 * settings.json that cannot be read rejects rather than hand on the defaults,
 * so the timer does not check against the author's choice, and a check
 * neither acts on nor writes a consent it could not read (hardening.15,
 * C.86).
 */
export function checkedUpdateSettings(
  loadChecked: () => Promise<{ settings: UpdateSettings; readFailed: boolean }>
): () => Promise<UpdateSettings> {
  return async () => {
    const read = await loadChecked();
    if (read.readFailed) throw fail('io', 'settings.json could not be read.');
    return read.settings;
  };
}

/* ------------------------------------------------------------------ */
/* Which updater                                                       */
/* ------------------------------------------------------------------ */

export interface UpdateSourceInput {
  packaged: boolean;
  platform: string;
  /** whether the build's `resources/app-update.yml` exists; asked only of an installed build */
  feedExists(): boolean;
  /** `MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`; always null in an installed build (devSwitches.ts) */
  fakeUpdate: string | null;
}

export interface UpdateSource {
  mode: UpdateMode;
  offReason: UpdateOffReason | null;
  /** the fake's plan in a development run with the switch, else null for electron-updater */
  fake: FakeUpdatePlan | null;
  /** the switch was set but could not be read, so the fake is off */
  fakeIgnored: boolean;
}

/**
 * The mode, and whether the fake stands in (PLAN 11.3 n, C.88): the fake in a
 * development run with a switch it can read, taking the mode an installed
 * build on this platform would have; else `updateModeFor`, with an installed
 * build that has no `app-update.yml` off.
 */
export function chooseUpdateSource(input: UpdateSourceInput): UpdateSource {
  const fake = input.packaged ? null : parseFakeUpdate(input.fakeUpdate);
  const fakeIgnored = !input.packaged && input.fakeUpdate !== null && fake === null;
  if (fake) return { mode: updateModeFor(true, input.platform), offReason: null, fake, fakeIgnored };
  const mode = updateModeFor(input.packaged, input.platform);
  if (mode === 'off') return { mode, offReason: 'development', fake: null, fakeIgnored };
  if (!input.feedExists()) return { mode: 'off', offReason: 'no-feed', fake: null, fakeIgnored };
  return { mode, offReason: null, fake: null, fakeIgnored };
}

/**
 * electron-updater's `autoUpdater` for this platform: `NsisUpdater` on
 * Windows. Required only here, the first time a check needs it, so a run whose
 * mode is `off` never loads the package.
 */
export function loadElectronUpdater(): UpdaterLike {
  const required = createRequire(import.meta.url)('electron-updater') as { autoUpdater: unknown };
  return required.autoUpdater as UpdaterLike;
}

/* ------------------------------------------------------------------ */
/* The app's one controller and its channels                           */
/* ------------------------------------------------------------------ */

type Handle = <C extends RequestChannel>(
  channel: C,
  fn: (payload: RequestPayload<C>) => Promise<ResponsePayload<C>>
) => void;

export interface UpdateHandlerDeps {
  /** `handle` from ipc.ts */
  handle: Handle;
  push: (status: UpdateStatus) => void;
  app: {
    version: string;
    packaged: boolean;
    platform: string;
    feedExists: () => boolean;
    /** `app.quit()`, which the fake calls where the installer would quit the app */
    quit: () => void;
  };
  /** `MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE` (devSwitches.ts) */
  fakeUpdate: string | null;
  repository: string;
  /** rejects while settings.json cannot be read (`checkedUpdateSettings`) */
  settings: () => Promise<UpdateSettings>;
  saveConsent: (version: string | null) => Promise<unknown>;
  install: UpdateControllerDeps['install'];
  log: Log;
  /** the terminal, where the fake says what it does */
  say: (line: string) => void;
}

let appController: UpdateController | null = null;

/**
 * Make the app's one controller and register `update:get`, `update:check`,
 * `update:download` and `update:install`. Called inside
 * `registerCoreHandlers` (PLAN 11.3 a), before the bridge is installed.
 */
export function registerUpdateHandlers(deps: UpdateHandlerDeps): void {
  const source = chooseUpdateSource({
    packaged: deps.app.packaged,
    platform: deps.app.platform,
    feedExists: deps.app.feedExists,
    fakeUpdate: deps.fakeUpdate
  });
  if (source.fakeIgnored) deps.log('warn', 'update.fake-ignored');
  const plan = source.fake;
  const controller = createUpdateController({
    mode: source.mode,
    offReason: source.offReason,
    current: deps.app.version,
    repository: deps.repository,
    loadUpdater: plan
      ? () => createFakeUpdater({ plan, current: deps.app.version, quit: deps.app.quit, say: deps.say })
      : loadElectronUpdater,
    settings: deps.settings,
    saveConsent: deps.saveConsent,
    push: deps.push,
    install: deps.install,
    log: deps.log,
    now: () => new Date()
  });
  if (plan)
    deps.say(
      `[fake update] on: ${plan.version ?? 'no version'}, ${plan.outcome}; nothing is asked of GitHub`
    );
  appController = controller;
  deps.handle('update:get', () => Promise.resolve(controller.status()));
  deps.handle('update:check', () => controller.check(true));
  deps.handle('update:download', ({ version }) => controller.download(version));
  deps.handle('update:install', () => controller.install());
}

/** Start the timer (PLAN 11.3 a: after the window is created). Does nothing when updates are off. */
export function startUpdates(): void {
  appController?.start();
}

/**
 * For main's `before-quit`: true when the quit is the one electron-updater
 * queued before it said the installer could not start, which main then
 * cancels (`UpdateController.beforeQuit`).
 */
export function updateHoldsQuit(): boolean {
  return appController?.beforeQuit() ?? false;
}
