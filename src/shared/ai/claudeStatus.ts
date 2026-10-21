/**
 * Reading what the user's Claude Code says about itself (PLAN 11.3 f and q).
 *
 * `cli.1` put the version rules and the usage-limit wording here; `setup.2` adds
 * the auth-status parser and the failure classifiers. Pure (CLAUDE.md rule 4).
 */

import { APP_NAME } from '../branding';
import type { ErrorCode } from '../types';
import { replyLimitMessage, type ReplyLimit, type ReplyLimitFacts } from './replyLimit';

/**
 * The oldest Claude Code the app is known to work with: every flag in
 * `providers/claudeOptions.ts` and the `initialize` exchange were checked against
 * 2.1.266 on 2026-10-14. An older copy is reported as outdated, with
 * `claude update` as the fix.
 */
export const MIN_CLAUDE_CODE = '2.1.266';

/** "2.1.283" from "2.1.283 (Claude Code)", or null. */
export function parseCliVersion(text: string): string | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isOutdated(version: string, minimum: string = MIN_CLAUDE_CODE): boolean {
  return compareVersions(version, minimum) < 0;
}

/*
 * How Claude Code words usage-limit messages. They arrive as prose, so they are
 * matched by their start. Copied from the Agent SDK 0.3.283's exported
 * USAGE_*_PREFIXES on 2026-10-14, when the app stopped depending on the SDK
 * (C.42); the Claude Code check of each release (docs/RELEASING.md,
 * `release.10`) looks at them again.
 */
export const USAGE_LIMIT_ERROR_PREFIXES: readonly string[] = [
  "You've hit your",
  "You've reached your",
  "You're out of usage credits",
  'Your org is out of usage · add funds to continue',
  'Your org is out of usage · contact your admin',
  "Your seat type doesn't include usage credits",
  "Your seat type doesn't include usage",
  'Your usage allocation has been disabled by your admin',
  "Your group's usage limit is set to $0",
  'Fable 5 requires usage credits',
  "You're out of extra usage",
  "Your seat type doesn't include extra usage"
];

export const USAGE_WARNING_PREFIXES: readonly string[] = ["You've used", "You're close to"];

export const USAGE_TRANSITION_PREFIXES: readonly string[] = [
  "You're now using usage credits",
  "You're now using your usage allocation",
  'Now using your usage allocation',
  'Now using usage credits',
  "You're now using extra usage",
  'Now using extra usage'
];

export function isUsageLimit(text: string): boolean {
  return USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function isUsageNotice(text: string): boolean {
  return [...USAGE_WARNING_PREFIXES, ...USAGE_TRANSITION_PREFIXES].some((prefix) => text.startsWith(prefix));
}

/**
 * The newest Claude Code this app has been checked with. An older copy still
 * works if it is at least `MIN_CLAUDE_CODE`, but it may not offer the newest
 * models: 2.1.266 lists Opus 5 where 2.1.283 lists Opus 5.5. The review dialog
 * says so and shows the update command. Claude Code has no "check without
 * installing" command, so this is the app's own yardstick; the Claude Code
 * check of each release (docs/RELEASING.md, `release.10`) moves it to the
 * current version after a live review.
 */
export const RECOMMENDED_CLAUDE_CODE = '2.1.283';

export const CLAUDE_UPDATE_COMMAND = 'claude update';

export interface ClaudeUpdateAdvice {
  installed: string;
  recommended: string;
  /** `claude update`, for a terminal where `claude` is on PATH */
  command: string;
  /** the same through the full path, for a terminal that does not find `claude` */
  fullPathCommand: string | null;
}

/**
 * A path as one argument for the terminal the commands are shown for.
 * PowerShell doubles a single quote inside single quotes; a POSIX shell
 * closes the quotes, escapes the quote and reopens them.
 */
export function quoteForShell(file: string, windows: boolean): string {
  return windows ? `'${file.replace(/'/g, "''")}'` : `'${file.replace(/'/g, "'\\''")}'`;
}

/** Advice when the installed Claude Code is older than recommended, otherwise null. */
export function claudeUpdateAdvice(
  cliVersion: string | undefined,
  executablePath: string | undefined,
  windows: boolean,
  recommended: string = RECOMMENDED_CLAUDE_CODE
): ClaudeUpdateAdvice | null {
  if (!cliVersion || compareVersions(cliVersion, recommended) >= 0) return null;
  const quoted = executablePath ? quoteForShell(executablePath, windows) : null;
  return {
    installed: cliVersion,
    recommended,
    command: CLAUDE_UPDATE_COMMAND,
    fullPathCommand: quoted ? (windows ? `& ${quoted} update` : `${quoted} update`) : null
  };
}

/* ------------------------------------------------------------------ */
/* Sign-in status (setup.2, PLAN 11.3 f)                               */
/* ------------------------------------------------------------------ */

/**
 * The fields of `claude auth status --json` the app keeps. The command also
 * prints the organisation, its id and folder paths; none of that is read.
 */
export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  apiKeySource?: string;
  subscriptionType?: string;
  email?: string;
}

