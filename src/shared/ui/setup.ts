/**
 * What the Setup screen shows, decided without React (setup.6, PLAN 11.3 f).
 *
 * The Setup screen (setup.7) and the status bar read everything from here: which
 * of the screen's views applies, the commands to type, and the label for the
 * runtime. Pure (CLAUDE.md rule 4), so every precedence rule has a test.
 */

import { claudeUpdateAdvice, isOutdated, quoteForShell, type ClaudeUpdateAdvice } from '../ai/claudeStatus';
import { APP_NAME } from '../branding';
import type { RuntimeStatus } from '../ipc';
import type { ErrorCode } from '../types';

export type SetupViewId =
  /** no status yet: the first check is still running */
  | 'checking'
  | 'not-installed'
  | 'signed-out'
  | 'expired'
  | 'could-not-check'
  | 'outdated'
  | 'usage-limit'
  | 'api-key'
  | 'ready';

/**
 * The last Claude failure that says something about setup, with the Claude
 * Code it happened with, so an update can clear an "outdated" failure.
 */
export interface LastFailure {
  code: ErrorCode;
  executablePath?: string;
  cliVersion?: string;
  /** a check has said "signed out" since the failure; a ready check after that clears it */
  signedOutSince?: boolean;
}

export type SetupEvent =
  /** a review or a connection test failed with `code` */
  | { type: 'failure'; code: ErrorCode; runtime?: RuntimeStatus | null }
  /** a review or a connection test went through */
  | { type: 'success' }
  /** a runtime check finished */
  | { type: 'check'; runtime: RuntimeStatus };

/**
 * The last failure after `event`. It clears on a successful review or
 * connection test, on a signed-out check followed by a ready one, and, for an
 * outdated failure only, when Claude Code's path or version changes. A plain
 * re-check never clears a sign-in failure: `auth status` can say signed in
 * while the token itself has ended.
 */
export function nextLastFailure(last: LastFailure | null, event: SetupEvent): LastFailure | null {
  switch (event.type) {
    case 'failure':
      return {
        code: event.code,
        ...(event.runtime?.executablePath ? { executablePath: event.runtime.executablePath } : {}),
        ...(event.runtime?.cliVersion ? { cliVersion: event.runtime.cliVersion } : {})
      };
    case 'success':
      return null;
    case 'check': {
      if (!last) return null;
      const { runtime } = event;
      if (runtime.state === 'not-signed-in')
        return last.signedOutSince ? last : { ...last, signedOutSince: true };
      if (runtime.state === 'ready' && last.signedOutSince) return null;
      if (
        last.code === 'claude-outdated' &&
        (runtime.executablePath !== last.executablePath || runtime.cliVersion !== last.cliVersion)
      ) {
        return null;
      }
      return last;
    }
  }
}

const SIGN_IN_FAILURES: ReadonlySet<ErrorCode> = new Set(['claude-login-expired', 'claude-not-signed-in']);

/** Which view the Setup screen shows, first match (PLAN 11.3 f). */
export function setupView(runtime: RuntimeStatus | null, last: LastFailure | null): SetupViewId {
  if (!runtime) return 'checking';
  if (runtime.state === 'missing-binary') return 'not-installed';
  if (runtime.state === 'not-signed-in')
    return last?.code === 'claude-login-expired' ? 'expired' : 'signed-out';
  if (last && SIGN_IN_FAILURES.has(last.code))
    return last.code === 'claude-login-expired' ? 'expired' : 'signed-out';
  if (runtime.state === 'error') {
    // An installed Claude Code below the minimum is reported as an error by the check.
    return runtime.cliVersion && isOutdated(runtime.cliVersion, runtime.minCliVersion)
      ? 'outdated'
      : 'could-not-check';
  }
  if (last?.code === 'claude-outdated') return 'outdated';
  if (last?.code === 'claude-usage-limit') return 'usage-limit';
  if (runtime.credential === 'api-key') return 'api-key';
  return 'ready';
}

/** The status bar's words for a provider's runtime. */
export function runtimeLabel(
  runtime: RuntimeStatus | null | undefined,
  last: LastFailure | null = null
): string | null {
  if (!runtime) return null;
  if (runtime.provider === 'openai') {
    return runtime.state === 'ready'
      ? `OpenAI ready (key ends ${runtime.keyLast4 ?? '????'})`
      : 'OpenAI: no API key';
  }
  switch (setupView(runtime, last)) {
    case 'not-installed':
      return 'Claude Code not installed';
    case 'signed-out':
      return 'Claude: not signed in';
    case 'expired':
      return 'Claude: sign-in ended';
    case 'could-not-check':
      return 'Claude: could not check';
    case 'outdated':
      return 'Claude Code out of date';
    case 'usage-limit':
      return 'Claude: usage limit reached';
    case 'api-key':
      return 'Claude ready (API key)';
    default:
      return `Claude ready${runtime.email ? ` ${runtime.email}` : ''}`;
  }
}

export type SetupOs = 'windows' | 'mac' | 'linux';

export function osFromUserAgent(userAgent: string): SetupOs {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  return 'linux';
}

export interface CommandAdvice {
  /** for a terminal where `claude` is on PATH */
  command: string;
  /** the same through the full path, for a terminal that does not find `claude` */
  fullPathCommand: string | null;
}

/** `claude auth login`, and the full-path form when the path is known. */
export function loginCommand(executablePath: string | undefined, os: SetupOs): CommandAdvice {
  const windows = os === 'windows';
  const quoted = executablePath ? quoteForShell(executablePath, windows) : null;
  return {
    command: 'claude auth login',
    fullPathCommand: quoted ? (windows ? `& ${quoted} auth login` : `${quoted} auth login`) : null
  };
}

/** Anthropic's installer, then sign-in through the path it installs to, in one line. */
export function installAndLoginCommand(os: SetupOs): string {
  return os === 'windows'
    ? 'irm https://claude.ai/install.ps1 | iex; & "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login'
    : 'curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude auth login';
}

/** `claude update` advice for an older Claude Code, as the review dialog already shows it. */
export function updateAdvice(
  runtime: RuntimeStatus | null | undefined,
  os: SetupOs
): ClaudeUpdateAdvice | null {
  return claudeUpdateAdvice(runtime?.cliVersion, runtime?.executablePath, os === 'windows');
}

/** How to open a terminal, for someone who never has. */
export function openTerminalHint(os: SetupOs): string {
  switch (os) {
    case 'windows':
      return 'Open PowerShell: press the Start key, type PowerShell, and press Enter.';
    case 'mac':
      return 'Open Terminal: press Command and Space, type Terminal, and press Return.';
    case 'linux':
      return 'Open a terminal (Ctrl+Alt+T on most systems).';
  }
}

export const SIGNED_OUT_INTRO = `Claude Code is not signed in. If reviews worked before, your sign-in has ended; this happens from time to time and nothing in ${APP_NAME} is lost.`;

export const NOT_INSTALLED_INTRO = `${APP_NAME} reviews with Claude through Claude Code, Anthropic's free command-line tool. It needs a Claude plan or an API key, and ${APP_NAME} does not include it: install it with the command below, which also signs you in.`;

export const PRIVACY_FOOTER = `${APP_NAME} never sees your Claude password or sign-in token. You sign in with Anthropic, in Claude Code and your browser.`;
