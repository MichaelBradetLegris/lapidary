import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { windowIconPath, type WindowIconContext } from '../../src/main/windowIcon';

/* brand.5: which icon file the window is given (PLAN C.92). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Where the app path and the main bundle's folder say the repository is.
const REPO = path.resolve('/repo/app');
const BUNDLE_ROOT = path.resolve('/elsewhere/app');

function context(overrides: Partial<WindowIconContext>): WindowIconContext {
  return {
    platform: 'win32',
    packaged: false,
    roots: [REPO, BUNDLE_ROOT],
    exists: () => true,
    ...overrides
  };
}

describe('windowIconPath', () => {
  it('gives a dev run on Windows the .ico from the repository', () => {
    expect(windowIconPath(context({}))).toBe(path.join(REPO, 'resources', 'icon', 'icon.ico'));
  });

  it('gives a packaged Windows build nothing, so the window takes the executable icon', () => {
    const asked: string[] = [];
    const exists = (file: string): boolean => {
      asked.push(file);
      return true;
    };
    expect(windowIconPath(context({ packaged: true, exists }))).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('gives a packaged build elsewhere nothing either', () => {
    expect(windowIconPath(context({ platform: 'darwin', packaged: true }))).toBeUndefined();
    expect(windowIconPath(context({ platform: 'linux', packaged: true }))).toBeUndefined();
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
      const file = windowIconPath({ platform, packaged: false, roots: [ROOT], exists: existsSync });
      expect(file).toBeDefined();
    }
  });
});
