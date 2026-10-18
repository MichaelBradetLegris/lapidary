import DiffMatchPatch from 'diff-match-patch';
import { distanceRatio } from '../text/distance';

export interface FuzzyMatch {
  start: number;
  end: number;
  text: string;
  /** edit distance between the needle and the matched text, over the longer length */
  ratio: number;
}

export interface FuzzyOptions {
  /** diff-match-patch Match_Threshold; lower is stricter. Default 0.3 per the plan. */
  threshold?: number;
  /** how far from `near` a match may drift before it is penalised */
  distance?: number;
}

/**
 * Locate `needle` in `haystack` near offset `near`, tolerating small edits.
 *
 * diff-match-patch only reports a start offset and refuses patterns longer than
 * `Match_MaxBits` (32), so the search uses the needle's first 32 characters and
 * then probes a few end offsets to recover the span that best matches the whole
 * needle. The caller decides whether `ratio` is good enough.
 */
export function fuzzyFind(
  haystack: string,
  needle: string,
  near: number,
  options: FuzzyOptions = {}
): FuzzyMatch | null {
  if (needle.length === 0 || haystack.length === 0) return null;

  const dmp = new DiffMatchPatch();
  dmp.Match_Threshold = options.threshold ?? 0.3;
  dmp.Match_Distance = options.distance ?? 2000;

  const pattern = needle.slice(0, dmp.Match_MaxBits);
  const loc = Math.max(0, Math.min(near, haystack.length));
  const found = dmp.match_main(haystack, pattern, loc);
  if (found < 0) return null;

  const slack = Math.min(12, Math.max(2, Math.round(needle.length * 0.25)));
  let best: FuzzyMatch | null = null;
  for (let delta = -slack; delta <= slack; delta += 1) {
    const end = Math.min(haystack.length, Math.max(found, found + needle.length + delta));
    const text = haystack.slice(found, end);
    const ratio = distanceRatio(needle, text);
    if (!best || ratio < best.ratio) best = { start: found, end, text, ratio };
  }
  return best;
}

/** Every start offset at which `needle` occurs in `haystack`. */
export function occurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    out.push(at);
    from = at + 1;
  }
  return out;
}

const WORD_CHAR = /[\p{L}\p{N}_'’]/u;

/** A letter, a digit, an underscore or an apostrophe: what a word is made of here. */
export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * True when a match does not cut a word in half. Without this, "w1" matches
 * inside "w10" and "began" matches inside "beganning", which is how a hunk ends
 * up anchored to the wrong span after the file moves.
 */
export function isCleanMatch(haystack: string, start: number, needle: string): boolean {
  if (needle.length === 0) return true;
  if (isWordChar(needle[0]) && isWordChar(haystack[start - 1])) return false;
  if (isWordChar(needle[needle.length - 1]) && isWordChar(haystack[start + needle.length])) return false;
  return true;
}

/**
 * True when a zero-width place falls between two word characters, inside a
 * word. A deletion or an insertion always starts and ends on a word boundary
 * (`trimCommonAffixes`), so a place inside a word is never where one was.
 */
export function insideWord(haystack: string, at: number): boolean {
  return isWordChar(haystack[at - 1]) && isWordChar(haystack[at]);
}

/**
 * Occurrences that respect word boundaries, falling back to every occurrence
 * when the needle only ever appears mid-word.
 */
export function cleanOccurrences(haystack: string, needle: string): { offsets: number[]; clean: boolean } {
  const all = occurrences(haystack, needle);
  const clean = all.filter((at) => isCleanMatch(haystack, at, needle));
  return clean.length > 0 ? { offsets: clean, clean: true } : { offsets: all, clean: false };
}