const AUTH_FIELDS = ['authMethod', 'apiProvider', 'apiKeySource', 'subscriptionType', 'email'] as const;

/** `claude auth status --json`, reduced to `AuthStatus`, or null when it is not that. */
export function parseAuthStatus(text: string): AuthStatus | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record['loggedIn'] !== 'boolean') return null;
  const status: AuthStatus = { loggedIn: record['loggedIn'] };
  for (const field of AUTH_FIELDS) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') status[field] = value;
  }
  return status;
}

/** The account in Claude Code's `initialize` reply, as far as the app reads it. */
export interface ClaudeAccount {
  email?: string;
  subscriptionType?: string;
  /** where the sign-in token comes from; `none` when there is none */
  tokenSource?: string;
  /** where an API key comes from; `none` when there is none */
  apiKeySource?: string;
  /** `firstParty` for Anthropic itself, otherwise Bedrock, Vertex and the like */
  apiProvider?: string;
}

/**
 * What Claude Code signs in with: a Claude plan, an API key, a cloud
 * provider's credentials, or the bearer token in `ANTHROPIC_AUTH_TOKEN`, which
 * a gateway or proxy hands out (setup.17).
 */
export type ClaudeCredential = 'subscription' | 'api-key' | 'cloud' | 'auth-token';

/**
 * The variable Claude Code names as the `initialize` reply's `tokenSource`
 * when it signs in with a bearer token from the environment. It outranks an
 * API key and the Claude sign-in (Appendix A, Authentication): with it set,
 * 2.1.302's `auth status` says `oauth_token` and its reply carries no email,
 * even over a Claude plan's sign-in (setup.17).
 */
export const AUTH_TOKEN_VARIABLE = 'ANTHROPIC_AUTH_TOKEN';

export interface ClaudeClassification {
  state: 'ready' | 'not-signed-in' | 'error';
  credential?: ClaudeCredential;
  message?: string;
  /** set when the plan cannot run Claude Code */
  planWarning?: string;
}

export const NOT_SIGNED_IN_MESSAGE = 'Claude Code is not signed in. Open Setup for instructions.';

export const FREE_PLAN_WARNING =
  'This Claude account is on the free plan, which cannot run Claude Code. Reviews need a Pro or Max plan, or an API key.';

/**
 * `auth status` says signed in, but the review would have no sign-in: it lives
 * in Claude Code's own settings, which the app does not load (11.3 c). The
 * Setup screen shows these words, as they say more than "not signed in".
 */
export function signedInElsewhereMessage(authMethod: string | undefined): string {
  return `Claude Code is signed in through its own settings (${authMethod ?? 'unknown'}), which ${APP_NAME} does not load. Sign in with the command below instead.`;
}

