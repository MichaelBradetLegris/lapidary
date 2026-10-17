import { describe, expect, it } from 'vitest';
import { fuzzyFind, occurrences } from '../../src/shared/diff/fuzzy';

const TEXT = 'It was the third night of rain, and the river had begun to climb the steps.';

describe('occurrences', () => {
  it('lists every start offset', () => {
    expect(occurrences('abcabcabc', 'abc')).toEqual([0, 3, 6]);
  });

  it('finds overlapping matches', () => {
    expect(occurrences('aaaa', 'aa')).toEqual([0, 1, 2]);
  });

  it('returns nothing for an empty needle', () => {
    expect(occurrences('abc', '')).toEqual([]);
  });
});

describe('fuzzyFind', () => {
  it('finds an exact span and reports ratio zero', () => {
    const m = fuzzyFind(TEXT, 'had begun', TEXT.indexOf('had'));
    expect(m).toMatchObject({ ratio: 0 });
    expect(TEXT.slice(m!.start, m!.end)).toBe('had begun');
  });

  it('tolerates a small mistyped quote', () => {
    const m = fuzzyFind(TEXT, 'the river has begun', 0);
    expect(m).not.toBeNull();
    expect(m!.ratio).toBeLessThan(0.2);
    expect(TEXT.slice(m!.start, m!.end)).toBe(m!.text);
  });

  it('returns null when the needle is nowhere near', () => {
    expect(fuzzyFind(TEXT, 'zzzzz qqqqq wwwww', 0)).toBeNull();
  });

  it('handles needles longer than the diff-match-patch pattern limit', () => {
    const long = TEXT.slice(0, 60);
    const m = fuzzyFind(TEXT, long, 0);
    expect(m?.start).toBe(0);
    expect(m?.ratio).toBe(0);
  });

  it('returns null for empty inputs', () => {
    expect(fuzzyFind(TEXT, '', 0)).toBeNull();
    expect(fuzzyFind('', 'abc', 0)).toBeNull();
  });
});
