import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  commitDecisions,
  composeReview,
  composeText,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import { insideWord } from '../../src/shared/diff/fuzzy';
import { rebaseReview, type RebaseOptions } from '../../src/shared/diff/rebase';
import { createDiffReview, createReview } from '../../src/shared/review';
import { normalizeText } from '../../src/shared/text/eol';
import { bodyStart } from '../../src/shared/text/obsidian';
import type { Hunk, HunkStatus, Review, ReviewBase } from '../../src/shared/types';

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

  it("finds a hunk's words however far the file moved them, as there is no window round the old offset for exact matches (files.23)", () => {
    const review = build();
    const filler = 'The rain went on and on over the town, and the roofs ran with water all night.';
    const above = Array.from({ length: 8 }, () => Array.from({ length: 5 }, () => filler).join(' ')).join(
      '\n\n'
    );
    const far = `${above}\n\n${ORIGINAL}`;
    // Far past the 400 characters the old, unused window option stood for.
    expect(far.indexOf(ORIGINAL)).toBeGreaterThan(3000);

    const { review: next, stats } = rebaseReview(review, baseOf(far));
    expect(stats.stale).toBe(0);
    expect(stats.anchored).toBe(review.hunks.length);
    // Found as surely as after a short paragraph added above ("of" is in the text twice).
    const near = `A brand new opening paragraph.\n\n${ORIGINAL}`;
    const nearHunks = rebaseReview(review, baseOf(near)).review.hunks;
    const moved = far.indexOf(ORIGINAL) - near.indexOf(ORIGINAL);
    expect(next.hunks.map((h) => [h.start - moved, h.end - moved, h.anchor])).toEqual(
      nearHunks.map((h) => [h.start, h.end, h.anchor])
    );
    expect(next.hunks.map((h) => h.anchor)).toEqual(['exact', 'ambiguous', 'exact']);
    for (const h of next.hunks) expect(far.slice(h.start, h.end)).toBe(h.original);

    // A change made by hand that far down is found and taken as made too.
    const byHand = `${above}\n\n${ORIGINAL.replace('had began', 'had begun')}`;
    const adopted = rebaseReview(review, baseOf(byHand));
    expect(adopted.review.hunks.find((h) => h.replacement === 'begun')).toMatchObject({
      baseSide: 'replacement',
      status: 'accepted'
    });
    expect(adopted.stats.stale).toBe(0);

    // The option is gone, not merely unread (4.5).
    // @ts-expect-error RebaseOptions has no window since files.23
    const options: RebaseOptions = { window: 400 };
    expect(rebaseReview(review, baseOf(far), options).review.hunks).toEqual(next.hunks);
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

  it('remembers the paragraph a lost comment had, and keeps it through later changes (ui.7)', () => {
    const review: Review = {
      ...build(),
      comments: [
        { id: 'c1', paragraph: 2, category: 'flow', text: 'This stalls.', status: 'open' },
        { id: 'c2', paragraph: null, category: 'pacing', text: 'The whole chapter.', status: 'open' },
        { id: 'c3', paragraph: 0, category: 'clarity', text: 'Which night?', status: 'resolved' }
      ]
    };
    const truncated = ORIGINAL.split('\n\n').slice(0, 1).join('\n\n');
    const lost = rebaseReview(review, baseOf(truncated)).review;
    expect(lost.comments[0]).toMatchObject({ paragraph: null, wasParagraph: 2 });
    // A comment about the whole chapter never had a paragraph, so it gains none.
    expect(lost.comments[1]).toEqual(review.comments[1]);
    expect(lost.comments[2]).toEqual(review.comments[2]);

    // Another change on disk, the paragraph still gone: it stays lost with the same number.
    const again = rebaseReview(lost, baseOf(`New opening.\n\n${truncated}`)).review;
    expect(again.comments[0]).toMatchObject({ paragraph: null, wasParagraph: 2 });
    expect(again.comments[2]?.paragraph).toBe(1);
    expect(again.comments[2]?.wasParagraph).toBeUndefined();
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

/* ------------------------------------------------------------------ */
/* apply.23: deletions and insertions through a rebase                 */
/* ------------------------------------------------------------------ */

const SPLICE = [
  'He had been splicing the same length for an hour, and the the frayed end had gone soft and grey in his hands.',
  '',
  'It was the third night of rain, and the river had begun to climb the steps below the mill.'
].join('\n');

/** The doubled "the the": where its first word starts, and its second. */
const FIRST = SPLICE.indexOf('the the');
const SECOND = FIRST + 'the '.length;

/**
 * Deleting either word of the pair, with the space after it. After the
 * deletion the place sits this far into "and the frayed": after "and " when
 * the first word went, after "and the " when the second did.
 */
const COPIES: Array<[string, number, number]> = [
  ['second', SECOND, 'and the '.length],
  ['first', FIRST, 'and '.length]
];

function reviewOn(text: string, hunks: Hunk[]): Review {
  return createReview({
    sourcePath: 'C:/vault/Chapter 01.md',
    base: baseOf(text),
    hunks,
    generator: { kind: 'manual' },
    now: '2026-10-17T00:00:00.000Z'
  });
}

function hunkAt(start: number, original: string, replacement: string, status: HunkStatus, id = 'd1'): Hunk {
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    source: 'diff',
    status,
    anchor: 'exact'
  };
}

/** Save to chapter: the decisions folded into the base, as `savedReview` does. */
function saved(review: Review): Review {
  const { text, hunks } = commitDecisions(review.base.text, review.hunks);
  return { ...review, base: baseOf(text, 'saved'), hunks };
}

function rebaseOnto(review: Review, text: string): ReturnType<typeof rebaseReview> {
  return rebaseReview(review, baseOf(text, 'next'));
}

/** Suggestions to delete a "the" that the page shows as not made yet. */
function offeredDeletions(hunks: readonly Hunk[]): Hunk[] {
  return hunks.filter(
    (h) => h.anchor !== 'stale' && h.baseSide === 'original' && h.original === 'the ' && h.replacement === ''
  );
}

describe('deletions through a rebase (apply.23)', () => {
  it('keeps a saved deletion of a doubled word saved when another editor appends a line', () => {
    // The window case: a manual review of the sample chapter, "the the
    // frayed" accepted and saved, then a line appended to the file.
    const raw = readFileSync(
      new URL('../../samples/manuscript/Chapter 01 - The Flood.md', import.meta.url),
      'utf8'
    );
    const text = normalizeText(raw).text;
    const corrected = text
      .replace('had began', 'had begun')
      .replace('should of', 'should have')
      .replace('the the frayed', 'the frayed')
      .replace('would loose', 'would lose');
    const review = createDiffReview({
      sourcePath: 'C:/vault/Chapter 01.md',
      originalRaw: text,
      correctedRaw: corrected
    });
    expect(review.hunks).toHaveLength(4);
    const deletion = review.hunks.find((h) => h.replacement === '')!;
    const after = saved({
      ...review,
      hunks: review.hunks.map((h) => (h.id === deletion.id ? { ...h, status: 'accepted' as const } : h))
    });
    const point = after.hunks.find((h) => h.id === deletion.id)!.start;
    expect(after.base.text.slice(point - 'and the '.length, point + 'frayed'.length)).toBe('and the frayed');

    const appended = `${after.base.text}\n\nA line another editor appended.`;
    const { review: next, stats } = rebaseOnto(after, appended);
    expect(stats).toMatchObject({ anchored: 4, stale: 0, adopted: 0 });
    expect(next.hunks.find((h) => h.id === deletion.id)).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: point,
      end: point,
      anchor: 'exact'
    });
    expect(offeredDeletions(next.hunks)).toEqual([]);
    expect(composeReview(next)).toBe(appended);
    expect(unsavedDecisionCount(next.hunks)).toBe(0);
  });

  it.each(COPIES)(
    'keeps a saved deletion of the %s word of a doubled "the" saved when the file changes elsewhere',
    (_, at, within) => {
      const before = saved(reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]));
      expect(before.base.text).toContain('an hour, and the frayed end');
      for (const text of [
        `${before.base.text}\n\nA line another editor appended.`,
        `A paragraph added above.\n\n${before.base.text}`,
        before.base.text.replace('to climb the steps', 'to rise up the steps')
      ]) {
        const { review: next, stats } = rebaseOnto(before, text);
        const point = text.indexOf('and the frayed') + within;
        expect(next.hunks[0]).toMatchObject({
          status: 'accepted',
          baseSide: 'replacement',
          start: point,
          end: point,
          anchor: 'exact'
        });
        expect(stats).toMatchObject({ stale: 0, adopted: 0 });
        expect(offeredDeletions(next.hunks)).toEqual([]);
        // Save writes the file as it is: the "the" that remains stays.
        expect(composeReview(next)).toBe(text);
      }
    }
  );

  it.each(COPIES)(
    'never brings a saved deletion of the %s word back as a suggestion on another word when the words next to it change',
    (_, at, within) => {
      const before = saved(reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]));
      // The word before the place, the word after it, then both.
      for (const [from, to, phrase] of [
        ['an hour, and the frayed', 'a while, and the frayed', 'and the frayed'],
        ['and the frayed end', 'and the worn end', 'and the worn']
      ]) {
        const text = before.base.text.replace(from!, to!);
        const { review: next } = rebaseOnto(before, text);
        const point = text.indexOf(phrase!) + within;
        expect(next.hunks[0]).toMatchObject({
          status: 'accepted',
          baseSide: 'replacement',
          start: point,
          end: point
        });
        expect(offeredDeletions(next.hunks)).toEqual([]);
        expect(composeReview(next)).toBe(text);
      }
      // With both changed nothing tells where the word was taken out, and
      // the "the" left is no evidence that it was put back.
      const both = before.base.text.replace('an hour, and the frayed end', 'a while, but the worn end');
      const { review: next, stats } = rebaseOnto(before, both);
      expect(next.hunks[0]?.anchor).toBe('stale');
      expect(stats).toMatchObject({ stale: 1, adopted: 0 });
      expect(composeReview(next)).toBe(both);
    }
  );

  it.each(COPIES)(
    'brings a saved deletion of the %s word back as a suggestion when the word is put back where it was',
    (_, at, within) => {
      const before = saved(reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]));
      const text = before.base.text.replace('and the frayed', 'and the the frayed');
      const { review: next, stats } = rebaseOnto(before, text);
      const hunk = next.hunks[0]!;
      // The disk wins (C.5): the deletion is a suggestion again, over the word put back.
      expect(hunk).toMatchObject({ status: 'pending', baseSide: 'original', anchor: 'exact' });
      expect(hunk.start).toBe(text.indexOf('and the the') + within);
      expect(text.slice(hunk.start, hunk.end)).toBe('the ');
      expect(stats.adopted).toBe(1);
      expect(composeReview(next)).toBe(text);
    }
  );

  it.each(COPIES)(
    'adopts an accepted deletion of the %s word of a doubled "the" that is already gone from the file',
    (_, at, within) => {
      const review = reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]);
      // As Save, or the same edit made by hand in Obsidian, wrote it.
      const made = composeReview(review);
      for (const [text, phrase] of [
        [made, 'and the frayed'],
        [`${made}\n\nA line another editor appended.`, 'and the frayed'],
        [made.replace('the frayed end', 'the worn end'), 'and the worn'],
        [made.replace('for an hour,', 'for a while,'), 'and the frayed']
      ]) {
        const { review: next, stats } = rebaseOnto(review, text!);
        const point = text!.indexOf(phrase!) + within;
        expect(next.hunks[0]).toMatchObject({
          status: 'accepted',
          baseSide: 'replacement',
          start: point,
          end: point,
          anchor: 'exact'
        });
        // The decision was accepted already; only where it stands changed.
        expect(stats).toMatchObject({ stale: 0, adopted: 0 });
        expect(unsavedDecisionCount(next.hunks)).toBe(0);
        // Save writes nothing for it, and the "the" that remains stays.
        expect(composeReview(next)).toBe(text);
      }
    }
  );

  it.each(COPIES)(
    'leaves an accepted deletion of the %s word off the page, rather than delete the other, when the words either side changed too',
    (_, at) => {
      const review = reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]);
      const text = composeReview(review).replace('an hour, and the frayed end', 'a while, but the worn end');
      const { review: next, stats } = rebaseOnto(review, text);
      expect(next.hunks[0]?.anchor).toBe('stale');
      expect(stats.stale).toBe(1);
      expect(composeReview(next)).toBe(text);
    }
  );

  it('does the same when the word left is the only one of its kind in the file', () => {
    const doubled = 'Mara counted the the steps twice before she stopped.';
    const review = reviewOn(doubled, [hunkAt(doubled.indexOf('the the') + 4, 'the ', '', 'accepted')]);
    const text = 'Mara climbed the stairs twice before she stopped.';
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(composeReview(next)).toBe(text);
  });

  it.each(COPIES)(
    'keeps a suggested deletion of the %s word on that word when text above it goes and the word before it changes',
    (_, at, within) => {
      const review = reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'pending')]);
      const text = SPLICE.replace('He had been splicing the same length', 'Splicing the same length').replace(
        'an hour, and the',
        'an hour, but the'
      );
      const { review: next, stats } = rebaseOnto(review, text);
      // Where the surroundings cannot tell the word from the place after it,
      // the decision stays as it was rather than be taken as made by hand.
      expect(next.hunks[0]).toMatchObject({ status: 'pending', baseSide: 'original' });
      expect(next.hunks[0]?.start).toBe(text.indexOf('but the the') + within);
      expect(stats.adopted).toBe(0);
      expect(composeReview(next)).toBe(text);
    }
  );

  it('keeps the start of the file as part of what surrounds a saved deletion', () => {
    const opening = 'Well, the river rose all night, and nobody slept in the mill.';
    const before = saved(reviewOn(opening, [hunkAt(0, 'Well, ', '', 'accepted')]));
    expect(before.base.text).toBe('the river rose all night, and nobody slept in the mill.');

    const added = `Well, it rained. ${before.base.text}`;
    const kept = rebaseOnto(before, added);
    expect(kept.review.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: 'Well, it rained. '.length,
      end: 'Well, it rained. '.length
    });
    expect(kept.stats.adopted).toBe(0);

    const putBack = `Well, ${before.base.text}`;
    const back = rebaseOnto(before, putBack);
    expect(back.review.hunks[0]).toMatchObject({ status: 'pending', baseSide: 'original', start: 0, end: 6 });
    expect(back.stats.adopted).toBe(1);
  });

  it('keeps a deletion or an insertion that went stale off the page through the next rebase', () => {
    // Nothing tells where it was any more, so it must not turn up at the start of the chapter.
    const before = saved(reviewOn(SPLICE, [hunkAt(SECOND, 'the ', '', 'accepted')]));
    const both = before.base.text.replace('an hour, and the frayed end', 'a while, but the worn end');
    const first = rebaseOnto(before, both).review;
    expect(first.hunks[0]?.anchor).toBe('stale');
    const second = rebaseOnto(first, `${both}\n\nA line appended.`);
    expect(second.review.hunks[0]).toMatchObject({ anchor: 'stale', status: 'accepted' });
    expect(second.stats).toMatchObject({ stale: 1, adopted: 0 });

    const insertion: Hunk = { ...hunkAt(0, '', 'had ', 'pending', 'i1'), anchor: 'stale' };
    const later = rebaseOnto(reviewOn(SPLICE, [insertion]), `${SPLICE}\n\nA line appended.`);
    expect(later.review.hunks[0]).toMatchObject({ anchor: 'stale', status: 'pending' });
  });

  it('finds where an accepted deletion was made by the nearer text when other changes sit a little way off', () => {
    const night =
      'Rain fell on the roofs of the mill all through the night, and the the river rose over the steps and into the low yard behind.';
    const review = reviewOn(night, [
      hunkAt(night.indexOf('roofs'), 'roofs', 'rooftops', 'accepted', 'r1'),
      hunkAt(night.indexOf('the the') + 4, 'the ', '', 'accepted', 'd1'),
      hunkAt(night.indexOf('yard'), 'yard', 'garden', 'accepted', 'r2')
    ]);
    // "roofs" ends 44 characters before the deletion and "yard" starts 43
    // after it: inside the 48 used to find the place on either side, outside
    // the 40 compared around it.
    const text = composeReview(review);
    const { review: next, stats } = rebaseOnto(review, text);
    const point = text.indexOf('and the river') + 'and the '.length;
    expect(next.hunks.find((h) => h.id === 'd1')).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: point,
      end: point
    });
    expect(stats).toMatchObject({ stale: 0, adopted: 0 });
    expect(composeReview(next)).toBe(text);
  });

  it('never places a saved deletion inside a word, and finds it by the text after it instead', () => {
    // " the", the second word with the space before it, as a model's change list gives it.
    const before = saved(reviewOn(SPLICE, [hunkAt(SECOND - 1, ' the', '', 'accepted')]));
    expect(before.base.text).toContain('an hour, and the frayed end');
    // The text before the place now runs on into "then".
    const text = before.base.text.replace('and the frayed', 'and then the frayed');
    const { review: next } = rebaseOnto(before, text);
    const point = text.indexOf('then the frayed') + 'then the'.length;
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: point,
      end: point
    });
    expect(composeReview(next)).toBe(text);
  });
});