function credentialFromAuthMethod(method: string | undefined): ClaudeCredential | undefined {
  switch (method) {
    case 'claude.ai':
    case 'oauth_token':
      return 'subscription';
    case 'api_key':
    case 'api_key_helper':
      return 'api-key';
    case 'third_party':
      return 'cloud';
    default:
      return undefined;
  }
}

function withPlan(result: ClaudeClassification, subscriptionType: string | undefined): ClaudeClassification {
  // `auth status` says "free"; the initialize reply says "Claude Free", as it says "Claude Max".
  return subscriptionType !== undefined && /\bfree\b/i.test(subscriptionType)
    ? { ...result, planWarning: FREE_PLAN_WARNING }
    : result;
}

/**
 * Is Claude Code ready, and with what? From `auth status` and the `initialize`
 * account, first match (PLAN 11.3 f). `auth status` is trusted only when it
 * says signed out: the review runs without the user's settings, so a sign-in
 * that lives there does not reach it, and the account answers for that. An
 * `ANTHROPIC_AUTH_TOKEN` is read from the account's `tokenSource`, since
 * `auth status` calls it `oauth_token`, which without an account reads as a
 * Claude plan's token (setup.17).
 */
export function classifyClaude(input: {
  auth: AuthStatus | null;
  account: ClaudeAccount | null;
}): ClaudeClassification {
  const { auth, account } = input;
  const plan = account?.subscriptionType ?? auth?.subscriptionType;
  const ready = (credential: ClaudeCredential | undefined): ClaudeClassification =>
    withPlan({ state: 'ready', ...(credential ? { credential } : {}) }, plan);

  if (auth?.loggedIn === false) return { state: 'not-signed-in', message: NOT_SIGNED_IN_MESSAGE };
  const cloud = account?.apiProvider !== undefined && account.apiProvider !== 'firstParty';
  // The token outranks an API key and a sign-in, and a cloud provider outranks it.
  if (account?.tokenSource === AUTH_TOKEN_VARIABLE && !cloud) return ready('auth-token');
  if (account?.apiKeySource && account.apiKeySource !== 'none') return ready('api-key');
  if (cloud) return ready('cloud');
  if (account?.email) return ready('subscription');
  if (account?.tokenSource === 'none') {
    return {
      state: 'not-signed-in',
      message: auth?.loggedIn ? signedInElsewhereMessage(auth.authMethod) : NOT_SIGNED_IN_MESSAGE
    };
  }
  if (auth?.loggedIn) return ready(credentialFromAuthMethod(auth.authMethod));
  return {
    state: 'error',
    message: 'Could not tell whether Claude Code is signed in. Check again in a moment.'
  };
}

/* ------------------------------------------------------------------ */
/* Failures (setup.2, PLAN 11.3 f)                                     */
/* ------------------------------------------------------------------ */

export interface ClaudeFailureInput {
  /** why Claude Code could not start, from its start-up failure result */
  startupReason?: string;
  /** the `error` of an assistant message, such as `rate_limit` */
  assistantError?: string;
  /** the result's subtype, such as `error_max_turns` */
  subtype?: string;
  /** the result text, the end of stderr, or a thrown message */
  text?: string;
  /**
   * the result's `api_error`, the typed kind Claude Code 2.1.302 gives the
   * API error that ended the run, such as `max_output_tokens`
   */
  apiError?: string;
  /** why the model's last reply stopped, such as `max_tokens` (files.10) */
  stopReason?: string;
  /** the chapter's words and the review's effort, for a reply that ran out of room (files.10) */
  limitFacts?: Pick<ReplyLimitFacts, 'words' | 'effort'>;
}

export interface ClaudeFailure {
  code: ErrorCode;
  message: string;
  /** Claude Code's own words, kept whenever the message is the app's */
  detail?: string;
}

export const LOGIN_EXPIRED_MESSAGE = `Your Claude sign-in has ended; this happens from time to time, and nothing in ${APP_NAME} is lost. Open Setup and sign in again.`;
export const OUTDATED_MESSAGE =
  'Your Claude Code is too old for this. Run "claude update" in a terminal, then try again.';
