/**
 * Claude's usage in words (setup.9, PLAN 5.1, section 7 and C.64), and since
 * codex.3 a ChatGPT plan's, in the same words: its notices come from the
 * answers to a ChatGPT review (`readChatGptLimits`, src/shared/ai/chatgpt.ts),
 * marked `provider: 'chatgpt'`, and name their limits by their windows.
 *
 * Before each result Claude Code sends a `rate_limit_event`: which of the
 * plan's limits is closest, when it resets, and whether extra usage is paying
 * (`RateLimitInfo`), with the share of that limit used only while Claude Code
 * itself warns (C.64). The status bar says it in a few words only when it
 * matters: from 80% of a limit, once a limit is reached, and while extra
 * usage, which may be billed, is in use. Claude Code's own warning comes much
 * earlier in a week (C.64), and its status and type names, "allowed_warning
 * (seven_day)", were what the status bar showed until now.
 *
 * Pure (CLAUDE.md rule 4): the time is passed in, and times are the
 * computer's local time on the 24-hour clock, as "Decisions kept 14:02" is.
 * The plan, where a function takes one, is Claude Code's `subscriptionType`.
 */

import { isProPlan } from '../ai/claudeModels';
import type { RateLimitInfo } from '../ipc';

/** From this share of a limit, as a whole percent, the status bar says how much is used. */
export const USAGE_NOTICE_FROM = 80;

/** The status bar while extra usage is paying, whatever the limit. */
export const USING_EXTRA_USAGE = 'Using extra usage (may be billed)';

const LIMIT_NAMES: ReadonlyMap<string, string> = new Map([
  ['five_hour', '5-hour limit'],
  ['seven_day', 'weekly limit'],
  ['seven_day_opus', 'weekly Opus limit'],
  ['seven_day_sonnet', 'weekly Sonnet limit'],
  // A weekly limit for one model, which Claude Code names after the model.
  ['seven_day_overage_included', 'weekly model limit'],
  ['overage', 'extra usage limit'],
  // A ChatGPT plan's limits, named by their windows (`windowKind`, codex.3).
  ['hourly', 'hourly limit'],
  ['daily', 'daily limit']
]);

/** A ChatGPT limit over another whole number of hours or days (`windowKind`): `<n>_hour`, `<n>_day`. */
const WINDOW_KIND = /^(\d{1,4})_(hour|day)$/;

/**
 * "5-hour limit", "weekly Opus limit", "3-hour limit"; "usage limit" for a
 * kind not given or not known here.
 */
export function limitName(kind: string | undefined): string {
  if (kind === undefined) return 'usage limit';
  const known = LIMIT_NAMES.get(kind);
  if (known) return known;
  const window = WINDOW_KIND.exec(kind);
  return window ? `${Number(window[1])}-${window[2]} limit` : 'usage limit';
}

/** Whose plan a notice is about, in the tooltip's words: Claude's, unless it is marked ChatGPT's (codex.3). */
function serviceOf(info: RateLimitInfo): 'Claude' | 'ChatGPT' {
  return info.provider === 'chatgpt' ? 'ChatGPT' : 'Claude';
}

/**
 * Whether Claude Code counts the weekly Sonnet limit as the account's weekly
 * limit: on a Pro or Enterprise plan it names `seven_day_sonnet` "weekly
 * limit" and says "You've hit your weekly limit", on any other plan, or none
 * known, "Sonnet limit" (2.1.302, C.64).
 */
function sonnetLimitIsWeekly(plan: string | undefined): boolean {
  return isProPlan(plan) || (plan !== undefined && /\benterprise\b/i.test(plan));
}

/** The notice as Claude Code means it on this plan: on Pro and Enterprise the weekly Sonnet limit is the weekly limit. */
function onPlan(info: RateLimitInfo, plan: string | undefined): RateLimitInfo {
  return info.kind === 'seven_day_sonnet' && sonnetLimitIsWeekly(plan)
    ? { ...info, kind: 'seven_day' }
    : info;
}

