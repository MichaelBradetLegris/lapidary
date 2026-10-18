/**
 * Claude's usage in words (setup.9, PLAN 5.1, section 7 and C.64).
 *
 * Before each result Claude Code sends a `rate_limit_event`: which of the
 * plan's limits is closest, how much of it is used, when it resets, and
 * whether extra usage is paying (`RateLimitInfo`). The status bar says it in a
 * few words only when it matters: from 80% of a limit, once a limit is
 * reached, and while extra usage, which may be billed, is in use. Claude
 * Code's own warning comes much earlier in a week (C.64), and its status and
 * type names, "allowed_warning (seven_day)", were what the status bar showed
 * until now.
 *
 * Pure (CLAUDE.md rule 4): the time is passed in, and times are the
 * computer's local time on the 24-hour clock, as "Decisions kept 14:02" is.
 */

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
  ['overage', 'extra usage limit']
]);

/** "5-hour limit", "weekly Opus limit"; "usage limit" for a kind not given or not known here. */
export function limitName(kind: string | undefined): string {
  return (kind === undefined ? undefined : LIMIT_NAMES.get(kind)) ?? 'usage limit';
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
 * minutes", "in 2 hours and 10 minutes", "in 3 days and 1 hour". Counted
 * down to the whole minute, so it never promises a reset sooner than it is.
 */
export function untilPhrase(ms: number): string {
  const minutes = Math.floor(ms / MINUTE);
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

/** The share used as a whole percent, at most 100, or null when Claude Code did not say. */
function percentUsed(utilization: number | undefined): number | null {
  if (utilization === undefined || !Number.isFinite(utilization) || utilization < 0) return null;
  return Math.min(100, Math.round(utilization * 100));
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
export function describeRateLimit(info: RateLimitInfo | null | undefined, now: Date): string | null {
  if (!info || expired(info, now)) return null;
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
function owned(kind: string | undefined): string {
  return kind === 'overage' ? `your ${limitName(kind)}` : `your Claude plan's ${limitName(kind)}`;
}

/**
 * The notice's tooltip, in full sentences, with how long until the reset,
 * or null when the status bar shows no notice:
 * "85% of your Claude plan's 5-hour limit is used. It resets at 15:45, in
 * 2 hours and 10 minutes."
 */
export function rateLimitTitle(info: RateLimitInfo | null | undefined, now: Date): string | null {
  if (!info || describeRateLimit(info, now) === null) return null;
  const reset = resetOf(info);
  const when = reset
    ? ` ${resetTimeInWords(reset, now)}, ${untilPhrase(reset.getTime() - now.getTime())}`
    : '';
  if (info.usingOverage === true) {
    // The limit that ran out is the plan's; "overage" names extra usage itself.
    const plan = info.kind === 'overage' ? undefined : info.kind;
    return `${capitalise(owned(plan))} is used up, so Claude Code is using extra usage, which may be billed.${
      reset ? ` The limit resets${when}.` : ''
    }`;
  }
  if (info.status === 'rejected') {
    return `${capitalise(owned(info.kind))} is used up, so reviews with Claude stop until it resets${when}.`;
  }
  return `${percentUsed(info.utilization) ?? 0}% of ${owned(info.kind)} is used.${reset ? ` It resets${when}.` : ''}`;
}

/** Advice for a limit that leaves other models free. */
export const OTHER_MODELS_ADVICE: Readonly<Record<'seven_day_opus' | 'seven_day_sonnet', string>> = {
  seven_day_opus:
    'Sonnet and Haiku do not count against the weekly Opus limit: choose one under Model in Review with AI to go on now, or wait until the limit resets.',
  seven_day_sonnet:
    'Haiku and Opus do not count against the weekly Sonnet limit: choose one under Model in Review with AI to go on now, or wait until the limit resets.'
};

/** Advice for a limit every model shares, or one not named. */
export const WAIT_ADVICE =
  'Wait until the limit resets, then try again. Sonnet and Haiku use your limits more slowly than Opus models (including Default), so choosing one under Model in Review with AI makes them last longer.';

/**
 * What to do about a usage limit that stopped a review: switch model when the
 * limit that was reached holds only one model, else wait, with Sonnet and
 * Haiku to make the limits last (setup.9). Read from the last notice, which
 * names the limit when it says `rejected`.
 */
export function usageLimitAdvice(info: RateLimitInfo | null | undefined): string {
  if (info?.status === 'rejected' && info.usingOverage !== true) {
    if (info.kind === 'seven_day_opus' || info.kind === 'seven_day_sonnet') {
      return OTHER_MODELS_ADVICE[info.kind];
    }
  }
  return WAIT_ADVICE;
}

/**
 * Whether a usage-limit failure is one of the plan's limits, which reset on
 * their own: the last notice says a limit was reached, or Claude Code's words
 * say so ("You've hit your limit · resets 3pm"). Not one of the other
 * usage-limit messages, such as credits run out or a seat without usage,
 * which waiting does not mend.
 */
function isPlanLimit(message: string, info: RateLimitInfo | null | undefined): boolean {
  if (info?.status === 'rejected' && info.usingOverage !== true && info.kind !== 'overage') return true;
  return /^You've (hit|reached) your\b/.test(message);
}

/**
 * The card a review that stopped at a usage limit puts up: Claude Code's own
 * words, which say which limit and when it resets, then what to do
 * (`usageLimitAdvice`). Claude Code's words alone for a limit that waiting
 * does not mend.
 */
export function usageLimitCard(message: string, info: RateLimitInfo | null | undefined): string {
  const said = message.trim();
  if (!isPlanLimit(said, info)) return said;
  if (said === '') return usageLimitAdvice(info);
  return `${said}${/[.!?]$/.test(said) ? '' : '.'} ${usageLimitAdvice(info)}`;
}
