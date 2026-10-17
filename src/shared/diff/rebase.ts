import { paragraphIndexAt, splitParagraphs, type Paragraph } from '../text/paragraphs';
import type { AnchorQuality, BaseSide, Hunk, HunkStatus, Review, ReviewBase, ReviewComment } from '../types';
import { resolveOverlaps } from './anchor';
import { changesBase } from './compose';
import { cleanOccurrences, fuzzyFind, insideWord, isCleanMatch, occurrences } from './fuzzy';

export interface RebaseStats {
  /** hunks that found a home in the new text */
  anchored: number;
  /** hunks that could not be found and dropped out of the inline view */
  stale: number;
  /** hunks whose decision was flipped to match what is now on disk */
  adopted: number;
  /** comments that lost their paragraph */
  orphanedComments: number;
}

export interface RebaseResult {
  review: Review;
  stats: RebaseStats;
}

export interface RebaseOptions {
  /** how far either side of the old offset to look before widening the search */
  window?: number;
  /** characters of surrounding text used to re-anchor a zero-length hunk */
  contextChars?: number;
  maxDistanceRatio?: number;
}

const DEFAULTS = { window: 400, contextChars: 48, maxDistanceRatio: 0.2 };

interface Found {
  start: number;
  end: number;
  side: BaseSide;
  anchor: AnchorQuality;
}

/**
 * Move an existing review onto a new version of the file (plan section 4.5).
 *
 * Each hunk looks for the text it expects to occupy its span and for the other
 * side, because the author may have applied or undone the change by hand in
 * Obsidian. A side that holds no text, as in a deletion or an insertion, is a
 * zero-width place found by the text around it. When the disk plainly
 * disagrees with the recorded decision, the disk wins and the decision is
 * flipped to match (C.5), so saving can never silently revert an edit made
 * outside the app. When it seems to disagree but not plainly, or when Save
 * would write a decision at a place the rebase had to guess, the hunk leaves
 * the page as stale instead (C.52).
 */
export function rebaseReview(
  review: Review,
  nextBase: ReviewBase,
  options: RebaseOptions = {}
): RebaseResult {
  const opts = { ...DEFAULTS, ...options };
  const oldText = review.base.text;
  const newText = nextBase.text;
  const oldParagraphs = splitParagraphs(oldText);
  const newParagraphs = splitParagraphs(newText);

  const present = new Set(review.hunks.map((h) => h.id));

  let adopted = 0;
  const moved: Hunk[] = review.hunks.map((hunk) => {
    /* A suggestion the author's own edit swallowed stays off the page. Its words
       often still exist inside the edit that replaced them, so re-anchoring it
       would put two hunks over the same span and undo a decision the author
       already made (item 3b). */
    if (hunk.supersededBy && present.has(hunk.supersededBy)) {
      return { ...hunk, anchor: 'stale', start: 0, end: 0 };
    }
    const found = locate(oldText, newText, hunk, opts);
    if (!found) {
      return { ...hunk, anchor: 'stale', start: 0, end: 0 };
    }
    const status = decisionOn(hunk, found.side);
    if (status !== hunk.status) adopted += 1;
    return {
      ...hunk,
      start: found.start,
      end: found.end,
      baseSide: found.side,
      anchor: found.anchor,
      status,
      paragraph: paragraphIndexAt(newParagraphs, found.start)
    };
  });

  const hunks = resolveOverlaps(moved);

  let orphanedComments = 0;
  const comments: ReviewComment[] = review.comments.map((comment) => {
    const next = remapComment(comment, oldParagraphs, newParagraphs, newText);
    if (comment.paragraph !== null && next.paragraph === null) orphanedComments += 1;
    return next;
  });

  const stale = hunks.filter((h) => h.anchor === 'stale').length;

  return {
    review: {
      ...review,
      base: { ...nextBase },
      updatedAt: new Date().toISOString(),
      hunks,
      comments
    },
    stats: { anchored: hunks.length - stale, stale, adopted, orphanedComments }
  };
}

/**
 * The decision a hunk takes when it is found with `side` in the base (C.5):
 * unchanged on the side it expected; text now showing the replacement is
 * accepted; an accepted hunk whose text is back to the original is pending.
 */
function decisionOn(hunk: Hunk, side: BaseSide): HunkStatus {
  if (side === hunk.baseSide) return hunk.status;
  if (side === 'replacement') return 'accepted';
  return hunk.status === 'accepted' ? 'pending' : hunk.status;
}

