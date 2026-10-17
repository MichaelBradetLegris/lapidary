import { describe, expect, it } from 'vitest';
import { composeText } from '../../src/shared/diff/compose';
import { diffToHunks } from '../../src/shared/diff/wordDiff';

function acceptAll(original: string, corrected: string): string {
  const hunks = diffToHunks(original, corrected).map((h) => ({ ...h, status: 'accepted' as const }));
  return composeText(original, hunks);
}

describe('diffToHunks', () => {
  it('finds a single changed word', () => {
    const hunks = diffToHunks('the river had began to climb', 'the river had begun to climb');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      original: 'began',
      replacement: 'begun',
      source: 'diff',
      anchor: 'exact'
    });
  });

  it('gives offsets into the original text', () => {
    const original = 'one two three';
    const [h] = diffToHunks(original, 'one four three');
    expect(original.slice(h!.start, h!.end)).toBe('two');
  });

  it('groups consecutive changed words into one hunk', () => {
    const hunks = diffToHunks('he walked very quickly home', 'he strode home');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.original).toBe('walked very quickly');
    expect(hunks[0]?.replacement).toBe('strode');
  });

  it('merges two changes separated only by whitespace', () => {
    const hunks = diffToHunks('alpha bravo charlie', 'delta bravo echo');
    expect(hunks.length).toBeGreaterThan(0);
    expect(acceptAll('alpha bravo charlie', 'delta bravo echo')).toBe('delta bravo echo');
  });

  it('keeps separate paragraphs separate', () => {
    const original = 'First one here.\n\nSecond one there.';
    const corrected = 'First one here.\n\nSecond one over there.';
    const hunks = diffToHunks(original, corrected);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.paragraph).toBe(1);
  });

  it('handles a deleted paragraph', () => {
    const original = 'Keep this.\n\nDrop this.\n\nKeep this too.';
    const corrected = 'Keep this.\n\nKeep this too.';
    expect(acceptAll(original, corrected)).toBe(corrected);
  });

  it('handles an inserted paragraph', () => {
    const original = 'Keep this.\n\nKeep this too.';
    const corrected = 'Keep this.\n\nBrand new middle.\n\nKeep this too.';
    expect(acceptAll(original, corrected)).toBe(corrected);
  });

  it('never touches frontmatter', () => {
    const original = '---\ntitle: A\n---\n\nBody had began.';
    const corrected = '---\ntitle: B\n---\n\nBody had begun.';
    const hunks = diffToHunks(original, corrected);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.original).toBe('began');
    expect(
      composeText(
        original,
        hunks.map((h) => ({ ...h, status: 'accepted' as const }))
      )
    ).toBe('---\ntitle: A\n---\n\nBody had begun.');
  });

  it('returns nothing for identical texts', () => {
    expect(diffToHunks('same text here', 'same text here')).toEqual([]);
  });

  it('accepting every hunk reproduces the corrected text', () => {
    const original = [
      'It was the third night of rain, and the river had began to climb the steps.',
      '',
      '"You should of told me," Mara said.',
      '',
      'She nodded her head, then looked away.'
    ].join('\n');
    const corrected = [
      'It was the third night of rain, and the river had begun to climb the steps.',
      '',
      '"You should have told me," Mara said.',
      '',
      'She nodded, then looked away toward the water.'
    ].join('\n');
    expect(acceptAll(original, corrected)).toBe(corrected);
  });

  it('produces hunks sorted and non-overlapping', () => {
    const original = 'alpha bravo charlie delta echo foxtrot';
    const corrected = 'alpha BRAVO charlie DELTA echo FOXTROT';
    const hunks = diffToHunks(original, corrected);
    for (let i = 1; i < hunks.length; i += 1) {
      expect(hunks[i]!.start).toBeGreaterThanOrEqual(hunks[i - 1]!.end);
    }
  });
});
