import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fail } from '../../src/main/errors';
import { createInstalledRecord } from '../../src/main/providers/claudeBinary';
import type { CliInitInfo } from '../../src/main/providers/claudeCli';
import {
  FIRST_HANDSHAKE_MS,
  HANDSHAKE_REUSE_MS,
  LATER_HANDSHAKE_MS,
  createHandshake
} from '../../src/main/providers/claudeHandshake';
import {
  claudeDiagnostics,
  createClaudeRuntimeCheck,
  type RuntimeCheckDeps
} from '../../src/main/providers/claudeRuntime';
import { MIN_CLAUDE_CODE, type AuthStatus } from '../../src/shared/ai/claudeStatus';

/* setup.4: the launch check, which never sends a prompt. */

const EXE = 'C:/Users/Ann/.local/bin/claude.exe'; // check-public: allow
const NOW = new Date('2026-10-15T09:00:00.000Z');
const SIGNED_IN: AuthStatus = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  subscriptionType: 'max'
};
const ACCOUNT_INFO: CliInitInfo = {
  models: [{ value: 'default' }],
  account: {
    email: 'ann@example.com',
    subscriptionType: 'Claude Max',
    tokenSource: 'claude.ai',
    apiKeySource: 'none'
  }
};

function check(patch: Partial<RuntimeCheckDeps> = {}) {
  return createClaudeRuntimeCheck({
    locate: () => Promise.resolve({ path: EXE, onPath: true }),
    version: () => Promise.resolve('2.1.283'),
    authStatus: () => Promise.resolve(SIGNED_IN),
    handshake: () => Promise.resolve(ACCOUNT_INFO),
    installed: createInstalledRecord(),
    now: () => NOW,
    ...patch
  });
}

describe('createHandshake', () => {
  it('gives the first attempt a minute and later ones 20 seconds, even after a failure', async () => {
    const budgets: number[] = [];
    let fails = true;
    const handshake = createHandshake((_exe, timeoutMs) => {
      budgets.push(timeoutMs);
      return fails ? Promise.reject(new Error('timed out')) : Promise.resolve(ACCOUNT_INFO);
    });
    await expect(handshake.run(EXE)).rejects.toThrow('timed out');
    fails = false;
    await handshake.run(EXE);
    await handshake.run(EXE);
    expect(budgets).toEqual([FIRST_HANDSHAKE_MS, LATER_HANDSHAKE_MS, LATER_HANDSHAKE_MS]);
    expect([FIRST_HANDSHAKE_MS, LATER_HANDSHAKE_MS]).toEqual([60_000, 20_000]);
  });

  it('keeps the last answer for the model list for ten minutes, for the same Claude Code', async () => {
    let clock = 0;
    const handshake = createHandshake(
      () => Promise.resolve(ACCOUNT_INFO),
      () => clock
    );
    expect(handshake.recent(EXE)).toBeNull();
    await handshake.run(EXE);
    clock = HANDSHAKE_REUSE_MS - 1;
    expect(handshake.recent(EXE)).toBe(ACCOUNT_INFO);
    expect(handshake.recent('D:/other/claude.exe')).toBeNull();
    clock = HANDSHAKE_REUSE_MS;
    expect(handshake.recent(EXE)).toBeNull();
  });
});

describe('the runtime check', () => {
  it('reports ready with the account and how Claude Code signs in, and when it checked', async () => {
    expect(await check()()).toEqual({
      provider: 'claude',
      state: 'ready',
      executablePath: EXE,
      cliVersion: '2.1.283',
      minCliVersion: MIN_CLAUDE_CODE,
      authMethod: 'claude.ai',
      credential: 'subscription',
      email: 'ann@example.com',
      subscriptionType: 'Claude Max',
      apiKeySource: 'none',
      checkedAt: NOW.toISOString()
    });
  });

  it('runs the three probes side by side', async () => {
    const started: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const probe =
      <T>(name: string, value: T) =>
      async (): Promise<T> => {
        started.push(name);
        await gate;
        return value;
      };
    const pending = check({
      version: probe('version', '2.1.283'),
      authStatus: probe('auth', SIGNED_IN),
      handshake: probe('handshake', ACCOUNT_INFO)
    })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started.sort()).toEqual(['auth', 'handshake', 'version']);
    release();
    expect((await pending).state).toBe('ready');
  });

  it('reports a missing Claude Code without probing', async () => {
    let probed = false;
    const status = await check({
      locate: () => Promise.resolve(null),
      version: () => ((probed = true), Promise.resolve(null))
    })();
    expect(status).toMatchObject({ state: 'missing-binary', checkedAt: NOW.toISOString() });
    expect(probed).toBe(false);
  });

  it('reports a Claude Code older than the minimum, with the fix', async () => {
    const status = await check({ version: () => Promise.resolve('2.1.200') })();
    expect(status.state).toBe('error');
    expect(status.message).toContain('Claude Code 2.1.200 is older than this app needs');
    expect(status.message).toContain('claude update');
  });

  it('believes auth status when it says signed out', async () => {
    const status = await check({
      authStatus: () => Promise.resolve({ loggedIn: false, authMethod: 'none' })
    })();
    expect(status).toMatchObject({ state: 'not-signed-in', authMethod: 'none' });
  });

  it('believes a handshake that failed because the sign-in is gone', async () => {
    const status = await check({
      handshake: () => Promise.reject(fail('claude-login-expired', 'Your Claude sign-in has ended.'))
    })();
    expect(status).toMatchObject({ state: 'not-signed-in', message: 'Your Claude sign-in has ended.' });
  });

  it('says an API key is in use', async () => {
    const status = await check({
      handshake: () =>
        Promise.resolve({ models: [], account: { apiKeySource: 'ANTHROPIC_API_KEY', tokenSource: 'none' } })
    })();
    expect(status).toMatchObject({ state: 'ready', credential: 'api-key' });
  });

  it('falls back on auth status when the handshake times out', async () => {
    const status = await check({
      handshake: () => Promise.reject(new Error('Claude Code did not answer in time.'))
    })();
    expect(status).toMatchObject({ state: 'ready', credential: 'subscription' });
  });

  it('says why it could not check when nothing answered', async () => {
    const status = await check({
      authStatus: () => Promise.resolve(null),
      handshake: () => Promise.reject(new Error('Claude Code did not answer in time.'))
    })();
    expect(status).toMatchObject({ state: 'error' });
    expect(status.message).toContain('Could not tell whether Claude Code is signed in');
  });
});

