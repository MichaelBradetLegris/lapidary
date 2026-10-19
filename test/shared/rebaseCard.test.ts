import { describe, expect, it } from 'vitest';
import { rebaseReview, type RebaseResult } from '../../src/shared/diff/rebase';
import { createReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import {
  adoptedSentence,
  keptOutSentence,
  mergeReloadRun,
  rebaseCardText,
  rebaseCardTone,
  type RebaseCard,
  type ReloadRun
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

/* The files.20 review: each reload replaces the reload card, so while it is up the
   next reload's card reports the whole run since it went up (mergeReloadRun). */

function reviewOf(text: string, hunks: Hunk[]): Review {
  return createReview({
    sourcePath: 'C:/vault/Chapter 01.md',
    base: { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    hunks,
    generator: { kind: 'manual' },
    now: '2026-10-19T00:00:00.000Z'
  });
}

function suggestion(
  text: string,
  id: string,
  original: string,
  replacement: string,
  extra: Partial<Hunk> = {}
): Hunk {
  const start = text.indexOf(original);
  if (start < 0) throw new Error(`"${original}" is not in the text`);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

/** Each text in turn on disk, the card's run carried from one reload to the next. */
function reloads(review: Review, texts: readonly string[]): { results: RebaseResult[]; runs: ReloadRun[] } {
  const results: RebaseResult[] = [];
  const runs: ReloadRun[] = [];
  let current = review;
  let run: ReloadRun | null = null;
  for (const [i, text] of texts.entries()) {
    const result = rebaseReview(current, { ...current.base, text, hash: `disk${i}` });
    run = mergeReloadRun(run, result);
    results.push(result);
    runs.push(run);
    current = result.review;
  }
  return { results, runs };
}

const TEXT = 'Teh river rose.\n\nShe sleeped well.';

describe('the reload card over a run of reloads (files.20 review)', () => {
  it('says just what one reload says when no card is up', () => {
    const review = reviewOf(TEXT, [
      suggestion(TEXT, 'h1', 'Teh', 'The'),
      suggestion(TEXT, 'h2', 'sleeped', 'slept')
    ]);
    const result = rebaseReview(review, {
      ...review.base,
      text: 'Teh river rose.\n\nShe rested.',
      hash: 'n'
    });
    const run = mergeReloadRun(null, result);
    expect(run.stats).toEqual({ anchored: 1, newlyStale: 1, keptOut: 0, adopted: 0 });
    expect(run).toMatchObject({ reviewId: review.id, newlyStale: ['h2'], keptOut: [], adopted: [] });
  });

  it('keeps counting a suggestion the first reload took off the page while the card is up', () => {
    const review = reviewOf(TEXT, [
      suggestion(TEXT, 'h1', 'Teh', 'The'),
      suggestion(TEXT, 'h2', 'sleeped', 'slept')
    ]);
    const rested = 'Teh river rose.\n\nShe rested.';
    const { results, runs } = reloads(review, [rested, `${rested}\n\nMorning came.`]);
    // The second reload alone took nothing off the page.
    expect(results[1]?.stats).toMatchObject({ anchored: 1, newlyStale: 0 });
    const [first, second] = runs.map((r) => r.stats);
    expect(rebaseCardText('reloaded', first!)).toBe(
      'Reloaded from disk. 1 suggestion re-anchored, 1 could not be found.'
    );
    expect(rebaseCardTone(first!)).toBe('warn');
    // Before the files.20 review this card said "0 could not be found", and was not a warning.
    expect(rebaseCardText('reloaded', second!)).toBe(
      'Reloaded from disk. 1 suggestion re-anchored, 1 could not be found.'
    );
    expect(rebaseCardTone(second!)).toBe('warn');
  });

  it('counts no longer a suggestion a later reload found again, as when a paragraph is cut and pasted back', () => {
    const review = reviewOf(TEXT, [
      suggestion(TEXT, 'h1', 'Teh', 'The'),
      suggestion(TEXT, 'h2', 'sleeped', 'slept')
    ]);
    const { runs } = reloads(review, [
      'Teh river rose.',
      'Teh river rose.\n\nMorning came.\n\nShe sleeped well.'
    ]);
    expect(runs[0]?.stats).toEqual({ anchored: 1, newlyStale: 1, keptOut: 0, adopted: 0 });
    expect(runs[1]?.stats).toEqual({ anchored: 2, newlyStale: 0, keptOut: 0, adopted: 0 });
    expect(rebaseCardTone(runs[1]!.stats)).toBe('info');
  });

  it('counts a suggestion lost, then found again inside syntax, once, as kept out', () => {
    const text = 'Rain fell.\n\nThe old mill stood.';
    const review = reviewOf(text, [suggestion(text, 'm1', 'mill', 'watermill')]);
    const { runs } = reloads(review, [
      'Rain fell.\n\nNothing stood.',
      'Rain fell by the [[mill]].\n\nNothing stood.'
    ]);
    expect(runs[0]?.stats).toEqual({ anchored: 0, newlyStale: 1, keptOut: 0, adopted: 0 });
    expect(runs[1]?.stats).toEqual({ anchored: 0, newlyStale: 0, keptOut: 1, adopted: 0 });
    expect(rebaseCardText('reloaded', runs[1]!.stats)).toBe(
      'Reloaded from disk. 0 suggestions re-anchored, 0 could not be found. 1 suggestion kept out of the text, as it would now change Obsidian syntax.'
    );
  });

  it('keeps the suggestions kept out earlier in the run, and counts each decision changed once', () => {
    const text = 'Rain fell on teh roof.\n\nThe old mill stood.';
    const review = reviewOf(text, [
      suggestion(text, 't1', 'teh', 'the'),
      suggestion(text, 'm1', 'mill', 'watermill')
    ]);
    const { runs } = reloads(review, [
      // "teh" fixed by hand, and the mill made a link.
      'Rain fell on the roof.\n\nThe old [[mill]] stood.',
      // "teh" put back by hand.
      'Rain fell on teh roof.\n\nThe old [[mill]] stood.'
    ]);
    expect(runs[0]?.stats).toEqual({ anchored: 1, newlyStale: 0, keptOut: 1, adopted: 1 });
    expect(runs[1]?.stats).toEqual({ anchored: 1, newlyStale: 0, keptOut: 1, adopted: 1 });
    expect(runs[1]).toMatchObject({ keptOut: ['m1'], adopted: ['t1'] });
  });

  it('starts a new run with none carried, and for another review', () => {
    const review = reviewOf(TEXT, [
      suggestion(TEXT, 'h1', 'Teh', 'The'),
      suggestion(TEXT, 'h2', 'sleeped', 'slept')
    ]);
    const rested = 'Teh river rose.\n\nShe rested.';
    const later = `${rested}\n\nMorning came.`;
    const { results, runs } = reloads(review, [rested, later]);
    // App passes none once the card has been closed, or a chapter or a review opened.
    expect(mergeReloadRun(null, results[1]!).stats).toEqual({
      anchored: 1,
      newlyStale: 0,
      keptOut: 0,
      adopted: 0
    });
    // Another review, its own "h2" off the page from before: not this run's.
    const other: Review = {
      ...reviewOf(rested, [
        suggestion(rested, 'h1', 'Teh', 'The'),
        { ...suggestion(TEXT, 'h2', 'sleeped', 'slept'), anchor: 'stale', start: 0, end: 0 }
      ]),
      id: 'another-review'
    };
    const result = rebaseReview(other, { ...other.base, text: later, hash: 'n' });
    expect(mergeReloadRun(runs[0]!, result).stats).toEqual({
      anchored: 1,
      newlyStale: 0,
      keptOut: 0,
      adopted: 0
    });
  });
});
