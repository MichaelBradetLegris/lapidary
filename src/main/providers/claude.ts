import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { claudeModelOptions } from '../../shared/ai/claudeModels';
import type { ModelInfo, ReviewRequest, RuntimeStatus } from '../../shared/ipc';
import { getDevSwitches } from '../devSwitches';
import { log } from '../log';
import { fail } from '../errors';
import {
  afterLookup,
  afterVersion,
  canRun,
  claudeAuthStatus,
  claudeVersion,
  locateClaudeCode,
  spawn,
  type InstalledCli,
  type LocateDeps,
  type RunOptions
} from './claudeBinary';
import { cliInitialize, cliReviewInput, runCliReview, runCliTest, type CliDeps } from './claudeCli';
import { createHandshake } from './claudeHandshake';
import { createClaudeRuntimeCheck } from './claudeRuntime';
import { buildClaudeEnv } from './claudeOptions';
import { registerController } from './controllers';
import type {
  ProviderHooks,
  ProviderResult,
  ProviderTestHooks,
  ProviderTestResult,
  ReviewProvider
} from './types';

/**
 * Claude, through the Claude Code the user installed (PLAN 11.3 q, C.42).
 *
 * The app ships no Claude Code of its own and no Anthropic library. It finds the
 * user's `claude`, and claudeCli.ts runs it. Nothing here reads, stores or
 * forwards credentials: Claude Code signs in on its own, through Anthropic's
 * flow (CLAUDE.md rule 2).
 *
 * The provider surface (`runtime`, `models`, `review`) is the same as before, so
 * nothing above this file changed; `test` came with setup.8.
 */

/* ------------------------------------------------------------------ */
/* Finding Claude Code                                                 */
/* ------------------------------------------------------------------ */

/** null: not installed; undefined: not looked for yet. */
let executableCache: string | null | undefined;

/** What the last lookup found and its version (setup.3); null: not installed; undefined: not looked for yet. */
let installed: InstalledCli | null | undefined;

/**
 * The Claude Code the last lookup found, whether a terminal finds it by name,
 * and what its `--version` said, for diagnostics and `app:info`
 * (hardening.5). Reading it looks for nothing and runs nothing.
 */
export function installedCli(): InstalledCli | null | undefined {
  return installed;
}

/** Where to look, for this machine (setup.3, claudeBinary.ts). */
function locateDeps(): LocateDeps {
  return {
    platform: process.platform,
    home: os.homedir(),
    pathEnv: process.env['PATH'] ?? '',
    pathApi: process.platform === 'win32' ? path.win32 : path.posix,
    access: canRun,
    // A development run can pretend Claude Code is missing, to test Setup (setup.15).
    noClaudeCode: getDevSwitches().noClaudeCode
  };
}

/** The installer's location, then PATH, then the usual system folders. */
async function locateExecutable(): Promise<string | null> {
  warnAboutSessionEnvironment();
  const located = await locateClaudeCode(locateDeps());
  installed = afterLookup(installed, located);
  return located?.path ?? null;
}

/** How the two probes run: never in the vault, with the same environment as a review. */
function probeOptions(): RunOptions {
  return { cwd: app.getPath('userData'), env: buildClaudeEnv(process.env) };
}

let warnedAboutSession = false;

/**
 * A development run started from inside a Claude Code session inherits that
 * session's variables, and some change what the app's own Claude Code does:
 * `ANTHROPIC_BASE_URL` routes it through the session's proxy. `npm run
 * dev:clean` removes them (setup.15, C.43); this says so once when they are set.
 */
function warnAboutSessionEnvironment(): void {
  if (warnedAboutSession || app.isPackaged) return;
  warnedAboutSession = true;
  const names = ['CLAUDECODE', 'CLAUDE_CODE_USER_EMAIL', 'ANTHROPIC_BASE_URL'].filter(
    (name) => process.env[name]
  );
  if (names.length === 0) return;
  console.warn(
    `[claude] started from a Claude Code session (${names.join(', ')} set); use npm run dev:clean for verification runs.`
  );
  log('warn', 'claude.session-env', { names: names.join(',') });
}

function cliDeps(executable: string): CliDeps {
  return {
    spawn,
    executable,
    // Never the vault: Claude Code gets a directory it has no reason to read (rule 6).
    cwd: app.getPath('userData'),
    env: buildClaudeEnv(process.env),
    onStderr: (line) => {
      if (getDevSwitches().verbose) console.log('[claude:stderr]', line.trimEnd());
    },
    track: registerController
  };
}

/* ------------------------------------------------------------------ */
/* Runtime check and models                                            */
/* ------------------------------------------------------------------ */

/** The `initialize` exchange, with its time budget; the last answer serves the model list (setup.4). */
const handshake = createHandshake((executable, timeoutMs) => cliInitialize(cliDeps(executable), timeoutMs));

/**
 * Is Claude Code installed, new enough and signed in? Run on every launch and
 * on "Check again". It sends no prompt, so it costs no usage: the version, the
 * sign-in state and the account come from `--version`, `auth status` and the
 * `initialize` exchange, side by side (claudeRuntime.ts).
 */
const runtimeCheck = createClaudeRuntimeCheck({
  locate: async () => {
    executableCache = await locateExecutable();
    return executableCache;
  },
  version: async (executable) => {
    const version = await claudeVersion(executable, probeOptions());
    installed = afterVersion(installed, executable, version);
    return version;
  },
  authStatus: (executable) => claudeAuthStatus(executable, probeOptions()),
  handshake: (executable) => handshake.run(executable),
  now: () => new Date()
});

export function checkRuntime(): Promise<RuntimeStatus> {
  return runtimeCheck();
}

export async function listModels(): Promise<ModelInfo[]> {
  if (executableCache === undefined) executableCache = await locateExecutable();
  if (!executableCache) return [];
  const { models } = handshake.recent(executableCache) ?? (await handshake.run(executableCache));
  // Labelled with their versions, plus earlier versions Claude Code's own list
  // leaves out (round 5, `shared/ai/claudeModels.ts`).
  return claudeModelOptions(models);
}

/* ------------------------------------------------------------------ */
/* The review call                                                     */
/* ------------------------------------------------------------------ */

export async function reviewChapter(request: ReviewRequest, hooks: ProviderHooks): Promise<ProviderResult> {
  if (executableCache === undefined) executableCache = await locateExecutable();
  if (!executableCache) {
    throw fail('claude-missing-binary', 'Claude Code is not installed. Open Setup to install it.');
  }
  // The prompt, model, effort and the chapter's words, built in claudeCli.ts, where a test runs it (files.10).
  return runCliReview(cliDeps(executableCache), cliReviewInput(request), hooks);
}

/* ------------------------------------------------------------------ */
/* Test the connection (setup.8)                                       */
/* ------------------------------------------------------------------ */

/**
 * One very small request, through the same Claude Code, flags, environment
 * and folder as a review (CLAUDE.md rule 6): Haiku, one turn, "Reply with the
 * single word OK." It counts against the author's plan, so it runs only when
 * the author presses Test the connection on the Setup screen.
 */
export async function testClaude(hooks: ProviderTestHooks): Promise<ProviderTestResult> {
  if (executableCache === undefined) executableCache = await locateExecutable();
  if (!executableCache) {
    throw fail('claude-missing-binary', 'Claude Code is not installed. Open Setup to install it.');
  }
  return runCliTest(cliDeps(executableCache), hooks);
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

export const claudeProvider: ReviewProvider = {
  id: 'claude',
  label: 'Claude',
  runtime: checkRuntime,
  models: listModels,
  review: reviewChapter,
  test: testClaude
};
