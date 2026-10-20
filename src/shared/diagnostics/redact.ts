/**
 * What may reach the log file and the diagnostics text (PLAN 11.3 m).
 *
 * The log is something the author might paste into a message or a GitHub issue,
 * so it holds only short scalar facts about what happened, never content. These
 * helpers enforce that at the boundary:
 *
 * - `scrub` removes API key shapes, Bearer tokens, email addresses and the
 *   user's home directory from any string;
 * - `formatFields` keeps only scalar values, each scrubbed and cut short;
 * - `loggableErrorFields` is the one policy for errors. It drops the parts of an
 *   error that can carry content: a model's reply quoted in a parse failure, the
 *   input V8 quotes in a SyntaxError, the `detail` of an app error.
 *
 * Pure and dependency-free (CLAUDE.md rule 4), so it is tested directly.
 */

/** Longest a single logged string may be. */
export const MAX_FIELD_CHARS = 300;

/** How many `at ...` lines of a stack are kept. */
export const MAX_FRAMES = 8;

export interface ScrubContext {
  /** the user's home directory, replaced by `~` wherever it appears */
  home?: string | null;
}

export type FieldValue = string | number | boolean | null;

const KEY_SHAPE = /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The home directory in every spelling a path turns up in: back or forward
 * slashes, doubled (JSON) backslashes, percent-encoded separators and colon, and
 * a file:/// URL. Case-insensitive, because Windows paths are.
 */
function homePattern(home: string): RegExp | null {
  const parts = home.split(/[\\/]+/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const sep = '(?:\\\\{1,2}|/|%5[cC]|%2[fF])';
  const encoded = parts.map((part) => {
    const drive = /^([A-Za-z]):$/.exec(part);
    if (drive) return `${escapeRegExp(drive[1] ?? '')}(?::|%3[aA])`;
    return part.split(' ').map(escapeRegExp).join('(?: |%20)');
  });
  const leading = /^[\\/]/.test(home) ? sep : '';
  return new RegExp(`${leading}${encoded.join(sep)}(?=$|[\\\\/%"'\\s:;,)\\]}>])`, 'gi');
}

export function scrub(text: string, ctx: ScrubContext = {}): string {
  let out = text.replace(KEY_SHAPE, '[key]').replace(BEARER, 'Bearer [token]').replace(EMAIL, '[email]');
  const home = ctx.home ? homePattern(ctx.home) : null;
  if (home) out = out.replace(home, '~');
  return out;
}

export function truncate(text: string, max = MAX_FIELD_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function isScalar(value: unknown): value is FieldValue {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function formatValue(value: FieldValue, ctx: ScrubContext): string {
  if (typeof value !== 'string') return String(value);
  const clean = truncate(scrub(value, ctx));
  return /^[^\s="'\\]+$/.test(clean) ? clean : JSON.stringify(clean);
}

/**
 * `k=v` pairs for one log line. Only scalar values are kept: an object or array
 * could carry anything, including chapter text, so it is dropped whole rather
 * than inspected.
 */
export function formatFields(fields: Readonly<Record<string, unknown>>, ctx: ScrubContext = {}): string {
  return Object.entries(fields)
    .filter((entry): entry is [string, FieldValue] => /^[A-Za-z][\w.]*$/.test(entry[0]) && isScalar(entry[1]))
    .map(([key, value]) => `${key}=${formatValue(value, ctx)}`)
    .join(' ');
}

/** The `at ...` lines of a stack, scrubbed. The first line repeats the message, so it is never kept. */
export function stackFrames(stack: string | undefined, ctx: ScrubContext = {}, max = MAX_FRAMES): string[] {
  if (!stack) return [];
  return stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, max)
    .map((line) => truncate(scrub(line, ctx), 200));
}

/**
 * The part of a stack after the error's message. V8 starts a stack with
 * `<name>: <message>`, and a message that quotes text with a line break in
 * it, as JSON.parse's does, can carry a line starting with "at" that would
 * pass for a frame (hardening.3b): cut at the message, only frames are left.
 */
function afterMessage(stack: string, message: string): string {
  if (message === '') return stack;
  const at = stack.indexOf(message);
  return at < 0 ? stack : stack.slice(at + message.length);
}

/** App error codes whose message quotes the model's reply. */
function quotesModelOutput(code: string): boolean {
  return code.endsWith('-invalid-output') || code === 'claude-refusal';
}

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  stack?: unknown;
  code?: unknown;
  errno?: unknown;
  syscall?: unknown;
}

/**
 * Names an app error goes by: `AppFailure` in main, and `ApiError` in the
 * page, which carries main's code and message across (`log:renderer`,
 * hardening.4).
 */
const APP_ERROR_NAMES: ReadonlySet<string> = new Set(['AppFailure', 'ApiError']);

/**
 * The one policy for putting an error in the log:
 *
 * - an app error (`AppFailure`, or the page's `ApiError`, recognised by its
 *   string `code` and name) logs its code, plus its message unless that
 *   quotes model output; never `detail`;
 * - a SyntaxError logs its name and stack frames only, because V8 quotes the
 *   text it failed to parse in the message, and frames are read only from
 *   the stack after the message;
 * - an errno error logs its name, code, errno and syscall, never the path;
 * - anything else logs its name, message and frames.
 */
export function loggableErrorFields(err: unknown, ctx: ScrubContext = {}): Record<string, FieldValue> {
  if (typeof err !== 'object' || err === null) {
    return { error: truncate(scrub(String(err), ctx)) };
  }
  const e = err as ErrorLike;
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const message = typeof e.message === 'string' ? e.message : '';
  const frames = stackFrames(
    typeof e.stack === 'string' ? afterMessage(e.stack, message) : undefined,
    ctx
  ).join(' | ');

  if (APP_ERROR_NAMES.has(name) && typeof e.code === 'string') {
    return quotesModelOutput(e.code)
      ? { code: e.code }
      : { code: e.code, message: truncate(scrub(message, ctx)) };
  }
  if (name === 'SyntaxError') {
    return { name, frames };
  }
  if (typeof e.syscall === 'string' || typeof e.errno === 'number') {
    return {
      name,
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
      ...(typeof e.errno === 'number' ? { errno: e.errno } : {}),
      ...(typeof e.syscall === 'string' ? { syscall: e.syscall } : {})
    };
  }
  return { name, message: truncate(scrub(message, ctx)), frames };
}