describe('insertions through a rebase (apply.23)', () => {
  const without = SPLICE.replace('climb the steps', 'climb steps');
  const point = without.indexOf('steps below');

  it('keeps a suggested insertion where it was when its words occur elsewhere and the file changes', () => {
    const review = reviewOn(without, [hunkAt(point, '', 'the ', 'pending', 'i1')]);
    const text = `${without}\n\nA line another editor appended.`;
    const { review: next, stats } = rebaseOnto(review, text);
    expect(next.hunks[0]).toMatchObject({
      status: 'pending',
      baseSide: 'original',
      start: point,
      end: point,
      anchor: 'exact'
    });
    expect(stats.adopted).toBe(0);
    expect(composeReview(next)).toBe(text);
  });

  it('adopts an insertion made by hand, and turns a saved one back into a suggestion when its words are taken out', () => {
    const pending = reviewOn(without, [hunkAt(point, '', 'the ', 'pending', 'i1')]);
    const made = rebaseOnto(pending, SPLICE);
    expect(made.review.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: point,
      end: point + 'the '.length
    });
    expect(made.stats.adopted).toBe(1);

    const savedInsertion = saved(reviewOn(without, [hunkAt(point, '', 'the ', 'accepted', 'i1')]));
    expect(savedInsertion.base.text).toBe(SPLICE);
    const undone = rebaseOnto(savedInsertion, without);
    expect(undone.review.hunks[0]).toMatchObject({
      status: 'pending',
      baseSide: 'original',
      start: point,
      end: point
    });
    expect(undone.stats.adopted).toBe(1);
  });

  it('leaves a suggested insertion off the page when the words either side of it changed', () => {
    const review = reviewOn(without, [hunkAt(point, '', 'the ', 'pending', 'i1')]);
    const text = without.replace('to climb steps below', 'to scale stairs beneath');
    const { review: next, stats } = rebaseOnto(review, text);
    // Not taken as made on some other "the".
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(stats.adopted).toBe(0);
  });
});

