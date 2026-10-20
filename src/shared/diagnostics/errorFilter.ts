/**
 * Which unexpected errors reach the log, and how many (hardening.4, PLAN 7.7
 * and 11.3 m). An error thrown in a loop, or on every frame, would otherwise
 * fill the log in seconds and push out everything that came before it, and
 * the page's own lines cross to main as requests (`log:renderer`).
 *
 * - `createErrorFilter` drops Chromium's "ResizeObserver loop" notice, which
 *   is not an error of the app's (the browser reports layout it put off to
 *   the next frame), and repeats: the same error again within `repeatMs` of
 *   the last time it was let through.
 * - `createRateCap` lets at most `limit` lines through in any `windowMs`.
 *
 * Both read the time from `now`, so tests drive them without timers. Pure and
 * dependency-free (CLAUDE.md rule 4).
 */

import type { FieldValue } from './redact';

/** How long the same error is dropped after it was last let through. */
export const REPEAT_MS = 60_000;

/** How many signatures the filter remembers before it forgets the oldest. */
const MAX_REMEMBERED = 200;

/**
 * Chromium's notice that a ResizeObserver callback changed layout it then
 * delivered a frame late ("ResizeObserver loop completed with undelivered
 * notifications.", or "ResizeObserver loop limit exceeded" in older builds).
 * It comes as a window error with no error object, and is harmless.
 */
const RESIZE_OBSERVER_LOOP = /ResizeObserver loop/;

/** What makes two errors the same one: where they came from and what they say. */
export function errorSignature(kind: string, fields: Readonly<Record<string, FieldValue>>): string {
  const frames = typeof fields['frames'] === 'string' ? fields['frames'] : '';
  const firstFrame = frames.split(' | ')[0] ?? '';
  return [kind, fields['name'], fields['code'], fields['message'], fields['error'], firstFrame]
    .map((part) => (part === undefined || part === null ? '' : String(part)))
    .join('\u0000');
}

/** True for Chromium's ResizeObserver notice, whatever field carries its words. */
export function isResizeObserverLoop(fields: Readonly<Record<string, FieldValue>>): boolean {
  return [fields['message'], fields['error']].some(
    (text) => typeof text === 'string' && RESIZE_OBSERVER_LOOP.test(text)
  );
}

export interface ErrorFilterOptions {
  now?: () => number;
  repeatMs?: number;
}

export interface ErrorFilter {
  /** true when this error should be reported; false for the ResizeObserver notice and repeats */
  accept(kind: string, fields: Readonly<Record<string, FieldValue>>): boolean;
}

export function createErrorFilter(options: ErrorFilterOptions = {}): ErrorFilter {
  const now = options.now ?? ((): number => Date.now());
  const repeatMs = options.repeatMs ?? REPEAT_MS;
  /** each signature let through, with when it last was */
  const seen = new Map<string, number>();

  function forgetOld(at: number): void {
    for (const [signature, when] of seen) {
      if (at - when >= repeatMs) seen.delete(signature);
    }
    // Still full of recent ones: the oldest go first (a Map keeps its order).
    while (seen.size >= MAX_REMEMBERED) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  }

  return {
    accept(kind, fields) {
      if (isResizeObserverLoop(fields)) return false;
      const at = now();
      const signature = errorSignature(kind, fields);
      const last = seen.get(signature);
      if (last !== undefined && at - last < repeatMs) return false;
      seen.delete(signature);
      if (seen.size >= MAX_REMEMBERED) forgetOld(at);
      seen.set(signature, at);
      return true;
    }
  };
}

export interface RateCapOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateCap {
  /**
   * `pass` when a line may go through, `drop` when it may not, and
   * `first-drop` for the first one dropped since a line last went through,
   * so the caller can say once that lines are being dropped.
   */
  take(): 'pass' | 'drop' | 'first-drop';
}

/** At most `limit` in any `windowMs`: a sliding window over the times let through. */
export function createRateCap(options: RateCapOptions): RateCap {
  const now = options.now ?? ((): number => Date.now());
  const passed: number[] = [];
  let dropping = false;
  return {
    take() {
      const at = now();
      while (passed.length > 0 && at - (passed[0] ?? at) >= options.windowMs) passed.shift();
      if (passed.length < options.limit) {
        passed.push(at);
        dropping = false;
        return 'pass';
      }
      if (dropping) return 'drop';
      dropping = true;
      return 'first-drop';
    }
  };
}
