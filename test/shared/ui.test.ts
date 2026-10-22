import { describe, expect, it } from 'vitest';
import { bulkPlan } from '../../src/shared/ui/bulk';
import { bodyLines } from '../../src/shared/ui/confirm';
import { NOTHING_UNTIL_SAVE } from '../../src/shared/ui/saveHint';
import { indexesOf, matchLabel, stepIndex } from '../../src/shared/ui/find';
import { formatElapsed, PROGRESS_TICK_MS, progressLabel } from '../../src/shared/ui/progress';
import { stackCards } from '../../src/shared/ui/stack';
import { groupSuggestions, summaryLine } from '../../src/shared/ui/suggestions';
import { placeTooltip, TOOLTIP_DELAY_MS } from '../../src/shared/ui/tooltip';
import type { Hunk } from '../../src/shared/types';

function hunk(partial: Partial<Hunk> & Pick<Hunk, 'id'>): Hunk {
  return {
    start: 0,
    end: 1,
    baseSide: 'original',
    original: 'a',
    replacement: 'b',
    paragraph: 0,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...partial
  };
}

describe('progress label', () => {
  it('counts seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9_400)).toBe('9s');
    expect(formatElapsed(72_000)).toBe('1m 12s');
    expect(formatElapsed(3_785_000)).toBe('1h 3m 5s');
  });

  it('cycles four dot states before any output arrives', () => {
    const at = (tick: number): string => progressLabel({ tick, elapsedMs: 72_000 });
    expect(at(0)).toBe('Thinking (1m 12s)');
    expect(at(1)).toBe('Thinking. (1m 12s)');
    expect(at(2)).toBe('Thinking.. (1m 12s)');
    expect(at(3)).toBe('Thinking... (1m 12s)');
    expect(at(4)).toBe(at(0));
    expect(PROGRESS_TICK_MS).toBe(500);
  });

  it('switches to a token count once Claude starts writing', () => {
    expect(progressLabel({ tick: 2, outputTokens: 240, elapsedMs: 72_000 })).toBe(
      'Writing suggestions (240 tokens) (1m 12s)'
    );
    expect(progressLabel({ tick: 2, outputTokens: 1, elapsedMs: 1_000 })).toBe(
      'Writing suggestions (1 token) (1s)'
    );
    // Zero tokens is still "thinking": the model has not produced anything yet.
    expect(progressLabel({ tick: 0, outputTokens: 0, elapsedMs: 1_000 })).toBe('Thinking (1s)');
  });
});

describe('suggestion list', () => {
  const hunks = [
    hunk({ id: 'c', start: 30, category: 'grammar' }),
    hunk({ id: 'a', start: 5, category: 'spelling' }),
    hunk({ id: 'b', start: 12, category: 'grammar' }),
    hunk({ id: 'x', start: 0, anchor: 'stale', category: 'spelling' })
  ];

  it('lists anchored hunks in document order and keeps stale ones apart', () => {
    const { inline, stale } = groupSuggestions(hunks);
    expect(inline.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    expect(stale.map((h) => h.id)).toEqual(['x']);
  });

  it('respects the category filter without hiding unanchored hunks', () => {
    const { inline, stale } = groupSuggestions(hunks, ['grammar']);
    expect(inline.map((h) => h.id)).toEqual(['a']);
    expect(stale.map((h) => h.id)).toEqual(['x']);
  });

  it('treats a hunk with no category as "other"', () => {
    const { inline } = groupSuggestions([hunk({ id: 'n', start: 1 })], ['other']);
    expect(inline).toEqual([]);
  });

  it('summarises a change on one line', () => {
    expect(summaryLine(hunk({ id: 'a', original: 'began', replacement: 'begun' }))).toBe('began → begun');
    expect(summaryLine(hunk({ id: 'a', original: 'a\n  b', replacement: '' }))).toBe('a b → (nothing)');
    const long = summaryLine(hunk({ id: 'a', original: 'x'.repeat(80), replacement: 'y' }), 30);
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long.endsWith('→ y')).toBe(true);
  });

  /* small.5 (PLAN 11.7), on purpose: "(nothing)" is kept for the empty string,
     and a side that cannot be seen, or small punctuation, is named. Case 1 of
     the round 6 screenshot read "- → (nothing)", as if the hyphen were deleted. */
  it('names a side that cannot be seen, and small punctuation', () => {
    expect(summaryLine(hunk({ id: 'a', original: '-', replacement: ' ' }))).toBe('- (hyphen) → (space)');
    expect(summaryLine(hunk({ id: 'a', original: '', replacement: ',' }))).toBe('(nothing) → , (comma)');
    expect(summaryLine(hunk({ id: 'a', original: '  ', replacement: ' ' }))).toBe('(2 spaces) → (space)');
    expect(summaryLine(hunk({ id: 'a', original: '\n\n', replacement: ' ' }))).toBe(
      '(paragraph break) → (space)'
    );
    expect(summaryLine(hunk({ id: 'a', original: 'i', replacement: 'I' }))).toBe('i → I');
    expect(summaryLine(hunk({ id: 'a', original: '     ', replacement: '' }))).toBe('(5 spaces) → (nothing)');
  });
});