describe('accepted insertions not saved yet, through a rebase (apply.23)', () => {
  const rain = 'It was the third night of rain, and the river begun to climb the steps below the mill.';
  const point = rain.indexOf('begun');
  const accepted = (): Review => reviewOn(rain, [hunkAt(point, '', 'had ', 'accepted', 'i1')]);

  it('keeps one at the very start of the chapter where it is when the file changes elsewhere', () => {
    // The start of the file is what comes before it, and still reads as it did.
    const opening = 'Mara ran down to the mill before the bells.';
    const review = reviewOn(opening, [hunkAt(0, '', 'Then ', 'accepted', 'i1')]);
    const text = `${opening}\n\nA line appended.`;
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]).toMatchObject({ status: 'accepted', baseSide: 'original', start: 0, end: 0 });
    expect(unsavedDecisionCount(next.hunks)).toBe(1);
    expect(composeReview(next)).toBe(`Then ${text}`);
  });

  it.each([
    ['the word before it changed too', rain.replace('the river begun', 'the stream had begun')],
    [
      'another word typed after it, and a change further back',
      rain.replace('It was', 'So it was').replace('river begun', 'river had already begun')
    ]
  ])('takes one made by hand as saved when %s', (_, text) => {
    const { review: next, stats } = rebaseOnto(accepted(), text);
    const at = text.indexOf('had ');
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: at,
      end: at + 4
    });
    expect(stats).toMatchObject({ stale: 0, adopted: 0 });
    // Save writes nothing for it: no second "had".
    expect(composeReview(next)).toBe(text);
  });

  it('leaves one off the page rather than write its words a second time beside the same words typed by hand', () => {
    const opening = 'Mara ran down to the mill before the bells.';
    const review = reviewOn(opening, [hunkAt(0, '', 'Then ', 'accepted', 'i1')]);
    const text = 'Then later Mara ran down to the mill before the bells.';
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(composeReview(next)).toBe(text);
  });

  it('leaves one off the page when its place can only be guessed', () => {
    const grey =
      'He had been splicing the same length for an hour, and the frayed end had gone soft and grey in his hands.';
    const at = grey.indexOf('soft');
    const review = reviewOn(grey, [hunkAt(at, '', 'very ', 'accepted', 'i1')]);
    const text = grey.replace('had gone soft and grey', 'was gone soft or grey');
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(composeReview(next)).toBe(text);
  });
});