const RATE_LIMIT_MESSAGE = 'Claude is rate limited right now. Try again shortly.';
const BILLING_MESSAGE = 'Your Claude account cannot run this request.';
const API_KEY_REFUSED_MESSAGE =
  'An ANTHROPIC_API_KEY is in use and was refused. Remove it from your environment to use your Claude plan instead, or replace it with a working key.';

const STARTUP_REASONS: Readonly<Record<string, [ErrorCode, string]>> = {
  cli_version_too_old: ['claude-outdated', OUTDATED_MESSAGE],
  org_verify_failed: ['claude-login-expired', LOGIN_EXPIRED_MESSAGE],
  gateway_signin_required: ['claude-login-expired', LOGIN_EXPIRED_MESSAGE],
  org_pin_api_key_conflict: ['claude-billing', API_KEY_REFUSED_MESSAGE],
  shell_tool_missing: [
    'claude-failed',
    'Claude Code could not find PowerShell or Git Bash, which it needs in order to start. Reinstall Claude Code, then try again.'
  ]
};

/** Every assistant error the app words itself; others fall through to the text. */
const ASSISTANT_ERRORS: Readonly<Record<string, [ErrorCode, string]>> = {
  authentication_failed: ['claude-not-signed-in', NOT_SIGNED_IN_MESSAGE],
  oauth_org_not_allowed: ['claude-not-signed-in', NOT_SIGNED_IN_MESSAGE],
  cloud_credential_error: ['claude-not-signed-in', NOT_SIGNED_IN_MESSAGE],
  rate_limit: ['claude-rate-limit', RATE_LIMIT_MESSAGE],
  overloaded: ['claude-rate-limit', RATE_LIMIT_MESSAGE],
  billing_error: ['claude-billing', BILLING_MESSAGE],
  account_on_hold: ['claude-billing', BILLING_MESSAGE],
  verification_required: ['claude-billing', BILLING_MESSAGE],
  model_not_found: ['claude-failed', 'That model is not available on your plan. Pick another in Settings.'],
  // max_output_tokens is a reply that ran out of room, worded by `claudeReplyLimit` (files.10).
  server_error: ['claude-failed', 'Claude had a server error. Try again in a few minutes.']
};

/** Rules for Claude Code's prose, in order. Specific phrases only: "the author" is not about signing in. */
const TEXT_RULES: readonly [RegExp, ErrorCode, string][] = [
  [/not logged in|please run \/login/i, 'claude-not-signed-in', NOT_SIGNED_IN_MESSAGE],
  [
    /does not support this model|newer version (of claude code )?is required|is required to use this model/i,
    'claude-outdated',
    OUTDATED_MESSAGE
  ],
  [
    /invalid api key|organization (has been )?disabled|disabled organization/i,
    'claude-billing',
    API_KEY_REFUSED_MESSAGE
  ],
  [/credit balance|spend limit/i, 'claude-billing', BILLING_MESSAGE],
  [
    /not available (with|on) (the|your)\b.*\bplan/i,
    'claude-failed',
    'That model is not available on your plan. Pick another in Settings.'
  ],
  [/high load|overloaded|\b529\b|\b429\b/i, 'claude-rate-limit', RATE_LIMIT_MESSAGE]
];

const SUBTYPES: Readonly<Record<string, [ErrorCode, string]>> = {
  error_max_turns: ['claude-failed', 'Claude ran out of turns before producing a result.'],
  error_max_structured_output_retries: [
    'claude-invalid-output',
    'Claude could not produce output matching the schema after several tries.'
  ],
  error_max_budget_usd: ['claude-failed', 'The query hit its cost budget.']
};

const EXPIRED = /login expired|session expired|token (has )?expired|token revoked/i;

