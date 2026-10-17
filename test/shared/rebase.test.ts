import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  commitDecisions,
  composeReview,
  composeText,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { createDiffReview, createReview } from '../../src/shared/review';
import { normalizeText } from '../../src/shared/text/eol';
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
