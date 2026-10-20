import { createRequire } from 'node:module';
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
 *   computer cuts short can leave half an app.
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
  /** takes back Restart now's allowance, should the installer fail after it started */
  let takeBack: (() => void) | null = null;

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
   * reject their promise, which handles them; this acts only on an install
   * that failed after `quitAndInstall` had returned, such as an installer
   * that could not be started: the allowance goes back, and the card says so.
   */
  function onUpdaterError(err: Error): void {
    if (insideQuitAndInstall || state.phase !== 'installing') return;
    const version = state.version;
    takeBack?.();
    takeBack = null;
    deps.log('error', 'update.install.failed', loggableErrorFields(err));
    set({ phase: 'failed', stage: 'install', kind: classifyUpdateError(err), manual: false, version });
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
      set({ phase: 'failed', stage: 'check', kind, manual: wasManual(manual), version: null });
      return status();
    }
    checkedAt = deps.now().toISOString();
    if (result === null) {
      deps.log('info', 'update.inactive');
      set(IDLE);
      return status();
    }
    const settings = await readSettings();
    const consent = settings?.updateDownloadConsent ?? null;
    if (!result.isUpdateAvailable) {
      deps.log('info', 'update.none', { latest: result.updateInfo.version });
      if (settings && consent !== null) await writeConsent(null);
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
    if (settings && consent !== keptConsent(consent, version)) await writeConsent(null);
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
        set({ phase: 'failed', stage: 'download', kind, manual: false, version });
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

  /** `autoUpdater.quitAndInstall(false, true)`, which reports an installer it cannot start as an `error` event, not a throw. */
  function quitAndInstall(): void {
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
  }

  async function install(): Promise<UpdateStatus> {
    const version =
      state.phase === 'downloaded' || (state.phase === 'failed' && state.stage === 'install')
        ? state.version
        : null;
    if (version === null) throw fail('not-found', 'There is no downloaded update to install.');
    set({ phase: 'installing', version });
    const outcome = await runUpdateInstall({ ...deps.install, quitAndInstall, log: deps.log });
    if (outcome.started) {
      takeBack = outcome.takeBack;
      return status();
    }
    set({
      phase: 'failed',
      stage: 'install',
      kind: classifyUpdateError(outcome.error),
      manual: false,
      version
    });
    return status();
  }

  /**
   * The timer's check: only while the setting is on, and not while a version
   * is on offer, whose card would otherwise go and come back with the check.
   * Check for updates still checks then.
   */
  async function scheduledCheck(): Promise<void> {
    const settings = await readSettings();
    if (settings && !settings.checkForUpdates) {
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

  return { status, start, stop, check, download, install };
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