describe('saved changes through a rebase (apply.23)', () => {
  const field =
    'The edge of the water had come up in the night. "You should have told me," she said, and most of the field was gone by noon.';
  const at = field.indexOf('have told');
  const savedOf: Hunk = {
    ...hunkAt(at, 'of', 'have', 'accepted', 'o1'),
    end: at + 'have'.length,
    baseSide: 'replacement'
  };

  it('never turns a saved change back into a suggestion on another place its old words occur', () => {
    const text = field.replace('"You should have told me,"', '"Why did nobody tell me?"');
    const { review: next, stats } = rebaseOnto(reviewOn(field, [savedOf]), text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(stats.adopted).toBe(0);
    expect(composeReview(next)).toBe(text);
  });

  it('still turns it back into a suggestion when the author undid it by hand, where it was', () => {
    const text = field.replace('should have told', 'should of told');
    const { review: next, stats } = rebaseOnto(reviewOn(field, [savedOf]), text);
    expect(next.hunks[0]).toMatchObject({ status: 'pending', baseSide: 'original', start: at, end: at + 2 });
    expect(stats.adopted).toBe(1);
  });

  it('leaves a change accepted but not saved off the page when its words are one of several and neither side reads as it did', () => {
    const unsaved = field.replace('should have told', 'should of told');
    const of = unsaved.indexOf('of told');
    const review = reviewOn(unsaved, [hunkAt(of, 'of', 'have', 'accepted', 'o1')]);
    // "of" is in the sentence three times; the words either side of this one changed.
    const text = unsaved.replace('"You should of told me," she said', '"You would of said so," she cried');
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    // Save writes nothing for it rather than "have" over whichever "of" looked closest.
    expect(composeReview(next)).toBe(text);
  });
});

/* ------------------------------------------------------------------ */
/* apply.23 review: words beside a place, edits on one side, no guess   */
/* ------------------------------------------------------------------ */

describe('a place beside the words it stands for (apply.23 review)', () => {
  const barge =
    'The barge had been tied up all night, and before the the storm broke they had moved it to the lee of the mill.';

  it.each([
    ['second', barge.indexOf('the the') + 4],
    ['first', barge.indexOf('the the')]
  ])(
    'keeps a deletion of the %s word of "before the the storm" on its word when "before" becomes "after"',
    (_, at) => {
      const text = barge.replace('before the the storm', 'after the the storm');
      const point = at - 'before'.length + 'after'.length;

      // Suggested: still a suggestion over its own word, not taken as made by hand.
      const pending = rebaseOnto(reviewOn(barge, [hunkAt(at, 'the ', '', 'pending')]), text);
      expect(pending.review.hunks[0]).toMatchObject({
        status: 'pending',
        baseSide: 'original',
        start: point,
        end: point + 4
      });
      expect(pending.stats.adopted).toBe(0);
      expect(composeReview(pending.review)).toBe(text);

      // Accepted: still a change to save, and Save deletes the word.
      const accepted = rebaseOnto(reviewOn(barge, [hunkAt(at, 'the ', '', 'accepted')]), text);
      expect(accepted.review.hunks[0]).toMatchObject({
        status: 'accepted',
        baseSide: 'original',
        start: point,
        end: point + 4
      });
      expect(accepted.stats.adopted).toBe(0);
      expect(unsavedDecisionCount(accepted.review.hunks)).toBe(1);
      expect(composeReview(accepted.review)).toBe(barge.replace('before the the storm', 'after the storm'));
    }
  );

  it('still takes an accepted deletion as made when one "the" went and the word before the pair changed', () => {
    // Which of the two went cannot be told, but the pair is single now, so the change is made.
    const at = barge.indexOf('the the') + 4;
    for (const word of ['but', 'once']) {
      const text = barge.replace('and before the the storm', `and ${word} the storm`);
      const { review: next, stats } = rebaseOnto(reviewOn(barge, [hunkAt(at, 'the ', '', 'accepted')]), text);
      expect(next.hunks[0]).toMatchObject({ status: 'accepted', baseSide: 'replacement' });
      expect(next.hunks[0]?.start).toBe(text.indexOf(`${word} the `) + `${word} the `.length);
      expect(stats).toMatchObject({ stale: 0, adopted: 0 });
      expect(composeReview(next)).toBe(text);
    }
  });

  it('keeps a saved insertion when a word is typed right after it and the text further back changes', () => {
    const rain = 'It was the third night of rain, and the river had begun to climb the steps below the mill.';
    const at = rain.indexOf('had begun');
    const savedHad: Hunk = {
      ...hunkAt(at, '', 'had ', 'accepted', 'i1'),
      end: at + 4,
      baseSide: 'replacement'
    };
    const text = rain.replace('third night', 'fourth night').replace('had begun', 'had slowly begun');
    const { review: next, stats } = rebaseOnto(reviewOn(rain, [savedHad]), text);
    // Not turned back into a suggestion to insert "had " beside the "had" in the file.
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: text.indexOf('had slowly'),
      end: text.indexOf('had slowly') + 4
    });
    expect(stats.adopted).toBe(0);
    expect(composeReview(next)).toBe(text);
  });

  it('never takes a suggested deletion as made at a place found only by a few words that recur', () => {
    // The text after the deletion is the last word of the file, "before", which
    // also stands earlier on; both words beside the deletion changed.
    const prose = 'They had all gone long before the flood came. Mara had stood at the door like that before';
    const at = prose.lastIndexOf('that ');
    const text = prose.replace('door like that before', 'door now like that again');
    const { review: next, stats } = rebaseOnto(reviewOn(prose, [hunkAt(at, 'that ', '', 'pending')]), text);
    expect(next.hunks[0]).toMatchObject({ status: 'pending', baseSide: 'original' });
    expect(stats.adopted).toBe(0);
    expect(composeReview(next)).toBe(text);
  });

  it.each([
    // The new word ends, or starts, with the letter "the" does, which agrees by chance.
    ['second', SECOND, ['and the frayed', 'once the frayed'], 'once the '],
    ['first', FIRST, ['and the frayed', 'and the torn'], 'and ']
  ] as const)(
    'takes an accepted deletion of the %s "the" as made when it went and the word on the far side of the pair changed',
    (_, at, [from, to], before) => {
      const review = reviewOn(SPLICE, [hunkAt(at, 'the ', '', 'accepted')]);
      const text = composeReview(review).replace(from, to);
      const { review: next, stats } = rebaseOnto(review, text);
      expect(next.hunks[0]).toMatchObject({
        status: 'accepted',
        baseSide: 'replacement',
        start: text.indexOf(to) + before.length
      });
      expect(stats).toMatchObject({ stale: 0, adopted: 0 });
      // Save writes nothing for it: the "the" left stays.
      expect(composeReview(next)).toBe(text);
    }
  );

  it('takes an accepted deletion as made when the word went, the next words changed and the same word stands further on', () => {
    // The "the" in "of the rope" reads no worse than the place beside the
    // twin, but the twin, right beside the place, plainly lost to it.
    const review = reviewOn(SPLICE, [hunkAt(SECOND, 'the ', '', 'accepted')]);
    const text = composeReview(review).replace('the frayed end had', 'the worn end of the rope had');
    const { review: next, stats } = rebaseOnto(review, text);
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: text.indexOf('and the worn') + 'and the '.length
    });
    expect(stats).toMatchObject({ stale: 0, adopted: 0 });
    expect(composeReview(next)).toBe(text);
  });

  it('leaves an accepted deletion off the page when its words and a place read as well as each other', () => {
    // "stood" became "sat" and "quietly" was typed after "very": as well read
    // as "very" kept, as "very" taken out and "sat very quietly" typed.
    const still = 'Far out on the marsh he stood very still by the gate, and the dogs lay down beside him.';
    const review = reviewOn(still, [hunkAt(still.indexOf('very '), 'very ', '', 'accepted')]);
    const text = still.replace('he stood very still', 'he sat very quietly still');
    const { review: next, stats } = rebaseOnto(review, text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(stats.adopted).toBe(0);
    // Save writes nothing for it, rather than delete a "very" that may be new.
    expect(composeReview(next)).toBe(text);
  });

  it('keeps an accepted deletion among repeated words when a word is added after them', () => {
    // A place found by repeated words reads as well on its far side as the
    // deletion's own words, but the words read further in all.
    const lead = 'Far away and long before any of this w1 w2 w3 w4 w5 w6 w7 w8';
    const repeated = `${lead} before before before the before`;
    const at = repeated.lastIndexOf('the ');
    const review = reviewOn(repeated, [hunkAt(at, 'the ', '', 'accepted')]);
    const text = `${repeated} after`;
    const { review: next } = rebaseOnto(review, text);
    expect(next.hunks[0]).toMatchObject({ status: 'accepted', baseSide: 'original', start: at, end: at + 4 });
    expect(composeReview(next)).toBe(`${lead} before before before before after`);
  });
});

