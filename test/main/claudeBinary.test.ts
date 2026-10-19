import { readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canRun,
  claudeAuthStatus,
  claudeCandidates,
  claudeVersion,
  discoverClaudeCode,
  isWindowsAppsDir,
  locateClaudeCode,
  runClaudeCli,
  type ExecFn,
  type LocateDeps,
  type RunOptions
} from '../../src/main/providers/claudeBinary';

/* setup.3: finding the user's Claude Code on every platform, and the only two
   commands the app ever runs through it outside a review. */

function machine(
  platform: NodeJS.Platform,
  present: string[],
  pathEnv: string,
  extra: Partial<LocateDeps> = {}
): LocateDeps {
  const windows = platform === 'win32';
  return {
    platform,
    home: windows ? 'C:\\Users\\Ann' : platform === 'darwin' ? '/Users/ann' : '/home/ann', // check-public: allow
    pathEnv,
    pathApi: windows ? path.win32 : path.posix,
    access: (file) => Promise.resolve(present.includes(file)),
    ...extra
  };
}

describe('claudeCandidates', () => {
  it('tries the installer s folder, then PATH, on Windows, and only claude.exe', () => {
    const list = claudeCandidates(machine('win32', [], 'C:\\Tools;C:\\Users\\Ann\\.local\\bin;C:\\npm')); // check-public: allow
    expect(list).toEqual([
      { path: 'C:\\Users\\Ann\\.local\\bin\\claude.exe', source: 'installer' }, // check-public: allow
      { path: 'C:\\Tools\\claude.exe', source: 'path' },
      { path: 'C:\\npm\\claude.exe', source: 'path' }
    ]);
    expect(list.some((c) => c.path.endsWith('.cmd'))).toBe(false);
  });

  it('adds Homebrew and /usr/local on macOS', () => {
    expect(claudeCandidates(machine('darwin', [], '/usr/bin:/bin')).map((c) => c.path)).toEqual([
      '/Users/ann/.local/bin/claude', // check-public: allow
      '/usr/bin/claude',
      '/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude'
    ]);
  });

  /* setup.17 (b): an older Claude Desktop's Claude.exe alias in WindowsApps,
     which a terminal runs for claude when that folder comes first on PATH. */
  it('leaves the WindowsApps alias folder out on Windows, however PATH spells it', () => {
    const apps = 'C:\\Users\\Ann\\AppData\\Local\\Microsoft\\WindowsApps'; // check-public: allow
    const links = 'C:\\Users\\Ann\\AppData\\Local\\Microsoft\\WinGet\\Links'; // check-public: allow
    const pathEnv = `${apps};C:\\Tools;${apps.toLowerCase()}\\;${links}`;
    expect(claudeCandidates(machine('win32', [], pathEnv)).map((c) => c.path)).toEqual([
      'C:\\Users\\Ann\\.local\\bin\\claude.exe', // check-public: allow
      'C:\\Tools\\claude.exe',
      `${links}\\claude.exe`
    ]);
    expect(isWindowsAppsDir(apps)).toBe(true);
    expect(isWindowsAppsDir('C:\\Program Files\\WindowsApps')).toBe(false);
    expect(isWindowsAppsDir('C:\\Tools\\WindowsApps2')).toBe(false);
    // Only Windows has App Execution Aliases.
    expect(claudeCandidates(machine('linux', [], '/opt/Microsoft/WindowsApps')).map((c) => c.path)).toContain(
      '/opt/Microsoft/WindowsApps/claude'
    );
  });

  it('adds /usr/bin and /usr/local/bin on Linux, without repeating a PATH folder', () => {
    expect(
      claudeCandidates(machine('linux', [], '/usr/local/bin:/usr/bin')).map((c) => `${c.source} ${c.path}`)
    ).toEqual([
      'installer /home/ann/.local/bin/claude', // check-public: allow
      'path /usr/local/bin/claude',
      'path /usr/bin/claude'
    ]);
  });
});

describe('locateClaudeCode', () => {
  it('prefers the installer s copy and says whether a terminal finds claude by name', async () => {
    const installer = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow
    const installerDir = 'C:\\Users\\Ann\\.local\\bin'; // check-public: allow
    expect(await locateClaudeCode(machine('win32', [installer], 'C:\\Windows'))).toEqual({
      path: installer,
      onPath: false
    });
    expect(await locateClaudeCode(machine('win32', [installer], installerDir))).toEqual({
      path: installer,
      onPath: true
    });
  });

  it('falls back to PATH, then the system folders', async () => {
    expect(await locateClaudeCode(machine('win32', ['D:\\bin\\claude.exe'], 'C:\\x;D:\\bin'))).toEqual({
      path: 'D:\\bin\\claude.exe',
      onPath: true
    });
    expect(await locateClaudeCode(machine('darwin', ['/opt/homebrew/bin/claude'], '/usr/bin'))).toEqual({
      path: '/opt/homebrew/bin/claude',
      onPath: false
    });
  });

  it('never takes npm s claude.cmd, and honours the development switch', async () => {
    expect(await locateClaudeCode(machine('win32', ['C:\\npm\\claude.cmd'], 'C:\\npm'))).toBeNull();
    const installer = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow
    expect(await locateClaudeCode(machine('win32', [installer], '', { noClaudeCode: true }))).toBeNull();
  });
});

