import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitDecisions } from '../../src/shared/diff/compose';
import { createReview, remapAfterCommit, repairCommentAnchors } from '../../src/shared/review';
import { findParagraph, splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, ReviewComment } from '../../src/shared/types';

/* files.21: comments and labels follow their paragraphs through a save. The
   author split paragraph 42-43 with the pen and saved; every later comment then
   pointed one paragraph too early (2026-10-14). */

let seq = 0;
function accepted(start: number, end: number, original: string, replacement: string): Hunk {
  seq += 1;
  return {
    id: `h${seq}`,
    start,
    end,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    source: 'manual',
    status: 'accepted',
    anchor: 'exact'
  };
}

function comment(paragraph: number, quote: string): ReviewComment {
  seq += 1;
  return { id: `c${seq}`, paragraph, quote, category: 'other', text: 'note', status: 'open' };
}

/** The paragraph a comment points at, in `text`. */
function textAt(text: string, paragraph: number | null): string {
  return paragraph === null ? '' : (findParagraph(splitParagraphs(text), paragraph)?.text ?? '');
}

function save(base: string, hunks: Hunk[], comments: ReviewComment[]) {
  const committed = commitDecisions(base, hunks);
  return { text: committed.text, ...remapAfterCommit(base, hunks, committed, comments) };
}

const BASE = 'A first one.\n\nB second one here.\n\nC third one.\n\nD fourth one.';

describe('remapAfterCommit', () => {
  it('moves later comments down after a paragraph is split', () => {
    const at = BASE.indexOf(' one here');
    const split = accepted(at, at + 1, ' ', '\n\n');
    const onC = comment(2, 'C third');
    const onD = comment(3, 'D fourth');
    const saved = save(BASE, [split], [onC, onD]);
    expect(textAt(saved.text, saved.comments[0]!.paragraph)).toContain('C third');
    expect(textAt(saved.text, saved.comments[1]!.paragraph)).toContain('D fourth');
    expect(saved.comments.map((c) => c.paragraph)).toEqual([3, 4]);
  });

  it('sends a comment on a split paragraph to the half that holds its quote', () => {
    const at = BASE.indexOf(' one here');
    const saved = save(
      BASE,
      [accepted(at, at + 1, ' ', '\n\n')],
      [comment(1, 'B second'), comment(1, 'one here')]
    );
    expect(textAt(saved.text, saved.comments[0]!.paragraph)).toContain('B second');
    expect(textAt(saved.text, saved.comments[1]!.paragraph)).toContain('one here');
    expect(saved.comments[1]!.paragraph).toBe(2);
  });

  it('moves later comments up after two paragraphs are joined', () => {
    const at = BASE.indexOf('\n\nB');
    const saved = save(
      BASE,
      [accepted(at, at + 2, '\n\n', ' ')],
      [comment(2, 'C third'), comment(1, 'B second')]
    );
    expect(saved.comments.map((c) => c.paragraph)).toEqual([1, 0]);
    expect(textAt(saved.text, 0)).toContain('B second');
  });

  it('moves later comments up after a paragraph is deleted', () => {
    const start = BASE.indexOf('B second');
    const end = BASE.indexOf('C third');
    const saved = save(BASE, [accepted(start, end, BASE.slice(start, end), '')], [comment(3, 'D fourth')]);
    expect(saved.comments[0]!.paragraph).toBe(2);
    expect(textAt(saved.text, 2)).toContain('D fourth');
  });

  it('leaves an unanchored comment as it was, the paragraph it had included (ui.7)', () => {
    const at = BASE.indexOf(' one here');
    const lost: ReviewComment = { ...comment(0, 'gone words'), paragraph: null, wasParagraph: 2 };
    const saved = save(BASE, [accepted(at, at + 1, ' ', '\n\n')], [lost]);
    expect(saved.comments[0]).toBe(lost);
  });

  it('relabels anchored hunks with their new paragraph', () => {
    const at = BASE.indexOf(' one here');
    const split = accepted(at, at + 1, ' ', '\n\n');
    const dAt = BASE.indexOf('fourth');
    const onD = { ...accepted(dAt, dAt + 6, 'fourth', '4th'), status: 'pending' as const, paragraph: 3 };
    const saved = save(BASE, [split, onD], []);
    expect(saved.hunks.find((h) => h.id === onD.id)?.paragraph).toBe(4);
  });

  it('keeps every comment beside its quote through any mix of splits and joins', () => {
    const paragraphCount = fc.integer({ min: 2, max: 6 });
    fc.assert(
      fc.property(
        paragraphCount.chain((n) =>
          fc.record({
            n: fc.constant(n),
            words: fc.array(fc.integer({ min: 2, max: 5 }), { minLength: n, maxLength: n }),
            joins: fc.array(fc.boolean(), { minLength: n - 1, maxLength: n - 1 }),
            splits: fc.array(fc.boolean(), { minLength: n, maxLength: n })
          })
        ),
        ({ n, words, joins, splits }) => {
          const paragraphs = Array.from({ length: n }, (_, i) =>
            Array.from({ length: words[i]! }, (_, j) => `p${i}w${j}`).join(' ')
          );
          const base = paragraphs.join('\n\n');
          const hunks: Hunk[] = [];
          let offset = 0;
          paragraphs.forEach((p, i) => {
            if (splits[i]) {
              const space = p.indexOf(' ');
              hunks.push(accepted(offset + space, offset + space + 1, ' ', '\n\n'));
            }
            offset += p.length;
            if (i < n - 1) {
              if (joins[i]) hunks.push(accepted(offset, offset + 2, '\n\n', ' '));
              offset += 2;
            }
          });
          // One comment per paragraph, quoting its last word, which no split moves away.
          const comments = paragraphs.map((p, i) => comment(i, p.split(' ').at(-1)!));
          const saved = save(base, hunks, comments);
          saved.comments.forEach((c, i) => {
            expect(textAt(saved.text, c.paragraph)).toContain(comments[i]!.quote);
          });
        }
      )
    );
  });
});

describe('repairCommentAnchors', () => {
  function reviewWith(comments: ReviewComment[], base = BASE) {
    return createReview({
      sourcePath: 'C:/Novel/Ch.md',
      base: { text: base, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [],
      comments,
      generator: { kind: 'claude' },
      now: '2026-10-15T00:00:00.000Z'
    });
  }

  it('moves a comment that sits a paragraph away from its quote', () => {
    const repaired = repairCommentAnchors(reviewWith([comment(1, 'C third')]));
    expect(repaired.comments[0]!.paragraph).toBe(2);
  });

  it('returns the same review when every comment is already beside its quote', () => {
    const review = reviewWith([comment(2, 'C third'), { ...comment(0, 'x'), paragraph: null }]);
    expect(repairCommentAnchors(review)).toBe(review);
  });

  it('leaves a comment whose quote is found nowhere', () => {
    const review = reviewWith([comment(1, 'words that were edited away')]);
    expect(repairCommentAnchors(review)).toBe(review);
  });

  it('picks the occurrence nearest the comment, by position, when the quote repeats', () => {
    const base = 'He said no.\n\nShe left.\n\nHe said yes.\n\nThe end.\n\nHe said maybe.';
    const review = reviewWith([comment(3, 'He said')], base);
    // 'He said' sits 14 characters before paragraph 3 and 10 after it.
    expect(repairCommentAnchors(review).comments[0]!.paragraph).toBe(4);
  });
});
