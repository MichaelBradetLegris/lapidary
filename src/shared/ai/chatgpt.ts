/**
 * The pure half of a ChatGPT review (codex.3, PLAN 5.8): the model list a
 * ChatGPT sign-in allows and its default, and the plan's limits as the
 * answers to a review carry them. Main asks OpenAI (src/main/providers/
 * chatgpt.ts); this reads what came back. Pure TypeScript and free of zod,
 * so the window may import it too (CLAUDE.md rule 4).
 */

import type { ModelInfo, RateLimitInfo } from '../ipc';
import { NOT_DEFAULT_MODEL } from './openai';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

/** One model of the list OpenAI's models endpoint gives a ChatGPT sign-in. */
export interface ChatGptModel {
  /** what a request sends as `model` */
  slug: string;
  /** what the list shows */
  displayName: string;
}

/**
 * The models a ChatGPT sign-in may use, from `GET /v1/models` with its
 * token, in the order OpenAI gives them. OpenAI's page on models and
 * inference (Appendix A, read 2026-10-24) gives a `models` array whose
 * entries hold `slug`, `display_name` and `visibility`, and says to show
 * those whose visibility is `list`; any other entry, or one without a slug,
 * is left out. An answer in the shape the endpoint gives an API key, a `data`
 * array of `id`s, is read too, each id as its own name, should the route ever
 * answer that way. Null when the answer holds neither array.
 */
export function readChatGptModels(json: unknown): ChatGptModel[] | null {
  if (!isRecord(json)) return null;
  const out: ChatGptModel[] = [];
  const add = (slug: string | null, displayName: string | null): void => {
    if (slug && !out.some((model) => model.slug === slug))
      out.push({ slug, displayName: displayName ?? slug });
  };
  const models = json['models'];
  if (Array.isArray(models)) {
    for (const entry of models) {
      if (isRecord(entry) && entry['visibility'] === 'list') {
        add(text(entry['slug']), text(entry['display_name']));
      }
    }
    return out;
  }
  const data = json['data'];
  if (Array.isArray(data)) {
    for (const entry of data) {
      if (isRecord(entry)) add(text(entry['id']), null);
    }
    return out;
  }
  return null;
}

/**
 * The model a review uses when the author has chosen none: the first the
 * list gives that `NOT_DEFAULT_MODEL` does not name (a -pro, -codex,
 * -deep-research or -chat model, hardening.10), else the first; null for an
 * empty list. The list's own order is OpenAI's, so it is kept rather than
 * sorted by name.
 */
export function defaultChatGptModel(models: readonly ChatGptModel[]): string | null {
  return (models.find((model) => !NOT_DEFAULT_MODEL.test(model.slug)) ?? models[0])?.slug ?? null;
}

/** The list as the review dialog shows it: each model by its name, the default marked "(default)". */
export function chatGptModelOptions(models: readonly ChatGptModel[]): ModelInfo[] {
  const fallback = defaultChatGptModel(models);
  return models.map((model) => ({
    value: model.slug,
    label: model.slug === fallback ? `${model.displayName} (default)` : model.displayName,
    ...(model.slug === fallback ? { isDefault: true } : {}),
    ...(model.displayName === model.slug ? {} : { description: model.slug })
  }));
}