const capitalise = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const twoDigits = (n: number): string => String(n).padStart(2, '0');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The reset as a time, or null when it is not given or cannot be read. */
function resetOf(info: RateLimitInfo): Date | null {
  if (info.resetsAt === undefined) return null;
  const reset = new Date(info.resetsAt);
  return Number.isNaN(reset.getTime()) ? null : reset;
}

/** Calendar days from `now`'s date to `then`'s, in local time; a change of clocks in between does not count. */
function daysApart(now: Date, then: Date): number {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((to.getTime() - from.getTime()) / DAY);
}

function clock(date: Date): string {
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

/**
 * When a limit resets, for the status bar: "15:45" later today, "tomorrow
 * 09:00", "Sat 09:00" within the week and "25 Oct 09:00" after that, so a
 * weekly limit's reset is never mistaken for today's.
 */
export function resetTime(reset: Date, now: Date): string {
  const days = daysApart(now, reset);
  const time = clock(reset);
  if (days <= 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${WEEKDAYS[reset.getDay()]?.slice(0, 3) ?? ''} ${time}`;
  return `${reset.getDate()} ${MONTHS[reset.getMonth()]?.slice(0, 3) ?? ''} ${time}`;
}

/** The same in a sentence: "at 15:45", "tomorrow at 09:00", "on Saturday at 09:00", "on 25 October at 09:00". */
export function resetTimeInWords(reset: Date, now: Date): string {
  const days = daysApart(now, reset);
  const time = clock(reset);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `on ${WEEKDAYS[reset.getDay()] ?? ''} at ${time}`;
  return `on ${reset.getDate()} ${MONTHS[reset.getMonth()] ?? ''} at ${time}`;
}

const count = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * How long until then: "in less than a minute", "in 1 minute", "in 45
 * minutes", "in 2 hours and 10 minutes", "in 3 days and 1 hour". The minutes
 * are counted up, so the time left is never shorter than it is, and from a
 * day on it gives whole hours. `rateLimitTitle` counts to the minute its
 * clock time names, so the two agree (setup.9 review: counted down, the time
 * left was a minute short of the clock time for all but a second of each
 * minute, and an hour short past a day).
 */
export function untilPhrase(ms: number): string {
  const minutes = Math.ceil(ms / MINUTE);
  if (minutes < 1) return 'in less than a minute';
  if (minutes < 60) return `in ${count(minutes, 'minute')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return `in ${count(hours, 'hour')}${rest > 0 ? ` and ${count(rest, 'minute')}` : ''}`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return `in ${count(days, 'day')}${rest > 0 ? ` and ${count(rest, 'hour')}` : ''}`;
}

/**
 * The share used as a whole percent, at most 100, or null when Claude Code
 * did not say: to a tenth of a percent, then rounded down, as Claude Code
 * words its own warning ("You've used 85% of your session limit"), so the two
 * never differ and a limit not reached never reads as 100%.
 */
function percentUsed(utilization: number | undefined): number | null {
  if (utilization === undefined || !Number.isFinite(utilization) || utilization < 0) return null;
  return Math.floor(Math.min(Math.round(utilization * 1000) / 10, 100));
}

/** A notice whose reset has passed is out of date: the limit has started again. */
function expired(info: RateLimitInfo, now: Date): boolean {
  const reset = resetOf(info);
  return reset !== null && reset.getTime() <= now.getTime();
}

/**
 * The status bar's words for Claude's usage, or null when there is nothing
 * worth a place there, first match:
 *
 * - nothing once the reset has passed;
 * - "Using extra usage (may be billed)" while extra usage is paying;
 * - "5-hour limit reached, resets 15:45" once a limit is reached;
 * - "5-hour limit 85% used, resets 15:45" from 80% of it;
 * - else nothing, nor when Claude Code gave no share.
 *
 * Without a reset time the words end at the limit: "Weekly limit 92% used".
 */
export function describeRateLimit(
  given: RateLimitInfo | null | undefined,
  now: Date,
  plan?: string
): string | null {
  if (!given || expired(given, now)) return null;
  const info = onPlan(given, plan);
  if (info.usingOverage === true) return USING_EXTRA_USAGE;
  const reset = resetOf(info);
  const name = capitalise(limitName(info.kind));
  const resets = reset ? `, resets ${resetTime(reset, now)}` : '';
  if (info.status === 'rejected') return `${name} reached${resets}`;
  const percent = percentUsed(info.utilization);
  if (percent === null || percent < USAGE_NOTICE_FROM) return null;
  return `${name} ${percent}% used${resets}`;
}

/** Whose limit it is, in a sentence: the plan's, or for extra usage the account's own. */
function owned(kind: string | undefined, service: 'Claude' | 'ChatGPT' = 'Claude'): string {
  return kind === 'overage' ? `your ${limitName(kind)}` : `your ${service} plan's ${limitName(kind)}`;
}

/** What a reached limit stops, for a limit that holds one model only; every other holds Claude. */
const MODEL_HELD: ReadonlyMap<string, string> = new Map([
  ['seven_day_opus', 'Opus'],
  ['seven_day_sonnet', 'Sonnet'],
  ['seven_day_overage_included', 'that model']
]);

/** The minute a time's clock reading names, as a time: 15:45:30 is 15:45. */
const minuteOf = (time: Date): number => Math.floor(time.getTime() / MINUTE) * MINUTE;

/**
 * The notice's tooltip, in full sentences, with how long until the reset,
 * or null when the status bar shows no notice:
 * "85% of your Claude plan's 5-hour limit is used. It resets at 15:45, in
 * 2 hours and 10 minutes." The time left runs to the minute the clock time
 * names, so it is the difference between that clock time and the computer's.
 * A ChatGPT plan's notice says "your ChatGPT plan's" and "reviews with
 * ChatGPT" (codex.3).
 */
export function rateLimitTitle(
  given: RateLimitInfo | null | undefined,
  now: Date,
  plan?: string
): string | null {
  if (!given || describeRateLimit(given, now, plan) === null) return null;
  const info = onPlan(given, plan);
  const service = serviceOf(info);
  const reset = resetOf(info);
  const when = reset
    ? ` ${resetTimeInWords(reset, now)}, ${untilPhrase(minuteOf(reset) - now.getTime())}`
    : '';
  if (info.usingOverage === true) {
    // The limit that ran out is the plan's; "overage" names extra usage itself.
    const planKind = info.kind === 'overage' ? undefined : info.kind;
    return `${capitalise(owned(planKind, service))} is used up, so Claude Code is using extra usage, which may be billed.${
      reset ? ` The limit resets${when}.` : ''
    }`;
  }
  if (info.status === 'rejected') {
    if (service === 'ChatGPT' && info.kind === undefined) {
      // OpenAI's refusal alone names no limit, and the limit may be the one it sets for the app (codex.3).
      return `A ChatGPT usage limit has been reached, your plan's or one OpenAI sets for this app, so reviews with ChatGPT stop until it resets${when}.`;
    }
    const held = (service === 'Claude' ? MODEL_HELD.get(info.kind ?? '') : undefined) ?? service;
    return `${capitalise(owned(info.kind, service))} is used up, so reviews with ${held} stop until it resets${when}.`;
  }
  return `${percentUsed(info.utilization) ?? 0}% of ${owned(info.kind, service)} is used.${reset ? ` It resets${when}.` : ''}`;
}

type OneModelLimit = 'seven_day_opus' | 'seven_day_sonnet' | 'seven_day_overage_included';

/** Advice for a limit that leaves other models free. */
export const OTHER_MODELS_ADVICE: Readonly<Record<OneModelLimit, string>> = {
  seven_day_opus:
    'Sonnet and Haiku do not count against the weekly Opus limit: choose one under Model in Review with AI to go on now, or wait until the limit resets.',
  seven_day_sonnet:
    'Haiku and Opus do not count against the weekly Sonnet limit: choose one under Model in Review with AI to go on now, or wait until the limit resets.',
  seven_day_overage_included:
    'Other models do not count against this weekly model limit: choose another under Model in Review with AI to go on now, or wait until the limit resets.'
};

function isOneModelLimit(kind: string | undefined): kind is OneModelLimit {
  return kind === 'seven_day_opus' || kind === 'seven_day_sonnet' || kind === 'seven_day_overage_included';
}

/** Advice for a limit every model shares, or one not named. */
export const WAIT_ADVICE =
  'Wait until the limit resets, then try again. Sonnet and Haiku use your limits more slowly than Opus models (including Default), so choosing one under Model in Review with AI makes them last longer.';

/**
 * What to do about a plan limit that stopped a review: switch model when the
 * limit that was reached holds only one model, else wait, with Sonnet and
 * Haiku to make the limits last (setup.9). Read from the last notice, which
 * names the limit when it says `rejected`, on the plan given: on Pro and
 * Enterprise the weekly Sonnet limit is the weekly limit, which every model
 * shares.
 */
export function usageLimitAdvice(given: RateLimitInfo | null | undefined, plan?: string): string {
  const info = given ? onPlan(given, plan) : null;
  if (info?.status === 'rejected' && info.usingOverage !== true && isOneModelLimit(info.kind)) {
    return OTHER_MODELS_ADVICE[info.kind];
  }
  return WAIT_ADVICE;
}

/**
 * Claude Code's words for one of the plan's limits, as 2.1.302 puts them:
 * "You've hit your " and the name it gives the limit (session, weekly, Opus,
 * Sonnet or Fable limit), or "limit" alone when extra usage was refused as
 * well ("You've hit your limit · resets 3pm"). Its other messages that start
 * the same way name a budget, a spend limit or usage credits.
 */
const PLAN_LIMIT_WORDS =
  /^You've hit your (?:limit|session limit|weekly limit|Opus limit|Sonnet limit|Fable limit)\b/;

/** Claude Code's words that already say to switch model, as for a team's shared budget or usage credits. */
const SWITCH_MODEL_WORDS = /\bswitch (?:to another model|models)\b/i;

/**
 * Whether a usage-limit failure is one of the plan's limits, which reset on
 * their own, so that waiting, or another model, is the advice; one rule for
 * the review's card and Setup's (`failureSetupEvent`, setup.9 review). Not
 * when Claude Code's words already say to switch model, nor when the last
 * notice says extra usage was paying or was the limit reached; else when the
 * notice says a plan limit was reached, or Claude Code's words name one. A
 * usage limit of another kind (usage credits with no plan limit reached, a
 * spend limit, a team's shared budget, a seat without usage) keeps Claude
 * Code's words alone: they say which, and waiting for the plan's limits does
 * not lift it.
 */
export function isPlanLimit(message: string, info: RateLimitInfo | null | undefined): boolean {
  const said = message.trim();
  if (SWITCH_MODEL_WORDS.test(said)) return false;
  if (info?.usingOverage === true || info?.kind === 'overage') return false;
  if (info?.status === 'rejected') return true;
  return PLAN_LIMIT_WORDS.test(said);
}

/**
 * The card a review that stopped at a usage limit puts up: Claude Code's own
 * words, which say which limit and when it resets, then what to do
 * (`usageLimitAdvice`). Claude Code's words alone for a usage limit that is
 * not one of the plan's (`isPlanLimit`).
 */
export function usageLimitCard(
  message: string,
  info: RateLimitInfo | null | undefined,
  plan?: string
): string {
  const said = message.trim();
  if (!isPlanLimit(said, info)) return said;
  const advice = usageLimitAdvice(info, plan);
  if (said === '') return advice;
  return `${said}${/[.!?]$/.test(said) ? '' : '.'} ${advice}`;
}