interface Candidate {
  start: number;
  end: number;
  side: BaseSide;
  /** a zero-width place for a side that holds no text, found by the text around it */
  place: boolean;
  clean: boolean;
  /** how many equally clean places this text, or this context, occurs in */
  siblings: number;
  /** characters just before the candidate that read as they did before the hunk (`agreeBefore`) */
  before: number;
  /** characters just after the candidate that read as they did after the hunk (`agreeAfter`) */
  after: number;
  distance: number;
  /** on the side the base holds, so choosing it leaves the decision as it was */
  own: boolean;
  /** on the other side, and plainly the change made or undone there (`plainlyOnDisk`) */
  plain: boolean;
}

/** How much text either side of a hunk is compared when ranking candidates. */
const CONTEXT_CHARS = 40;

/** How many candidates for one side are scored: the nearest ones to the old offset. */
const NEAREST = 12;

/**
 * Best candidate first. Word-boundary matches always win; then the one whose
 * surroundings still look like the old file, which is what saves short common
 * words such as "of" from anchoring onto an unrelated occurrence (C.6); then,
 * where the surroundings tie, the side the base holds, so that where nothing
 * tells them apart the decision stays as it was (C.52); then the one that
 * moved least.
 */
function betterCandidate(a: Candidate, b: Candidate): number {
  if (a.clean !== b.clean) return a.clean ? -1 : 1;
  const context = b.before + b.after - (a.before + a.after);
  if (context !== 0) return context;
  if (a.own !== b.own) return a.own ? -1 : 1;
  if (a.distance !== b.distance) return a.distance - b.distance;
  return a.start - b.start;
}

/**
 * Whether a candidate on the side the base does not hold may win, which flips
 * the decision (C.5). A zero-width place was found by the text around it, so
 * it stands where the hunk stood. Words count only when they plainly are the
 * hunk's own: a word-boundary match whose surroundings read as they did on
 * both sides; on one side, unless the words stood right beside a copy of
 * themselves, which may be all that is left of them; or, for a hunk whose own
 * side has words, the only word-boundary match in the file. A side counts
 * only where the old file has text on it: the start of the file alone says
 * nothing. Words found anywhere else say nothing about whether a change was
 * made or undone: that is how a saved deletion of one word of a doubled
 * "the the" came back as a suggestion to delete the "the" that remained, or
 * another "the" nearby (apply.23).
 */
function plainlyOnDisk(c: Candidate, oldText: string, hunk: Hunk, expected: string, other: string): boolean {
  if (c.place) return true;
  if (!c.clean) return false;
  const before = hunk.start > 0 && c.before === CONTEXT_CHARS;
  const after = hunk.end < oldText.length && c.after === CONTEXT_CHARS;
  if (before && after) return true;
  if ((before || after) && !twinned(oldText, hunk, other)) return true;
  return c.siblings === 1 && expected.length > 0;
}

function locate(oldText: string, newText: string, hunk: Hunk, opts: typeof DEFAULTS): Found | null {
  /* A hunk already off the page has no place in the old text (its offsets are
     0), and a side that holds no text is found only by what surrounds its
     place, so a deletion or an insertion that went stale stays stale rather
     than come back at the start of the chapter. */
  if (hunk.anchor === 'stale' && (hunk.original.length === 0 || hunk.replacement.length === 0)) return null;
  const expectedSide: BaseSide = hunk.baseSide;
  const otherSide: BaseSide = expectedSide === 'original' ? 'replacement' : 'original';
  const expected = expectedSide === 'original' ? hunk.original : hunk.replacement;
  const other = otherSide === 'original' ? hunk.original : hunk.replacement;

  const pool = [
    ...candidates(oldText, newText, hunk, expectedSide, expected, true, opts),
    ...candidates(oldText, newText, hunk, otherSide, other, false, opts).map((c) => ({
      ...c,
      plain: plainlyOnDisk(c, oldText, hunk, expected, other)
    }))
  ].sort(betterCandidate);

  let best = pool[0];
  if (best?.own && best.place && !(best.before === CONTEXT_CHARS && best.after === CONTEXT_CHARS)) {
    /* An empty place the base holds, found by its surroundings on one side
       only, says less than the other side's words found plainly where the
       hunk was: those words are in the file, as with an insertion made by
       hand and the word before it changed, or another word typed after it. */
    best = pool.find((c) => !c.own && c.plain) ?? best;
  }
  if (best) {
    /* The other side reads closer to the old surroundings than anything on
       the hunk's own side, but not plainly enough to change the decision.
       Its own side is then most likely gone from here, so a weaker match
       for it would be a guess: the hunk leaves the page instead. */
    if (!best.own && !best.plain) return null;
    const rivals = pool.filter(
      (c) => c.side === best.side && c.clean === best.clean && (c.own || c.plain)
    ).length;
    const anchor: AnchorQuality = best.clean && rivals === 1 ? 'exact' : 'ambiguous';
    if (best.own && changesBase(hunk) && !placedPlainly(best, anchor, oldText, hunk, expected)) return null;
    return { start: best.start, end: best.end, side: best.side, anchor };
  }

  // Save never writes a decision into a place found only approximately.
  if (expected.length === 0 && !changesBase(hunk)) {
    const place = placeByFuzzyContext(oldText, newText, hunk, expectedSide, opts);
    if (place) return place;
  }
  if (other.length === 0) {
    const place = placeByFuzzyContext(oldText, newText, hunk, otherSide, opts);
    if (place) return place;
  }

  if (expected.length > 0) {
    const match = fuzzyFind(newText, expected, hunk.start);
    if (match && match.ratio <= opts.maxDistanceRatio) {
      return { start: match.start, end: match.end, side: expectedSide, anchor: 'fuzzy' };
    }
  }

  return null;
}

