import { describe, expect, it } from 'vitest';
import { distanceRatio, levenshtein } from '../../src/shared/text/distance';
import { nextId, resetIdCounter, slugify } from '../../src/shared/ids';
import {
  chapterName,
  chapterSlug,
  createDiffReview,
  makeReviewId,
  toChangeCategory,
  toCommentCategory,
  toComments
} from '../../src/shared/review';
import { CHANGE_CATEGORIES, COMMENT_CATEGORIES, EFFORT_LEVELS } from '../../src/shared/types';

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('abc', 'abc')).toBe(0);
  });

  it('counts single edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('began', 'begun')).toBe(1);
  });

  it('falls back to length when one side is empty', () => {
    expect(levenshtein('', 'abcd')).toBe(4);
    expect(levenshtein('abcd', '')).toBe(4);
  });

  it('normalizes by the longer string', () => {
    expect(distanceRatio('began', 'begun')).toBeCloseTo(0.2);
    expect(distanceRatio('', '')).toBe(0);
  });
});

describe('ids', () => {
  it('never repeats within a session', () => {
    resetIdCounter(0);
    const ids = new Set(Array.from({ length: 500 }, () => nextId('h')));
    expect(ids.size).toBe(500);
  });

  it('slugifies a chapter name for a folder', () => {
    expect(slugify('Chapter 12: The Flood')).toBe('chapter-12-the-flood');
    expect(slugify('  ')).toBe('chapter');
    expect(slugify('...')).toBe('chapter');
  });
});

describe('review helpers', () => {
  it('takes the chapter name off a Windows or POSIX path', () => {
    expect(chapterName('C:\\vault\\Book\\Chapter 12.md')).toBe('Chapter 12');
    expect(chapterName('/home/x/Chapter 12.md')).toBe('Chapter 12'); // check-public: allow
    expect(chapterSlug('C:\\vault\\Chapter 12.md')).toBe('chapter-12');
  });

  it('builds a filesystem-safe review id', () => {
    expect(makeReviewId('C:/v/Chapter 1.md', '2026-09-08T12:34:56.789Z')).toBe(
      'chapter-1--2026-09-08T12-34-56-789Z'
    );
  });

  it('coerces unknown categories to other', () => {
    expect(toChangeCategory('typo')).toBe('typo');
    expect(toChangeCategory('nonsense')).toBe('other');
    expect(toCommentCategory('plot')).toBe('plot');
    expect(toCommentCategory(42)).toBe('other');
  });

  it('turns raw comments into stored comments', () => {
    const [c] = toComments([{ paragraph: 3, quote: 'Mara', category: 'clarity', text: 'Who?' }]);
    expect(c).toMatchObject({ paragraph: 3, quote: 'Mara', category: 'clarity', status: 'open' });
    expect(c?.id).toBeTruthy();
  });

  it('builds a manual review with hunks and a captured shape', () => {
    const review = createDiffReview({
      originalRaw: '\ufeffthe river had began\r\n',
      correctedRaw: 'the river had begun\r\n'
    });
    expect(review.generator.kind).toBe('manual');
    expect(review.base).toMatchObject({ eol: 'crlf', bom: true, trailingNewline: true });
    expect(review.base.text).toBe('the river had began');
    expect(review.hunks).toHaveLength(1);
    expect(review.hunks[0]).toMatchObject({ original: 'began', replacement: 'begun' });
  });
});

describe('category lists', () => {
  it('has no duplicates', () => {
    expect(new Set(CHANGE_CATEGORIES).size).toBe(CHANGE_CATEGORIES.length);
    expect(new Set(COMMENT_CATEGORIES).size).toBe(COMMENT_CATEGORIES.length);
    expect(new Set(EFFORT_LEVELS).size).toBe(EFFORT_LEVELS.length);
  });
});
