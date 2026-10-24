/**
 * What the Setup screen shows, decided without React (setup.6, PLAN 11.3 f).
 *
 * The Setup screen (setup.7) and the status bar read everything from here: which
 * of the screen's views applies, the commands to type, and the label for the
 * runtime. Pure (CLAUDE.md rule 4), so every precedence rule has a test.
 */

import {
  AUTH_TOKEN_VARIABLE,
  CLAUDE_UPDATE_COMMAND,
  MIN_CLAUDE_CODE,
  RECOMMENDED_CLAUDE_CODE,
  claudeUpdateAdvice,
  isOutdated,
  quoteForShell,
  signedInElsewhereMessage,
  type ClaudeCredential,
  type ClaudeUpdateAdvice
} from '../ai/claudeStatus';
import { APP_NAME } from '../branding';
import type { ConnectionTestResult, RateLimitInfo, RuntimeStatus } from '../ipc';
import type { ErrorCode } from '../types';
import { WITH_AI_IN_MENU } from './menu';
import { isPlanLimit, usageLimitAdvice } from './usage';

/**
 * Which service the Setup screen sets up: Claude, through the Claude Code the
 * author installs (5.6), or ChatGPT, through Sign in with ChatGPT (codex.2,
 * PLAN 5.7). Each has a view of its own on the one screen.
 */
export type SetupFor = 'claude' | 'chatgpt';

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
  /**
   * for a usage limit: whether it is one of the plan's limits, which reset on
   * their own, as the review's card decided it (`isPlanLimit`), so that Setup
   * says what that card said (setup.9 review)
   */
  planLimit?: boolean;
}

export type SetupEvent =
  /** a review or a connection test failed with `code` (`failureSetupEvent`) */
  | { type: 'failure'; code: ErrorCode; runtime?: RuntimeStatus | null; planLimit?: boolean }
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
        ...(event.runtime?.cliVersion ? { cliVersion: event.runtime.cliVersion } : {}),
        ...(event.planLimit === undefined ? {} : { planLimit: event.planLimit })
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
      if (runtime.credential === 'auth-token') return 'Claude ready (token)';
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

/** `claude update`, and the full-path form when the path is known. */
export function updateCommand(executablePath: string | undefined, os: SetupOs): CommandAdvice {
  const windows = os === 'windows';
  const quoted = executablePath ? quoteForShell(executablePath, windows) : null;
  return {
    command: CLAUDE_UPDATE_COMMAND,
    fullPathCommand: quoted ? (windows ? `& ${quoted} update` : `${quoted} update`) : null
  };
}

/**
 * Claude Code at the path Anthropic's installer puts it on `os`, run with
 * `args` in that system's terminal: for a terminal that does not find
 * `claude` by name, where no path of this machine can be shown.
 */
export function installerPathCommand(os: SetupOs, args: string): string {
  return os === 'windows'
    ? `& "$env:USERPROFILE\\.local\\bin\\claude.exe" ${args}`
    : `~/.local/bin/claude ${args}`;
}

/** Anthropic's installer, then sign-in through the path it installs to, in one line. */
export function installAndLoginCommand(os: SetupOs): string {
  return os === 'windows'
    ? `irm https://claude.ai/install.ps1 | iex; ${installerPathCommand(os, 'auth login')}`
    : `curl -fsSL https://claude.ai/install.sh | bash && ${installerPathCommand(os, 'auth login')}`;
}

/**
 * The Claude Code path for the commands of the system chosen in Setup's tabs:
 * the one found on this machine, on this machine's own tab only. On another
 * system's tab it would be this machine's path in that system's syntax, such
 * as a Windows path quoted for a Mac terminal, which runs nowhere, so that
 * tab gives no full-path form (`setup.7` review).
 */
export function pathForTab(
  runtime: RuntimeStatus | null | undefined,
  os: SetupOs,
  host: SetupOs
): string | undefined {
  return os === host ? runtime?.executablePath : undefined;
}

/**
 * `claude update` advice for an older Claude Code, as the review dialog
 * already shows it, on the system chosen in Setup's tabs; the full-path form
 * only on `host`'s own tab (`pathForTab`).
 */
