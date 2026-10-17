import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commonTrailingSegments, isInsidePath, pathKey, samePath } from '../../src/shared/paths';

/* files.1a: path comparison as the file system does it. `ci` is always explicit. */

const NFC = 'Chapitre \u00e9t\u00e9.md';
const NFD = 'Chapitre e\u0301te\u0301.md';

describe('pathKey', () => {
  it('uses forward slashes, collapses repeats and drops a trailing slash', () => {
    expect(pathKey('C:\\Novel\\\\Part 1\\', false)).toBe('C:/Novel/Part 1');
    expect(pathKey('/home/ann//novel/', false)).toBe('/home/ann/novel'); // check-public: allow
  });

  it('keeps roots as roots', () => {
    expect(pathKey('D:\\', true)).toBe('d:/');
    expect(pathKey('D:', true)).toBe('d:/');
    expect(pathKey('/', false)).toBe('/');
    expect(pathKey('\\\\srv\\share', true)).toBe('//srv/share/');
    expect(pathKey('\\\\srv\\share\\', true)).toBe('//srv/share/');
    expect(pathKey('\\\\srv\\share\\Novel\\', true)).toBe('//srv/share/novel');
  });

  it('lower-cases only when the file system ignores case', () => {
    expect(pathKey('C:/Novel/Ch.md', true)).toBe('c:/novel/ch.md');
    expect(pathKey('/Novel/Ch.md', false)).toBe('/Novel/Ch.md');
  });

  it('composes Unicode', () => {
    expect(pathKey(`C:/Novel/${NFD}`, false)).toBe(`C:/Novel/${NFC}`);
  });
});

describe('samePath', () => {
  it('ignores case only when asked', () => {
    expect(samePath('C:\\Novel\\Ch 1.md', 'c:/novel/ch 1.md', true)).toBe(true);
    expect(samePath('/novel/Ch 1.md', '/novel/ch 1.md', false)).toBe(false);
  });

  it('treats composed and decomposed names as the same file', () => {
    expect(samePath(`C:/Novel/${NFC}`, `C:/Novel/${NFD}`, true)).toBe(true);
    expect(samePath(`/Novel/${NFC}`, `/Novel/${NFD}`, false)).toBe(true);
  });

  it('tells other drives apart', () => {
    expect(samePath('C:/Novel/Ch.md', 'D:/Novel/Ch.md', true)).toBe(false);
  });
});

describe('isInsidePath', () => {
  it('finds files under a folder, at any depth and in any case on Windows', () => {
    expect(isInsidePath('C:\\Novel', 'C:\\Novel\\Ch 1.md', true)).toBe(true);
    expect(isInsidePath('C:\\Novel', 'c:/novel/Part 2/Ch 9.md', true)).toBe(true);
    expect(isInsidePath('/novel', '/Novel/ch.md', false)).toBe(false);
  });

  it('does not mistake a longer sibling name for a parent', () => {
    expect(isInsidePath('C:/Book', 'C:/Booklet/Ch 1.md', true)).toBe(false);
    expect(isInsidePath('C:/Book', 'C:/Book/Ch 1.md', true)).toBe(true);
  });

  it('counts a path as outside itself', () => {
    expect(isInsidePath('C:/Novel', 'C:/Novel', true)).toBe(false);
    expect(isInsidePath('C:/Novel/', 'C:/Novel', true)).toBe(false);
  });

  it('handles drive and UNC roots', () => {
    expect(isInsidePath('D:\\', 'D:\\Ch 1.md', true)).toBe(true);
    expect(isInsidePath('D:\\', 'C:\\Ch 1.md', true)).toBe(false);
    expect(isInsidePath('\\\\srv\\share', '\\\\srv\\share\\Novel\\Ch.md', true)).toBe(true);
    expect(isInsidePath('\\\\srv\\share', '\\\\srv\\shared\\Ch.md', true)).toBe(false);
    expect(isInsidePath('/', '/home/ann/ch.md', false)).toBe(true); // check-public: allow
  });

  it('is never true both ways', () => {
    const segment = fc.stringMatching(/^[A-Za-z0-9 ]{1,6}$/);
    const p = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => `C:/${parts.join('/')}`);
    fc.assert(
      fc.property(p, p, fc.boolean(), (a, b, ci) => {
        expect(isInsidePath(a, b, ci) && isInsidePath(b, a, ci)).toBe(false);
      })
    );
  });
});

describe('commonTrailingSegments', () => {
  it('counts the shared end of two paths', () => {
    expect(commonTrailingSegments('C:/Old/Novel/Ch 1.md', 'D:/New/Novel/Ch 1.md', true)).toBe(2);
    expect(commonTrailingSegments('C:/Old/Novel/Ch 1.md', 'D:/New/novel/ch 1.md', true)).toBe(2);
    expect(commonTrailingSegments('C:/Old/Novel/Ch 1.md', 'D:/New/novel/ch 1.md', false)).toBe(0);
    expect(commonTrailingSegments('C:/A/Ch 1.md', 'C:/B/Ch 2.md', true)).toBe(0);
    expect(commonTrailingSegments('C:/Novel/Ch.md', 'C:/Novel/Ch.md', true)).toBe(3);
  });
});
