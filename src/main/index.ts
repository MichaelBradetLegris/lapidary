import { app, BrowserWindow, dialog, Menu } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_DATA_DIR, APP_ID, APP_NAME } from '../shared/branding';
import { createRendererGoneHandler, installCrashHandlers } from './crash';
import { readDevSwitches, setDevSwitches } from './devSwitches';
import { backgroundThrottling, bringForward, chromiumSwitches, showWindow } from './foreground';
import { closeGuard, installIpcBridge, registerCoreHandlers, stopWatching, systemShell } from './ipc';
import { flushLog, initLog, log } from './log';
import { navigationAction } from './navigation';
import { sendNotice } from './notice';
import { abortAll } from './providers/controllers';
import { loadSettings } from './settings';
import { SHELL_STUB_PREFIX } from './shellApi';
import { applyTheme, currentWindowBackground, installTheme } from './theme';
import { installZoom } from './zoom';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

/**
 * The window and taskbar icon. Packaged builds get it beside the executable
 * through electron-builder's extraResources; a dev run reads it out of the repo,
 * so `npm run dev` shows the real icon rather than Electron's default.
 */
function iconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'icon.png')]
    : [
        path.join(app.getAppPath(), 'resources', 'icon', 'icon-256.png'),
        path.join(dirname, '../../resources/icon/icon-256.png')
      ];
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * Development switches, read once (src/main/devSwitches.ts). A packaged build
 * ignores the environment variables and honours only `--isolated-user-data`.
 *
 * The scratch userData folder keeps a test run from reading or overwriting the
 * author's real settings, which name their manuscript vault. It must be set
 * before anything reads app.getPath('userData'), which is why this sits at
 * module scope rather than inside whenReady.
 */
const switches = readDevSwitches({
  env: process.env,
  packaged: app.isPackaged,
  isolatedUserData: app.commandLine.getSwitchValue('isolated-user-data') || null
});
setDevSwitches(switches);
if (switches.userDataDir) {
  app.setPath('userData', path.resolve(switches.userDataDir));
} else {
  /* Pin the data directory to a name of its own. Electron derives userData from
     the application name, so without this the author's settings and their saved
     reviews would move house every time the app is renamed. */
  app.setPath('userData', path.join(app.getPath('appData'), APP_DATA_DIR));
}

/* A quiet test window (dev.1, src/main/foreground.ts) keeps rendering while
   the author's windows cover it. Chromium reads its features when the app
   gets ready, so the switch goes on the command line before that. */
for (const [name, value] of chromiumSwitches(switches)) app.commandLine.appendSwitch(name, value);

/**
 * The app owns every key it needs; the default File/Edit/View menu only got in
 * the way, since Alt revealed it over the manuscript (item 10). Removing it
 * removes the accelerators too, so development keeps its own.
 */
function installDevShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const devTools = key === 'f12' || (input.control && input.shift && key === 'i');
    const reload = input.control && !input.shift && !input.alt && key === 'r';
    if (devTools) {
      // Explicit open/close in a detached window: toggleDevTools() proved
      // unreliable here, and a docked pane would squeeze the manuscript.
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'detach' });
      event.preventDefault();
    } else if (reload) {
      win.webContents.reloadIgnoringCache();
      event.preventDefault();
    }
  });
}

/**
 * Reload window or Quit, after the page's process has gone (hardening.4),
 * unless the app is quitting, the session is ending, the process exited
 * cleanly or a close under way goes ahead (`createRendererGoneHandler`). The
 * box goes with its window, through its signal, should the window close
 * first.
 */
const afterRendererGone = createRendererGoneHandler<BrowserWindow>({
  guard: closeGuard,
  showBox: async (win, options) => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    win.once('closed', abort);
    try {
      return (await dialog.showMessageBox(win, { ...options, signal: controller.signal })).response;
    } finally {
      if (!win.isDestroyed()) win.removeListener('closed', abort);
    }
  },
  reload: (win) => win.webContents.reload(),
  quit: () => app.quit(),
  isDestroyed: (win) => win.isDestroyed(),
  log
});

