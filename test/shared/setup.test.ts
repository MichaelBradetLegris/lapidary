import { describe, expect, it } from 'vitest';
import type { RuntimeStatus } from '../../src/shared/ipc';
import {
  installAndLoginCommand,
  loginCommand,
  nextLastFailure,
  openTerminalHint,
  osFromUserAgent,
  runtimeLabel,
  setupView,
  updateAdvice,
  type LastFailure
} from '../../src/shared/ui/setup';

/* setup.6: what the Setup screen shows, and when a failure stops counting. */

const PATH = 'C:\\Users\\Ann\\.local\\bin\\claude.exe'; // check-public: allow

function claude(patch: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return { provider: 'claude', state: 'ready', executablePath: PATH, cliVersion: '2.1.283', ...patch };
}

const expired: LastFailure = { code: 'claude-login-expired' };

describe('setupView', () => {
  it.each([
    ['no check yet', null, null, 'checking'],
    ['Claude Code missing', claude({ state: 'missing-binary' }), expired, 'not-installed'],
    ['signed out', claude({ state: 'not-signed-in' }), null, 'signed-out'],
    ['signed out after an ended sign-in', claude({ state: 'not-signed-in' }), expired, 'expired'],
    ['ready, but the last review said the sign-in ended', claude(), expired, 'expired'],
    [
      'ready, but the last review said not signed in',
      claude(),
      { code: 'claude-not-signed-in' },
      'signed-out'
    ],
    ['the check failed', claude({ state: 'error' }), null, 'could-not-check'],
    [
      'the check found Claude Code too old',
      claude({ state: 'error', cliVersion: '2.1.200' }),
      null,
      'outdated'
    ],
    ['the last review said too old', claude(), { code: 'claude-outdated' }, 'outdated'],
    ['a usage limit in force', claude(), { code: 'claude-usage-limit' }, 'usage-limit'],
    ['an API key in use', claude({ credential: 'api-key' }), null, 'api-key'],
    ['ready', claude({ credential: 'subscription' }), { code: 'claude-rate-limit' }, 'ready']
  ] as const)('%s', (_label, runtime, last, view) => {
    expect(setupView(runtime, last)).toBe(view);
  });
});

describe('nextLastFailure', () => {
  it('remembers a failure with the Claude Code it happened with', () => {
    expect(nextLastFailure(null, { type: 'failure', code: 'claude-outdated', runtime: claude() })).toEqual({
      code: 'claude-outdated',
      executablePath: PATH,
      cliVersion: '2.1.283'
    });
  });

  it('keeps an ended sign-in through a plain re-check that says ready', () => {
    const after = nextLastFailure(expired, { type: 'check', runtime: claude() });
    expect(after).toBe(expired);
    expect(setupView(claude(), after)).toBe('expired');
  });

  it('clears it once a check said signed out and a later one says ready', () => {
    const signedOut = nextLastFailure(expired, {
      type: 'check',
      runtime: claude({ state: 'not-signed-in' })
    });
    expect(signedOut).toEqual({ ...expired, signedOutSince: true });
    expect(nextLastFailure(signedOut, { type: 'check', runtime: claude({ state: 'not-signed-in' }) })).toBe(
      signedOut
    );
    expect(nextLastFailure(signedOut, { type: 'check', runtime: claude() })).toBeNull();
  });

  it('clears on a review or connection test that went through', () => {
    expect(nextLastFailure(expired, { type: 'success' })).toBeNull();
  });

  it('clears an outdated failure when Claude Code changes, and only then', () => {
    const outdated = nextLastFailure(null, {
      type: 'failure',
      code: 'claude-outdated',
      runtime: claude({ cliVersion: '2.1.266' })
    });
    expect(nextLastFailure(outdated, { type: 'check', runtime: claude({ cliVersion: '2.1.266' }) })).toBe(
      outdated
    );
    expect(
      nextLastFailure(outdated, { type: 'check', runtime: claude({ cliVersion: '2.1.290' }) })
    ).toBeNull();
    expect(
      nextLastFailure(outdated, {
        type: 'check',
        runtime: claude({ cliVersion: '2.1.266', executablePath: 'D:\\claude.exe' })
      })
    ).toBeNull();
    expect(nextLastFailure(expired, { type: 'check', runtime: claude({ cliVersion: '2.1.290' }) })).toBe(
      expired
    );
  });
});

describe('runtimeLabel', () => {
  it('names the state, the account and an API key', () => {
    expect(runtimeLabel(claude({ email: 'ann@example.com' }))).toBe('Claude ready ann@example.com');
    expect(runtimeLabel(claude({ credential: 'api-key' }))).toBe('Claude ready (API key)');
    expect(runtimeLabel(claude(), expired)).toBe('Claude: sign-in ended');
    expect(runtimeLabel(claude({ state: 'missing-binary' }))).toBe('Claude Code not installed');
    expect(runtimeLabel(null)).toBeNull();
  });

  it('labels OpenAI by its key', () => {
    expect(runtimeLabel({ provider: 'openai', state: 'ready', keyLast4: 'ab12' })).toBe(
      'OpenAI ready (key ends ab12)'
    );
    expect(runtimeLabel({ provider: 'openai', state: 'not-signed-in' })).toBe('OpenAI: no API key');
  });
});

describe('commands', () => {
  it('reads the operating system from the user agent', () => {
    expect(osFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/38')).toBe('windows');
    expect(osFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Electron/38')).toBe('mac');
    expect(osFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) Electron/38')).toBe('linux');
  });

  it('signs in with claude, or through the full path, quoted for the shell', () => {
    const windows = loginCommand("C:\\Users\\Ann O'Neil\\.local\\bin\\claude.exe", 'windows'); // check-public: allow
    expect(windows).toEqual({
      command: 'claude auth login',
      fullPathCommand: "& 'C:\\Users\\Ann O''Neil\\.local\\bin\\claude.exe' auth login" // check-public: allow
    });
    const posix = "/home/ann o'neil/.local/bin/claude"; // check-public: allow
    expect(loginCommand(posix, 'linux').fullPathCommand).toBe(
      "'/home/ann o'\\''neil/.local/bin/claude' auth login" // check-public: allow
    );
    expect(loginCommand(undefined, 'mac').fullPathCommand).toBeNull();
  });

  it('installs and signs in with one line', () => {
    expect(installAndLoginCommand('windows')).toBe(
      'irm https://claude.ai/install.ps1 | iex; & "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login'
    );
    expect(installAndLoginCommand('mac')).toBe(
      'curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude auth login'
    );
  });

  it('advises claude update for an older Claude Code, as the review dialog does', () => {
    expect(updateAdvice(claude({ cliVersion: '2.1.266' }), 'windows')).toMatchObject({
      command: 'claude update',
      fullPathCommand: `& '${PATH}' update`
    });
    expect(updateAdvice(claude(), 'windows')).toBeNull();
  });

  it('says how to open a terminal on each system', () => {
    expect(openTerminalHint('windows')).toContain('PowerShell');
    expect(openTerminalHint('mac')).toContain('Terminal');
    expect(openTerminalHint('linux')).toContain('Ctrl+Alt+T');
  });
});
