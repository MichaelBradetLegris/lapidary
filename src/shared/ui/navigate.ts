/**
 * Where j, k and their Shift forms move the focus (PLAN 11.7, `small.9`).
 *
 * They start where the author is reading. When nothing is focused, or the
 * focused change is off screen, they start from the paragraphs on screen: j
 * goes to the first change at or below the top of the screen, k to the last at
 * or above its foot. Otherwise they step from the focused change, as they always
 * have, stopping at either end. Until `small.9` the first j after scrolling
 * went back to the old focus, or to paragraph 1.
 *
 * Shift+J and Shift+K go to the next and previous pending change, pass over
 * decided ones, and wrap round. Letters rather than [ and ], which need AltGr
 * on a Canadian French keyboard and never reach the page's key handler.
 *
 * The keys and the suggestions list sort with one comparator, `compareHunks`:
 * start, then end, then id, the order the page draws the changes in. They used
 * to break ties three different ways. Pure (CLAUDE.md rule 4).
 */

import type { Hunk } from '../types';

/** By start, then end, then id: the order the changes are drawn and listed in. */
export function compareHunks(
  a: Pick<Hunk, 'start' | 'end' | 'id'>,
  b: Pick<Hunk, 'start' | 'end' | 'id'>
): number {
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The base-text offsets of the paragraphs on screen, first to last. */
export interface ReadingRange {
  start: number;
  end: number;
}

export interface StepOptions {
  /** Shift+J and Shift+K: pending changes only, wrapping round */
  pendingOnly?: boolean;
  /** what is on screen; null or absent when it is not known, and the keys step as before */
  view?: ReadingRange | null;
}

/**
 * The id of the change the focus moves to, from `hunks` (the changes the
 * page shows: anchored, in a category the chips leave visible), or null when
 * there is none to go to.
 */
export function stepFocus(
  hunks: readonly Hunk[],
  focusedId: string | null,
  delta: 1 | -1,
  { pendingOnly = false, view = null }: StepOptions = {}
): string | null {
  const list = hunks.filter((h) => h.anchor !== 'stale').sort(compareHunks);
  if (list.length === 0) return null;
  const onScreen = (h: Hunk): boolean => view === null || (h.start <= view.end && h.end >= view.start);
  const current = list.findIndex((h) => h.id === focusedId);
  const here = current >= 0 && onScreen(list[current] as Hunk) ? current : -1;
  const below = (h: Hunk): boolean => view !== null && h.end >= view.start;
  const above = (h: Hunk): boolean => view !== null && h.start <= view.end;

  if (!pendingOnly) {
    if (here >= 0) return list[Math.max(0, Math.min(list.length - 1, here + delta))]?.id ?? null;
    if (view === null) return (delta > 0 ? list[0] : list[list.length - 1])?.id ?? null;
    const target =
      delta > 0 ? (list.find(below) ?? list[list.length - 1]) : (list.findLast(above) ?? list[0]);
    return target?.id ?? null;
  }

  const pending = list.filter((h) => h.status === 'pending');
  if (pending.length === 0) return null;
  const first = pending[0];
  const last = pending[pending.length - 1];
  if (here >= 0) {
    const target =
      delta > 0
        ? list.slice(here + 1).find((h) => h.status === 'pending')
        : list.slice(0, here).findLast((h) => h.status === 'pending');
    return (target ?? (delta > 0 ? first : last))?.id ?? null;
  }
  if (view === null) return (delta > 0 ? first : last)?.id ?? null;
  const target = delta > 0 ? (pending.find(below) ?? first) : (pending.findLast(above) ?? last);
  return target?.id ?? null;
}

/** What the key handler reads of the element a key went to, to tell a field from the rest. */
export interface KeyField {
  tagName: string;
  /** an input's type, which the DOM gives in lower case */
  type?: string;
  isContentEditable: boolean;
}

/**
 * Whether a key pressed in `target` is typing, which the review keys leave
 * to it: a text field, a text area, a select or editable text. A checkbox is
 * not (`polish.12` review): it takes Space alone, and no review key is Space,
 * so j, k, the arrows, a, d, u, e and n act on the suggestions while one has
 * the focus, as on a button. The rule came with Show states, a box that kept
 * the focus once clicked and so held the review keys until the author clicked
 * somewhere else; the box went in `polish.17`, and the rule stays for the
 * comments' Resolve box reached with Tab. A radio button is still typing,
 * since its group takes the arrows.
 */
export function isTypingField(target: KeyField | null): boolean {
  if (target === null) return false;
  if (target.tagName === 'INPUT') return target.type !== 'checkbox';
  return target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
}
