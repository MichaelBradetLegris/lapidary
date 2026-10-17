import { isUtf8 } from 'node:buffer';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyBytes, encodingProblem, scanUtf8 } from '../../src/shared/text/encoding';

/* files.3: only UTF-8 is read (PLAN 11.3 l). */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** "café" with its é in Windows-1252. */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => (ch === 'é' ? 0xe9 : ch === '’' ? 0x92 : ch.charCodeAt(0))));
}

function utf16le(text: string, bom = true): Uint8Array {
  const out: number[] = bom ? [0xff, 0xfe] : [];
  for (const ch of text) out.push(ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8);
  return Uint8Array.from(out);
}

describe('scanUtf8', () => {
  it('agrees with Node on what is valid UTF-8, for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
        expect(scanUtf8(b).valid).toBe(isUtf8(b));
      }),
      { numRuns: 2000 }
    );
  });

  it('agrees with Node on text that is mostly valid with a few bytes flipped', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 40 }),
        fc.array(fc.nat(), { maxLength: 3 }),
        (text, flips) => {
          const b = utf8(text);
          for (const f of flips) {
            const at = f % Math.max(b.length, 1);
            if (at < b.length) b[at] = (b[at] ?? 0) ^ 0x80;
          }
          expect(scanUtf8(b).valid).toBe(isUtf8(b));
        }
      ),
      { numRuns: 2000 }
    );
  });

  it('counts as many bad characters as a decoder shows replacement characters', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (b) => {
        // A U+FFFD already in the file would be shown too without being damage.
        fc.pre(!Buffer.from(b).includes(Buffer.from([0xef, 0xbf, 0xbd])));
        const shown = [...new TextDecoder().decode(b)].filter((ch) => ch === '�').length;
        expect(scanUtf8(b).invalid).toBe(shown);
      }),
      { numRuns: 2000 }
    );
  });

  it('counts one bad character the way a decoder shows it', () => {
    const scan = scanUtf8(bytes(0x61, 0xe2, 0x80, 0x62));
    expect(scan).toEqual({ valid: false, multiByte: 0, invalid: 1, firstInvalid: 1 });
    expect(new TextDecoder().decode(bytes(0x61, 0xe2, 0x80, 0x62))).toBe('a�b');
  });

  it('rejects overlong forms, surrogates and code points past U+10FFFF', () => {
    expect(scanUtf8(bytes(0xc0, 0xaf)).valid).toBe(false);
    expect(scanUtf8(bytes(0xed, 0xa0, 0x80)).valid).toBe(false);
    expect(scanUtf8(bytes(0xf4, 0x90, 0x80, 0x80)).valid).toBe(false);
    expect(scanUtf8(bytes(0xf0, 0x9f, 0x98, 0x80))).toMatchObject({ valid: true, multiByte: 1 });
  });
});

describe('classifyBytes', () => {
  it('passes UTF-8, with or without a BOM', () => {
    expect(classifyBytes(utf8('Café, naïve, “quoted”.'))).toEqual({ kind: 'utf8' });
    expect(classifyBytes(bytes(0xef, 0xbb, 0xbf, ...utf8('Café')))).toEqual({ kind: 'utf8' });
    expect(classifyBytes(new Uint8Array())).toEqual({ kind: 'utf8' });
  });

  it('spots UTF-16 by its BOM, either way round', () => {
    expect(classifyBytes(utf16le('Chapter one'))).toEqual({ kind: 'utf16' });
    expect(classifyBytes(bytes(0xfe, 0xff, 0x00, 0x41))).toEqual({ kind: 'utf16' });
  });

  it('spots UTF-16 without a BOM by its NULs', () => {
    expect(classifyBytes(utf16le('Chapter one, in which nothing happens.', false))).toEqual({
      kind: 'utf16'
    });
  });

  it('calls a file with scattered NULs binary', () => {
    const b = utf8('PK'.padEnd(400, 'x'));
    b[17] = 0;
    expect(classifyBytes(b)).toEqual({ kind: 'binary' });
  });

  it('calls an older single-byte encoding legacy', () => {
    expect(classifyBytes(cp1252('The café was closed. She didn’t mind.'))).toEqual({ kind: 'legacy' });
  });

  it('calls mostly UTF-8 with a few damaged characters mixed, naming the first bad line', () => {
    const good = utf8('Line one, café.\nLine two, naïve.\nLine three, résumé.\n');
    const damaged = Uint8Array.from([...good, ...cp1252('Line four, café.\n')]);
    expect(classifyBytes(damaged)).toEqual({ kind: 'mixed', damaged: 1, line: 4 });
  });
});

describe('encodingProblem', () => {
  it('says nothing for UTF-8', () => {
    expect(encodingProblem('Ch 1.md', { kind: 'utf8' }, true)).toBeNull();
  });

  it('gives re-save advice for the platform, and always says the file is unchanged', () => {
    const windows = encodingProblem('Ch 1.md', { kind: 'legacy' }, true)!;
    const elsewhere = encodingProblem('Ch 1.md', { kind: 'utf16' }, false)!;
    expect(windows).toMatch(/^Ch 1\.md is not saved as UTF-8/);
    expect(windows).toContain('Notepad');
    expect(elsewhere).toContain('VS Code');
    for (const kind of ['utf16', 'legacy', 'binary'] as const) {
      expect(encodingProblem('x.md', { kind }, true)).toMatch(/The app has not changed the file\.$/);
    }
  });

  it('tells the author to retype damaged characters, never to re-save in Notepad', () => {
    const one = encodingProblem('Ch 1.md', { kind: 'mixed', damaged: 1, line: 4 }, true)!;
    expect(one).toContain('1 damaged character, the first on line 4. Retype it in Obsidian');
    expect(one).toContain('Do not re-save the file in Notepad');
    expect(encodingProblem('Ch 1.md', { kind: 'mixed', damaged: 3, line: 2 }, true)).toContain(
      '3 damaged characters, the first on line 2. Retype them'
    );
  });
});
