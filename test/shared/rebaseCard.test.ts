import { describe, expect, it } from 'vitest';
import {
  adoptedSentence,
  keptOutSentence,
  rebaseCardText,
  rebaseCardTone,
  type RebaseCard
} from '../../src/shared/ui/rebase';

/* apply.23: the cards that report a rebase count the decisions it changed to match the file.
   files.20: they count only the suggestions the rebase took off the page, and say
   how many it kept out of the text. */

const CARDS: RebaseCard[] = ['opened', 'history', 'reloaded', 'saving'];

describe('rebase cards (apply.23)', () => {
  it('read as they did when no decision changed', () => {
    expect(rebaseCardText('opened', { anchored: 4, newlyStale: 0, keptOut: 0, adopted: 0 })).toBe(
      'The chapter changed since this review was made. 4 suggestions re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('opened', { anchored: 1, newlyStale: 2, keptOut: 0, adopted: 0 })).toBe(
      'The chapter changed since this review was made. 1 suggestion re-anchored, 2 could not be found.'
    );
    expect(rebaseCardText('history', { anchored: 3, newlyStale: 1, keptOut: 0, adopted: 0 })).toBe(
      'Loaded an older review. 3 re-anchored, 1 could not be found.'
    );
    expect(rebaseCardText('reloaded', { anchored: 4, newlyStale: 0, keptOut: 0, adopted: 0 })).toBe(
      'Reloaded from disk. 4 suggestions re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('reloaded', { anchored: 1, newlyStale: 0, keptOut: 0, adopted: 0 })).toBe(
      'Reloaded from disk. 1 suggestion re-anchored, 0 could not be found.'
    );
    expect(rebaseCardText('saving', { anchored: 2, newlyStale: 1, keptOut: 0, adopted: 0 })).toBe(
      'The chapter changed on disk before saving. Rebased: 2 re-anchored, 1 lost. Retrying.'
    );
  });

  it('say how many decisions changed to match the file', () => {
    expect(rebaseCardText('reloaded', { anchored: 4, newlyStale: 0, keptOut: 0, adopted: 1 })).toBe(
      'Reloaded from disk. 4 suggestions re-anchored, 0 could not be found. 1 decision changed to match the file.'
    );
    expect(rebaseCardText('opened', { anchored: 5, newlyStale: 1, keptOut: 0, adopted: 2 })).toBe(
      'The chapter changed since this review was made. 5 suggestions re-anchored, 1 could not be found. 2 decisions changed to match the file.'
    );
    expect(rebaseCardText('history', { anchored: 3, newlyStale: 0, keptOut: 0, adopted: 1 })).toBe(
      'Loaded an older review. 3 re-anchored, 0 could not be found. 1 decision changed to match the file.'
    );
    expect(rebaseCardText('saving', { anchored: 2, newlyStale: 0, keptOut: 0, adopted: 3 })).toBe(
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
        for (const keptOut of [0, 1, 3]) {
          expect(rebaseCardText(card, { anchored: 3, newlyStale: 1, keptOut, adopted })).not.toMatch(
            /accepted changes?/i
          );
        }
      }
    }
  });
});

describe('rebase cards and the guard (files.20)', () => {
  it('say how many suggestions the rebase kept out of the text, before the decisions that changed', () => {
    expect(rebaseCardText('reloaded', { anchored: 3, newlyStale: 0, keptOut: 1, adopted: 0 })).toBe(
      'Reloaded from disk. 3 suggestions re-anchored, 0 could not be found. 1 suggestion kept out of the text, as it would now change Obsidian syntax.'
    );
    expect(rebaseCardText('opened', { anchored: 5, newlyStale: 1, keptOut: 2, adopted: 1 })).toBe(
      'The chapter changed since this review was made. 5 suggestions re-anchored, 1 could not be found. 2 suggestions kept out of the text, as they would now change Obsidian syntax. 1 decision changed to match the file.'
    );
    expect(rebaseCardText('history', { anchored: 3, newlyStale: 0, keptOut: 1, adopted: 0 })).toBe(
      'Loaded an older review. 3 re-anchored, 0 could not be found. 1 suggestion kept out of the text, as it would now change Obsidian syntax.'
    );
    expect(rebaseCardText('saving', { anchored: 2, newlyStale: 0, keptOut: 2, adopted: 3 })).toBe(
      'The chapter changed on disk before saving. Rebased: 2 re-anchored, 0 lost. 2 suggestions kept out of the text, as they would now change Obsidian syntax. 3 decisions changed to match the file. Retrying.'
    );
  });

  it('add nothing for none kept out, and count one and many', () => {
    expect(keptOutSentence(0)).toBe('');
    expect(keptOutSentence(1)).toBe(
      '1 suggestion kept out of the text, as it would now change Obsidian syntax.'
    );
    expect(keptOutSentence(4)).toBe(
      '4 suggestions kept out of the text, as they would now change Obsidian syntax.'
    );
  });

  it('warn only when the rebase took suggestions off the page', () => {
    expect(rebaseCardTone({ newlyStale: 0 })).toBe('info');
    expect(rebaseCardTone({ newlyStale: 1 })).toBe('warn');
    expect(rebaseCardTone({ newlyStale: 6 })).toBe('warn');
  });
});