/** The model a review sends: the author's choice, else the list's default, or null when the list is empty. */
export function chatGptModelToSend(requested: string, models: readonly ChatGptModel[]): string | null {
  const chosen = requested.trim();
  return chosen.length > 0 ? chosen : defaultChatGptModel(models);
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * The headers a ChatGPT plan's two limits come in: the share of each used,
 * its window in minutes and when it resets, as Codex reads them from its
 * answers (the names compiled into Codex CLI 0.149.1 on this machine, read
 * 2026-10-24; the `-reset-after-seconds` form is an older Codex's). OpenAI's
 * pages for this sign-in document no such header, so whether its answers
 * carry them is the author's real review's to say (C.114): without them a
 * review shows no notice until a limit is reached.
 */
export const CHATGPT_LIMIT_HEADERS = {
  primary: {
    used: 'x-codex-primary-used-percent',
    window: 'x-codex-primary-window-minutes',
    resetAt: 'x-codex-primary-reset-at',
    resetAfter: 'x-codex-primary-reset-after-seconds'
  },
  secondary: {
    used: 'x-codex-secondary-used-percent',
    window: 'x-codex-secondary-window-minutes',
    resetAt: 'x-codex-secondary-reset-at',
    resetAfter: 'x-codex-secondary-reset-after-seconds'
  }
} as const;

type LimitHeaderNames = (typeof CHATGPT_LIMIT_HEADERS)['primary' | 'secondary'];

/** A header's number, or null when it is missing or not a finite number. */
function headerNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * The kind a limit's window makes it, as `limitName` (src/shared/ui/usage.ts)
 * names it: 300 minutes is the 5-hour limit and 10,080 the weekly one, as
 * Claude's are named; 60 the hourly, 1,440 the daily, and any other whole
 * number of days or hours `<n>_day` or `<n>_hour`. Any other window has no
 * kind, and is named "usage limit".
 */
export function windowKind(minutes: number): string | undefined {
  if (!Number.isInteger(minutes) || minutes <= 0) return undefined;
  if (minutes === 60) return 'hourly';
  if (minutes === 300) return 'five_hour';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'seven_day';
  if (minutes % 1440 === 0) return `${minutes / 1440}_day`;
  if (minutes % 60 === 0) return `${minutes / 60}_hour`;
  return undefined;
}

interface LimitWindow {
  usedPercent: number;
  kind?: string;
  resetsAt?: Date;
}

function readWindow(
  get: (name: string) => string | null | undefined,
  names: LimitHeaderNames,
  now: Date
): LimitWindow | null {
  const used = headerNumber(get(names.used));
  if (used === null || used < 0) return null;
  const minutes = headerNumber(get(names.window));
  const kind = minutes === null ? undefined : windowKind(minutes);
  const at = headerNumber(get(names.resetAt));
  const after = headerNumber(get(names.resetAfter));
  const resetsAt =
    at !== null && at > 0
      ? new Date(at * 1000)
      : after !== null && after >= 0
        ? new Date(now.getTime() + after * 1000)
        : undefined;
  return {
    usedPercent: used,
    ...(kind ? { kind } : {}),
    ...(resetsAt && !Number.isNaN(resetsAt.getTime()) ? { resetsAt } : {})
  };
}

/**
 * A ChatGPT plan's limits from one answer's headers, as the notice the status
 * bar words (`describeRateLimit`, setup.9's words): the limit that matters
 * most, which is a limit reached, the one that resets last when both are,
 * since no review runs until both have; else the one most used. A share of
 * 100% or more is `rejected`; the share itself is `utilization`, as Claude
 * Code's is. Null when the headers give neither limit.
 */
export function readChatGptLimits(
  get: (name: string) => string | null | undefined,
  now: Date
): RateLimitInfo | null {
  const windows = [
    readWindow(get, CHATGPT_LIMIT_HEADERS.primary, now),
    readWindow(get, CHATGPT_LIMIT_HEADERS.secondary, now)
  ].filter((window): window is LimitWindow => window !== null);
  if (windows.length === 0) return null;
  const reached = windows.filter((window) => window.usedPercent >= 100);
  const pick =
    reached.length > 0
      ? reached.reduce((a, b) => ((b.resetsAt?.getTime() ?? 0) > (a.resetsAt?.getTime() ?? 0) ? b : a))
      : windows.reduce((a, b) => (b.usedPercent > a.usedPercent ? b : a));
  return {
    provider: 'chatgpt',
    status: pick.usedPercent >= 100 ? 'rejected' : 'allowed',
    ...(pick.kind ? { kind: pick.kind } : {}),
    utilization: pick.usedPercent / 100,
    ...(pick.resetsAt ? { resetsAt: pick.resetsAt.toISOString() } : {})
  };
}

/**
 * The notice for a review that reached a ChatGPT usage limit: the limits the
 * refusal's headers give, as `rejected` when one of them is, or a limit
 * reached with no name and no reset, since OpenAI's page warns against
 * reading a reset time, or the whole plan as used up, from the code alone.
 */
export function usageLimitNotice(fromHeaders: RateLimitInfo | null): RateLimitInfo {
  return fromHeaders?.status === 'rejected' ? fromHeaders : { provider: 'chatgpt', status: 'rejected' };
}

/**
 * The notice after a ChatGPT review went through with no limits in its
 * headers: one that says nothing (`describeRateLimit` words it as nothing),
 * so a "limit reached" from an earlier review does not stay in the status
 * bar once a review has gone through.
 */
export const CHATGPT_LIMITS_UNKNOWN: Readonly<RateLimitInfo> = Object.freeze({
  provider: 'chatgpt',
  status: 'allowed'
});
