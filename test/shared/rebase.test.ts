import { describe, expect, it } from 'vitest';
import { composeReview, composeText } from '../../src/shared/diff/compose';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { createDiffReview } from '../../src/shared/review';
import type { Review, ReviewBase } from '../../src/shared/types';

const ORIGINAL = [
  'It was the third night of rain, and the river had began to climb the steps.',
  '',
  '"You should of told me," Mara said.',
  '',
  'She nodded her head, then looked away toward the grey water.'
].join('\n');

const CORRECTED = [
  'It was the third night of rain, and the river had begun to climb the steps.',
  '',
  '"You should have told me," Mara said.',
  '',
  'She nodded, then looked away toward the grey water.'
].join('\n');

function baseOf(text: string, hash = 'h'): ReviewBase {
  return { text, hash, eol: 'lf', bom: false, trailingNewline: true };
}

function build(): Review {
  return createDiffReview({
    sourcePath: 'C:/vault/Chapter 12.md',
    originalRaw: ORIGINAL,
    correctedRaw: CORRECTED
  });
}

describe('rebaseReview', () => {
  it('re-anchors every hunk when text is inserted above them', () => {
    const review = build();
    const shifted = `A brand new opening paragraph.\n\n${ORIGINAL}`;
    const { review: next, stats } = rebaseReview(review, baseOf(shifted));
    expect(stats.stale).toBe(0);
    expect(stats.anchored).toBe(review.hunks.length);
    for (const h of next.hunks) {
      expect(shifted.slice(h.start, h.end)).toBe(h.original);
    }
    expect(next.hunks.every((h) => h.paragraph >= 1)).toBe(true);
  });

  it('marks a hunk stale when its paragraph is gone', () => {
    const review = build();
    const without = ORIGINAL.split('\n\n').slice(0, 2).join('\n\n');
    const { stats } = rebaseReview(review, baseOf(without));
    expect(stats.stale).toBeGreaterThan(0);
  });

  it('adopts a change the author already made by hand in Obsidian', () => {
    const review = build();
    const byHand = ORIGINAL.replace('had began', 'had begun');
    const { review: next, stats } = rebaseReview(review, baseOf(byHand));
    const adopted = next.hunks.find((h) => h.replacement === 'begun');
    expect(adopted).toMatchObject({ baseSide: 'replacement', status: 'accepted' });
    expect(stats.adopted).toBeGreaterThanOrEqual(1);
    // The adopted hunk must not rewrite the author's own edit.
    expect(composeText(byHand, next.hunks)).toContain('had begun');
  });

  it('returns an accepted hunk to pending when the author undid it by hand', () => {
    const review = build();
    const accepted = {
      ...review,
      hunks: review.hunks.map((h) => (h.replacement === 'begun' ? { ...h, status: 'accepted' as const } : h))
    };
    const applied = ORIGINAL.replace('had began', 'had begun');
    const step1 = rebaseReview(accepted, baseOf(applied)).review;
    const step2 = rebaseReview(step1, baseOf(ORIGINAL)).review;
    const hunk = step2.hunks.find((h) => h.replacement === 'begun');
    expect(hunk).toMatchObject({ baseSide: 'original', status: 'pending' });
  });

  it('keeps the composed output identical across a compose/rebase round trip', () => {
    const review = build();
    const decided = {
      ...review,
      hunks: review.hunks.map((h, i) => ({
        ...h,
        status: (['accepted', 'pending', 'dismissed'] as const)[i % 3]!
      }))
    };
    const composed = composeReview(decided);
    const { review: next } = rebaseReview(decided, baseOf(composed));
    expect(composeReview(next)).toBe(composed);
    for (const before of decided.hunks) {
      const after = next.hunks.find((h) => h.id === before.id);
      expect(after?.status).toBe(before.status);
    }
  });

  it('is idempotent, because Obsidian fires the watcher repeatedly', () => {
    const review = build();
    const once = rebaseReview(review, baseOf(ORIGINAL)).review;
    const twice = rebaseReview(once, baseOf(ORIGINAL)).review;
    expect(twice.hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide])).toEqual(
      once.hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide])
    );
  });

  it('keeps a comment on its paragraph and orphans it when the paragraph goes', () => {
    const review: Review = {
      ...build(),
      comments: [
        { id: 'c1', paragraph: 2, category: 'flow', text: 'This stalls.', status: 'open' },
        { id: 'c2', paragraph: 1, quote: 'Mara said', category: 'clarity', text: 'Who?', status: 'open' }
      ]
    };
    const shifted = `New opening.\n\n${ORIGINAL}`;
    const kept = rebaseReview(review, baseOf(shifted)).review;
    expect(kept.comments[0]?.paragraph).toBe(3);
    expect(kept.comments[1]?.paragraph).toBe(2);

    const truncated = ORIGINAL.split('\n\n').slice(0, 1).join('\n\n');
    const orphaned = rebaseReview(review, baseOf(truncated));
    expect(orphaned.review.comments[0]?.paragraph).toBeNull();
    expect(orphaned.stats.orphanedComments).toBeGreaterThan(0);
  });

  it('keeps a short common word anchored when a paragraph is inserted above it', () => {
    // "of" and "have" occur all over ordinary prose, so distance from the old
    // offset alone is not enough to pick the right occurrence.
    const review = build();
    const decided = {
      ...review,
      hunks: review.hunks.map((h) => ({ ...h, status: 'accepted' as const }))
    };
    const applied = composeReview(decided);
    const committed = rebaseReview(decided, baseOf(applied)).review;

    const inserted = `The mill had stood for two hundred years, and it would stand for two hundred more, or so her father had liked to say, often, and to anyone who would listen.\n\n${applied}`;
    const { review: next, stats } = rebaseReview(committed, baseOf(inserted));

    expect(stats.stale).toBe(0);
    expect(stats.adopted).toBe(0);
    for (const hunk of next.hunks) {
      expect(hunk.status).toBe('accepted');
      expect(hunk.baseSide).toBe('replacement');
      expect(inserted.slice(hunk.start, hunk.end)).toBe(hunk.replacement);
    }
    expect(composeReview(next)).toBe(inserted);
  });

  it('carries the new base and a fresh timestamp onto the review', () => {
    const review = build();
    const next = rebaseReview(review, baseOf(CORRECTED, 'newhash')).review;
    expect(next.base.hash).toBe('newhash');
    expect(next.base.text).toBe(CORRECTED);
    expect(next.id).toBe(review.id);
  });
});
