/**
 * Packaging (PLAN 11.3 n, `release.4`).
 *
 * One Windows target: a one-click, per-user NSIS installer for x64, which is
 * also what the updater downloads and runs. There is no portable exe (PLAN
 * 11.0): it unpacked the whole app into %TEMP% at every start and could not
 * update itself. Local tests use `npm run package:dir` and dist/win-unpacked.
 *
 * Nothing of Anthropic's is packaged: the app runs the Claude Code each user
 * installs (PLAN 11.3 q, C.42), so no dependency has a binary to unpack from
 * the asar and there is no `asarUnpack`.
 *
 * The name, the app id and the repository come from src/shared/branding.ts
 * through scripts/branding.cjs, and `npm run package` syncs package.json's
 * productName and repository from the same place first.
 *
 * Every script that runs electron-builder passes `--publish never`. The
 * publish block below only tells the build where updates come from: it is
 * written into resources/app-update.yml, and the release workflow (`release.7`)
 * uploads the files itself.
 */
const { appName, appId, appRepository } = require('./scripts/branding.cjs');

const name = appName();
const { owner, repo } = appRepository();

module.exports = {
  // Frozen from 1.0 (APP_ID in src/shared/branding.ts). The installer's
  // registry key and uninstall entry are named by a GUID made from it, and the
  // packaged app sets it as its Windows taskbar identity (AUMID). Changing it
  // would leave every installed copy behind as a separate app.
  appId: appId(),
  // Also frozen from 1.0, though it is not set here: package.json's `name`,
  // `manuscript-review`. electron-builder takes the install folder,
  // %LOCALAPPDATA%\Programs\manuscript-review, and the updater's cache,
  // %LOCALAPPDATA%\manuscript-review-updater (`updaterCacheDirName` in
  // app-update.yml), from it, so a new name would leave both behind. It is
  // deliberately unlike APP_DATA_DIR: the uninstaller's --delete-app-data
  // removes the folders in %APPDATA% named after the package and the product,
  // so it never reaches the one that holds settings and reviews.
  // test/branding.test.ts pins it.
  productName: name,
  copyright: `Copyright ${new Date().getFullYear()} Michael Bradet-Legris`,
  directories: {
    output: 'dist',
    buildResources: 'resources/icon'
  },
  // The main process, the preload, the renderer bundle and the production
  // dependency tree. electron-builder drops devDependencies on its own.
  files: ['out/**/*', 'resources/icon/icon*.png', 'package.json', 'node_modules/**/*'],
  extraResources: [
    // main/guidelines.ts looks for the template beside the executable.
    { from: 'resources/GUIDELINES.default.md', to: 'GUIDELINES.default.md' },
    { from: 'resources/icon/icon-256.png', to: 'icon.png' }
  ],
  // Only en-US.pak, the locale Chromium falls back on, and en-GB.pak; the
  // other 53 locale files are 47.2 MiB. Chromium takes the page's locale from
  // Windows's display language among the files it has, and the spelling
  // check's language from that locale, since main never sets one. A Windows
  // in British English, or in an English Chromium maps to it (Irish,
  // Australian, New Zealand, Indian, South African or Canadian), gets en-GB:
  // day-first dates in History and a British spelling check in the boxes
  // where the author edits a paragraph or a suggestion. Every other Windows
  // gets en-US: US dates, the review dialog's word count written the US way
  // and a US spelling check, even in French or German. en-US alone would have
  // given British writers a US spelling check on a new install, underlining
  // "colour" and "realise". The spelling language is stored in userData on
  // the first run and kept after that. Chromium's own messages are in
  // English, like the app's (C.90).
  electronLanguages: ['en-US', 'en-GB'],
  // Where installed copies look for updates: the releases of APP_REPOSITORY.
  // A draft is invisible to the updater until the author publishes it.
  publish: [{ provider: 'github', owner, repo, releaseType: 'draft' }],
  win: {
    icon: 'resources/icon/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    // No pages and no administrator prompt: it installs for the current
    // Windows account into %LOCALAPPDATA%\Programs, the way the updater
    // re-runs it.
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    shortcutName: name,
    artifactName: '${productName}-Setup-${version}.${ext}',
    // Writes the .blockmap beside the installer, from which an update
    // downloads only the blocks that changed.
    differentialPackage: true,
    // Settings, reviews, backups and drafts stay after an uninstall.
    deleteAppDataOnUninstall: false
  },
  // No dependency has native code to rebuild for Electron.
  npmRebuild: false
};