/* setup.17 (b): `canRun` must never take an App Execution Alias for a
   program it may run, or an older Claude Desktop's Claude.exe would be found
   and started with --version. `fs.stat` cannot follow an alias (EACCES), so
   it says no; this pins that against a change in Node or Electron, on the
   real aliases of the machine the tests run on: every `.exe` in the folder
   that is not a folder itself. Node lists them as symbolic links today, but
   the test does not ask for that, so a Node that listed them as plain files
   would still be tested rather than skipped. None is ever run. Skipped off
   Windows, and where the folder holds no `.exe`. */
const WINDOWS_APPS =
  process.platform === 'win32' && process.env['LOCALAPPDATA']
    ? path.join(process.env['LOCALAPPDATA'], 'Microsoft', 'WindowsApps')
    : null;

function windowsAppsAliases(): string[] {
  if (!WINDOWS_APPS) return [];
  try {
    return readdirSync(WINDOWS_APPS, { withFileTypes: true })
      .filter((entry) => /\.exe$/i.test(entry.name) && !entry.isDirectory())
      .map((entry) => path.join(WINDOWS_APPS, entry.name));
  } catch {
    return [];
  }
}

const ALIASES = windowsAppsAliases();

describe.skipIf(ALIASES.length === 0)('App Execution Aliases (Windows)', () => {
  it('canRun says no to every alias in WindowsApps, which only a terminal runs', async () => {
    const answers = await Promise.all(ALIASES.map(async (alias) => [alias, await canRun(alias)] as const));
    expect(answers.filter(([, runs]) => runs)).toEqual([]);
  });

  it('the lookup passes over the folder that holds them, on this machine s own PATH', () => {
    const folder = WINDOWS_APPS ?? '';
    const list = claudeCandidates({
      platform: 'win32',
      home: os.homedir(),
      pathEnv: `${folder};${process.env['PATH'] ?? ''}`,
      pathApi: path.win32
    });
    expect(list.filter((c) => path.win32.dirname(c.path).toLowerCase() === folder.toLowerCase())).toEqual([]);
  });
});

describe('runClaudeCli', () => {
  const calls: string[][] = [];
  // Each test reads only its own calls, whatever order the tests run in.
  beforeEach(() => {
    calls.length = 0;
  });
  const exec =
    (code: number | null, stdout: string): ExecFn =>
    (file, args) => {
      calls.push([file, ...args]);
      return Promise.resolve({ code, stdout });
    };
  const opts = (fn: ExecFn): RunOptions => ({ cwd: 'C:\\data', env: {}, exec: fn });

  it('runs only the two probes', async () => {
    await expect(runClaudeCli('claude.exe', ['auth', 'login'], opts(exec(0, '')))).rejects.toThrow(
      /runs only --version and auth status --json/
    );
    await expect(runClaudeCli('claude.exe', ['auth', 'logout'], opts(exec(0, '')))).rejects.toThrow();
    await expect(runClaudeCli('claude.exe', ['-p', 'hello'], opts(exec(0, '')))).rejects.toThrow();
    await expect(runClaudeCli('claude.exe', ['--version', '--debug'], opts(exec(0, '')))).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('keeps the output of exit 1, as auth status gives when signed out, and nothing else', async () => {
    expect(
      await runClaudeCli('claude.exe', ['auth', 'status', '--json'], opts(exec(1, '{"loggedIn":false}')))
    ).toBe('{"loggedIn":false}');
    expect(await runClaudeCli('claude.exe', ['--version'], opts(exec(2, 'boom')))).toBeNull();
    expect(await runClaudeCli('claude.exe', ['--version'], opts(exec(null, '')))).toBeNull();
  });

  it('reports a Claude Code older than the minimum as outdated', async () => {
    const installer = '/home/ann/.local/bin/claude'; // check-public: allow
    const found = await discoverClaudeCode(
      machine('linux', [installer], ''),
      opts(exec(0, '2.1.200 (Claude Code)'))
    );
    expect(found).toEqual({ path: installer, onPath: false, version: '2.1.200', outdated: true });
    expect(
      (await discoverClaudeCode(machine('linux', [installer], ''), opts(exec(0, '2.1.283 (Claude Code)'))))
        ?.outdated
    ).toBe(false);
    expect(await discoverClaudeCode(machine('linux', [], ''), opts(exec(0, '')))).toBeNull();
  });
});

describe('the probes against a stand-in Claude Code', () => {
  const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fakeClaude.ts');
  const real = (scenario: string, extra: Record<string, string> = {}): RunOptions => ({
    cwd: path.dirname(FAKE),
    env: { ...(process.env as Record<string, string>), FAKE_CLAUDE_SCENARIO: scenario, ...extra },
    prefixArgs: [FAKE]
  });

  it('reads the version', async () => {
    expect(await claudeVersion(process.execPath, real('success'))).toBe('2.1.283');
    expect(await claudeVersion(process.execPath, real('success', { FAKE_CLAUDE_VERSION: '2.1.266' }))).toBe(
      '2.1.266'
    );
  });

  it('keeps only the allowed auth fields, never the organisation', async () => {
    const status = await claudeAuthStatus(process.execPath, real('success'));
    expect(status).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      subscriptionType: 'max',
      email: 'ann@example.com'
    });
    expect(JSON.stringify(status)).not.toContain('Organization');
  });

  it('reads a signed-out status even though the command exits with 1', async () => {
    expect(await claudeAuthStatus(process.execPath, real('signed-out'))).toMatchObject({
      loggedIn: false,
      authMethod: 'none'
    });
  });
});
