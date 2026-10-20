/**
 * What the page sends main about an error it did not expect (`log:renderer`,
 * hardening.4): the error's loggable fields, by the one policy for errors
 * (`loggableErrorFields`, PLAN 11.3 m), and for an error in drawing the page,
 * the names of the components it happened in. Main keeps only the fields it
 * knows (`RENDERER_LOG_FIELDS`) and scrubs them again as it writes them.
 *
 * Pure and dependency-free (CLAUDE.md rule 4).
 */

import { loggableErrorFields, truncate, type FieldValue } from './redact';

/** The fields main writes for a line from the page; anything else the page sends is dropped. */
export const RENDERER_LOG_FIELDS = [
  'name',
  'code',
  'message',
  'frames',
  'error',
  'errno',
  'syscall',
  'components'
] as const;

/** How many component names a render error carries. */
export const MAX_COMPONENTS = 6;

/**
 * The fields of an error the page did not expect. A window `error` event
 * carries no error object for some errors (Chromium's ResizeObserver notice,
 * a script from elsewhere), only its message, which then stands for it.
 */
export function pageErrorFields(error: unknown, message?: string): Record<string, FieldValue> {
  if ((error === null || error === undefined) && message)
    return { name: 'Error', message: truncate(message) };
  return loggableErrorFields(error);
}

/**
 * The components a render error happened in, innermost first, from React's
 * component stack (`ErrorInfo.componentStack`): only the names of the app's
 * own components, which start with a capital, never `div` or a file's
 * address, so `StatusBar < App < ErrorBoundary`.
 */
export function componentNames(stack: string | null | undefined, max = MAX_COMPONENTS): string {
  if (!stack) return '';
  const names: string[] = [];
  for (const line of stack.split('\n')) {
    // React 19 writes `at Name (address)`; earlier versions wrote `in Name`.
    const name = /^\s*(?:at|in)\s+([A-Z][\w$]*)(?=\s|$)/.exec(line)?.[1];
    if (name) names.push(name);
    if (names.length === max) break;
  }
  return names.join(' < ');
}
