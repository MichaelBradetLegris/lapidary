import { describe, expect, it } from 'vitest';
import { composeText } from '../../src/shared/diff/compose';
import { diffToHunks } from '../../src/shared/diff/wordDiff';
import { buildRenderBlocks } from '../../src/shared/render';
import { splitParagraphs } from '../../src/shared/text/paragraphs';

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

  describe('either end of the body (files.22)', () => {
    const NEXT = '---\ntitle: A\n---\nFirst words here.\n\nSecond paragraph.';
    const SPACED = '---\ntitle: A\n---\n\nFirst words here.\n\nSecond paragraph.';
    const bodyStartOf = (text: string): number => text.indexOf('First');

    it('makes nothing of a blank line added or taken away between the frontmatter and the body', () => {
      expect(diffToHunks(NEXT, SPACED)).toEqual([]);
      expect(diffToHunks(SPACED, NEXT)).toEqual([]);
      expect(diffToHunks(NEXT, '---\ntitle: A\n---\n\n\n \nFirst words here.\n\nSecond paragraph.')).toEqual(
        []
      );
    });

    it('changes the first words without touching the line break before them', () => {
      const corrected = NEXT.replace('First words', 'Opening words');
      const hunks = diffToHunks(NEXT, corrected);
      expect(hunks).toEqual([
        expect.objectContaining({ start: bodyStartOf(NEXT), original: 'First', replacement: 'Opening' })
      ]);
      expect(acceptAll(NEXT, corrected)).toBe(corrected);
    });

    it('puts a paragraph added at the top before the first body paragraph, where the page shows it', () => {
      for (const original of [NEXT, SPACED]) {
        const at = bodyStartOf(original);
        const front = original.slice(0, at);
        const corrected = `${front}A new opening.\n\nFirst words here.\n\nSecond paragraph.`;
        const hunks = diffToHunks(original, corrected);
        expect(hunks, JSON.stringify(front)).toEqual([
          expect.objectContaining({
            start: at,
            end: at,
            original: '',
            replacement: 'A new opening.\n\n',
            paragraph: 0
          })
        ]);
        expect(acceptAll(original, corrected)).toBe(corrected);
        // The page draws it in the first paragraph's block.
        const [first] = buildRenderBlocks(original, splitParagraphs(original), hunks).filter(
          (b) => !b.isFrontmatter
        );
        expect(first?.segments[0]).toMatchObject({ kind: 'hunk', hunk: { id: hunks[0]?.id } });
      }
    });

    it('keeps several paragraphs added at the top in their order, each its own suggestion', () => {
      const corrected = '---\ntitle: A\n---\nOne.\n\nTwo.\n\nFirst words here.\n\nSecond paragraph.';
      const hunks = diffToHunks(NEXT, corrected);
      expect(hunks.map((h) => [h.start, h.replacement])).toEqual([
        [bodyStartOf(NEXT), 'One.\n\n'],
        [bodyStartOf(NEXT), 'Two.\n\n']
      ]);
      expect(acceptAll(NEXT, corrected)).toBe(corrected);
      const second = hunks.map((h, i) => ({ ...h, status: i === 1 ? ('accepted' as const) : h.status }));
      expect(composeText(NEXT, second)).toBe(
        '---\ntitle: A\n---\nTwo.\n\nFirst words here.\n\nSecond paragraph.'
      );
    });

    it('adds the words of a body that had none after the frontmatter, never inside it', () => {
      // The corrected text's frontmatter is never diffed, so the same corrected text serves each case.
      const corrected = '---\ntitle: A\n---\nNew words.\n\nMore.';
      for (const [original, composed] of [
        ['---\ntitle: A\n---', '---\ntitle: A\n---\n\nNew words.\n\nMore.'],
        ['---\ntitle: A\n---\n', '---\ntitle: A\n---\nNew words.\n\nMore.'],
        ['---\ntitle: A\n---\n\n', '---\ntitle: A\n---\n\nNew words.\n\nMore.'],
        ['', 'New words.\n\nMore.']
      ] as const) {
        const hunks = diffToHunks(original, corrected);
        expect(hunks.map((h) => h.start)).toEqual([original.length, original.length]);
        expect(acceptAll(original, corrected), JSON.stringify(original)).toBe(composed);
      }
    });

    it('deletes a last paragraph without the blank lines that end the text, so the page draws it', () => {
      // Found by the files.22 property: the deletion took them, and reached past the paragraph's block.
      const original = 'Keep this.\n\nDrop this.\n \n';
      const hunks = diffToHunks(original, 'Keep this.');
      expect(hunks).toEqual([expect.objectContaining({ original: '\n\nDrop this.', replacement: '' })]);
      const blocks = buildRenderBlocks(original, splitParagraphs(original), hunks);
      expect(blocks.some((b) => b.segments.some((s) => s.kind === 'hunk'))).toBe(true);
      expect(acceptAll(original, 'Keep this.')).toBe('Keep this.\n \n');
      // A paragraph that follows still takes the blank line between with it.
      const middle = diffToHunks(
        'Keep this.\n\nDrop this.\n\nKeep this too.\n\n',
        'Keep this.\n\nKeep this too.'
      );
      expect(middle).toEqual([expect.objectContaining({ original: 'Drop this.\n\n', replacement: '' })]);
    });

    it('deletes the last paragraphs with the blank line before each, as the paragraph box does, so the chapter ends at the words that stay (the files.22 review)', () => {
      const front = '---\ntitle: A\n---\n';
      for (const [original, corrected, deleted] of [
        [`${front}Keep this.\n\nDrop this.`, `${front}Keep this.`, ['\n\nDrop this.']],
        [
          `${front}Keep this.\n\nDrop this.\n\nAnd this.`,
          `${front}Keep this.`,
          ['\n\nDrop this.', '\n\nAnd this.']
        ],
        // The last paragraph kept as a rewrite of the one before it: the deletion starts where it ends.
        [
          `${front}Keep this.\n\nDrop this.\n\nAnd this.`,
          `${front}Keep this.\n\nDrop that.`,
          ['\n\nAnd this.']
        ]
      ] as const) {
        const hunks = diffToHunks(original, corrected);
        expect(
          hunks.filter((h) => h.replacement === '').map((h) => h.original),
          original
        ).toEqual(deleted);
        expect(acceptAll(original, corrected)).toBe(corrected);
        const blocks = buildRenderBlocks(original, splitParagraphs(original), hunks);
        const drawn = blocks.flatMap((b) =>
          b.segments.flatMap((s) => (s.kind === 'hunk' ? [s.hunk.id] : []))
        );
        expect(drawn).toEqual(hunks.map((h) => h.id));
      }
      // Every paragraph deleted: the first has no blank line before it to take, and the frontmatter and the
      // line break that closes it stay as they are.
      const all = `${front}Drop this.\n\nAnd this.`;
      expect(diffToHunks(all, front).map((h) => h.original)).toEqual(['Drop this.', '\n\nAnd this.']);
      expect(acceptAll(all, front)).toBe(front);
    });

    it('still puts a paragraph added at the top of a text with no frontmatter first', () => {
      const original = 'First words here.\n\nSecond paragraph.';
      const corrected = `A new opening.\n\n${original}`;
      expect(diffToHunks(original, corrected)).toEqual([
        expect.objectContaining({ start: 0, end: 0, replacement: 'A new opening.\n\n' })
      ]);
      expect(acceptAll(original, corrected)).toBe(corrected);
    });
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
