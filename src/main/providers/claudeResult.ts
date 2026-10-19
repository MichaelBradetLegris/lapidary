import { classifyClaudeFailure, isUsageLimit as defaultIsUsageLimit } from '../../shared/ai/claudeStatus';
import type { RateLimitInfo } from '../../shared/ipc';
import { fail, type AppFailure } from '../errors';

/*
 * What a Claude Code result means for the review (setup.5, PLAN 11.3 f).
 *
 * A failed run arrives in two shapes: a `result` with an error subtype, and a
 * `result` whose subtype says `success` while `is_error` is true, which is how
 * Claude Code reports "Not logged in" (C.47). Both go through
 * `classifyClaudeFailure`, after a refusal, which always speaks for itself.
 * The usage notice that comes before the result is read here too (setup.9).
 * Electron-free and pure apart from building the error.
 */

/** The fields of a `result` message read here. */
export interface ResultMessage {
  subtype?: string;
  is_error?: unknown;
  result?: unknown;
  errors?: unknown;
  [key: string]: unknown;
}

/** What the run said before its result: a refusal, or an assistant message's error. */
export interface ResultContext {
  refusal?: string;
  assistantError?: string;
}

/**
 * Claude Code's start-up failure reasons. Version 2.1.266 does not send them
 * (the names come from the Agent SDK's types), and the field a later version
 * puts them in is not documented, so they are recognised anywhere in the
 * result.
 */
const STARTUP_REASONS = [
  'cli_version_too_old',
  'org_verify_failed',
  'gateway_signin_required',
  'org_pin_api_key_conflict',
  'shell_tool_missing'
] as const;

export function startupReasonOf(message: ResultMessage): string | undefined {
  const text = JSON.stringify(message);
  return STARTUP_REASONS.find((reason) => text.includes(reason));
}

function textOf(message: ResultMessage): string {
  if (typeof message.result === 'string' && message.result.trim() !== '') return message.result;
  return Array.isArray(message.errors) ? message.errors.map(String).join('\n') : '';
}

/**
 * The error a result stands for, or null when it is a usable success. A
 * success whose text is a usage-limit message is still a usage limit.
 */
export function resultToError(
  message: ResultMessage,
  context: ResultContext,
  isUsageLimit: (text: string) => boolean = defaultIsUsageLimit
): AppFailure | null {
  const text = textOf(message);
  const failed = message.subtype !== 'success' || message.is_error === true;
  if (!failed) return isUsageLimit(text) ? fail('claude-usage-limit', text) : null;
  if (context.refusal) return fail('claude-refusal', context.refusal);
  const startupReason = startupReasonOf(message);
  const failure = classifyClaudeFailure({
    ...(startupReason ? { startupReason } : {}),
    ...(context.assistantError ? { assistantError: context.assistantError } : {}),
    ...(message.subtype && message.subtype !== 'success' ? { subtype: message.subtype } : {}),
    text
  });
  return fail(failure.code, failure.message, failure.detail);
}

/**
 * The `rate_limit_info` of a `rate_limit_event` (setup.9). What Claude Code
 * sends is pinned by test/helpers/fakeClaude.ts; 2.1.302's schema, which the
 * Agent SDK's `SDKRateLimitInfo` documents:
 *
 * - `status`: `allowed`, `allowed_warning` or `rejected`;
 * - `resetsAt`: when the limit resets, in Unix seconds;
 * - `rateLimitType`: `five_hour`, `seven_day`, `seven_day_opus`,
 *   `seven_day_sonnet`, `seven_day_overage_included` or `overage`;
 * - `utilization`: the share of that limit used, a fraction (usually 0 to 1),
 *   sent only with `allowed_warning`, when Claude Code itself warns (C.64);
 * - `isUsingOverage`: the plan's limit is used up and extra usage is paying,
 *   set on a `rejected` notice only;
 * - and fields read nowhere here: `overageStatus`, `overageResetsAt`,
 *   `overageDisabledReason`, `surpassedThreshold`, `unifiedWindows` and more.
 *
 * Only these four and the reset are kept; a field of the wrong type is left
 * out rather than guessed, and a missing status reads as `unknown`.
 */
export function readRateLimit(value: unknown): RateLimitInfo {
  const info = (typeof value === 'object' && value !== null ? value : {}) as {
    status?: unknown;
    resetsAt?: unknown;
    rateLimitType?: unknown;
    utilization?: unknown;
    isUsingOverage?: unknown;
  };
  const status = typeof info.status === 'string' ? info.status : 'unknown';
  const resets =
    typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt)
      ? new Date(info.resetsAt * 1000).toISOString()
      : undefined;
  const utilization =
    typeof info.utilization === 'number' && Number.isFinite(info.utilization) && info.utilization >= 0
      ? info.utilization
      : undefined;
  return {
    status,
    ...(resets ? { resetsAt: resets } : {}),
    ...(typeof info.rateLimitType === 'string' && info.rateLimitType !== ''
      ? { kind: info.rateLimitType }
      : {}),
    ...(utilization === undefined ? {} : { utilization }),
    ...(typeof info.isUsingOverage === 'boolean' ? { usingOverage: info.isUsingOverage } : {})
  };
}

/**
 * A run that ended with no result at all: what it said on stderr decides,
 * else a plain "ended without a result".
 */
export function endedWithoutResult(
  context: ResultContext,
  stderr: string,
  malformedLines: number
): AppFailure {
  if (context.refusal) return fail('claude-refusal', context.refusal);
  const failure = classifyClaudeFailure({
    ...(context.assistantError ? { assistantError: context.assistantError } : {}),
    text: stderr
  });
  if (failure.code !== 'claude-failed' || context.assistantError) {
    return fail(failure.code, failure.message, failure.detail);
  }
  return fail(
    'claude-failed',
    `Claude ended without returning a result.${malformedLines > 0 ? ` (${malformedLines} unreadable lines)` : ''}`,
    stderr || undefined
  );
}
