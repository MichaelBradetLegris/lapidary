import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  claudeCodeInfo,
  collectAppInfo,
  openAiPackageVersion,
  readPackageVersion,
  type AppInfoDeps
} from '../../src/main/appInfo';
import { MIN_CLAUDE_CODE } from '../../src/shared/ai/claudeStatus';
import { APP_NAME } from '../../src/shared/branding';

/* hardening.5: the versions `app:info` and Copy diagnostics give, read while
   the app runs. The openai package's comes from its own package.json, found
   from where Node resolves the package, whose `exports` do not list it; the
   user's Claude Code from the last lookup, never a new one. */

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALLED_OPENAI = (
  JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'openai', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
const resolveHere = (id: string): string => createRequire(import.meta.url).resolve(id);
const readFile = (file: string): Promise<string> => Promise.resolve(readFileSync(file, 'utf8'));
const CLAUDE_EXE = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

describe('readPackageVersion', () => {
  it('reads the installed openai package, whose exports do not list its package.json', async () => {
    expect(() => resolveHere('openai/package.json')).toThrow();
    expect(await readPackageVersion('openai', { resolve: resolveHere, readFile })).toBe(INSTALLED_OPENAI);
  });

  it('is what the app asks, read once and kept', async () => {
    const first = openAiPackageVersion();
    expect(openAiPackageVersion()).toBe(first);
    expect(await first).toBe(INSTALLED_OPENAI);
  });

  it('passes over a package.json of another name, as a package keeps beside its built files', async () => {
    const pkg = path.join(path.sep, 'app', 'node_modules', 'pkg');
    const files: Record<string, string> = {
      [path.join(pkg, 'dist', 'esm', 'package.json')]:
        '{"name": "pkg-esm", "version": "0.0.0", "type": "module"}',
      [path.join(pkg, 'dist', 'package.json')]: 'not json at all',
      [path.join(pkg, 'package.json')]: '{"name": "pkg", "version": "1.2.3"}'
    };
    const version = await readPackageVersion('pkg', {
      resolve: () => path.join(pkg, 'dist', 'esm', 'index.js'),
      readFile: (file) =>
        file in files ? Promise.resolve(files[file] ?? '') : Promise.reject(new Error('ENOENT'))
    });
    expect(version).toBe('1.2.3');
  });

  it('is null for a package that is not installed, or whose package.json gives no version', async () => {
    expect(await readPackageVersion('no-such-package-here', { resolve: resolveHere, readFile })).toBeNull();
    const pkg = path.join(path.sep, 'app', 'node_modules', 'pkg');
    expect(
      await readPackageVersion('pkg', {
        resolve: () => path.join(pkg, 'index.js'),
        readFile: () => Promise.resolve('{"name": "pkg"}')
      })
    ).toBeNull();
  });
});

describe('claudeCodeInfo', () => {
  it('tells not looked for from not found, and keeps no path', () => {
    expect(claudeCodeInfo(undefined)).toEqual({ state: 'not-checked' });
    expect(claudeCodeInfo(null)).toEqual({ state: 'not-installed' });
    expect(claudeCodeInfo({ path: CLAUDE_EXE, onPath: false, version: '2.1.302' })).toEqual({
      state: 'found',
      version: '2.1.302',
      onPath: false
    });
  });
});

describe('collectAppInfo', () => {
  const deps = (patch: Partial<AppInfoDeps> = {}): AppInfoDeps => ({
    version: '0.1.0',
    packaged: false,
    versions: { electron: '44.3.0', chrome: '140.0.7339.80', node: '22.19.0' },
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.26300',
    openAiVersion: () => Promise.resolve('7.15.0'),
    installedCli: () => ({ path: CLAUDE_EXE, onPath: true, version: '2.1.302' }),
    ...patch
  });

  it('gives every version, the Claude Code the last lookup found and the minimum, and no path', async () => {
    const info = await collectAppInfo(deps());
    expect(info).toEqual({
      name: APP_NAME,
      version: '0.1.0',
      packaged: false,
      electron: '44.3.0',
      chromium: '140.0.7339.80',
      node: '22.19.0',
      platform: 'win32',
      arch: 'x64',
      osRelease: '10.0.26300',
      openai: '7.15.0',
      claudeCode: { state: 'found', version: '2.1.302', onPath: true },
      claudeCodeMin: MIN_CLAUDE_CODE
    });
    expect(JSON.stringify(info)).not.toContain('Users');
  });

  it('reads the record as it stands each time, and says unknown for a version the process lacks', async () => {
    let found: ReturnType<AppInfoDeps['installedCli']> = undefined;
    const info = (): ReturnType<typeof collectAppInfo> =>
      collectAppInfo(
        deps({ versions: {}, openAiVersion: () => Promise.resolve(null), installedCli: () => found })
      );
    expect((await info()).claudeCode).toEqual({ state: 'not-checked' });
    found = null;
    expect((await info()).claudeCode).toEqual({ state: 'not-installed' });
    expect(await info()).toMatchObject({
      electron: 'unknown',
      chromium: 'unknown',
      node: 'unknown',
      openai: null
    });
  });
});
