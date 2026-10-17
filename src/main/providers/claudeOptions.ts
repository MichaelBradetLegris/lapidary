import { modelArgs } from '../../shared/ai/claudeModels';
import type { EffortLevel } from '../../shared/types';
import { DEV_SWITCH_NAMES } from '../devSwitches';

/**
 * How the app runs the user's Claude Code (PLAN 11.3 c and q, C.42): the child
 * process's environment and its command line. The system prompt and the output
 * schema are not here; they travel in the `initialize` message on stdin, where a
 * long guidelines file cannot run into the Windows command-line limit.
 *
 * The flags keep the guarantees of CLAUDE.md rule 6:
 * - no built-in tools (`--tools ""`), so the call cannot read or write the vault;
 * - no MCP servers but the (empty) set given here (`--strict-mcp-config`);
 * - no user, project or local settings (`--setting-sources=`);
 * - no session kept on disk (`--no-session-persistence`);
 * - permission prompts answered "no" (`--permission-mode dontAsk`).
 * `--bare` is never used: it turns off signing in with a Claude subscription.
 *
 * No electron import; test/main/claudeOptions.test.ts pins both functions.
 */

export const BASE_CLAUDE_ARGS: readonly string[] = Object.freeze([
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--tools',
  '',
  '--setting-sources=',
  '--strict-mcp-config',
  '--no-session-persistence',
  '--permission-mode',
  'dontAsk'
]);

export interface ClaudeArgsInput {
  /** the model setting; `default` and '' leave the choice to Claude Code */
  model?: string;
  effort?: EffortLevel;
  maxTurns?: number;
  /** stream partial messages, which drive the progress label */
  partialMessages?: boolean;
}

export function claudeArgs(input: ClaudeArgsInput = {}): string[] {
  return [
    ...BASE_CLAUDE_ARGS,
    ...modelArgs(input.model ?? ''),
    ...(input.effort ? ['--effort', input.effort] : []),
    ...(input.maxTurns ? ['--max-turns', String(input.maxTurns)] : []),
    ...(input.partialMessages ? ['--include-partial-messages'] : [])
  ];
}

/**
 * Variables the child never sees. A model forced from the environment would
 * override the author's choice; the OpenAI key and the development switches are
 * none of Claude Code's business; and `CLAUDE_CODE_SIMPLE` is the switch behind
 * `--bare`, which would refuse the user's subscription sign-in.
 */
const REMOVED = new Set(['ANTHROPIC_MODEL', 'OPENAI_API_KEY', 'CLAUDE_CODE_SIMPLE', ...DEV_SWITCH_NAMES]);

/**
 * The child's environment: `base` without the variables above, plus
 * `CLAUDE_CODE_STARTUP_FAILURE_RESULTS`, which makes a start-up failure arrive
 * as a result message the app can read. Everything else passes through
 * unchanged, including `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, proxy settings
 * and the telemetry opt-outs, so no sign-in method or user preference is lost.
 * Nothing here sets or overrides Claude Code's client or entrypoint identity
 * (CLAUDE.md rule 6; the Usage Policy's "misrepresent the product or client").
 * Names compare case-insensitively, as Windows does. `base` is not changed.
 */
export function buildClaudeEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined || REMOVED.has(name.toUpperCase())) continue;
    env[name] = value;
  }
  env['CLAUDE_CODE_STARTUP_FAILURE_RESULTS'] = '1';
  return env;
}
