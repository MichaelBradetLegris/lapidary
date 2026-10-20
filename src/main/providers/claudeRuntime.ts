import {
  MIN_CLAUDE_CODE,
  OUTDATED_MESSAGE,
  classifyClaude,
  isOutdated,
  type AuthStatus,
  type ClaudeAccount
} from '../../shared/ai/claudeStatus';
import type { RuntimeStatus } from '../../shared/ipc';
import type { LastFailure } from '../../shared/ui/setup';
import { AppFailure } from '../errors';
import type { CliInitInfo } from './claudeCli';

/*
 * Is Claude Code installed, new enough and signed in? (setup.4, PLAN 11.3 f)
 *
 * Three probes run side by side and none sends a prompt: `--version`,
 * `auth status --json` and the `initialize` handshake. `classifyClaude` reads
 * the answers. Electron-free: every probe is passed in.
 */

export interface RuntimeCheckDeps {
  /** the Claude Code executable, or null when it is not installed */
  locate: () => Promise<string | null>;
  version: (executable: string) => Promise<string | null>;
  authStatus: (executable: string) => Promise<AuthStatus | null>;
  handshake: (executable: string) => Promise<CliInitInfo>;
  now: () => Date;
}

const SIGN_IN_CODES = new Set(['claude-not-signed-in', 'claude-login-expired']);

export function createClaudeRuntimeCheck(deps: RuntimeCheckDeps): () => Promise<RuntimeStatus> {
  return async () => {
    const checkedAt = deps.now().toISOString();
    const executable = await deps.locate();
    if (!executable) {
      return {
        provider: 'claude',
        state: 'missing-binary',
        checkedAt,
        message: 'Claude Code is not installed. Open Setup to install it, then check again.'
      };
    }

    const [version, auth, init] = await Promise.all([
      deps.version(executable),
      deps.authStatus(executable),
      deps.handshake(executable).then(
        (info) => ({ info }),
        (error: unknown) => ({ error })
      )
    ]);
    const found: RuntimeStatus = {
      provider: 'claude',
      state: 'error',
      executablePath: executable,
      minCliVersion: MIN_CLAUDE_CODE,
      checkedAt,
      ...(version ? { cliVersion: version } : {}),
      ...(auth?.authMethod ? { authMethod: auth.authMethod } : {})
    };

    if (version && isOutdated(version)) {
      return {
        ...found,
        message: `Claude Code ${version} is older than this app needs (${MIN_CLAUDE_CODE} or newer). ${OUTDATED_MESSAGE}`
      };
    }

    const account: ClaudeAccount | null = 'info' in init ? init.info.account : null;
    // A handshake that failed because the sign-in is gone says more than a hopeful auth status.
    if ('error' in init && init.error instanceof AppFailure && SIGN_IN_CODES.has(init.error.code)) {
      return { ...found, state: 'not-signed-in', message: init.error.message };
    }

    const verdict = classifyClaude({ auth, account });
    return {
      ...found,
      state: verdict.state,
      ...(verdict.credential ? { credential: verdict.credential } : {}),
      ...(verdict.planWarning ? { planWarning: verdict.planWarning } : {}),
      ...(account?.email ? { email: account.email } : {}),
      ...(account?.subscriptionType ? { subscriptionType: account.subscriptionType } : {}),
      ...(account?.apiKeySource ? { apiKeySource: account.apiKeySource } : {}),
      ...(verdict.message
        ? { message: verdict.message }
        : verdict.state === 'error' && 'error' in init
          ? { message: init.error instanceof Error ? init.error.message : String(init.error) }
          : {})
    };
  };
}

/**
 * The Claude part of "Copy diagnostics": what was found and how it signs in,
 * never the email or the organisation. Paths are scrubbed by the caller
 * (shared/diagnostics/redact.ts).
 */
export function claudeDiagnostics(runtime: RuntimeStatus | null, lastFailure: LastFailure | null): string[] {
  if (!runtime) return ['Claude: not checked yet'];
  const found =
    runtime.state === 'missing-binary'
      ? 'not found'
      : `${runtime.cliVersion ?? 'unknown version'}${runtime.executablePath ? ` at ${runtime.executablePath}` : ''}`;
  return [
    `Claude: ${runtime.state}${runtime.credential ? ` (${runtime.credential})` : ''}`,
    `Claude Code: ${found}`,
    `Claude Code minimum: ${runtime.minCliVersion ?? MIN_CLAUDE_CODE}`,
    ...(runtime.authMethod ? [`Auth method: ${runtime.authMethod}`] : []),
    ...(runtime.subscriptionType ? [`Plan: ${runtime.subscriptionType}`] : []),
    ...(runtime.planWarning ? ['Plan warning: free plan'] : []),
    ...(runtime.checkedAt ? [`Checked: ${runtime.checkedAt}`] : []),
    `Last failure: ${lastFailure?.code ?? 'none'}`
  ];
}