describe('bulk confirmation semantics', () => {
  const hunks = [
    hunk({ id: 'p1', category: 'spelling', status: 'pending' }),
    hunk({ id: 'p2', category: 'grammar', status: 'pending' }),
    hunk({ id: 'a1', category: 'spelling', status: 'accepted' }),
    hunk({ id: 'd1', category: 'grammar', status: 'dismissed' }),
    hunk({ id: 's1', category: 'spelling', status: 'pending', anchor: 'stale' })
  ];

  it('dismiss all only touches pending hunks and says so', () => {
    const plan = bulkPlan(hunks, 'dismiss');
    expect(plan.ids).toEqual(['p1', 'p2']);
    expect(plan.count).toBe(2);
    expect(plan.status).toBe('dismissed');
    expect(plan.title).toBe('Dismiss 2 pending suggestions?');
    expect(plan.body).toBe('Suggestions you already accepted are not changed.');
    expect(plan.confirmLabel).toBe('Dismiss');
  });

  it('accept all leaves dismissed hunks alone, and says nothing reaches the chapter until Save (apply.12)', () => {
    const plan = bulkPlan(hunks, 'accept');
    expect(plan.ids).toEqual(['p1', 'p2']);
    expect(plan.body).toBe(
      'Suggestions you already dismissed are not changed.\nNothing reaches the chapter until you press Save to chapter.'
    );
    // One point per line, as the confirm dialog shows it.
    expect(bodyLines(plan.body)).toEqual([
      'Suggestions you already dismissed are not changed.',
      NOTHING_UNTIL_SAVE
    ]);
    // A chip's Accept all of one category says the same.
    expect(bulkPlan(hunks, 'accept', 'spelling').body).toBe(plan.body);
    // Dismissing and resetting change nothing the chapter holds either, but
    // their questions are as they were.
    expect(bulkPlan(hunks, 'dismiss').body).not.toContain(NOTHING_UNTIL_SAVE);
    expect(bulkPlan(hunks, 'reset').body).toBe(
      'This clears every accept and dismiss. Nothing is written to the chapter.'
    );
  });

  it('reset takes back every decision and nothing else', () => {
    const plan = bulkPlan(hunks, 'reset');
    expect(plan.ids).toEqual(['a1', 'd1']);
    expect(plan.status).toBe('pending');
    expect(plan.title).toBe('Return 2 suggestions to pending?');
  });

  it('scopes to one category for the chip actions', () => {
    const plan = bulkPlan(hunks, 'accept', 'spelling');
    expect(plan.ids).toEqual(['p1']);
    expect(plan.title).toBe('Accept 1 pending spelling suggestion?');
    expect(plan.category).toBe('spelling');
  });

  it('never counts an unanchored hunk', () => {
    expect(bulkPlan(hunks, 'dismiss').ids).not.toContain('s1');
  });

  it('describes the empty case instead of asking', () => {
    const plan = bulkPlan([hunk({ id: 'a1', status: 'accepted' })], 'accept');
    expect(plan.count).toBe(0);
    expect(plan.emptyNote).toBe('There are no pending suggestions to accept.');
    expect(bulkPlan([], 'reset', 'typo').emptyNote).toBe('There are no typo decisions to reset.');
  });
});