describe('a decision Save would write, with the file changed on one side of it (apply.23 review)', () => {
  const rain =
    'It was the third night of rain, and the river begun to climb the steps below the mill. Nobody in the town slept.';
  const point = rain.indexOf('begun');

  it.each([
    ['a word 15 characters after it', rain.replace('the steps below', 'the stairs below')],
    ['a word 25 characters before it', rain.replace('third night', 'fourth night')],
    ['a word 60 characters after it', rain.replace('Nobody in the town', 'No one in the town')]
  ])('keeps an accepted insertion where it was when the file changes %s', (_, text) => {
    const review = reviewOn(rain, [hunkAt(point, '', 'had ', 'accepted', 'i1')]);
    const { review: next, stats } = rebaseOnto(review, text);
    const at = text.indexOf('river begun') + 'river '.length;
    expect(next.hunks[0]).toMatchObject({ status: 'accepted', baseSide: 'original', start: at, end: at });
    expect(stats).toMatchObject({ stale: 0, adopted: 0 });
    expect(unsavedDecisionCount(next.hunks)).toBe(1);
    expect(composeReview(next)).toBe(text.replace('river begun', 'river had begun'));
  });

  it('keeps a saved deletion turned back where it was when a word a few words after it changes', () => {
    const before = saved(reviewOn(rain, [hunkAt(rain.indexOf('third '), 'third ', '', 'accepted', 'd1')]));
    expect(before.base.text).toContain('It was the night of rain');
    const turnedBack = { ...before, hunks: before.hunks.map((h) => ({ ...h, status: 'pending' as const })) };
    const text = before.base.text.replace('and the river', 'and the stream');
    const { review: next } = rebaseOnto(turnedBack, text);
    expect(next.hunks[0]).toMatchObject({ status: 'pending', baseSide: 'replacement', start: 11, end: 11 });
    // Save puts the word back.
    expect(composeReview(next)).toBe(text.replace('It was the night', 'It was the third night'));
  });

  it('still leaves an accepted insertion off the page when another word was typed right where it goes', () => {
    const text = rain.replace('river begun to', 'river slowly begun to');
    const { review: next } = rebaseOnto(reviewOn(rain, [hunkAt(point, '', 'had ', 'accepted', 'i1')]), text);
    expect(next.hunks[0]?.anchor).toBe('stale');
    expect(composeReview(next)).toBe(text);
  });
});

