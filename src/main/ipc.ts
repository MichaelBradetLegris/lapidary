import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_NAME, APP_REPOSITORY } from '../shared/branding';
import { diagnosticsReport, type DisplayFacts } from '../shared/diagnostics/report';
import type { Settings } from '../shared/types';
import type {
  ApiEventMap,
  ChapterFile,
  EventChannel,
  IpcResult,
  RequestChannel,
  RequestPayload,
  ResponsePayload
} from '../shared/ipc';
import { chapterName } from '../shared/review';
import { noBackupsYet } from '../shared/ui/backups';
import { EXTERNAL_PAGE_URLS } from '../shared/ui/chatgpt';
import { backupsRootFor, chapterBackupHooks, chapterBackups } from './backups';
import { createChatGptAuth, type ChatGptAuth } from './chatgpt';
import { boxAnswer, createCloseGuard, messageBoxOptions } from './closeGuard';
import { getDevSwitches } from './devSwitches';
import {
  draftsRootFor,
  loadDrafts,
  saveDrafts,
  setAsideDrafts,
  setAsideFile,
  setAsideFolderFor
} from './drafts';
import { collectAppInfo, openAiPackageVersion } from './appInfo';
import { createRendererLog } from './crash';
import { collectDiagnostics } from './diagnostics';
import { fail } from './errors';
import {
  beginRequest,
  cancelRequest,
  endRequest,
  installedCli,
  lastFailure,
  lastRuntime,
  noteTest,
  providers
} from './providers';
import { testConnection } from './providers/connectionTest';
import { abortAll, registerController } from './providers/controllers';
import { clearOpenAiKey, openAiKeyStatus, storeOpenAiKey } from './secrets';
import {
  OpenedChapters,
  assertSavableChapter,
  caseInsensitiveFs,
  checkChapterNameOnDisk,
  createChapter,
  isInsideManuscript,
  listChapters,
  readChapter,
  saveLogFields,
  writeChapter
} from './files';
import { GUIDELINES_TEMPLATE, ensureGuidelines, guidelinesPathFor, guidelinesStatus } from './guidelines';
import { runHandler } from './ipcEnvelope';
import { log, logWriting, tail } from './log';
import { openNotices } from './notices';
import { openGuidelines, revealGuidelines } from './openGuidelines';
import { pickShell, type ShellApi } from './shellApi';
import {
  isDefaultReviewsFolder,
  listReviews,
  loadLatestReview,
  loadReviewFile,
  makeReviewsFolder,
  recordShown,
  resolveReviewsFolder,
  reviewIndex,
  saveReview
} from './reviews';
import { loadSettings, loadSettingsChecked, saveSettings } from './settings';
import { SETTINGS_FILE, settingsAnswer } from './settingsStore';
import { applyTheme } from './theme';
import { checkedUpdateSettings, registerUpdateHandlers } from './updates';
import { createManuscriptWatcher, listAndWatch } from './watcher';
import { trackWrite, writesSettled } from './writes';
import { applyZoom, changeZoom } from './zoom';

type Handler<C extends RequestChannel> = (payload: RequestPayload<C>) => Promise<ResponsePayload<C>>;

const handlers = new Map<RequestChannel, (payload: unknown) => Promise<unknown>>();

/**
 * Register one typed request handler. Every channel goes through the same
 * envelope (`runHandler`), which refuses a payload of the wrong shape or with
 * a NUL in a path field before the handler runs (`checkPayload`, hardening.8).
 */
export function handle<C extends RequestChannel>(channel: C, fn: Handler<C>): void {
  handlers.set(channel, (payload) => fn(payload as RequestPayload<C>));
}

/**
 * Register a handler whose work writes the author's files or settings, so
 * that Restart now can let it end before the installer stops the app
 * (`trackWrite` and `writesSettled` in writes.ts, release.8b). The request
 * starts and answers exactly as it would otherwise.
 */
