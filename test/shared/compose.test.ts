import { describe, expect, it } from 'vitest';
import {
  activeHunks,
  changesBase,
  commitDecisions,
  composeForFile,
  composeReview,
  composeText,
  decidedText,
  decisionCounts,
  desiredSide,
  findOverlaps,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import type { Hunk, Review } from '../../src/shared/types';

const BASE = 'The river had began to climb the steps.';

function hunk(partial: Partial<Hunk> & Pick<Hunk, 'id' | 'start' | 'end'>): Hunk {
  return {
    baseSide: 'original',
    original: BASE.slice(partial.start, partial.end),
    replacement: '',
    paragraph: 0,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...partial
  };
}

const began = hunk({ id: 'a', start: 14, end: 19, replacement: 'begun' });

describe('composeText', () => {
  it('returns the base untouched when nothing is accepted', () => {
    expect(composeText(BASE, [began])).toBe(BASE);
  });

  it('splices in the replacement when accepted', () => {
    expect(composeText(BASE, [{ ...began, status: 'accepted' }])).toBe(
      'The river had begun to climb the steps.'
    );
  });

  it('restores the original when an already-applied hunk is set back to pending', () => {
    const applied = { ...began, baseSide: 'replacement' as const, status: 'accepted' as const };
    const appliedBase = 'The river had begun to climb the steps.';
    expect(composeText(appliedBase, [applied])).toBe(appliedBase);
    expect(composeText(appliedBase, [{ ...applied, status: 'pending' }])).toBe(BASE);
  });

  it('treats dismissed exactly like pending', () => {
    expect(composeText(BASE, [{ ...began, status: 'dismissed' }])).toBe(BASE);
  });

  it('handles a pure insertion', () => {
    const insert = hunk({
      id: 'i',
      start: 4,
      end: 4,
      original: '',
      replacement: 'wide ',
      status: 'accepted'
    });
    expect(composeText(BASE, [insert])).toBe('The wide river had began to climb the steps.');
  });

  it('handles a pure deletion', () => {
    const del = hunk({ id: 'd', start: 3, end: 9, original: ' river', replacement: '', status: 'accepted' });
    expect(composeText(BASE, [del])).toBe('The had began to climb the steps.');
  });

  it('applies several hunks in one left-to-right pass', () => {
    const second = hunk({ id: 'b', start: 23, end: 28, replacement: 'scale', status: 'accepted' });
    expect(composeText(BASE, [{ ...began, status: 'accepted' }, second])).toBe(
      'The river had begun to scale the steps.'
    );
  });

  it('ignores stale hunks entirely', () => {
    const stale = hunk({
      id: 's',
      start: 0,
      end: 0,
      original: 'nope',
      replacement: 'yes',
      anchor: 'stale',
      status: 'accepted'
    });
    expect(composeText(BASE, [stale])).toBe(BASE);
    expect(activeHunks([stale])).toEqual([]);
  });

  it('is a pure function of base and statuses', () => {
    const hunks = [{ ...began, status: 'accepted' as const }];
    expect(composeText(BASE, hunks)).toBe(composeText(BASE, [...hunks].reverse()));
  });

  it('copies the base for a hunk whose two sides are the same, whatever its decision', () => {
    // What a rewrite to the file's own words leaves (editSuggestion, apply.22).
    const same = hunk({ id: 's', start: 14, end: 19, replacement: 'began' });
    for (const status of ['pending', 'accepted', 'dismissed'] as const) {
      for (const baseSide of ['original', 'replacement'] as const) {
        const h = { ...same, status, baseSide };
        expect(composeText(BASE, [h])).toBe(BASE);
        expect(decidedText(BASE, h)).toBe('began');
        expect(changesBase(h)).toBe(false);
        expect(unsavedDecisionCount([h])).toBe(0);
      }
    }
    // Even after the base drifted away from both sides, the base is what shows.
    const drifted = { ...same, original: 'begun', replacement: 'begun', status: 'accepted' as const };
    expect(composeText(BASE, [drifted])).toBe(BASE);
  });
});

describe('overlap detection', () => {
  it('reports a pair that shares characters', () => {
    const a = hunk({ id: 'a', start: 4, end: 12 });
    const b = hunk({ id: 'b', start: 10, end: 19 });
    expect(findOverlaps([a, b])).toEqual([{ earlier: 'a', later: 'b' }]);
  });

  it('accepts touching hunks', () => {
    expect(findOverlaps([hunk({ id: 'a', start: 4, end: 9 }), hunk({ id: 'b', start: 9, end: 13 })])).toEqual(
      []
    );
  });
});

describe('commitDecisions', () => {
  it('folds decisions into the base without changing the output', () => {
    const hunks = [{ ...began, status: 'accepted' as const }];
    const composed = composeText(BASE, hunks);
    const committed = commitDecisions(BASE, hunks);
    expect(committed.text).toBe(composed);
    expect(composeText(committed.text, committed.hunks)).toBe(composed);
  });

  it('moves offsets and flips baseSide for accepted hunks', () => {
    const insert = hunk({
      id: 'i',
      start: 4,
      end: 4,
      original: '',
      replacement: 'wide ',
      status: 'accepted'
    });
    const later = hunk({ id: 'l', start: 23, end: 28, replacement: 'scale' });
    const committed = commitDecisions(BASE, [insert, later]);
    const movedInsert = committed.hunks.find((h) => h.id === 'i');
    const movedLater = committed.hunks.find((h) => h.id === 'l');
    expect(movedInsert).toMatchObject({ start: 4, end: 9, baseSide: 'replacement' });
    expect(movedLater).toMatchObject({ start: 28, end: 33, baseSide: 'original' });
    expect(committed.text.slice(movedLater!.start, movedLater!.end)).toBe('climb');
  });

  it('leaves stale hunks alone', () => {
    const stale = hunk({ id: 's', start: 0, end: 0, anchor: 'stale', original: 'x', replacement: 'y' });
    expect(commitDecisions(BASE, [stale]).hunks[0]).toEqual(stale);
  });

  it('keeps the base words for a hunk whose two sides are the same', () => {
    const same = hunk({ id: 's', start: 14, end: 19, replacement: 'began', status: 'accepted' });
    const later = hunk({ id: 'l', start: 23, end: 28, replacement: 'scale', status: 'accepted' });
    const committed = commitDecisions(BASE, [same, later]);
    expect(committed.text).toBe('The river had began to scale the steps.');
    expect(committed.hunks.find((h) => h.id === 's')).toMatchObject({
      start: 14,
      end: 19,
      baseSide: 'replacement'
    });
    expect(unsavedDecisionCount(committed.hunks)).toBe(0);
  });
});

describe('unsavedDecisionCount', () => {
  it('counts a decision the base does not hold yet, on either side', () => {
    expect(unsavedDecisionCount([began])).toBe(0);
    expect(unsavedDecisionCount([{ ...began, status: 'accepted' }])).toBe(1);
    const applied = { ...began, baseSide: 'replacement' as const, status: 'accepted' as const };
    expect(unsavedDecisionCount([applied])).toBe(0);
    expect(unsavedDecisionCount([{ ...applied, status: 'pending' }])).toBe(1);
    expect(unsavedDecisionCount([{ ...applied, status: 'dismissed' }])).toBe(1);
    expect(unsavedDecisionCount([{ ...applied, status: 'pending', anchor: 'stale' }])).toBe(0);
  });
});

describe('helpers', () => {
  it('maps status to the side the author wants', () => {
    expect(desiredSide({ status: 'accepted' })).toBe('replacement');
    expect(desiredSide({ status: 'pending' })).toBe('original');
    expect(desiredSide({ status: 'dismissed' })).toBe('original');
  });

  it('counts decisions for the status bar', () => {
    const counts = decisionCounts([
      began,
      { ...began, id: 'b', status: 'accepted' },
      { ...began, id: 'c', status: 'dismissed' },
      { ...began, id: 'd', anchor: 'stale' }
    ]);
    expect(counts).toEqual({ pending: 1, accepted: 1, dismissed: 1, stale: 1 });
  });

  it('composes a whole review back into file shape', () => {
    const review: Review = {
      version: 1,
      id: 'r',
      sourcePath: 'C:/x/Chapter 1.md',
      createdAt: 'now',
      updatedAt: 'now',
      base: { text: BASE, hash: 'h', eol: 'crlf', bom: true, trailingNewline: true },
      generator: { kind: 'manual' },
      hunks: [{ ...began, status: 'accepted' }],
      comments: []
    };
    expect(composeReview(review)).toBe('The river had begun to climb the steps.');
    expect(composeForFile(review)).toBe('\ufeffThe river had begun to climb the steps.\r\n');
  });
});
