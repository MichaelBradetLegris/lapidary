import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_ID, APP_NAME, APP_REPOSITORY } from '../../src/shared/branding';

/*
 * release.4: the electron-builder config per PLAN 11.3 (n). One target, a
 * one-click per-user NSIS installer for x64, with no portable exe (11.0); a
 * GitHub publish block from APP_REPOSITORY, which the build writes into
 * resources/app-update.yml for the updater; nothing unpacked from the asar,
 * since no Anthropic package is a dependency (C.42); and only Chromium's en-US
 * and en-GB locale files, the second so that a Windows in British English keeps
 * day-first dates and a British spelling check (C.90).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

interface BuilderConfig {
  appId?: unknown;
  productName?: unknown;
  asarUnpack?: unknown;
  electronLanguages?: unknown;
  publish?: unknown;
  portable?: unknown;
  win?: { target?: unknown; artifactName?: unknown };
  nsis?: Record<string, unknown>;
}

const builder = require('../../electron-builder.config.cjs') as BuilderConfig;
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name?: string };

describe('electron-builder config (release.4)', () => {
  it('takes the app id and the name from branding.ts', () => {
    expect(builder.appId).toBe(APP_ID);
    expect(builder.productName).toBe(APP_NAME);
  });

  it('publishes to the releases of APP_REPOSITORY, as drafts', () => {
    const [owner, repo] = APP_REPOSITORY.split('/');
    expect(builder.publish).toEqual([{ provider: 'github', owner, repo, releaseType: 'draft' }]);
  });

  it('builds one Windows target, the NSIS installer for x64, and no portable exe', () => {
    expect(builder.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(builder).not.toHaveProperty('portable');
    // The installer's own artifactName below is the only file name template.
    expect(builder.win).not.toHaveProperty('artifactName');
  });

  it('makes a one-click installer for the current Windows account that keeps user data', () => {
    expect(builder.nsis).toEqual({
      oneClick: true,
      perMachine: false,
      runAfterFinish: true,
      createDesktopShortcut: true,
      shortcutName: APP_NAME,
      artifactName: '${productName}-Setup-${version}.${ext}',
      differentialPackage: true,
      deleteAppDataOnUninstall: false
    });
  });

  it('unpacks nothing from the asar and keeps only the en-US and en-GB locale files', () => {
    expect(builder).not.toHaveProperty('asarUnpack');
    expect(builder.electronLanguages).toEqual(['en-US', 'en-GB']);
  });

  it('keeps the package name that names the install folder and the updater cache', () => {
    // electron-builder names both from package.json's name (appInfo.js,
    // targetUtil.js): %LOCALAPPDATA%\Programs\manuscript-review and
    // %LOCALAPPDATA%\manuscript-review-updater. Frozen from 1.0 (PLAN 11.1).
    expect(pkg.name).toBe('manuscript-review');
    expect(`${pkg.name?.toLowerCase()}-updater`).toBe('manuscript-review-updater');
  });
});