/*
 * A reply that ran out of room, in Claude Code 2.1.302's words (read from its
 * bundled code, C.77). A reply cut off at the output limit, once Claude Code's
 * own attempts to resume it are used up, ends the run with an assistant
 * message whose `error` and `api_error` are `max_output_tokens` and whose text,
 * which the result repeats, reads "API Error: Claude's response exceeded the
 * 32000 output token maximum. ..."; a full context window comes with the same
 * error and "API Error: The model has reached its context window limit.";
 * a chapter too long to send at all is "Prompt is too long".
 */
const OUTPUT_MAXIMUM = /exceeded the (\d+) output token maximum/i;
const CONTEXT_WINDOW = /reached its context window limit/i;
const PROMPT_TOO_LONG = /prompt is too long|input is too long for requested model/i;

/**
 * Whether a failed run ran out of room, and which room, from what Claude Code
 * said outright: its text first, which tells a full context window from an
 * output limit that share one error, then the error itself. A reply that
 * merely stopped at `max_tokens` is weaker evidence and is read later, by
 * `classifyClaudeFailure`. Null when none of them says so.
 */
export function claudeReplyLimit(
  input: ClaudeFailureInput
): { limit: ReplyLimit; maxTokens?: number } | null {
  const text = input.text ?? '';
  if (PROMPT_TOO_LONG.test(text)) return { limit: 'input' };
  if (CONTEXT_WINDOW.test(text) || input.stopReason === 'model_context_window_exceeded') {
    return { limit: 'context' };
  }
  const maximum = OUTPUT_MAXIMUM.exec(text);
  if (maximum) return { limit: 'output', maxTokens: Number(maximum[1]) };
  if (input.assistantError === 'max_output_tokens' || input.apiError === 'max_output_tokens') {
    return { limit: 'output' };
  }
  return null;
}

/**
 * What went wrong with a Claude run, first match (PLAN 11.3 f): the start-up
 * reason, a usage limit, an expired sign-in, a reply that ran out of room
 * (`claudeReplyLimit`), the assistant error, the text, a last reply that
 * stopped at the output limit, the subtype, else a plain failure. A refusal
 * is the caller's to handle first. Claude Code's own words stay in `detail`
 * whenever the message is the app's.
 */
export function classifyClaudeFailure(input: ClaudeFailureInput): ClaudeFailure {
  const text = input.text?.trim() ?? '';
  const ours = (code: ErrorCode, message: string): ClaudeFailure => ({
    code,
    message,
    ...(text && text !== message ? { detail: text } : {})
  });
  const outOfRoom = (limit: ReplyLimit, maxTokens?: number): ClaudeFailure =>
    ours(
      'claude-failed',
      replyLimitMessage(limit, { ...input.limitFacts, who: 'Claude', ...(maxTokens ? { maxTokens } : {}) })
    );

  const startup = input.startupReason ? STARTUP_REASONS[input.startupReason] : undefined;
  if (startup) return ours(...startup);
  if (text && isUsageLimit(text)) return { code: 'claude-usage-limit', message: text };
  if (EXPIRED.test(text)) return ours('claude-login-expired', LOGIN_EXPIRED_MESSAGE);
  const limit = claudeReplyLimit(input);
  if (limit) return outOfRoom(limit.limit, limit.maxTokens);
  const assistant = input.assistantError ? ASSISTANT_ERRORS[input.assistantError] : undefined;
  if (assistant) return ours(...assistant);
  for (const [pattern, code, message] of TEXT_RULES) {
    if (pattern.test(text)) return ours(code, message);
  }
  // A run that ran out of turns or schema retries after a reply cut off at the
  // limit failed because of the limit (files.10).
  if (input.stopReason === 'max_tokens') return outOfRoom('output');
  const subtype = input.subtype ? SUBTYPES[input.subtype] : undefined;
  if (subtype) return ours(...subtype);
  if (input.assistantError) return ours('claude-failed', `Claude reported an error: ${input.assistantError}`);
  if (text)
    return {
      code: 'claude-failed',
      message: `Claude reported: ${text.split('\n')[0]}`,
      ...(text.includes('\n') ? { detail: text } : {})
    };
  return { code: 'claude-failed', message: 'Claude could not finish the review.' };
}