/**
 * Whether a decision Save would write (an accepted change not saved yet, or a
 * saved one turned back) may stay on this candidate of its own side. An empty
 * place, known only by its surroundings, needs them to read as they did on
 * both sides, so Save never inserts words a little way from the same words
 * already typed by hand. Words need them on one side at least, unless they are
 * the only such words in the file and did not stand beside a copy of
 * themselves: otherwise Save would write over whichever of several the rebase
 * picked, as when a doubled word was deleted by hand together with the words
 * either side of it and only its twin is left.
 */
function placedPlainly(
  c: Candidate,
  anchor: AnchorQuality,
  oldText: string,
  hunk: Hunk,
  words: string
): boolean {
  const before = c.before === CONTEXT_CHARS;
  const after = c.after === CONTEXT_CHARS;
  if (c.place) return before && after;
  if (before || after) return true;
  return anchor === 'exact' && !twinned(oldText, hunk, words);
}

/** Whether a hunk's words stood right next to an identical copy in the old text, as one word of a doubled "the the" does. */
function twinned(oldText: string, hunk: Hunk, words: string): boolean {
  if (words.length === 0) return false;
  return (
    oldText.slice(Math.max(0, hunk.start - words.length), hunk.start) === words ||
    oldText.slice(hunk.end, hunk.end + words.length) === words
  );
}

/**
 * Every place one side of a hunk could sit in the new text: occurrences of its
 * words, or, for a side that holds no text, zero-width places found by the
 * text around the hunk (`placeCandidates`), which compete with the other
 * side's words on the same footing.
 */
function candidates(
  oldText: string,
  newText: string,
  hunk: Hunk,
  side: BaseSide,
  text: string,
  own: boolean,
  opts: typeof DEFAULTS
): Candidate[] {
  return text.length > 0
    ? wordCandidates(oldText, newText, hunk, side, text, own)
    : placeCandidates(oldText, newText, hunk, side, own, opts);
}

/** Every place `needle` could sit in the new text, scored for ranking. */
function wordCandidates(
  oldText: string,
  newText: string,
  hunk: Hunk,
  side: BaseSide,
  needle: string,
  own: boolean
): Candidate[] {
  const { offsets, clean } = cleanOccurrences(newText, needle);
  // Only the nearest handful matter; a far-away duplicate rarely wins, and
  // scoring every occurrence of a common word would be wasteful.
  return nearestOf(offsets, hunk.start).map((start) => ({
    start,
    end: start + needle.length,
    side,
    place: false,
    clean: clean && isCleanMatch(newText, start, needle),
    siblings: offsets.length,
    before: agreeBefore(oldText, hunk.start, newText, start),
    after: agreeAfter(oldText, hunk.end, newText, start + needle.length),
    distance: Math.abs(start - hunk.start),
    own,
    plain: false
  }));
}

/**
 * Zero-width places for a side that holds no text, the empty side of a
 * deletion or an insertion, found by the text that surrounded the hunk in the
 * old file: `contextChars` of it either side together, then half and a
 * quarter of that, then either side alone at those widths, so that an edit
 * right next to the place still leaves one side to find it by. The first that
 * occurs in the new text, other than inside a word, gives the places, nearest
 * to the old offset first.
 * Each is scored like a word, so the place the words were taken out of, whose
 * surroundings agree on both sides, outranks the twin of a doubled word, which
 * agrees on one side at most.
 */
