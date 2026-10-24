/**
 * Development switches (PLAN 11.3 b), read in this one place.
 *
 * Each is an environment variable that helps a test run: a scratch userData
 * folder so a run cannot touch the author's real settings, a local mock in place
 * of the OpenAI API or of OpenAI's sign-in server, Claude Code's stderr echoed
 * to the terminal, a window that stays out of the author's way, a shell that
 * opens nothing, and so on. A packaged build ignores all of them. A variable
 * left in someone's shell profile must never redirect a ChatGPT sign-in or its
 * token to another server, or move an installed app's settings.
 * The ignored names are kept so the log can say they were seen.
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
  'MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL',
  'MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE',
  'MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE',
  'MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW',
  'MANUSCRIPT_REVIEW_DEV_SHELL_STUB',
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
  /**
   * a stand-in for OpenAI's sign-in server, https://auth.openai.com, http or
   * https only: the issuer and the base of the authorization, token,
   * revocation and key endpoints Sign in with ChatGPT uses (codex.2,
   * src/main/chatgpt)
   */
  chatGptAuthUrl: string | null;
  /** behave as if Claude Code were not installed, to test the Setup screen */
  noClaudeCode: boolean;
  /**
   * the fake update's plan, such as `1.0.1` or `1.0.1 install-fails`, played
   * in electron-updater's place with no request to GitHub (`parseFakeUpdate`,
   * src/main/fakeUpdater.ts, release.8b)
   */
  fakeUpdate: string | null;
  /**
   * a test window that never takes the foreground and keeps rendering while it
   * is covered (dev.1, src/main/foreground.ts)
   */
  quietWindow: boolean;
  /**
   * open nothing outside the app: a link, a file or a folder main would hand
   * the system is written to the terminal instead (setup.10b, src/main/shellApi.ts)
   */
  shellStub: boolean;
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
  chatGptAuthUrl: null,
  noClaudeCode: false,
  fakeUpdate: null,
  quietWindow: false,
  shellStub: false,
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
    chatGptAuthUrl: httpUrl(env['MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL']),
    noClaudeCode: flag(env['MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE']),
    fakeUpdate: text(env['MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE']),
    quietWindow: flag(env['MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW']),
    shellStub: flag(env['MANUSCRIPT_REVIEW_DEV_SHELL_STUB']),
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
