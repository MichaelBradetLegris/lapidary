import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PACKAGED_ICON, windowIconPath, type WindowIconContext } from '../../src/main/windowIcon';

/* brand.5: which icon file the window is given (PLAN C.92). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Where the app path and the main bundle's folder say the repository is.
const REPO = path.resolve('/repo/app');
const BUNDLE_ROOT = path.resolve('/elsewhere/app');
// process.resourcesPath of a packaged copy.
const RESOURCES = path.resolve('/install/Lapidary/resources');

function context(overrides: Partial<WindowIconContext>): WindowIconContext {
  return {
    platform: 'win32',
    packaged: false,
    roots: [REPO, BUNDLE_ROOT],
    resourcesPath: RESOURCES,
    exists: () => true,
    ...overrides
  };
}

describe('windowIconPath', () => {
  it('gives a dev run on Windows the .ico from the repository', () => {
    expect(windowIconPath(context({}))).toBe(path.join(REPO, 'resources', 'icon', 'icon.ico'));
  });

  it('gives a packaged Windows build the .ico beside the asar, never one from a repository', () => {
    const asked: string[] = [];
    const exists = (file: string): boolean => {
      asked.push(file);
      return true;
    };
    expect(windowIconPath(context({ packaged: true, exists }))).toBe(path.join(RESOURCES, 'icon.ico'));
    expect(asked).toEqual([path.join(RESOURCES, 'icon.ico')]);
  });

  it('gives a packaged Windows build nothing when the .ico is missing, so the window keeps the executable icon', () => {
    expect(windowIconPath(context({ packaged: true, exists: () => false }))).toBeUndefined();
  });

  it('gives a packaged build elsewhere nothing', () => {
    const exists = (): boolean => {
      throw new Error('nothing to look for');
    };
    expect(windowIconPath(context({ platform: 'darwin', packaged: true, exists }))).toBeUndefined();
    expect(windowIconPath(context({ platform: 'linux', packaged: true, exists }))).toBeUndefined();
  });

  it('gives a dev run elsewhere the 256 px PNG', () => {
    expect(windowIconPath(context({ platform: 'linux' }))).toBe(
      path.join(REPO, 'resources', 'icon', 'icon-256.png')
    );
  });

  it('takes the first root that holds the file, and none when no root does', () => {
    const second = path.join(BUNDLE_ROOT, 'resources', 'icon', 'icon.ico');
    expect(windowIconPath(context({ exists: (file) => file === second }))).toBe(second);
    expect(windowIconPath(context({ exists: () => false }))).toBeUndefined();
  });

  it('names files the repository has', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const file = windowIconPath({
        platform,
        packaged: false,
        roots: [ROOT],
        resourcesPath: RESOURCES,
        exists: existsSync
      });
      expect(file).toBeDefined();
    }
  });

  it('looks beside the asar for the name the package config copies the .ico to', () => {
    const require = createRequire(import.meta.url);
    const builder = require('../../electron-builder.config.cjs') as {
      extraResources?: { from: string; to: string }[];
    };
    const copied = builder.extraResources?.find((entry) => entry.to === PACKAGED_ICON);
    expect(copied?.from).toBe('resources/icon/icon.ico');
    expect(existsSync(path.join(ROOT, copied?.from ?? ''))).toBe(true);
  });
});
