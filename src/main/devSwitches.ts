/**
 * Development switches (PLAN 11.3 b), read in this one place.
 *
 * Each is an environment variable that helps a test run: a scratch userData
 * folder so a run cannot touch the author's real settings, a local mock in place
 * of the OpenAI API, Claude Code's stderr echoed to the terminal, and so on. A
 * packaged build ignores all of them. A variable left in someone's shell profile
 * must never redirect the stored OpenAI key to another server, or move an
 * installed app's settings. The ignored names are kept so the log can say they
 * were seen.
 *
 * The one switch an installed build honours is the `--isolated-user-data=<dir>`
 * command-line flag. A flag has to be typed for each launch, so it cannot linger,
 * and it lets a packaged build be tested without touching real settings. It wins
 * over the variable in development too.
 *
 * The names keep a prefix of their own that never changes with the app's name.
 * No electron import, so the rules are unit-tested directly.
 */

export const DEV_SWITCH_NAMES = [
  'MANUSCRIPT_REVIEW_USER_DATA',
  'MANUSCRIPT_REVIEW_OPENAI_BASE_URL',
  'MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE',
  'MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE',
  'MREV_VERBOSE'
] as const;

export type DevSwitchName = (typeof DEV_SWITCH_NAMES)[number];

export interface DevSwitches {
  /** true in an installed build, where only the command-line flag counts */
  packaged: boolean;
  /** a userData folder that replaces the real one, from the flag or (in development) the variable */
  userDataDir: string | null;
  /** a stand-in for https://api.openai.com/v1, http or https only */
  openAiBaseUrl: string | null;
  /** behave as if Claude Code were not installed, to test the Setup screen */
  noClaudeCode: boolean;
  /** pretend this version is available, to exercise the update UI */
  fakeUpdate: string | null;
  /** echo Claude Code's stderr to the terminal */
  verbose: boolean;
  /** variables a packaged build saw and ignored, for the log */
  ignored: DevSwitchName[];
}

export interface DevSwitchInput {
  env: Readonly<Record<string, string | undefined>>;
  packaged: boolean;
  /** the value of `--isolated-user-data`, or null when the flag is absent */
  isolatedUserData: string | null;
}

/** Everything off, as before `readDevSwitches` has run. */
export const NO_DEV_SWITCHES: DevSwitches = Object.freeze({
  packaged: true,
  userDataDir: null,
  openAiBaseUrl: null,
  noClaudeCode: false,
  fakeUpdate: null,
  verbose: false,
  ignored: []
});

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Set and not an explicit "0", "false", "no" or "off". */
function flag(value: string | undefined): boolean {
  const v = text(value);
  return v !== null && !/^(0|false|no|off)$/i.test(v);
}

/** An absolute http or https URL, or null. Anything else is ignored rather than guessed at. */
export function httpUrl(value: string | undefined): string | null {
  const v = text(value);
  if (v === null) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'http:' || url.protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

export function readDevSwitches({ env, packaged, isolatedUserData }: DevSwitchInput): DevSwitches {
  const fromFlag = text(isolatedUserData);
  if (packaged) {
    return {
      ...NO_DEV_SWITCHES,
      packaged: true,
      userDataDir: fromFlag,
      ignored: DEV_SWITCH_NAMES.filter((name) => text(env[name]) !== null)
    };
  }
  return {
    packaged: false,
    userDataDir: fromFlag ?? text(env['MANUSCRIPT_REVIEW_USER_DATA']),
    openAiBaseUrl: httpUrl(env['MANUSCRIPT_REVIEW_OPENAI_BASE_URL']),
    noClaudeCode: flag(env['MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE']),
    fakeUpdate: text(env['MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE']),
    verbose: flag(env['MREV_VERBOSE']),
    ignored: []
  };
}

let current: DevSwitches = NO_DEV_SWITCHES;

/** The switches for this run; everything off until `setDevSwitches` is called at startup. */
export function getDevSwitches(): DevSwitches {
  return current;
}

export function setDevSwitches(switches: DevSwitches): void {
  current = switches;
}
