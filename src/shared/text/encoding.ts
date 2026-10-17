/**
 * Telling UTF-8 from everything else a chapter file might be (files.3, PLAN
 * 11.3 l).
 *
 * The app reads chapters as UTF-8. Bytes that are not UTF-8 used to become
 * U+FFFD on reading, and Save would then have written those replacement
 * characters back over the author's accented letters. So a file is read only
 * when it is valid UTF-8, and anything else is refused with advice that fits
 * what it most likely is. Pure (CLAUDE.md rule 4): bytes are a Uint8Array.
 */

/** Chapters larger than this are refused rather than read. */
export const MAX_TEXT_BYTES = 4 * 1024 * 1024;

export interface Utf8Scan {
  valid: boolean;
  /** well-formed sequences of two to four bytes */
  multiByte: number;
  /** replacement characters a WHATWG decoder would produce */
  invalid: number;
  /** byte offset of the first ill-formed sequence, or -1 */
  firstInvalid: number;
}

/**
 * Walk the bytes as the WHATWG UTF-8 decoder does: overlong forms, surrogates
 * and code points past U+10FFFF are ill-formed, and each maximal ill-formed
 * subpart counts once, as one replacement character would.
 */
export function scanUtf8(bytes: Uint8Array): Utf8Scan {
  let multiByte = 0;
  let invalid = 0;
  let firstInvalid = -1;
  const bad = (at: number): void => {
    invalid += 1;
    if (firstInvalid < 0) firstInvalid = at;
  };

  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i] ?? 0;
    if (lead < 0x80) {
      i += 1;
      continue;
    }
    let need: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) need = 1;
    else if (lead >= 0xe0 && lead <= 0xef) {
      need = 2;
      if (lead === 0xe0) lower = 0xa0;
      if (lead === 0xed) upper = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      need = 3;
      if (lead === 0xf0) lower = 0x90;
      if (lead === 0xf4) upper = 0x8f;
    } else {
      bad(i);
      i += 1;
      continue;
    }

    let seen = 0;
    while (seen < need) {
      const next = bytes[i + 1 + seen];
      if (next === undefined || next < lower || next > upper) break;
      lower = 0x80;
      upper = 0xbf;
      seen += 1;
    }
    if (seen === need) {
      multiByte += 1;
      i += need + 1;
    } else {
      // The lead and the continuations that fit are one bad character; the
      // byte that broke the sequence is read again as the start of the next.
      bad(i);
      i += seen + 1;
    }
  }
  return { valid: invalid === 0, multiByte, invalid, firstInvalid };
}

export type ByteClass =
  | { kind: 'utf8' }
  | { kind: 'utf16' }
  | { kind: 'binary' }
  /** mostly UTF-8 with some damaged characters, the first on `line` (1-based) */
  | { kind: 'mixed'; damaged: number; line: number }
  /** an older single-byte encoding such as Windows-1252 */
  | { kind: 'legacy' };

const SNIFF_BYTES = 4096;

function looksLikeUtf16(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, SNIFF_BYTES);
  let even = 0;
  let odd = 0;
  head.forEach((b, i) => {
    if (b !== 0) return;
    if (i % 2 === 0) even += 1;
    else odd += 1;
  });
  const evenSlots = Math.ceil(head.length / 2);
  const oddSlots = Math.floor(head.length / 2);
  return (evenSlots > 0 && even / evenSlots >= 0.25) || (oddSlots > 0 && odd / oddSlots >= 0.25);
}

function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (bytes[i] === 0x0a) line += 1;
  return line;
}

/** What the bytes most likely are, checked in the order PLAN 11.3 (l) gives. */
export function classifyBytes(bytes: Uint8Array): ByteClass {
  if (
    bytes.length >= 2 &&
    ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
  ) {
    return { kind: 'utf16' };
  }
  if (bytes.includes(0)) return looksLikeUtf16(bytes) ? { kind: 'utf16' } : { kind: 'binary' };
  const scan = scanUtf8(bytes);
  if (scan.valid) return { kind: 'utf8' };
  if (scan.multiByte > scan.invalid) {
    return { kind: 'mixed', damaged: scan.invalid, line: lineAt(bytes, scan.firstInvalid) };
  }
  return { kind: 'legacy' };
}

const UNCHANGED = 'The app has not changed the file.';

function resaveAdvice(windows: boolean): string {
  return windows
    ? 'To fix it, open the file in Notepad, choose File > Save as, set Encoding to UTF-8 and save, then open it here again.'
    : 'To fix it, open the file in VS Code, click the encoding in the status bar, choose Save with Encoding and pick UTF-8, then open it here again.';
}

/** Why a file of this class is not read, or null for UTF-8. */
export function encodingProblem(name: string, found: ByteClass, windows: boolean): string | null {
  switch (found.kind) {
    case 'utf8':
      return null;
    case 'utf16':
      return `${name} is saved as UTF-16, and the app reads only UTF-8. ${resaveAdvice(windows)} ${UNCHANGED}`;
    case 'legacy':
      return `${name} is not saved as UTF-8; it looks like an older encoding such as Windows-1252. ${resaveAdvice(windows)} ${UNCHANGED}`;
    case 'mixed': {
      const which = found.damaged === 1 ? 'character' : 'characters';
      return `${name} is UTF-8 but has ${found.damaged} damaged ${which}, the first on line ${found.line}. Retype ${found.damaged === 1 ? 'it' : 'them'} in Obsidian and save there. Do not re-save the file in Notepad: that would garble every accented letter in it. ${UNCHANGED}`;
    }
    case 'binary':
      return `${name} does not look like a text file, so it was not opened. ${UNCHANGED}`;
  }
}