function createWindow(): BrowserWindow {
  const icon = iconPath();
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // The theme's --bg, so the window opens in the colour the page will paint.
    backgroundColor: currentWindowBackground(),
    title: APP_NAME,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The defaults, stated so nobody switches them off by accident.
      webSecurity: true,
      allowRunningInsecureContent: false,
      // Off only for a quiet test window, which may be covered (dev.1).
      backgroundThrottling: backgroundThrottling(switches)
    }
  });

  /* Show on the first painted frame, so the window never flashes blank. In the
     packaged build 'ready-to-show' never fired on Windows and the app ran with
     its window hidden, so the page finishing its load and a timer are fallbacks;
     whichever comes first shows the window. A quiet test window is shown
     without taking the foreground (dev.1). */
  let shown = false;
  const reveal = (): void => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    showWindow(win, switches.quietWindow);
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  setTimeout(reveal, 3000);
  installZoom(win);

  /* The close guard (apply.8, PLAN 7.7): a close that would put something at
     risk asks the page first, a page that does not answer gets a native box
     with Close anyway, and a window whose page has said nothing closes at once. */
  closeGuard.attach(win);

  /* The one render-process-gone handler (11.3 a). A page that is gone holds
     nothing more that could be saved, so no close waits for it: the close
     guard hears first, and a close under way goes ahead. Otherwise the author
     is offered Reload window or Quit (hardening.4, PLAN 7.7). */
  win.webContents.on('render-process-gone', (_e, details) => {
    const closing = closeGuard.onRendererGone();
    void afterRendererGone(win, details, closing);
  });

  if (isDev) {
    installDevShortcuts(win);
    // Surface renderer console output in the terminal so `npm run dev` failures are visible.
    win.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void systemShell().openExternal(url);
    return { action: 'deny' };
  });

  /* The page is the whole app and must never be replaced (C.41): a web address
     opens in the browser, anything else is refused. `details.url`, because the
     url argument is deprecated in Electron 44. */
  win.webContents.on('will-navigate', (details) => {
    const action = navigationAction(details.url, win.webContents.getURL());
    if (action === 'allow') return;
    details.preventDefault();
    if (action === 'external') void systemShell().openExternal(details.url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(dirname, '../renderer/index.html'));
  }

  return win;
}

/**
 * One running copy per userData folder (PLAN 11.3 a, C.40). Two copies on the
 * same folder would race on settings.json and on the review files. Chromium
 * keys the lock on userData, which is already set above, so a test run with
 * its own scratch folder still starts next to the author's copy. The copy that
 * loses the race quits before it writes anything; the one already running
 * comes to the front instead.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start(): void {
  // After the lock, so a copy that loses the race writes nothing (11.3 a).
  initLog(path.join(app.getPath('userData'), 'logs'));
  // Main's own unexpected errors: logged, and a card in the window (hardening.4).
  installCrashHandlers(process, { log, notice: sendNotice });
  log('info', 'app.start', {
    version: app.getVersion(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    isolatedUserData: switches.userDataDir !== null
  });
  if (switches.ignored.length > 0) log('warn', 'devswitch.ignored', { names: switches.ignored.join(',') });
  // Said by main itself, so a test run knows the switch took before it presses anything (setup.10b).
  if (switches.shellStub) console.log(`${SHELL_STUB_PREFIX} on: nothing is opened outside the app`);

  // Pinned shortcuts and the running window share one taskbar button only when
  // both carry the installer's identity, which is APP_ID.
  if (app.isPackaged && process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) bringForward(win, switches.quietWindow);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  /* The app, not only its window, is closing: a close the page then agrees to
     goes on quitting, since holding the close cancelled the quit (apply.8).
     Awaits nothing (11.3 a). */
  app.on('before-quit', () => closeGuard.onBeforeQuit());

  // Synchronous on purpose: nothing may be awaited once the app is quitting.
  app.on('will-quit', () => {
    abortAll();
    stopWatching();
    log('info', 'app.quit');
    flushLog();
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerCoreHandlers();
    installIpcBridge();
    // The theme before the window, so its first frame and title bar are already
    // in it (11.3 a and e). loadSettings falls back to defaults rather than throw.
    const settings = await loadSettings();
    applyTheme(settings.theme);
    installTheme();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