describe('tooltip placement', () => {
  const viewport = { width: 1000, height: 800 };
  const tip = { width: 300, height: 120 };

  it('opens quickly enough to feel instant', () => {
    expect(TOOLTIP_DELAY_MS).toBeLessThanOrEqual(100);
  });

  it('sits below the words so it cannot cover the ghost above them', () => {
    const placed = placeTooltip({ left: 400, top: 300, width: 60, height: 20 }, tip, viewport);
    expect(placed.placement).toBe('below');
    expect(placed.top).toBe(330);
    // Centred on the anchor.
    expect(placed.left).toBe(280);
  });

  it('flips above only when there is no room below', () => {
    const placed = placeTooltip({ left: 400, top: 720, width: 60, height: 20 }, tip, viewport);
    expect(placed.placement).toBe('above');
    expect(placed.top).toBe(590);
  });

  it('stays on screen at either edge', () => {
    const left = placeTooltip({ left: 0, top: 10, width: 20, height: 20 }, tip, viewport);
    expect(left.left).toBe(8);
    const right = placeTooltip({ left: 990, top: 10, width: 20, height: 20 }, tip, viewport);
    expect(right.left).toBe(692);
    // Too tall for the viewport in either direction: still fully visible.
    const tall = placeTooltip(
      { left: 10, top: 400, width: 20, height: 20 },
      { width: 100, height: 780 },
      viewport
    );
    expect(tall.top).toBeGreaterThanOrEqual(8);
    expect(tall.top + 780).toBeLessThanOrEqual(800);
  });

  /* polish.4: Settings' (?) puts its card's left edge under its own, so the
     card runs over the row it explains rather than out of the dialog. */
  it("lines the card's left edge up with the anchor's when asked, still on screen", () => {
    const anchor = { left: 400, top: 300, width: 18, height: 18 };
    const start = placeTooltip(anchor, tip, viewport, 6, 8, 'start');
    expect(start).toEqual({ left: 400, top: 324, placement: 'below' });
    expect(placeTooltip(anchor, tip, viewport, 6, 8).left).toBe(259);
    // Near the right edge it moves left, as the middle does.
    expect(placeTooltip({ ...anchor, left: 900 }, tip, viewport, 6, 8, 'start').left).toBe(692);
    expect(placeTooltip({ ...anchor, top: 760 }, tip, viewport, 6, 8, 'start')).toEqual({
      left: 400,
      top: 634,
      placement: 'above'
    });
  });
});

describe('margin note stacking', () => {
  it('leaves cards where they want to be when they do not collide', () => {
    const placed = stackCards(
      [
        { id: 'a', desiredTop: 0, height: 40 },
        { id: 'b', desiredTop: 200, height: 40 }
      ],
      8
    );
    expect(placed.map((p) => p.top)).toEqual([0, 200]);
    expect(placed.every((p) => p.offset === 0)).toBe(true);
  });

  it('pushes a colliding card down by exactly the overlap plus the gap', () => {
    const placed = stackCards(
      [
        { id: 'a', desiredTop: 0, height: 60 },
        { id: 'b', desiredTop: 30, height: 20 },
        { id: 'c', desiredTop: 40, height: 20 }
      ],
      10
    );
    expect(placed.map((p) => p.top)).toEqual([0, 70, 100]);
    expect(placed[2]?.offset).toBe(60);
  });

  it('sorts by desired position, so input order does not matter', () => {
    const cards = [
      { id: 'b', desiredTop: 100, height: 30 },
      { id: 'a', desiredTop: 10, height: 30 }
    ];
    expect(stackCards(cards).map((p) => p.id)).toEqual(['a', 'b']);
    expect(stackCards(cards.slice().reverse())).toEqual(stackCards(cards));
  });
});

describe('find', () => {
  it('finds every occurrence, case-insensitively', () => {
    expect(indexesOf('The the THE', 'the')).toEqual([0, 4, 8]);
    expect(indexesOf('aaaa', 'aa')).toEqual([0, 1, 2]);
    expect(indexesOf('anything', '')).toEqual([]);
  });

  it('wraps in both directions', () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(-1, 0, 1)).toBe(-1);
  });

  it('labels the position the way a find bar does', () => {
    expect(matchLabel(2, 12, 'rain')).toBe('3 of 12');
    expect(matchLabel(-1, 0, 'rain')).toBe('No matches');
    expect(matchLabel(-1, 0, '')).toBe('');
  });
});