export function updateAdvice(
  runtime: RuntimeStatus | null | undefined,
  os: SetupOs,
  host: SetupOs
): ClaudeUpdateAdvice | null {
  return claudeUpdateAdvice(runtime?.cliVersion, pathForTab(runtime, os, host), os === 'windows');
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

/* ------------------------------------------------------------------ */
/* The Setup screen, its launch card and its entry points (setup.7)    */
/* ------------------------------------------------------------------ */

/**
 * Where With AI, in the Review menu, goes when Claude is the provider (PLAN
 * 11.3 f). Setup stands in front of the review dialog only when Claude Code is
 * missing or says for certain that it is signed out. A check that failed or
 * ran out of time, or a Claude Code that is too old, opens the dialog with a
 * warning: the review may still go through, and if it does not, it says why.
 */
export function reviewGate(runtime: RuntimeStatus | null | undefined): 'setup' | 'dialog' {
  return runtime?.state === 'missing-binary' || runtime?.state === 'not-signed-in' ? 'setup' : 'dialog';
}

/** The views where Setup has something for the author to do. */
const TO_DO: ReadonlySet<SetupViewId> = new Set([
  'not-installed',
  'signed-out',
  'expired',
  'could-not-check',
  'outdated'
]);

/** Setup has something for the author to do: install, sign in, update, or check again. */
export function needsSetup(view: SetupViewId): boolean {
  return TO_DO.has(view);
}

/**
 * Setup offers "Try the review anyway" when its view is not ready but nothing
 * the check found stops a review: a check that failed, a Claude Code that is
 * too old, a usage limit, or a sign-in failure from the last review that
 * Claude Code no longer reports.
 */
export function canTryReviewAnyway(
  runtime: RuntimeStatus | null | undefined,
  last: LastFailure | null
): boolean {
  if (!runtime || reviewGate(runtime) === 'setup') return false;
  const view = setupView(runtime, last);
  return view !== 'ready' && view !== 'api-key';
}

/** The least time between two checks that the window coming back to the front starts. */
export const FOCUS_RECHECK_MS = 3000;

export interface FocusRecheckInput {
  view: SetupViewId;
  /** Claude is the provider, or the Setup screen is open */
  claudeInUse: boolean;
  /** a check of Claude is running */
  inFlight: boolean;
  /** Date.now() when the last check of Claude started, whatever started it, or null */
  lastCheckAt: number | null;
  now: number;
}

/**
 * Check Claude again as the window comes back to the front? Only while Setup
 * has something for the author to do, which they may just have done in a
 * terminal; only while Claude is in use; never over a check that is running;
 * and at most every 3 s, however often the window comes and goes.
 */
export function focusRecheckDue(input: FocusRecheckInput): boolean {
  if (!input.claudeInUse || input.inFlight || !TO_DO.has(input.view)) return false;
  return input.lastCheckAt === null || input.now - input.lastCheckAt >= FOCUS_RECHECK_MS;
}

/** The key of the card that says at launch that Claude is not ready (section 7). */
export const CLAUDE_RUNTIME_CARD = 'claude-runtime';

export interface RuntimeCard {
  tone: 'info' | 'warn';
  text: string;
}

/** Too old for the app, as the check found, or for the last review, as it said. */
function outdatedLine(runtime: RuntimeStatus | null | undefined): string {
  const version = runtime?.cliVersion;
  if (runtime?.state === 'error' && version) {
    return `Claude Code ${version} is older than ${APP_NAME} needs (${runtime.minCliVersion ?? MIN_CLAUDE_CODE} or newer).`;
  }
  return `The last review said that Claude Code${version ? ` ${version}` : ''} is too old for it.`;
}

/**
 * The launch card's words, which its Open Setup button follows, or null when
 * the card has nothing to say and goes (by its key): Claude is ready, or the
 * view is one Setup cannot change.
 */
export function runtimeCard(
  view: SetupViewId,
  runtime: RuntimeStatus | null | undefined
): RuntimeCard | null {
  switch (view) {
    case 'not-installed':
      return { tone: 'warn', text: 'Claude Code is not installed, so reviews with Claude cannot run yet.' };
    case 'signed-out':
      return { tone: 'warn', text: 'Claude Code is not signed in, so reviews with Claude cannot run yet.' };
    case 'expired':
      return {
        tone: 'warn',
        text: `Your Claude sign-in has ended. This happens from time to time, and nothing in ${APP_NAME} is lost.`
      };
    case 'outdated':
      return {
        tone: 'warn',
        text: `${outdatedLine(runtime)} Reviews with Claude may fail until it is updated.`
      };
    case 'could-not-check':
      return { tone: 'info', text: `${APP_NAME} could not check Claude Code.` };
    default:
      return null;
  }
}

/** What a check does to the launch card: put it up, keep its words current, take it away, or nothing. */
export type RuntimeCardAction = 'raise' | 'update' | 'withdraw' | 'none';

export interface RuntimeCardInput {
  /** the card's words for the view, or null when it has nothing to say (`runtimeCard`) */
  card: RuntimeCard | null;
  /** the card is on screen */
  showing: boolean;
  /** an earlier check in this run has had its chance to put the card up */
  pastLaunch: boolean;
  provider: 'claude' | 'openai';
  setupOpen: boolean;
  /** the welcome guide is showing, whose first step says the same (setup.11) */
  welcomeOpen?: boolean;
}

/**
 * The launch card after a check (5.6, section 7). Only the first check of the
 * run, with the settings in, may put it up: when Claude is the provider, Setup
 * and the welcome guide are not open and there is something to do. While it
 * is up, a later check keeps its words current. It is taken away by its key
 * when nothing is left to do, when OpenAI becomes the provider, and when Setup
 * is open, which says the same at length, or the welcome guide, whose first
 * step does (setup.11). Once closed with its X, or taken away, it stays away.
 */
export function runtimeCardAction(input: RuntimeCardInput): RuntimeCardAction {
  if (!input.card || input.provider !== 'claude' || input.setupOpen || input.welcomeOpen === true) {
    return input.showing ? 'withdraw' : 'none';
  }
  if (input.showing) return 'update';
  return input.pastLaunch ? 'none' : 'raise';
}

/**
 * What Review with AI says above its buttons when Claude is the provider and
 * Setup has something to say about it, or null, with Open Setup beside it.
 * Review with AI opens the dialog only where nothing the check found stops a
 * review (`reviewGate`), and there this is the warning 11.3 (f) gives it. The
 * dialog can still be open over a check that finds Claude Code missing or
 * signed out: the first check answering after it opened, its Provider list
 * switched to Claude, or its Check again or the window coming back to the
 * front answering so. That check is what it says
 * then, not the last review (`setup.7` review).
 */
export function reviewDialogWarning(
  runtime: RuntimeStatus | null | undefined,
  last: LastFailure | null
): string | null {
  if (!runtime) return null;
  if (runtime.state === 'missing-binary') {
    return 'Claude Code is not installed, so this review cannot run yet.';
  }
  if (runtime.state === 'not-signed-in') {
    return last?.code === 'claude-login-expired'
      ? 'Your Claude sign-in has ended, so this review cannot run until you sign in again.'
      : 'Claude Code is not signed in, so this review cannot run yet.';
  }
  switch (setupView(runtime, last)) {
    case 'could-not-check':
      return `${APP_NAME} could not check Claude Code, so this review may fail. If it does, it says why.`;
    case 'outdated':
      return `${outdatedLine(runtime)} The review may fail until it is updated.`;
    case 'expired':
      return 'The last review said your Claude sign-in had ended. If you have signed in again since, go ahead.';
    case 'signed-out':
      return 'The last review said Claude Code was not signed in. If you have signed in since, go ahead.';
    case 'usage-limit':
      return last?.planLimit === true
        ? "The last review stopped at your Claude plan's usage limit. If the limit has reset since, go ahead."
        : "The last review stopped at a usage limit other than your Claude plan's own. If it no longer applies, go ahead.";
    default:
      return null;
  }
}

export type SetupTone = 'ok' | 'warn' | 'pending';

/** The status card at the top of the Setup screen. */
export interface SetupStatus {
  tone: SetupTone;
  title: string;
  /** one paragraph each */
  lines: string[];
}

export const EXPIRED_INTRO = `Claude Code needs you to sign in again. This happens from time to time, and nothing in ${APP_NAME} is lost.`;

/** A sign-in failure from the last review that the check no longer finds. */
export const SIGNED_IN_AGAIN =
  'Claude Code now says it is signed in. If you have signed in again since, test the connection or try the review: this clears once either goes through.';

export const COULD_NOT_CHECK_ADVICE =
  'Check again in a moment. If it keeps failing, try the review anyway: if something is wrong, it says what.';

export const USAGE_LIMIT_TEXT =
  "The last review stopped because your Claude plan's usage limit was reached. The limit resets on its own, at the time Claude Code's message gave. Nothing here needs setting up.";

/** A usage limit that is not one of the plan's (`isPlanLimit`): Claude Code's message said which, and what to do. */
export const OTHER_USAGE_LIMIT_TEXT =
  "The last review stopped at a usage limit that is not one of your Claude plan's own limits, such as usage credits, a spend limit or a team's shared budget. Claude Code's message said which. Nothing here needs setting up.";

function claudeCode(runtime: RuntimeStatus | null | undefined): string {
  return runtime?.cliVersion ? `Claude Code ${runtime.cliVersion}` : 'Claude Code';
}

function readyLines(runtime: RuntimeStatus | null | undefined): string[] {
  if (runtime?.credential === 'cloud') {
    return [
      `${claudeCode(runtime)} is signed in through your cloud provider. ${WITH_AI_IN_MENU} can use Claude.`
    ];
  }
  if (runtime?.credential === 'auth-token') {
    return [
      `${claudeCode(runtime)} signs in with the token in ${AUTH_TOKEN_VARIABLE}, such as a gateway or proxy hands out, so reviews are billed to the account behind that token, not through your Claude sign-in. ${WITH_AI_IN_MENU} can use Claude.`,
      `To use your Claude sign-in instead, remove ${AUTH_TOKEN_VARIABLE} from your environment and start ${APP_NAME} again.`
    ];
  }
  const who = runtime?.email ? ` as ${runtime.email}` : '';
  const plan = runtime?.subscriptionType ? ` (${runtime.subscriptionType})` : '';
  return [`${claudeCode(runtime)} is signed in${who}${plan}. ${WITH_AI_IN_MENU} can use Claude.`];
}

/**
 * Where the API key Claude Code signs in with comes from, such as
 * ANTHROPIC_API_KEY, or null when there is none: the check keeps the `none`
 * that a Claude Code may give for a plan's sign-in, which names no key.
 */
export function apiKeySourceOf(runtime: RuntimeStatus | null | undefined): string | null {
  const source = runtime?.apiKeySource;
  return source && source !== 'none' ? source : null;
}

/**
 * Settings' Claude account row (section 7): the account and its plan, and
 * the API key's source or the token when Claude Code signs in with one; the
 * check's own words when it is not ready; "not checked" before the first
 * check. A plan's sign-in names no key (setup.17: it read "key from none").
 */
export function claudeAccountLine(runtime: RuntimeStatus | null | undefined): string {
  if (!runtime) return 'not checked';
  if (runtime.state !== 'ready') return runtime.message ?? runtime.state;
  const plan = runtime.subscriptionType ? ` (${runtime.subscriptionType})` : '';
  const source = apiKeySourceOf(runtime);
  const how =
    runtime.credential === 'auth-token'
      ? `, token from ${AUTH_TOKEN_VARIABLE}`
      : source
        ? `, API key from ${source}`
        : '';
  return `${runtime.email ?? 'signed in'}${plan}${how}`;
}

function apiKeyLines(runtime: RuntimeStatus | null | undefined): string[] {
  const source = apiKeySourceOf(runtime);
  return [
    `${claudeCode(runtime)} signs in with an API key${source ? ` (${source})` : ''}, so reviews are billed by the token to the Anthropic Console account the key belongs to, not to a Claude plan.`,
    ...(source === 'ANTHROPIC_API_KEY'
      ? [
          `To use your Claude plan instead, remove ANTHROPIC_API_KEY from your environment and start ${APP_NAME} again.`
        ]
      : [])
  ];
}

/**
 * The status card: the view in a few words, what was found, and the plan
 * warning when there is one. A usage limit says what to do about it as the
 * review's card did: for one of the plan's limits, the advice from the last
 * usage notice, which names the limit, on the plan the check found
 * (`usageLimitAdvice`, setup.9); for any other, nothing beyond Claude Code's
 * message (`LastFailure.planLimit`, setup.9 review).
 */
export function setupStatus(
  view: SetupViewId,
  runtime: RuntimeStatus | null | undefined,
  last: LastFailure | null = null,
  rateLimit: RateLimitInfo | null = null
): SetupStatus {
  const plan = runtime?.planWarning ? [runtime.planWarning] : [];
  // The last review's sign-in failure outranks a check that says ready (setupView).
  const signedInNow = runtime?.state === 'ready' && last !== null ? [SIGNED_IN_AGAIN] : [];
  switch (view) {
    case 'checking':
      return {
        tone: 'pending',
        title: 'Checking Claude Code…',
        lines: [
          `${APP_NAME} is asking Claude Code for its version and its sign-in. This sends nothing to Claude and uses none of your plan.`
        ]
      };
    case 'not-installed':
      return { tone: 'warn', title: 'Claude Code is not installed', lines: [NOT_INSTALLED_INTRO] };
    case 'signed-out': {
      const elsewhere =
        runtime?.message !== undefined && runtime.message === signedInElsewhereMessage(runtime.authMethod)
          ? [runtime.message]
          : [];
      return {
        tone: 'warn',
        title: 'Claude Code is not signed in',
        lines: [SIGNED_OUT_INTRO, ...elsewhere, ...signedInNow, ...plan]
      };
    }
    case 'expired':
      return {
        tone: 'warn',
        title: 'Your Claude sign-in has ended',
        lines: [EXPIRED_INTRO, ...signedInNow, ...plan]
      };
    case 'could-not-check':
      return {
        tone: 'warn',
        title: 'Could not check Claude Code',
        lines: [runtime?.message ?? 'Claude Code did not answer.', COULD_NOT_CHECK_ADVICE]
      };
    case 'outdated':
      return { tone: 'warn', title: 'Claude Code is out of date', lines: [outdatedLine(runtime), ...plan] };
    case 'usage-limit':
      return {
        tone: 'warn',
        title: 'Claude usage limit reached',
        lines:
          last?.planLimit === true
            ? [USAGE_LIMIT_TEXT, usageLimitAdvice(rateLimit, runtime?.subscriptionType), ...plan]
            : [OTHER_USAGE_LIMIT_TEXT, ...plan]
      };
    case 'api-key':
      return {
        tone: plan.length ? 'warn' : 'ok',
        title: 'Claude is ready, with an API key',
        lines: [...apiKeyLines(runtime), ...plan]
      };
    case 'ready':
      return plan.length
        ? { tone: 'warn', title: 'Claude Code is signed in, on a plan that cannot run it', lines: plan }
        : { tone: 'ok', title: 'Claude is ready', lines: readyLines(runtime) };
  }
}

/** One step on the Setup screen, with the command it asks for when there is one. */
export interface SetupStep {
  text: string;
  command?: CommandAdvice;
}

/** Said before a command's full-path form, as the review dialog's update note says it. */
export const FULL_PATH_TEXT = 'If the terminal does not recognise claude, use this instead:';

function comeBack(when: string): string {
  return `Come back to ${APP_NAME} ${when}. It checks again as its window comes back to the front, or press Check again.`;
}

/** The heading over the steps, or null when the view has none. */
export function stepsHeading(view: SetupViewId): string | null {
  switch (view) {
    case 'not-installed':
      return 'Install Claude Code';
    case 'signed-out':
      return 'Sign in to Claude Code';
    case 'expired':
      return 'Sign in again';
    case 'outdated':
      return 'Update Claude Code';
    default:
      return null;
  }
}

/**
 * The steps for the view, on the system chosen: open a terminal, run the one
 * command (with its full-path form where the terminal may not find `claude`,
 * on `host`'s own tab only: the path is this machine's, `pathForTab`), come
 * back. Anthropic's installer signs in as it finishes (11.3 f).
 */
export function setupSteps(
  view: SetupViewId,
  runtime: RuntimeStatus | null | undefined,
  os: SetupOs,
  host: SetupOs
): SetupStep[] {
  const terminal: SetupStep = { text: openTerminalHint(os) };
  const path = pathForTab(runtime, os, host);
  switch (view) {
    case 'not-installed':
      return [
        terminal,
        {
          text: 'Paste this line and press Enter. It installs Claude Code, then opens your browser so that you can sign in with your Claude account:',
          command: { command: installAndLoginCommand(os), fullPathCommand: null }
        },
        { text: comeBack('once the terminal says you are signed in') }
      ];
    case 'signed-out':
    case 'expired':
      return [
        terminal,
        {
          text: 'Run this, then sign in with your Claude account in the browser window it opens:',
          command: loginCommand(path, os)
        },
        { text: comeBack('once the terminal says you are signed in') }
      ];
    case 'outdated':
      return [
        terminal,
        { text: 'Run this to update Claude Code:', command: updateCommand(path, os) },
        { text: comeBack('once the update has finished') }
      ];
    default:
      return [];
  }
}

export interface OtherInstall {
  name: string;
  command: string;
}

/** Package managers that install Claude Code where the app finds it. npm is not one on Windows. */
export function otherInstalls(os: SetupOs): OtherInstall[] {
  switch (os) {
    case 'windows':
      return [{ name: 'WinGet', command: 'winget install Anthropic.ClaudeCode' }];
    case 'mac':
      return [{ name: 'Homebrew', command: 'brew install --cask claude-code' }];
    case 'linux':
      return [];
  }
}

export const OTHER_INSTALLS_NOTE =
  'Other ways to install. These do not sign you in, so run claude auth login once they have finished.';

export interface TroubleItem {
  question: string;
  answer: string;
}

export const NOT_RECOGNISED_QUESTION = 'The terminal says it does not recognise claude';

/** Where Anthropic's installer puts Claude Code on each system, named as its pages name it. */
const INSTALLER_FOLDER: Readonly<Record<SetupOs, string>> = {
  windows: '%USERPROFILE%\\.local\\bin',
  mac: '~/.local/bin',
  linux: '~/.local/bin'
};

/** What the view's command runs after `claude`: the update, or the sign-in. */
function viewArgs(view: SetupViewId): string {
  return view === 'outdated' ? 'update' : 'auth login';
}

/**
 * "The terminal does not recognise claude", answered for the view and the
 * tab (setup.17). Anthropic's installer does not put its folder on PATH, so
 * a new terminal helps only once someone has; WinGet and Homebrew do, for
 * terminals opened after the install (troubleshoot-install, Appendix A).
 * Where the steps show the full-path form, which names the Claude Code found
 * on this machine, it comes first. The not-installed view's install line
 * signs in through the full path already, so there the question is a
 * terminal opened before a WinGet or Homebrew install. On another system's
 * tab, which shows no path of this machine, it names the installer's folder
 * on that system.
 */
function notRecognised(view: SetupViewId, os: SetupOs, fullPathShown: boolean): TroubleItem {
  const manager = otherInstalls(os)[0]?.name;
  if (view === 'not-installed') {
    return {
      question: NOT_RECOGNISED_QUESTION,
      answer: manager
        ? `The install line above does not need it: it signs in through the full path of the copy it installs. After a ${manager} install, a terminal that was already open may not see the folder ${manager} put Claude Code in, so open a new terminal, then run claude auth login.`
        : `The install line above does not need it: it signs in through the full path of the copy it installs, ${INSTALLER_FOLDER[os]}/claude. To run claude by name later, add ${INSTALLER_FOLDER[os]} to PATH, as the installer's output says, then open a new terminal.`
    };
  }
  if (fullPathShown) {
    return {
      question: NOT_RECOGNISED_QUESTION,
      answer: `Use the full-path form of the command, shown under it: it names the Claude Code that ${APP_NAME} found, so the terminal does not have to find claude by name. Opening a new terminal helps only once Claude Code's folder is on PATH, which Anthropic's installer does not arrange.`
    };
  }
  return {
    question: NOT_RECOGNISED_QUESTION,
    answer: `Anthropic's installer puts Claude Code in ${INSTALLER_FOLDER[os]} and does not add that folder to PATH. Run it by its full path in place of claude, as in ${installerPathCommand(os, viewArgs(view))}, or add the folder to PATH, as the installer's output says, and open a new terminal.${
      manager
        ? ` A copy installed with ${manager} is found by name in a terminal opened after the install.`
        : ''
    }`
  };
}

export const DESKTOP_ALIAS_QUESTION = 'The terminal starts Claude Desktop instead of Claude Code';

/**
 * An older Claude Desktop's `Claude.exe` in the WindowsApps folder, which a
 * terminal runs for `claude` when that folder comes first on PATH
 * (troubleshoot-install; PLAN 5.6 item 1, setup.17). Windows only. The app's
 * own lookup passes over the folder; the way round it in a terminal is the
 * full path.
 */
function desktopAlias(view: SetupViewId, fullPathShown: boolean): TroubleItem {
  const way =
    view === 'not-installed'
      ? 'The install line above is not affected, as it signs in through the full path of the copy it installs. Use it even after a WinGet install; the two copies can stay side by side.'
      : fullPathShown
        ? 'Use the full-path form of the command, shown under it, which names Claude Code itself.'
        : `Run Claude Code by its full path in place of claude, as in ${installerPathCommand('windows', viewArgs(view))} for a copy from Anthropic's installer.`;
  return {
    question: DESKTOP_ALIAS_QUESTION,
    answer: `An older Claude Desktop can put a Claude.exe in %LOCALAPPDATA%\\Microsoft\\WindowsApps, and where that folder comes before Claude Code's on PATH, typing claude starts Claude Desktop. ${way}`
  };
}

const NO_BROWSER: TroubleItem = {
  question: 'No browser window opened',
  answer:
    'Claude Code prints a sign-in link in the terminal: open it in your browser. If the browser then shows a code, paste it into the terminal.'
};

const STILL_SIGNED_OUT: TroubleItem = {
  question: `Signed in, but ${APP_NAME} still says not signed in`,
  answer: `Press Check again. ${APP_NAME} starts Claude Code without your Claude Code settings, so a sign-in kept there, such as an apiKeyHelper or an env block in ~/.claude/settings.json, does not reach it. Sign in with the command above, or set ANTHROPIC_API_KEY in your environment and start ${APP_NAME} again.`
};

const PLANS: TroubleItem = {
  question: 'Which Claude plans work?',
  answer: `Pro, Max, Team and Enterprise plans can run Claude Code; the free plan cannot. Without a plan, Claude Code can use an Anthropic API key: set ANTHROPIC_API_KEY in your environment, then start ${APP_NAME} again. Reviews are then billed by the token to the Console account the key belongs to.`
};

/** The npm question, Windows only: `claude.cmd` reads as not installed (setup.3). */
const NPM_ON_WINDOWS: TroubleItem = {
  question: 'Installed Claude Code with npm?',
  answer: `On Windows, ${APP_NAME} runs only claude.exe, which Anthropic's installer and WinGet put in place. npm installs claude.cmd instead, a script ${APP_NAME} cannot start without a shell, so a copy installed only with npm shows here as not installed. Install with the command above as well; the two can stay side by side.`
};

const COULD_NOT_CHECK: TroubleItem = {
  question: 'It keeps saying it could not check',
  answer:
    'Claude Code may be busy updating itself, or slow to start the first time. Wait a minute and press Check again. If that does not help, run claude --version in a terminal to see whether it answers, or try the review anyway: if something is wrong, it says what.'
};

function updateElsewhere(os: SetupOs): TroubleItem {
  const how =
    os === 'mac'
      ? 'A copy installed with Homebrew updates with brew upgrade --cask claude-code.'
      : os === 'windows'
        ? 'A copy installed with WinGet updates with winget upgrade Anthropic.ClaudeCode.'
        : 'A copy installed by a package manager updates through that package manager.';
  return { question: 'claude update says it cannot update this copy', answer: how };
}

/**
 * Questions people run into in this view, each with its answer, on the
 * system chosen in Setup's tabs. The terminal questions follow the steps:
 * where they show the full-path form, on `host`'s own tab once the path is
 * known (`pathForTab`), the answers point at it, and nowhere else (setup.17).
 */
export function setupTroubleshooting(
  view: SetupViewId,
  runtime: RuntimeStatus | null | undefined,
  os: SetupOs,
  host: SetupOs
): TroubleItem[] {
  const fullPathShown = pathForTab(runtime, os, host) !== undefined;
  const terminal = [
    notRecognised(view, os, fullPathShown),
    ...(os === 'windows' ? [desktopAlias(view, fullPathShown)] : [])
  ];
  switch (view) {
    case 'not-installed':
      return [...terminal, NO_BROWSER, PLANS, ...(os === 'windows' ? [NPM_ON_WINDOWS] : [])];
    case 'signed-out':
    case 'expired':
      return [...terminal, NO_BROWSER, STILL_SIGNED_OUT, PLANS];
    case 'outdated':
      return [...terminal, updateElsewhere(os)];
    case 'could-not-check':
      return [COULD_NOT_CHECK];
    default:
      return [];
  }
}

const CREDENTIAL_WORDS: Readonly<Record<ClaudeCredential, string>> = {
  subscription: 'a Claude plan',
  'api-key': 'an API key',
  cloud: 'a cloud provider',
  'auth-token': `a token from ${AUTH_TOKEN_VARIABLE}`
};

const LOOKS_IN: Readonly<Record<SetupOs, string>> = {
  windows:
    "%USERPROFILE%\\.local\\bin\\claude.exe, where Anthropic's installer puts it, then each folder on PATH but WindowsApps, where an older Claude Desktop keeps a Claude.exe. Only claude.exe counts, not npm's claude.cmd.",
  mac: "~/.local/bin, where Anthropic's installer puts it, then each folder on PATH, then /opt/homebrew/bin and /usr/local/bin.",
  linux:
    "~/.local/bin, where Anthropic's installer puts it, then each folder on PATH, then /usr/bin and /usr/local/bin."
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "14:02:11" in local time, from an ISO time; the text itself when it is not one. */
export function checkedAtText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export interface AdvancedRow {
  label: string;
  value: string;
}

/** Setup's Advanced section: which Claude Code, which version, and how it signs in. */
export function advancedRows(runtime: RuntimeStatus | null | undefined, os: SetupOs): AdvancedRow[] {
  const signsIn = [
    runtime?.credential ? CREDENTIAL_WORDS[runtime.credential] : null,
    // `auth status` says "none" when signed out, which is no method to name.
    runtime?.authMethod && runtime.authMethod !== 'none' ? `auth method ${runtime.authMethod}` : null
  ].filter((part): part is string => part !== null);
  return [
    { label: 'Claude Code', value: runtime?.executablePath ?? 'not found' },
    {
      label: 'Version',
      value: runtime?.cliVersion ?? (runtime?.executablePath ? 'could not be read' : 'none')
    },
    {
      label: 'Needs',
      value: `${runtime?.minCliVersion ?? MIN_CLAUDE_CODE} or newer, and ${RECOMMENDED_CLAUDE_CODE} or newer for the newest models`
    },
    ...(signsIn.length ? [{ label: 'Signs in with', value: signsIn.join(', ') }] : []),
    ...(runtime?.checkedAt ? [{ label: 'Last checked', value: checkedAtText(runtime.checkedAt) }] : []),
    { label: 'Looks in', value: LOOKS_IN[os] }
  ];
}

/** What a Copy button says when the clipboard refused the command. */
export const COPY_FAILED_TEXT = 'Could not copy. Select the command and copy it yourself.';

/** The status bar's runtime label is a button: Setup for Claude, Settings for OpenAI. */
export function runtimeButtonTitle(provider: 'claude' | 'openai'): string {
  return provider === 'claude' ? 'Open Setup' : 'Open Settings';
}

/* ------------------------------------------------------------------ */
/* Test the connection (setup.8)                                       */
/* ------------------------------------------------------------------ */

/**
 * Said under Test the connection on the Setup screen, by what Claude Code
 * signs in with (`connectionTestNote`). The task's words are a plan's; an API
 * key's card says a few lines higher that reviews are billed to the key, "not
 * to a Claude plan", so the note says what that card says (setup.8 review).
 * A failed check does not say what Claude Code signs in with, so its note
 * names both.
 */
export const CONNECTION_TEST_NOTES: Readonly<Record<ClaudeCredential | 'unknown', string>> = {
  subscription: 'Sends one very small request to Claude, which counts against your plan like any other.',
  'api-key': 'Sends one very small request to Claude, which is billed to your API key like any other.',
  cloud:
    'Sends one very small request to Claude, which is billed through your cloud provider like any other.',
  'auth-token': `Sends one very small request to Claude, which is billed to the account behind your ${AUTH_TOKEN_VARIABLE} like any other.`,
  unknown: 'Sends one very small request to Claude, which counts against your plan or API key like any other.'
};

/** The note under Test the connection for what the last check found. */
export function connectionTestNote(runtime: RuntimeStatus | null | undefined): string {
  return CONNECTION_TEST_NOTES[runtime?.credential ?? 'unknown'];
}

/** Said under the buttons while a test runs, where its result will be. */
export const CONNECTION_TEST_RUNNING = 'Testing: waiting for Claude to answer…';

/**
 * Setup offers Test the connection once Claude Code has been found and the
 * check has not said for certain that it is signed out: when it says ready,
 * as after a sign-in that the last review said had ended, which only a test
 * or a review clears, and when the check itself failed, where the test can
 * say more. Not before the first check, nor for a missing Claude Code or a
 * definite "signed out", where the steps say what to do and a test could
 * only fail.
 */
export function canTestConnection(runtime: RuntimeStatus | null | undefined): boolean {
  return runtime?.state === 'ready' || runtime?.state === 'error';
}

/**
 * What a finished test does to the last failure: one that went through
 * clears it, as a review that went through does (11.3 f); one that did not
 * is remembered, as a review's failure is; a cancelled one, which the app's
 * quitting causes, says nothing. `setup.6` named the success event for a
 * review and a test alike.
 */
export function testSetupEvent(
  result: ConnectionTestResult,
  runtime: RuntimeStatus | null | undefined
): SetupEvent | null {
  if (result.ok) return { type: 'success' };
  const code = result.error?.code ?? 'unknown';
  if (code === 'cancelled') return null;
  return failureSetupEvent(code, result.error?.message ?? '', result.rateLimit, runtime);
}

/**
 * A review or connection test that failed with `code`, Claude Code's
 * `message`, after the usage notice `rateLimit`, the last that came before
 * the failure. A usage limit carries whether it is one of the plan's limits,
 * decided as the review's card decides it (`isPlanLimit`), so that Setup's
 * usage-limit view says what that card said (setup.9 review).
 */
export function failureSetupEvent(
  code: ErrorCode,
  message: string,
  rateLimit: RateLimitInfo | null | undefined,
  runtime: RuntimeStatus | null | undefined
): SetupEvent {
  return {
    type: 'failure',
    code,
    runtime: runtime ?? null,
    ...(code === 'claude-usage-limit' ? { planLimit: isPlanLimit(message, rateLimit) } : {})
  };
}

/** A finished test, with when it finished. */
export interface ConnectionTestOutcome {
  result: ConnectionTestResult;
  /** ISO time */
  finishedAt: string;
}

/** "2.9 s" under 10 seconds, "12 s" from there. */
export function testDurationText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

export interface ConnectionTestLine {
  tone: 'ok' | 'failed';
  text: string;
}

/** The line under Test the connection that says how the last test went, and when. */
export function connectionTestLine(outcome: ConnectionTestOutcome): ConnectionTestLine {
  const { result } = outcome;
  const at = checkedAtText(outcome.finishedAt);
  if (result.ok) {
    return {
      tone: 'ok',
      text: `Claude answered the test at ${at}, in ${testDurationText(result.durationMs)}${
        result.model ? ` (${result.model})` : ''
      }.`
    };
  }
  return {
    tone: 'failed',
    text: `The test at ${at} did not go through: ${result.error?.message ?? 'no reason was given.'}`
  };
}
