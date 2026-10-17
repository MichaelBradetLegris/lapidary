const WORD = /[\p{L}\p{N}_'’]/u;

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && WORD.test(ch);
}

export interface TrimResult {
  /** characters shared at the start of both strings */
  prefix: number;
  /** characters shared at the end of both strings */
  suffix: number;
  original: string;
  replacement: string;
}

/**
 * Narrow a before/after pair down to the part that actually differs, then widen
 * the span back out to whole-word boundaries so the floating suggestion reads as
 * words rather than letters ("colour" -> "color", not "ou" -> "o").
 *
 * `prefix` and `suffix` are counts of characters kept outside the hunk, so a
 * caller holding offsets can move them with `start + prefix` and `end - suffix`.
 */
export function trimCommonAffixes(original: string, replacement: string): TrimResult {
  const min = Math.min(original.length, replacement.length);

  let prefix = 0;
  while (prefix < min && original[prefix] === replacement[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < min - prefix &&
    original[original.length - 1 - suffix] === replacement[replacement.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  while (
    prefix > 0 &&
    isWord(original[prefix - 1]) &&
    (isWord(original[prefix]) || isWord(replacement[prefix]))
  ) {
    prefix -= 1;
  }

  while (suffix > 0) {
    const oCut = original.length - suffix;
    const rCut = replacement.length - suffix;
    const oInside = isWord(original[oCut - 1]) && isWord(original[oCut]);
    const rInside = isWord(replacement[rCut - 1]) && isWord(replacement[rCut]);
    if (!oInside && !rInside) break;
    suffix -= 1;
  }

  return {
    prefix,
    suffix,
    original: original.slice(prefix, original.length - suffix),
    replacement: replacement.slice(prefix, replacement.length - suffix)
  };
}
