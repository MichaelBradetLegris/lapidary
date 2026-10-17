import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  claudeAuthStatus,
  claudeCandidates,
  claudeVersion,
  discoverClaudeCode,
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
