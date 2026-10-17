import type { CliInitInfo } from './claudeCli';

/*
 * The launch check's conversation with Claude Code (setup.4, PLAN 11.3 f and q).
 *
 * After `cli.1` the handshake is Claude Code's own `initialize` exchange over
 * stream-json: it answers with the model list and the account, and no prompt
 * is ever sent, so a launch costs no usage. `cliInitialize` always ends the
 * process, on success, on a refusal and on a timeout. This adds the time
 * budget and keeps the last answer for the model list.
 */

/** The first check may wait for a cold start; later ones should answer fast. */
export const FIRST_HANDSHAKE_MS = 60_000;
export const LATER_HANDSHAKE_MS = 20_000;
/** How long an answer serves the model list without asking again. */
export const HANDSHAKE_REUSE_MS = 10 * 60 * 1000;

export type InitializeFn = (executable: string, timeoutMs: number) => Promise<CliInitInfo>;

export interface Handshake {
  /** ask Claude Code now, within the budget for this attempt */
  run(executable: string): Promise<CliInitInfo>;
  /** the last answer from `executable`, if it is younger than `maxAgeMs` */
  recent(executable: string, maxAgeMs?: number): CliInitInfo | null;
}

export function createHandshake(initialize: InitializeFn, now: () => number = Date.now): Handshake {
  let attempted = false;
  let last: { executable: string; at: number; info: CliInitInfo } | null = null;
  return {
    async run(executable) {
      const budget = attempted ? LATER_HANDSHAKE_MS : FIRST_HANDSHAKE_MS;
      attempted = true;
      const info = await initialize(executable, budget);
      last = { executable, at: now(), info };
      return info;
    },
    recent(executable, maxAgeMs = HANDSHAKE_REUSE_MS) {
      if (!last || last.executable !== executable || now() - last.at >= maxAgeMs) return null;
      return last.info;
    }
  };
}
