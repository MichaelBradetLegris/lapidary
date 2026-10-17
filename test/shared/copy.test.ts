import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { joinProsePieces, type ProsePiece } from '../../src/shared/ui/copy';

/* Copying from the page (2026-10-14): the author pasted a paragraph and found
   "insertion" in it, and a blank line in front of every suggestion. */

describe('joinProsePieces', () => {
  it('runs one paragraph together, around a suggestion, with no break', () => {
    const pieces: ProsePiece[] = [
      { block: 0, text: 'they ran to catch up with Mira' },
      { block: 0, text: ',' },
      { block: 0, text: ' who had nearly vanished' }
    ];
    expect(joinProsePieces(pieces)).toBe('they ran to catch up with Mira, who had nearly vanished');
  });

  it('puts a blank line between paragraphs', () => {
    expect(
      joinProsePieces([
        { block: 0, text: '"Of course not!"' },
        { block: 1, text: '"Right. Okay. Sure."' },
        { block: 2, text: 'Rat squeaked.' }
      ])
    ).toBe('"Of course not!"\n\n"Right. Okay. Sure."\n\nRat squeaked.');
  });

  it('adds no blank line for a paragraph the selection only touches', () => {
    expect(
      joinProsePieces([
        { block: 0, text: '' },
        { block: 1, text: 'Only this one.' },
        { block: 2, text: '' }
      ])
    ).toBe('Only this one.');
  });

  it('keeps line breaks that belong to the text itself', () => {
    expect(joinProsePieces([{ block: 0, text: 'line one\nline two' }])).toBe('line one\nline two');
  });

  it('gives nothing for nothing', () => {
    expect(joinProsePieces([])).toBe('');
    expect(joinProsePieces([{ block: 3, text: '' }])).toBe('');
  });

  it('is the paragraphs, each run together, joined by blank lines', () => {
    const piece = fc.record({ block: fc.integer({ min: 0, max: 4 }), text: fc.string({ maxLength: 6 }) });
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (raw) => {
        // Pages put blocks in order, so sort the generated runs by block first.
        const pieces = [...raw].sort((a, b) => a.block - b.block);
        const expected = [...new Set(pieces.map((p) => p.block))]
          .map((block) =>
            pieces
              .filter((p) => p.block === block)
              .map((p) => p.text)
              .join('')
          )
          .filter((text) => text.length > 0)
          .join('\n\n');
        expect(joinProsePieces(pieces)).toBe(expected);
      })
    );
  });
});
