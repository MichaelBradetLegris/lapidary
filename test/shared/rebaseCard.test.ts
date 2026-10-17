import { describe, expect, it } from 'vitest';
import { adoptedSentence, rebaseCardText, type RebaseCard } from '../../src/shared/ui/rebase';

/* apply.23: the cards that report a rebase count the decisions it changed to match the file. */

const CARDS: RebaseCard[] = ['opened', 'history', 'reloaded', 'saving'];

describe('rebase cards (apply.23)', () => {
  it('read as they did when no decision changed', () => {
    expect(rebaseCardText('opened', { anchored: 4, stale: 0, adopted: 0 })).toBe(
      'The chapter changed since this review was made. 4 suggestions re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('opened', { anchored: 1, stale: 2, adopted: 0 })).toBe(
      'The chapter changed since this review was made. 1 suggestion re-anchored, 2 could not be found.'
    );
    expect(rebaseCardText('history', { anchored: 3, stale: 1, adopted: 0 })).toBe(
      'Loaded an older review. 3 re-anchored, 1 could not be found.'
    );
    expect(rebaseCardText('reloaded', { anchored: 4, stale: 0, adopted: 0 })).toBe(
      'Reloaded from disk. 4 suggestions re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('reloaded', { anchored: 1, stale: 0, adopted: 0 })).toBe(
      'Reloaded from disk. 1 suggestion re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('saving', { anchored: 2, stale: 1, adopted: 0 })).toBe(
      'The chapter changed on disk before saving. Rebased: 2 re-anchored, 1 lost. Retrying.'
    );
  });

  it('say how many decisions changed to match the file', () => {
    expect(rebaseCardText('reloaded', { anchored: 4, stale: 0, adopted: 1 })).toBe(
      'Reloaded from disk. 4 suggestions re-anchored, 0 could not be found. 1 decision changed to match the file.'
    );
    expect(rebaseCardText('opened', { anchored: 5, stale: 1, adopted: 2 })).toBe(
      'The chapter changed since this review was made. 5 suggestions re-anchored, 1 could not be found. 2 decisions changed to match the file.'
    );
    expect(rebaseCardText('history', { anchored: 3, stale: 0, adopted: 1 })).toBe(
      'Loaded an older review. 3 re-anchored, 0 could not be found. 1 decision changed to match the file.'
    );
    expect(rebaseCardText('saving', { anchored: 2, stale: 0, adopted: 3 })).toBe(
      'The chapter changed on disk before saving. Rebased: 2 re-anchored, 0 lost. 3 decisions changed to match the file. Retrying.'
    );
  });

  it('add nothing for no changed decision, and count one and many', () => {
    expect(adoptedSentence(0)).toBe('');
    expect(adoptedSentence(1)).toBe('1 decision changed to match the file.');
    expect(adoptedSentence(12)).toBe('12 decisions changed to match the file.');
  });

  it('never say "accepted changes"', () => {
    for (const card of CARDS) {
      for (const adopted of [0, 1, 7]) {
        expect(rebaseCardText(card, { anchored: 3, stale: 1, adopted })).not.toMatch(/accepted changes?/i);
      }
    }
  });
});
