/**
 * Packaging (plan Phase 5).
 *
 * Two Windows targets: an NSIS installer for keeping, and a portable exe for
 * trying a build without installing anything.
 *
 * Nothing of Anthropic's is packaged: the app runs the Claude Code each user
 * installs (PLAN 11.3 q, C.42), so there is no binary to unpack from the asar.
 *
 * The name comes from src/shared/branding.ts through scripts/branding.cjs, and
 * `npm run package` syncs package.json's productName from the same place first.
 */
const { appName, appId } = require('./scripts/branding.cjs');

const name = appName();

module.exports = {
  // Frozen from 1.0 (APP_ID in src/shared/branding.ts).
  appId: appId(),
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
  win: {
    icon: 'resources/icon/icon.ico',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] }
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: name
  },
  portable: {
    artifactName: '${productName}-${version}-portable.${ext}'
  },
  // No dependency has native code to rebuild for Electron.
  npmRebuild: false
};