describe('what the check keeps for app:info and Copy diagnostics (hardening.5 review)', () => {
  it('keeps where Claude Code is, whether a terminal finds it, and what --version said', async () => {
    const installed = createInstalledRecord();
    expect(installed.current()).toBeUndefined();
    await check({ installed })();
    expect(installed.current()).toEqual({ path: EXE, onPath: true, version: '2.1.283' });
    // An outdated Claude Code is the one most worth naming, though the check ends in an error.
    const status = await check({
      installed,
      locate: () => Promise.resolve({ path: EXE, onPath: false }),
      version: () => Promise.resolve('2.1.200')
    })();
    expect(status.state).toBe('error');
    expect(installed.current()).toEqual({ path: EXE, onPath: false, version: '2.1.200' });
  });

  it('keeps the lookup before --version answers, and an answer it cannot read as no version', async () => {
    const installed = createInstalledRecord();
    let answer: (version: string | null) => void = () => undefined;
    const pending = check({
      installed,
      version: () => new Promise<string | null>((resolve) => (answer = resolve))
    })();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(installed.current()).toEqual({ path: EXE, onPath: true, version: null });
    answer(null);
    await pending;
    expect(installed.current()).toEqual({ path: EXE, onPath: true, version: null });
  });

  it('keeps nothing found when Claude Code is missing, in place of what an earlier check found', async () => {
    const installed = createInstalledRecord();
    await check({ installed })();
    await check({ installed, locate: () => Promise.resolve(null) })();
    expect(installed.current()).toBeNull();
  });

  it('is the record installedCli reads, and a lookup outside a check is kept in it too', () => {
    const source = readFileSync(path.join(__dirname, '../../src/main/providers/claude.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(source).toContain('const installed = createInstalledRecord();');
    expect(source).toMatch(/export function installedCli\(\)[^{]*\{\s*return installed\.current\(\);\s*\}/);
    expect(source).toMatch(/createClaudeRuntimeCheck\(\{[^]*?\n {2}installed,\n[^]*?\}\);/);
    const outside = source.slice(
      source.indexOf('async function locateExecutable('),
      source.indexOf('function probeOptions(')
    );
    expect(outside).toMatch(/const located = await lookUp\(\);\s*installed\.lookedUp\(located\);/);
  });
});

describe('claudeDiagnostics', () => {
  it('says what was found and how it signs in, never the email or organisation', async () => {
    const lines = claudeDiagnostics(await check()(), { code: 'claude-rate-limit' });
    expect(lines).toEqual([
      'Claude: ready (subscription)',
      `Claude Code: 2.1.283 at ${EXE}`,
      `Claude Code minimum: ${MIN_CLAUDE_CODE}`,
      'Auth method: claude.ai',
      'Plan: Claude Max',
      `Checked: ${NOW.toISOString()}`,
      'Last failure: claude-rate-limit'
    ]);
    expect(lines.join('\n')).not.toMatch(/example\.com|organi[sz]ation/i);
    expect(claudeDiagnostics(null, null)).toEqual(['Claude: not checked yet']);
  });

  it('says not found, rather than an unknown version, when Claude Code is not installed (hardening.5)', () => {
    const lines = claudeDiagnostics(
      { provider: 'claude', state: 'missing-binary', checkedAt: NOW.toISOString(), message: 'not installed' },
      null
    );
    expect(lines).toEqual([
      'Claude: missing-binary',
      'Claude Code: not found',
      `Claude Code minimum: ${MIN_CLAUDE_CODE}`,
      `Checked: ${NOW.toISOString()}`,
      'Last failure: none'
    ]);
  });
});
