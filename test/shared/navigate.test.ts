import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Hunk, HunkStatus } from '../../src/shared/types';
import { compareHunks, stepFocus } from '../../src/shared/ui/navigate';
import { groupSuggestions } from '../../src/shared/ui/suggestions';

/* small.9 (PLAN 11.7): j and k start where the author is reading, Shift+J and
   Shift+K go to the next and previous pending change and wrap, and the keys and
   the list sort the same way. */

function h(id: string, start: number, status: HunkStatus = 'pending', end = start + 3): Hunk {
  return {
    id,
    start,
    end,
    baseSide: 'original',
    original: 'abc'.slice(0, end - start),
    replacement: 'x',
    paragraph: 0,
    source: 'claude',
    status,
    anchor: 'exact'
  };
}

// Ten changes, 100 characters apart; c and h are decided.
const HUNKS: Hunk[] = 'abcdefghij'
  .split('')
  .map((id, i) => h(id, i * 100, id === 'c' || id === 'h' ? 'accepted' : 'pending'));
const VIEW_MIDDLE = { start: 380, end: 620 }; // on screen: e (400), f (500), g (600)

describe('compareHunks', () => {
  it('sorts by start, then end, then id', () => {
    const list = [h('b', 10, 'pending', 10), h('a', 10, 'pending', 10), h('c', 10, 'pending', 12), h('d', 5)];
    expect([...list].sort(compareHunks).map((x) => x.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is the order of the suggestions list', () => {
    const list = [h('z', 10, 'pending', 10), h('y', 10, 'pending', 10), h('w', 10, 'pending', 12), h('x', 5)];
    expect(groupSuggestions(list).inline.map((x) => x.id)).toEqual(
      [...list].sort(compareHunks).map((x) => x.id)
    );
  });
});

describe('stepFocus: j and k', () => {
  it('steps from the focused change and stops at the ends, as before, when nothing says what is on screen', () => {
    expect(stepFocus(HUNKS, 'b', 1)).toBe('c');
    expect(stepFocus(HUNKS, 'b', -1)).toBe('a');
    expect(stepFocus(HUNKS, 'a', -1)).toBe('a');
    expect(stepFocus(HUNKS, 'j', 1)).toBe('j');
    expect(stepFocus(HUNKS, null, 1)).toBe('a');
    expect(stepFocus(HUNKS, null, -1)).toBe('j');
    expect(stepFocus([], null, 1)).toBeNull();
  });

  it('steps from the focused change while it is on screen', () => {
    expect(stepFocus(HUNKS, 'f', 1, { view: VIEW_MIDDLE })).toBe('g');
    expect(stepFocus(HUNKS, 'f', -1, { view: VIEW_MIDDLE })).toBe('e');
    expect(stepFocus(HUNKS, 'g', 1, { view: VIEW_MIDDLE })).toBe('h');
  });

  it('starts from the paragraphs on screen when nothing is focused, or the focus is off screen', () => {
    expect(stepFocus(HUNKS, null, 1, { view: VIEW_MIDDLE })).toBe('e');
    expect(stepFocus(HUNKS, null, -1, { view: VIEW_MIDDLE })).toBe('g');
    expect(stepFocus(HUNKS, 'a', 1, { view: VIEW_MIDDLE })).toBe('e');
    expect(stepFocus(HUNKS, 'j', -1, { view: VIEW_MIDDLE })).toBe('g');
  });

  it('takes the nearest change past the screen when none is on it', () => {
    expect(stepFocus(HUNKS, null, 1, { view: { start: 1000, end: 1200 } })).toBe('j');
    expect(stepFocus(HUNKS, null, -1, { view: { start: 0, end: 50 } })).toBe('a');
    expect(stepFocus(HUNKS, null, 1, { view: { start: 410, end: 480 } })).toBe('f');
    expect(stepFocus(HUNKS, null, -1, { view: { start: 410, end: 480 } })).toBe('e');
  });

  it('passes over stale changes', () => {
    const stale = { ...h('s', 450), anchor: 'stale' as const };
    expect(stepFocus([...HUNKS, stale], 'e', 1)).toBe('f');
  });
});

describe('stepFocus: Shift+J and Shift+K', () => {
  const next = (from: string | null, delta: 1 | -1, view: { start: number; end: number } | null = null) =>
    stepFocus(HUNKS, from, delta, { pendingOnly: true, view });

  it('goes to the next and previous pending change, passing over decided ones', () => {
    expect(next('b', 1)).toBe('d');
    expect(next('d', -1)).toBe('b');
    expect(next('g', 1)).toBe('i');
    expect(next('c', 1)).toBe('d');
  });

  it('wraps round at either end', () => {
    expect(next('j', 1)).toBe('a');
    expect(next('a', -1)).toBe('j');
  });

  it('starts from the top of the screen after a scroll, never from paragraph 1', () => {
    expect(next(null, 1, VIEW_MIDDLE)).toBe('e');
    expect(next('a', 1, VIEW_MIDDLE)).toBe('e');
    expect(next(null, 1, { start: 680, end: 820 })).toBe('i');
    expect(next(null, -1, { start: 680, end: 820 })).toBe('i');
    expect(next(null, -1, { start: 650, end: 750 })).toBe('g');
    expect(next(null, 1, { start: 880, end: 1200 })).toBe('j');
    expect(next(null, 1, { start: 1050, end: 1200 })).toBe('a');
  });

  it('goes nowhere when nothing is pending', () => {
    const decided = HUNKS.map((x) => ({ ...x, status: 'accepted' as const }));
    expect(stepFocus(decided, 'b', 1, { pendingOnly: true })).toBeNull();
  });

  it('always lands on a pending change, and steps through every one in order (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), {
          minLength: 1,
          maxLength: 12
        }),
        fc.nat(),
        (statuses, pick) => {
          const list = statuses.map((s, i) => h(`h${String(i).padStart(2, '0')}`, i * 10, s));
          const pending = list.filter((x) => x.status === 'pending').map((x) => x.id);
          const from = list[pick % list.length]!.id;
          const got = stepFocus(list, from, 1, { pendingOnly: true });
          if (pending.length === 0) {
            expect(got).toBeNull();
            return;
          }
          expect(pending).toContain(got);
          // From a pending change, Shift+J pending.length times comes back to it.
          let at = pending[0]!;
          const seen: string[] = [];
          for (let i = 0; i < pending.length; i += 1) {
            at = stepFocus(list, at, 1, { pendingOnly: true })!;
            seen.push(at);
          }
          expect(at).toBe(pending[0]);
          expect([...seen].sort()).toEqual([...pending].sort());
        }
      )
    );
  });
});