function placeCandidates(
  oldText: string,
  newText: string,
  hunk: Hunk,
  side: BaseSide,
  own: boolean,
  opts: typeof DEFAULTS
): Candidate[] {
  for (const { needle, offset } of contextNeedles(oldText, hunk, opts.contextChars)) {
    // Deletions and insertions are whole words, so a place inside a word is no find.
    const places = [...new Set(occurrences(newText, needle).map((at) => at + offset))].filter(
      (at) => !insideWord(newText, at)
    );
    if (places.length === 0) continue;
    return nearestOf(places, hunk.start).map((at) => ({
      start: at,
      end: at,
      side,
      place: true,
      clean: true,
      siblings: places.length,
      before: agreeBefore(oldText, hunk.start, newText, at),
      after: agreeAfter(oldText, hunk.end, newText, at),
      distance: Math.abs(at - hunk.start),
      own,
      plain: false
    }));
  }
  return [];
}

/** The texts a zero-width place is looked for by, best first, with where the place sits in each. */
function contextNeedles(
  oldText: string,
  hunk: Hunk,
  contextChars: number
): Array<{ needle: string; offset: number }> {
  const widths = [contextChars, Math.round(contextChars / 2), Math.round(contextChars / 4)].filter(
    (w, i, all) => w > 0 && all.indexOf(w) === i
  );
  const left = (w: number): string => oldText.slice(Math.max(0, hunk.start - w), hunk.start);
  const right = (w: number): string => oldText.slice(hunk.end, hunk.end + w);

  const needles: Array<{ needle: string; offset: number }> = [];
  const seen = new Set<string>();
  const add = (needle: string, offset: number): void => {
    const key = `${offset}:${needle}`;
    if (needle.length === 0 || seen.has(key)) return;
    seen.add(key);
    needles.push({ needle, offset });
  };
  for (const w of widths) add(left(w) + right(w), left(w).length);
  for (const w of widths) {
    add(left(w), left(w).length);
    add(right(w), 0);
  }
  return needles;
}

/** A zero-width place found by its surroundings with small edits allowed, once nothing was found exactly. */
function placeByFuzzyContext(
  oldText: string,
  newText: string,
  hunk: Hunk,
  side: BaseSide,
  opts: typeof DEFAULTS
): Found | null {
  const left = oldText.slice(Math.max(0, hunk.start - opts.contextChars), hunk.start);
  const right = oldText.slice(hunk.end, hunk.end + opts.contextChars);
  const context = left + right;
  if (context.length === 0) return null;

  const match = fuzzyFind(newText, context, hunk.start);
  if (match && match.ratio <= opts.maxDistanceRatio) {
    const at = Math.min(newText.length, match.start + left.length);
    return { start: at, end: at, side, anchor: 'fuzzy' };
  }
  return null;
}

function nearestOf(offsets: readonly number[], near: number): number[] {
  return [...offsets].sort((a, b) => Math.abs(a - near) - Math.abs(b - near)).slice(0, NEAREST);
}

/**
 * How many characters before `at` in the old text and before `bt` in the new
 * one agree, up to `CONTEXT_CHARS`. Where both texts begin together within
 * that distance, the start of the text agrees too, so the surroundings agree
 * in full; where only one of them begins there, they agree no further.
 */
function agreeBefore(oldText: string, at: number, newText: string, bt: number): number {
  for (let k = 0; k < CONTEXT_CHARS; k += 1) {
    const i = at - 1 - k;
    const j = bt - 1 - k;
    if (i < 0 || j < 0) return i < 0 && j < 0 ? CONTEXT_CHARS : k;
    if (oldText[i] !== newText[j]) return k;
  }
  return CONTEXT_CHARS;
}

/** The same after `from` in the old text and `bfrom` in the new one, with the end of the text. */
function agreeAfter(oldText: string, from: number, newText: string, bfrom: number): number {
  for (let k = 0; k < CONTEXT_CHARS; k += 1) {
    const i = from + k;
    const j = bfrom + k;
    if (i >= oldText.length || j >= newText.length) {
      return i >= oldText.length && j >= newText.length ? CONTEXT_CHARS : k;
    }
    if (oldText[i] !== newText[j]) return k;
  }
  return CONTEXT_CHARS;
}

function remapComment(
  comment: ReviewComment,
  oldParagraphs: readonly Paragraph[],
  newParagraphs: readonly Paragraph[],
  newText: string
): ReviewComment {
  if (comment.paragraph === null) return comment;
  const old = oldParagraphs.find((p) => !p.isFrontmatter && p.index === comment.paragraph);
  if (old) {
    const key = old.text.slice(0, 40);
    const hit = newParagraphs.find((p) => !p.isFrontmatter && p.text.startsWith(key));
    if (hit) return { ...comment, paragraph: hit.index };
  }
  if (comment.quote && comment.quote.length > 0) {
    const at = newText.indexOf(comment.quote);
    if (at >= 0) return { ...comment, paragraph: paragraphIndexAt(newParagraphs, at) };
  }
  return { ...comment, paragraph: null };
}
