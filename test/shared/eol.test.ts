import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOM, normalizeText, restoreText, shapeOf } from '../../src/shared/text/eol';

describe('normalizeText', () => {
  it('reads a plain LF file with a trailing newline', () => {
    const n = normalizeText('one\ntwo\n');
    expect(n).toEqual({ text: 'one\ntwo', eol: 'lf', bom: false, trailingNewline: true });
  });

  it('reads a CRLF file with a BOM and no trailing newline', () => {
    const n = normalizeText(`${BOM}one\r\ntwo`);
    expect(n).toEqual({ text: 'one\ntwo', eol: 'crlf', bom: true, trailingNewline: false });
  });

  it('keeps every newline except the final one', () => {
    const n = normalizeText('a\n\n\n');
    expect(n.text).toBe('a\n\n');
    expect(n.trailingNewline).toBe(true);
  });

  it('normalizes a lone carriage return', () => {
    expect(normalizeText('a\rb').text).toBe('a\nb');
  });

  it('treats an empty file as LF with no trailing newline', () => {
    expect(normalizeText('')).toEqual({ text: '', eol: 'lf', bom: false, trailingNewline: false });
  });
});

describe('restoreText', () => {
  it('puts the CRLF, the BOM and the trailing newline back', () => {
    const shape = { eol: 'crlf' as const, bom: true, trailingNewline: true };
    expect(restoreText('one\ntwo', shape)).toBe(`${BOM}one\r\ntwo\r\n`);
  });

  it('shapeOf drops the text', () => {
    expect(shapeOf(normalizeText('a\r\n'))).toEqual({ eol: 'crlf', bom: false, trailingNewline: true });
  });
});

describe('EOL round trip', () => {
  it('restore(normalize(raw)) === raw for CRLF-consistent files', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z ]{0,12}$/), { minLength: 0, maxLength: 8 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (lines, crlf, bom, trailing) => {
          const nl = crlf ? '\r\n' : '\n';
          const raw = (bom ? BOM : '') + lines.join(nl) + (trailing && lines.length > 0 ? nl : '');
          const n = normalizeText(raw);
          expect(restoreText(n.text, n)).toBe(raw);
        }
      ),
      { numRuns: 300 }
    );
  });
});