function handleWrite<C extends RequestChannel>(channel: C, fn: Handler<C>): void {
  handle(channel, (payload) => trackWrite(() => fn(payload)));
}

/** Push a typed event to every open window. */
export function broadcast<E extends EventChannel>(channel: E, payload: ApiEventMap[E]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * The manuscript folder watcher (PLAN 6.2, files.5). Settings starts it on
 * the folder chosen; a list read that works starts it again when the folder
 * refused its start (`listAndWatch`, files.21).
 */
const watcher = createManuscriptWatcher(broadcast);
const startWatching = (folder: string | null): void => watcher.start(folder);
const rememberHash = (file: string, hash: string): void => watcher.rememberHash(file, hash);
const forgetHash = (file: string): void => watcher.forgetHash(file);
export const stopWatching = (): void => watcher.stop();

/**
 * The app's one close guard (apply.8, PLAN 7.7 and 11.3 i). `createWindow`
 * attaches the window, `before-quit` and `render-process-gone` tell it so, and
 * the three `app:` requests below carry what the page says. Its native box is
 * `dialog.showMessageBox` over the window, taken away through the signal when
 * the page answers late.
 */
export const closeGuard = createCloseGuard<BrowserWindow>({
  showBox: async (win, box, signal) =>
    boxAnswer((await dialog.showMessageBox(win, { ...messageBoxOptions(box), signal })).response),
  quit: () => app.quit(),
  log,
  quietWindow: () => getDevSwitches().quietWindow
});

/**
 * Wire the accumulated handlers into ipcMain. Call once, after all modules
 * registered. A file system error that reaches here unexplained is worded as
 * a write that replaces a file; every read path explains its own first
 * (`readFailure`, apply.24), and so does every write that makes a new file,
 * a copy or a folder (`writeFailure`, apply.25). A failure is logged as
 * `ipc.failed`, never with its payload (`runHandler`, hardening.3b), and a
 * payload that is not what its channel takes never reaches its handler
 * (`checkPayload`, hardening.8).
 */
export function installIpcBridge(): void {
  for (const [channel, fn] of handlers) {
    ipcMain.handle(channel, (_event, payload: unknown): Promise<IpcResult<unknown>> =>
      runHandler(channel, payload, fn, log)
    );
  }
}

export function registerCoreHandlers(): void {
  /* While settings.json cannot be read, the page is handed no settings, only
     the flag, and the watcher is left as it is (hardening.15, C.86). A read
     that works puts the author's theme and zoom back, which the window took
     from the defaults when the file could not be read as it opened;
     `applyTheme` and `applyZoom` change nothing already in effect. */
  handle('settings:get', async () => {
    const read = await loadSettingsChecked();
    if (!read.readFailed) {
      startWatching(read.settings.manuscriptFolder);
      applyTheme(read.settings.theme);
      applyZoom(read.settings.zoom);
    }
    return settingsAnswer(read);
  });

  handleWrite('settings:set', async (patch) => {
    const settings = await saveSettings(patch);
    startWatching(settings.manuscriptFolder);
    // A changed Appearance setting takes effect at once, title bar and all
    // (theme.5); applyTheme does nothing when the theme is already in effect.
    applyTheme(settings.theme);
    return settings;
  });

  handle('view:zoom', async ({ action }) => ({ zoom: await changeZoom(action) }));

  handle('settings:effective', async () => {
    const settings = await loadSettings();
    return {
      manuscriptFolder: settings.manuscriptFolder,
      reviewsFolder: await reviewsFolder(),
      reviewsFolderIsDefault: isDefaultReviewsFolder(settings.reviewsFolder),
      guidelinesPath: guidelinesPathFor(settings),
      backupsFolder: backupsRootFor(app.getPath('userData'))
    };
  });

  handle('dialog:pick-folder', async ({ title, defaultPath }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title,
      properties: ['openDirectory', 'createDirectory'] as const,
      ...(defaultPath ? { defaultPath } : {})
    };
    const result = win
      ? await dialog.showOpenDialog(win, { ...options, properties: [...options.properties] })
      : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle('dialog:pick-file', async ({ title, defaultPath, extensions }) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title,
      properties: ['openFile'] as const,
      filters: extensions?.length ? [{ name: 'Files', extensions }] : undefined,
      ...(defaultPath ? { defaultPath } : {})
    };
    const args = { ...options, properties: [...options.properties] };
    const result = win ? await dialog.showOpenDialog(win, args) : await dialog.showOpenDialog(args);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  registerFileHandlers();
  registerReviewHandlers();
  registerDraftHandlers();
  registerAiHandlers();
  registerSecretHandlers();
  registerChatGptHandlers();
  registerCloseGuardHandlers();
  registerDiagnosticsHandlers();
  registerUpdates();
}

/**
 * The updater (release.8b, PLAN 11.3 n): its four channels and the app's one
 * controller, which `startUpdates()` (src/main/updates.ts) sets going once the
 * window exists. A development run, and an installed build with no
 * `resources/app-update.yml`, never check; `MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`
 * puts the fake in electron-updater's place in a development run.
 */
function registerUpdates(): void {
  registerUpdateHandlers({
    handle,
    push: (status) => broadcast('update:state', status),
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      feedExists: () => existsSync(path.join(process.resourcesPath, 'app-update.yml')),
      quit: () => app.quit()
    },
    fakeUpdate: getDevSwitches().fakeUpdate,
    repository: APP_REPOSITORY,
    settings: checkedUpdateSettings(loadSettingsChecked),
    saveConsent: (version) => trackWrite(() => saveSettings({ updateDownloadConsent: version })),
    install: {
      allowNextClose: (reason) => closeGuard.allowNextClose(reason),
      abortAll,
      writesSettled,
      stopWatching,
      resumeWatching: () => {
        void loadSettings().then((settings) => startWatching(settings.manuscriptFolder));
      }
    },
    log,
    say: (line) => console.log(line)
  });
}

/** The versions, read now: the app's, Electron's, the openai package's and the user's Claude Code (hardening.5). */
function appInfo(): ReturnType<typeof collectAppInfo> {
  return collectAppInfo({
    version: app.getVersion(),
    packaged: app.isPackaged,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    openAiVersion: openAiPackageVersion,
    installedCli
  });
}

/**
 * How the app is drawn: the theme in force, Windows' contrast themes, and
 * the first window's zoom, size and display. The GPU's compositing status is
 * Chromium's own word for it, such as `enabled` or `disabled_software`.
 */
function displayFacts(settings: Settings): DisplayFacts {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  const [width = 0, height = 0] = win ? win.getContentSize() : [];
  return {
    theme: settings.theme,
    dark: nativeTheme.shouldUseDarkColors,
    forcedColors: nativeTheme.inForcedColorsMode,
    zoom: win ? win.webContents.getZoomFactor() : settings.zoom,
    scale: win ? screen.getDisplayMatching(win.getBounds()).scaleFactor : null,
    window: win ? { width, height, maximized: win.isMaximized() } : null,
    gpuCompositing: app.getGPUFeatureStatus().gpu_compositing || null
  };
}

/**
 * The page's unexpected errors (hardening.4): only the fields main knows, at
 * most 30 lines a minute (`createRendererLog`).
 */
const rendererLog = createRendererLog({ log });

/**
 * Copy diagnostics and the versions (hardening.5). Neither runs a check of
 * Claude or OpenAI: they read what the last one found, so asking for them
 * costs nothing and logs no `ai.runtime`. The report is scrubbed here, where
 * the home folder is known, before it crosses to the page. The page's own
 * errors come in here too, for the log (`log:renderer`, hardening.4).
 */
function registerDiagnosticsHandlers(): void {
  handle('log:renderer', (line) => {
    rendererLog(line);
    return Promise.resolve();
  });
  handle('app:info', appInfo);
  handle('app:diagnostics', async () => {
    const data = await collectDiagnostics({
      now: () => new Date(),
      info: appInfo,
      settings: loadSettings,
      lastRuntime,
      lastFailure,
      display: displayFacts,
      userData: app.getPath('userData'),
      switches: getDevSwitches(),
      logWriting,
      warnings: (n) => tail(n, 'warn'),
      guidelinesTemplate: guidelinesTemplate(),
      ci: caseInsensitiveFs()
    });
    return { text: diagnosticsReport(data, { home: os.homedir() }) };
  });
  // About's Licences and notices (release.9): the file beside the installed app.
  handle('app:open-notices', () =>
    openNotices({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      exists: existsSync,
      shell: systemShell()
    })
  );
}

/**
 * What the page tells the close guard (apply.8, PLAN 7.7): what a close would
 * put at risk, pushed once the page has loaded and whenever it changes, how
 * far it has got with a close request, and what the author decided
 * (`src/renderer/state/closeGuard.ts`, apply.9).
 */
function registerCloseGuardHandlers(): void {
  handle('app:guard-state', (state) => {
    closeGuard.setState(state);
    return Promise.resolve();
  });
  handle('app:close-status', ({ status }) => {
    closeGuard.onStatus(status);
    return Promise.resolve();
  });
  handle('app:close-decision', ({ close }) => {
    closeGuard.onDecision(close);
    return Promise.resolve();
  });
}

/**
 * Paragraph boxes kept on disk (apply.16, PLAN 11.3 j): one file per chapter
 * under `<userData>/drafts`, named by a hash of its path, so the renderer
 * never names a file here; set-aside text goes to `drafts/set-aside`.
 */
function registerDraftHandlers(): void {
  const root = (): string => draftsRootFor(app.getPath('userData'));
  handle('drafts:load', async ({ sourcePath }) => loadDrafts(root(), sourcePath, caseInsensitiveFs()));
  handle('drafts:save', async (request) => saveDrafts(root(), request, caseInsensitiveFs()));
  handle('drafts:set-aside', async (request) => ({ name: (await setAsideDrafts(root(), request)).name }));
}

/**
 * One set of channels for every provider (Phase 5c). The provider does the
 * talking; this layer owns the request ids, Cancel, and the broadcasts.
 */
function registerAiHandlers(): void {
  handle('ai:runtime', async ({ provider }) => providers().get(provider).runtime());
  handle('ai:models', async ({ provider }) => providers().get(provider).models());

  handle('ai:review', async (request) => {
    const provider = providers().get(request.provider);
    const signal = beginRequest(request.requestId);
    try {
      const result = await provider.review(request, {
        signal,
        onProgress: (phase, outputTokens) =>
          broadcast('ai:progress', {
            requestId: request.requestId,
            provider: request.provider,
            phase,
            ...(outputTokens === undefined ? {} : { outputTokens })
          }),
        onRateLimit: (info) => broadcast('ai:rate-limit', info)
      });
      return {
        provider: request.provider,
        changes: result.output.changes,
        comments: result.output.comments.map((c) => ({
          paragraph: c.paragraph,
          ...(c.quote ? { quote: c.quote } : {}),
          category: c.category,
          text: c.text
        })),
        raw: result.raw,
        ...(result.model ? { model: result.model } : {}),
        ...(result.costUsd === undefined ? {} : { costUsd: result.costUsd }),
        ...(result.costEstimated === undefined ? {} : { costEstimated: result.costEstimated }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
        ...(result.fallbackNote ? { fallbackNote: result.fallbackNote } : {}),
        ...(result.rateLimit ? { rateLimit: result.rateLimit } : {})
      };
    } finally {
      endRequest(request.requestId);
    }
  });

  handle('ai:cancel', ({ requestId }) => {
    cancelRequest(requestId);
    return Promise.resolve();
  });

  /* Test the connection (setup.8): one very small request, only when the
     author presses the button. A failed test is an answer, not an error, and
     the log keeps only its outcome, never what the provider said. The
     answer moves the last failure, as the page's does (noteTest). */
  handle('ai:test', async ({ provider }) => {
    const result = await testConnection(providers().get(provider), { track: registerController });
    noteTest(provider, result);
    log('info', 'ai.test', {
      provider,
      ok: result.ok,
      durationMs: result.durationMs,
      ...(result.error ? { code: result.error.code } : {})
    });
    return result;
  });
}

/**
 * The OpenAI key. It arrives from the renderer once, is encrypted here, and the
 * only thing that ever goes back is `{configured, source, last4}`.
 */
function registerSecretHandlers(): void {
  const dir = (): string => app.getPath('userData');
  handle('secrets:openai-status', async () => openAiKeyStatus(safeStorage, dir()));
  handle('secrets:openai-set', async ({ key }) => storeOpenAiKey(safeStorage, dir(), key));
  handle('secrets:openai-clear', async () => clearOpenAiKey(safeStorage, dir()));
}

/**
 * Sign in with ChatGPT (codex.2, PLAN 5.7), made once: main signs in through
 * the browser and a loopback port, keeps the tokens encrypted beside the key
 * (src/main/chatgpt), and the page only ever gets the status. A sign-in waits
 * for the browser, so it is not a tracked write: Restart now would wait on
 * it. Quitting ends it (`registerController`), and its writes of
 * secrets.json are tracked one by one.
 */
let chatGptAuth: ChatGptAuth | null = null;

function chatGpt(): ChatGptAuth {
  chatGptAuth ??= createChatGptAuth({
    userDataDir: () => app.getPath('userData'),
    vault: safeStorage,
    shell: systemShell,
    fetch: (input, init) => fetch(input, init),
    authBase: () => getDevSwitches().chatGptAuthUrl,
    log,
    track: registerController,
    write: trackWrite
  });
  return chatGptAuth;
}

function registerChatGptHandlers(): void {
  handle('chatgpt:status', () => chatGpt().status());
  handle('chatgpt:sign-in', ({ another }) => chatGpt().signIn({ another: another === true }));
  handle('chatgpt:cancel-sign-in', () => {
    chatGpt().cancelSignIn();
    return Promise.resolve();
  });
  handle('chatgpt:sign-out', () => chatGpt().signOut());
  handle('chatgpt:confirm-data-settings', ({ confirmed }) =>
    chatGpt().confirmDataSettings(confirmed === true)
  );
  /* A page by its name, never an address from the page: ChatGPT's Data
     controls (codex.2). The shell stub writes it to the terminal instead. */
  handle('shell:open-external', async ({ page }) => {
    const url = Object.hasOwn(EXTERNAL_PAGE_URLS, page) ? EXTERNAL_PAGE_URLS[page] : undefined;
    if (!url) throw fail('invalid-input', `That is not a page ${APP_NAME} opens.`);
    await systemShell().openExternal(url);
  });
}

/**
 * The reviews folder, defaulting to `<userData>/reviews` and created on demand.
 * Saving a review must never fail because Settings is incomplete: a generated
 * review is expensive and losing it is the worst outcome (plan 6.4).
 */
async function reviewsFolder(): Promise<string> {
  const settings = await loadSettings();
  const folder = resolveReviewsFolder(settings.reviewsFolder, app.getPath('userData'));
  await makeReviewsFolder(folder);
  return folder;
}

/** Where the shipped guidelines template lives, in development and once packaged. */
function guidelinesTemplate(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, GUIDELINES_TEMPLATE)
    : path.join(app.getAppPath(), 'resources', GUIDELINES_TEMPLATE);
}

/**
 * Electron's shell, or under `dev:clean --shell-stub` one that opens nothing
 * and writes what it would have opened to the terminal (shellApi.ts, setup.10b).
 */
export function systemShell(): ShellApi {
  return pickShell(shell, getDevSwitches().shellStub, (line) => console.log(line));
}

/** What Save may still write after Settings changes folder (files.2). */
const openedChapters = new OpenedChapters();

/**
 * The chapters in the manuscript folder, as the file list shows them. A read
 * that works starts the watcher when nothing watches the folder (files.21).
 */
async function currentChapters(): Promise<ChapterFile[]> {
  const settings = await loadSettings();
  if (!settings.manuscriptFolder) return [];
  const guidelines = guidelinesPathFor(settings);
  return listAndWatch(watcher, settings.manuscriptFolder, (folder) =>
    listChapters(folder, settings.reviewsFolder, guidelines ? [guidelines] : [])
  );
}

function registerFileHandlers(): void {
  handle('files:list', currentChapters);

  // The page asks after each list read, and hears of a change from `files:watching-changed`.
  handle('files:watching', () => Promise.resolve({ watching: watcher.watching() }));

  handle('files:read', async ({ path: file }) => {
    const content = await readChapter(file);
    const settings = await loadSettings();
    if (isInsideManuscript(file, settings.manuscriptFolder, caseInsensitiveFs())) openedChapters.add(file);
    // Remember what we just loaded so the watcher does not report it as a change.
    rememberHash(file, content.hash);
    return content;
  });

  handleWrite('files:save', async (request) => {
    const started = Date.now();
    const settings = await loadSettings();
    assertSavableChapter(request.path, {
      manuscriptFolder: settings.manuscriptFolder,
      guidelinesPath: guidelinesPathFor(settings),
      opened: openedChapters,
      ci: caseInsensitiveFs()
    });
    // Before the chapter is replaced, the bytes it holds are copied to
    // <userData>/backups; no backup, no save (apply.10, PLAN 6.5).
    const response = await writeChapter(request, {
      onWritten: rememberHash,
      ...chapterBackupHooks({
        backupsRoot: backupsRootFor(app.getPath('userData')),
        manuscriptFolder: settings.manuscriptFolder,
        ci: caseInsensitiveFs()
      })
    });
    if (response.status === 'stale') forgetHash(request.path);
    log('info', 'file.save', saveLogFields(request, response, Date.now() - started));
    return response;
  });

  handle('files:check-name', async ({ name, extension }) => {
    const settings = await loadSettings();
    if (!settings.manuscriptFolder) {
      return { valid: false, problem: 'Choose a manuscript folder first.', exists: false, path: null };
    }
    return checkChapterNameOnDisk(settings.manuscriptFolder, name, extension);
  });

  handleWrite('files:create', async ({ name, extension, text }) => {
    const settings = await loadSettings();
    if (!settings.manuscriptFolder) {
      throw fail('not-configured', 'Choose a manuscript folder before creating a chapter.');
    }
    const created = await createChapter(settings.manuscriptFolder, name, extension, text);
    openedChapters.add(created.path);
    return created;
  });

  handle('guidelines:ensure', async () => ensureGuidelines(await loadSettings(), guidelinesTemplate()));

  // openGuidelines refuses a file that is not .md or .txt before anything is created (setup.10b, polish.3).
  handle('guidelines:open', async () =>
    openGuidelines(await loadSettings(), guidelinesTemplate(), systemShell())
  );

  handle('guidelines:status', async () => guidelinesStatus(await loadSettings()));

  handle('shell:reveal', async ({ target, sourcePath, name }) => {
    const system = systemShell();
    /* Show backups for a chapter (apply.11): its own backup folder, which main
       works out from the path and refuses outside the backups root, opened
       with the newest backup selected. The folder follows the chapter's path,
       so a chapter not yet changed by a Save to chapter at this path has none,
       whether it is new or was renamed or moved (its earlier backups stay in
       the old path's folder), and the card says so. */
    if (target === 'backups' && sourcePath !== undefined) {
      const shown = await chapterBackups(
        backupsRootFor(app.getPath('userData')),
        sourcePath,
        caseInsensitiveFs()
      );
      if (!shown) throw fail('not-found', noBackupsYet(chapterName(sourcePath)));
      if (shown.newest) {
        system.showItemInFolder(shown.newest);
        return { path: shown.newest };
      }
      const problem = await system.openPath(shown.folder);
      if (problem) system.showItemInFolder(shown.folder);
      return { path: shown.folder };
    }
    /* A set-aside card's Show the text opens its own file (apply.16), in the
       app the computer uses for .txt, or shows it in its folder when no app
       is set for .txt. Only a bare name of a file in drafts/set-aside counts. */
    if (target === 'drafts' && name !== undefined) {
      const text = await setAsideFile(draftsRootFor(app.getPath('userData')), name);
      if (!text) throw fail('not-found', 'That set-aside text is no longer in the drafts folder.');
      const problem = await system.openPath(text);
      if (problem) system.showItemInFolder(text);
      return { path: text };
    }
    /* About's Open data folder (release.9): the folder itself, opened, or
       shown in its parent should it fail to open. */
    if (target === 'data') {
      const folder = await userDataTarget('data');
      const problem = await system.openPath(folder);
      if (problem) system.showItemInFolder(folder);
      return { path: folder };
    }
    /* Open folder for the guidelines file (polish.3): the file the settings
       name, made from the template first when it is missing, then shown. */
    if (target === 'guidelines') return revealGuidelines(await loadSettings(), guidelinesTemplate(), system);
    let file: string | null;
    if (target === 'settings' || target === 'logs' || target === 'backups' || target === 'drafts') {
      file = await userDataTarget(target);
    } else if (target === 'reviews') {
      file = await reviewsFolder();
    } else {
      file = (await loadSettings()).manuscriptFolder;
    }
    if (!file) throw fail('not-configured', `There is no ${target} folder to show yet.`);
    system.showItemInFolder(file);
    return { path: file };
  });
}

/**
 * The userData places "show in folder" can open, created on demand so the
 * author never lands on a missing folder (setup.7a). `backups` here is the
 * root, for Settings; a chapter's own backup folder is shown from its path
 * (`chapterBackups`, apply.11). `settings` is settings.json itself, for the
 * card shown while it cannot be read, or the data folder once the author has
 * moved the file away (hardening.15).
 */
async function userDataTarget(target: 'data' | 'settings' | 'logs' | 'backups' | 'drafts'): Promise<string> {
  const root = app.getPath('userData');
  if (target === 'data') return root;
  if (target === 'settings') {
    const file = path.join(root, SETTINGS_FILE);
    return existsSync(file) ? file : root;
  }
  const folder =
    target === 'logs'
      ? path.join(root, 'logs')
      : target === 'backups'
        ? backupsRootFor(root)
        : setAsideFolderFor(draftsRootFor(root));
  await fs.mkdir(folder, { recursive: true });
  if (target === 'logs') {
    const log = path.join(folder, 'main.log');
    if (existsSync(log)) return log;
  }
  return folder;
}

function registerReviewHandlers(): void {
  handle('reviews:list', async ({ sourcePath }) => listReviews(await reviewsFolder(), sourcePath));

  handle('reviews:load', async ({ path: file }) => ({ path: file, review: await loadReviewFile(file) }));

  handle('reviews:load-latest', async ({ sourcePath, hash }) =>
    loadLatestReview(await reviewsFolder(), sourcePath, hash === undefined ? {} : { hash })
  );

  handleWrite('reviews:save', async ({ review, path: file }) =>
    saveReview(await reviewsFolder(), review, file)
  );

  // The review on screen is the one its chapter opens with next (apply.26).
  handle('reviews:shown', async ({ sourcePath, path: file }) => {
    await recordShown(await reviewsFolder(), sourcePath, file);
  });

  handle('reviews:index', async () =>
    reviewIndex(
      await reviewsFolder(),
      (await currentChapters()).map((chapter) => chapter.path)
    )
  );
}