describe('no place by a guess (apply.23 review)', () => {
  const ewes = [
    'Her brother had left in June. He had not said where.',
    '',
    'The ewes were fine. The ewes were always fine. It was the one mercy of that whole year, and she took it without gratitude, the way you take a thing you are owed.'
  ].join('\n');
  const point = ewes.indexOf('always fine') + 'always '.length;
  const glued = /\wvery|very\s\s/;

  it('never places a suggested insertion inside a word when the words either side of it change in turn', () => {
    // As seen in a window: "always fine." became "always good.", then "quite good.", then "always fine." again.
    let review = reviewOn(ewes, [hunkAt(point, '', 'very ', 'pending', 'i1')]);
    for (const text of [
      ewes.replace('were always fine. It', 'were always good. It'),
      ewes.replace('were always fine. It', 'were quite good. It'),
      ewes
    ]) {
      review = rebaseOnto(review, text).review;
      const hunk = review.hunks[0]!;
      if (hunk.anchor !== 'stale') expect(insideWord(text, hunk.start)).toBe(false);
      // Accepted and saved, the words never run into the next.
      const accepted = review.hunks.map((h) => ({ ...h, status: 'accepted' as const }));
      expect(composeText(text, accepted)).not.toMatch(glued);
    }
    // The last step changed the words either side of it: off the page, so Save writes nothing for it.
    expect(review.hunks[0]?.anchor).toBe('stale');
  });

  it('leaves it off the page when both words beside it change at once', () => {
    const text = ewes.replace('were always fine. It', 'were quite good. It');
    const { review: next } = rebaseOnto(reviewOn(ewes, [hunkAt(point, '', 'very ', 'pending', 'i1')]), text);
    expect(next.hunks[0]?.anchor).toBe('stale');
  });
});

