import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trimCommonAffixes } from '../../src/shared/diff/trim';

describe('trimCommonAffixes', () => {
  it('keeps the change whole-word rather than whole-letter', () => {
    const t = trimCommonAffixes('colour', 'color');
    expect(t).toMatchObject({ original: 'colour', replacement: 'color', prefix: 0, suffix: 0 });
  });

  it('drops shared words at both ends', () => {
    const t = trimCommonAffixes('the river had began to climb', 'the river had begun to climb');
    expect(t.original).toBe('began');
    expect(t.replacement).toBe('begun');
  });

  it('turns a doubled word into a pure deletion', () => {
    const t = trimCommonAffixes('the the cat', 'the cat');
    expect(t.original).toBe('the ');
    expect(t.replacement).toBe('');
  });

  it('turns a missing word into a pure insertion', () => {
    const t = trimCommonAffixes('walked to store', 'walked to the store');
    expect(t.original).toBe('');
    expect(t.replacement).toBe('the ');
  });

  it('reports offsets a caller can apply directly', () => {
    const original = 'she nodded her head slowly';
    const t = trimCommonAffixes(original, 'she nodded slowly');
    expect(original.slice(t.prefix, original.length - t.suffix)).toBe(t.original);
  });

  it('leaves identical strings empty on both sides', () => {
    expect(trimCommonAffixes('same', 'same')).toMatchObject({ original: '', replacement: '' });
  });

  it('is a lossless decomposition for any pair', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const t = trimCommonAffixes(a, b);
        expect(a.slice(0, t.prefix) + t.original + a.slice(a.length - t.suffix)).toBe(a);
        expect(b.slice(0, t.prefix) + t.replacement + b.slice(b.length - t.suffix)).toBe(b);
      }),
      { numRuns: 500 }
    );
  });
});