/* ------------------------------------------------------------------ */
/* files.20: nothing is placed before the body                         */
/* ------------------------------------------------------------------ */

describe('the body only (files.20)', () => {
  const sources: Array<Pick<Hunk, 'source' | 'status' | 'edited'>> = [
    { source: 'diff', status: 'pending' },
    { source: 'diff', status: 'accepted' },
    { source: 'manual', status: 'accepted' },
    { source: 'claude', status: 'pending' },
    { source: 'claude', status: 'accepted', edited: true }
  ];

  it('never places a hunk of any source on its words where only the frontmatter still has them', () => {
    const body = 'Mara walked to teh mill at dusk.\n\nRain fell on a roof.';
    const later = 'Mara walked to a mill at dusk.\n\nRain fell on a roof.';
    for (const kind of sources) {
      // In the frontmatter, the words are not the chapter's: the hunk leaves the page.
      const front = '---\naliases: [teh mill]\n---\n\n';
      const text = front + body;
      const hunk = { ...hunkAt(text.indexOf('teh mill at'), 'teh', 'the', kind.status), ...kind };
      const { review: next, stats } = rebaseOnto(reviewOn(text, [hunk]), front + later);
      expect(next.hunks[0], kind.source).toMatchObject({ anchor: 'stale', start: 0, end: 0 });
      expect(stats).toMatchObject({ anchored: 0, newlyStale: 1 });
      expect(composeReview(next)).toBe(front + later);
      // In a body paragraph, the same words are found.
      const lead = 'aliases: [teh mill]\n\n';
      const plain = { ...hunkAt((lead + body).indexOf('teh mill at'), 'teh', 'the', kind.status), ...kind };
      const kept = rebaseOnto(reviewOn(lead + body, [plain]), lead + later).review.hunks[0];
      expect(kept, kind.source).toMatchObject({ start: lead.indexOf('teh'), end: lead.indexOf('teh') + 3 });
    }
  });

  it('never places a deletion or an insertion by surroundings that only the frontmatter still has', () => {
    const body = 'It was late, and the river rose in the night.';
    const later = 'It was late, and the sea rose in the dawn.';
    const places = (summary: string): Hunk | undefined => {
      const front = `---\nsummary: ${summary}\n---\n\n`;
      const point = front.length + body.indexOf('night');
      const review = reviewOn(front + body, [hunkAt(point, '', 'dark ', 'pending', 'i1')]);
      return rebaseOnto(review, front + later).review.hunks[0];
    };
    // The frontmatter holds the words around the place, which the body no longer does.
    const tempted = places('the river rose in the night');
    const front = '---\nsummary: the river rose in the night\n---\n\n';
    expect(tempted?.anchor).not.toBe('stale');
    expect(tempted?.start).toBeGreaterThanOrEqual(front.length);
    // Just where it goes when the frontmatter holds other words, as many.
    expect(tempted?.start).toBe(places('a flood came over the hills')?.start);
  });

  it('searches the body alone for words changed a little, past a copy in the frontmatter', () => {
    const front = '---\nsummary: the river had begun to climb the steps\n---\n\n';
    const body = 'It was the third night of rain, and the river had begun to climb the steps.';
    const at = front.length + body.indexOf('had begun');
    const review = reviewOn(front + body, [hunkAt(at, 'had begun to climb', 'began climbing', 'pending')]);
    const later = front + body.replace('had begun to climb', 'had begun to clamb');
    const { review: next } = rebaseOnto(review, later);
    expect(next.hunks[0]).toMatchObject({ anchor: 'fuzzy', start: at });
  });

  it('weighs no copy of the words in the frontmatter against a place in the body', () => {
    // "the" deleted by hand, and "and" made "but": the copy in the frontmatter reads
    // as the old text before the deletion did, and would take the place's claim away.
    const front = '---\nsummary: and the river rose\n---\n';
    const text = `${front}It was late and the river rose at dusk.`;
    const later = `${front}It was late but river rose at dusk.`;
    const hunk = hunkAt(text.indexOf('the river rose at'), 'the ', '', 'pending');
    const { review: next, stats } = rebaseOnto(reviewOn(text, [hunk]), later);
    const place = later.indexOf('river rose at');
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: place,
      end: place
    });
    expect(stats.adopted).toBe(1);
  });

  it('counts only the body in finding the only such words in the file', () => {
    // "colour" made "color" by hand, with the words either side changed too.
    const front = '---\ntags: [color]\n---\n\n';
    const text = `${front}The grey colour of the sky.`;
    const later = `${front}A pale color in the sky.`;
    const hunk = hunkAt(text.indexOf('colour'), 'colour', 'color', 'pending');
    const { review: next } = rebaseOnto(reviewOn(text, [hunk]), later);
    expect(next.hunks[0]).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement',
      start: later.indexOf('color in'),
      end: later.indexOf('color in') + 'color'.length
    });
  });

  it('never takes a suggestion already off the page as made, with a copy of its words in the frontmatter or without', () => {
    // A model's "teh river" that was never found; then the author types "the river" in the body (the files.20 review).
    for (const front of ['', '---\nsummary: the river rose\n---\n\n']) {
      const text = `${front}Rain fell on the roof.`;
      const lost: Hunk = {
        ...hunkAt(0, 'teh river', 'the river', 'pending', 'c1'),
        end: 0,
        anchor: 'stale',
        source: 'claude'
      };
      const later = `${front}Rain fell on the river.`;
      const { review: next, stats } = rebaseOnto(reviewOn(text, [lost]), later);
      expect(next.hunks[0], front).toMatchObject({
        anchor: 'stale',
        status: 'pending',
        baseSide: 'original',
        start: 0,
        end: 0
      });
      expect(stats, front).toMatchObject({ anchored: 0, adopted: 0, newlyStale: 0 });
      // Dismissed, it writes nothing: "teh river" was never in the chapter.
      const dismissed = { ...next, hunks: next.hunks.map((h) => ({ ...h, status: 'dismissed' as const })) };
      expect(composeReview(dismissed)).toBe(later);
      // On its own words it comes back, its decision as it was.
      const typed = `${front}Rain fell on teh river.`;
      const back = rebaseOnto(reviewOn(text, [lost]), typed).review.hunks[0];
      expect(back, front).toMatchObject({
        anchor: 'exact',
        status: 'pending',
        baseSide: 'original',
        start: typed.indexOf('teh river')
      });
    }
    // Nor is a saved change off the page turned back into a suggestion where its old words now stand.
    const text = 'Rain fell on the roof.';
    const saved: Hunk = {
      ...hunkAt(0, 'colour', 'color', 'accepted', 'c2'),
      end: 0,
      baseSide: 'replacement',
      anchor: 'stale'
    };
    const { review: next, stats } = rebaseOnto(reviewOn(text, [saved]), 'Rain of a grey colour fell.');
    expect(next.hunks[0]).toMatchObject({ anchor: 'stale', status: 'accepted', baseSide: 'replacement' });
    expect(stats.adopted).toBe(0);
  });

  it('places a hunk that starts right at the start of the body, where it follows the closing line at once', () => {
    // The usual layout in Obsidian: the body on the line after the closing "---" (the files.20 review).
    const text = '---\ntitle: x\n---\nTeh river rose in the night.\n\nSecond.';
    const body = bodyStart(text);
    expect(body).toBe('---\ntitle: x\n---\n'.length);
    const later = `${text}\n\nA paragraph added.`;
    for (const status of ['pending', 'accepted'] as const) {
      const word = rebaseOnto(reviewOn(text, [hunkAt(body, 'Teh', 'The', status)]), later).review.hunks[0];
      expect(word, status).toMatchObject({ anchor: 'exact', status, start: body, end: body + 3 });
      const insertion = hunkAt(body, '', 'Late that year, ', status, 'i1');
      const top = rebaseOnto(reviewOn(text, [insertion]), later).review.hunks[0];
      expect(top, status).toMatchObject({ anchor: 'exact', status, start: body, end: body });
    }
    // Words changed a little, found by the fuzzy search from the start of the body.
    const phrase = hunkAt(body, 'Teh river rose in', 'The river rose in', 'pending');
    const changed = later.replace('Teh river rose in', 'Teh rivers rose in');
    const fuzzy = rebaseOnto(reviewOn(text, [phrase]), changed).review.hunks[0];
    expect(fuzzy).toMatchObject({ anchor: 'fuzzy', start: body, end: body + 'Teh rivers rose in'.length });
  });

  it('never places a hunk at the line break that closes the frontmatter', () => {
    // As the paragraph box made one before files.22, where the body starts on the next line; a review saved
    // then may still hold one, though it now loads with it off the page (unanchorOutsideBody).
    const text = '---\na: 1\n---\nFirst words.\n\nSecond.';
    const brk = text.indexOf('\nFirst');
    const hunk = { ...hunkAt(brk, '\n', '', 'accepted'), source: 'manual' as const };
    const later = `${text}\n\nThird.`;
    const { review: next } = rebaseOnto(reviewOn(text, [hunk]), later);
    expect(next.hunks[0]).toMatchObject({ anchor: 'stale', start: 0, end: 0 });
    expect(composeReview(next)).toBe(later);
  });
});
