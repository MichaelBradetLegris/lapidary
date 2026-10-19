import { bodyStart } from '../text/obsidian';
import { paragraphIndexAt, splitParagraphs, type Paragraph } from '../text/paragraphs';
import type { AnchorQuality, BaseSide, Hunk, HunkStatus, Review, ReviewBase, ReviewComment } from '../types';
import { resolveOverlaps } from './anchor';
import { changesBase } from './compose';
import { cleanOccurrences, fuzzyFind, insideWord, isCleanMatch, isWordChar, occurrences } from './fuzzy';
import { screenModelHunks, touchingRule } from './protect';

export interface RebaseStats {
  /** hunks on the page after the rebase: found in the new text, and neither kept out nor overlapped */
  anchored: number;
  /** hunks off the page after the rebase, those already off it before included */
  stale: number;
  /**
   * hunks the rebase took off the page: on it before, off it after, and not
   * kept out (`files.20`). What the cards count as "could not be found".
   */
  newlyStale: number;
  /**
   * model suggestions the rebase kept out of the text (`files.20`): placed
   * where the file has them now, they would change Obsidian syntax. Those
   * kept out before are not counted again.
   */
  keptOut: number;
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
 *
 * Only the body of the new text is searched: no hunk, whatever its source,
 * is placed before `bodyStart`, in the frontmatter or at the line break that
 * closes it (`files.20`). The guard then runs as when a review is made (4.3
 * steps 7 and 8): each model suggestion still undecided is screened in its
 * new place before overlaps are resolved, and the touching rule runs within
 * the overlap pass, so a change on disk that puts one into syntax, or right
 * where another ends, keeps it out of the text (`files.20`).
 */
export function rebaseReview(
  review: Review,
  nextBase: ReviewBase,
  options: RebaseOptions = {}
): RebaseResult {
  const opts = { ...DEFAULTS, ...options };
  const oldText = review.base.text;
  const newText = nextBase.text;
  const body = bodyStart(newText);
  const oldParagraphs = splitParagraphs(oldText);
  const newParagraphs = splitParagraphs(newText);

  const present = new Set(review.hunks.map((h) => h.id));

  let adopted = 0;
  const moved: Hunk[] = review.hunks.map((hunk) => {
    /* A suggestion the guard kept out of the text stays out (files.7, 11.3 k):
       found again, it would be back on the page, the syntax it would change
       and all. */
    if (hunk.keptOut !== undefined) return hunk;
    /* A suggestion the author's own edit swallowed stays off the page. Its words
       often still exist inside the edit that replaced them, so re-anchoring it
       would put two hunks over the same span and undo a decision the author
       already made (item 3b). */
    if (hunk.supersededBy && present.has(hunk.supersededBy)) {
      return { ...hunk, anchor: 'stale', start: 0, end: 0 };
    }
    const found = locate(oldText, newText, body, hunk, opts);
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

  const hunks = resolveOverlaps(screenModelHunks(newText, moved), touchingRule(newText));

  let orphanedComments = 0;
  const comments: ReviewComment[] = review.comments.map((comment) => {
    const next = remapComment(comment, oldParagraphs, newParagraphs, newText);
    if (comment.paragraph !== null && next.paragraph === null) orphanedComments += 1;
    return next;
  });

  const was = new Map(review.hunks.map((h) => [h.id, h]));
  let stale = 0;
  let newlyStale = 0;
  let keptOut = 0;
  for (const hunk of hunks) {
    if (hunk.anchor !== 'stale') continue;
    stale += 1;
    const before = was.get(hunk.id);
    if (hunk.keptOut !== undefined && before?.keptOut === undefined) keptOut += 1;
    else if (before !== undefined && before.anchor !== 'stale') newlyStale += 1;
  }

  return {
    review: {
      ...review,
      base: { ...nextBase },
      updatedAt: new Date().toISOString(),
      hunks,
      comments
    },
    stats: { anchored: hunks.length - stale, stale, newlyStale, keptOut, adopted, orphanedComments }
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

/**
 * How many characters of whole words a side of a place that no longer reads
 * as before in full must still agree for, to count (`plainlyOnDisk`,
 * `placedPlainly`): the narrowest context a place is looked for by
 * (`contextNeedles`).
 */
const PINNED = 12;

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
 * the decision (C.5). A zero-width place was found by the text around it, and
 * it counts where that text reads as before in full on one side, or for at
 * least `PINNED` characters of whole words on both, a side with less old text
 * than that saying nothing: a place found only by a few words, such as the
 * last word of the file recurring further up, is no evidence that a change
 * was made or undone. A place near copies of the hunk's own words has been
 * weighed against them first (`settleCopies`). Words count only when they
 * plainly are the hunk's own: a word-boundary match whose surroundings read
 * as they did on both sides; on one side, unless the words stood right beside
 * a copy of themselves, which may be all that is left of them; or, for a hunk
 * whose own side has words, the only word-boundary match in the file. A side
 * counts only where the old file has text on it: the start of the file alone
 * says nothing. Words found anywhere else say nothing about whether a change was
 * made or undone: that is how a saved deletion of one word of a doubled
 * "the the" came back as a suggestion to delete the "the" that remained, or
 * another "the" nearby (apply.23).
 */
function plainlyOnDisk(
  c: Candidate,
  oldText: string,
  newText: string,
  hunk: Hunk,
  expected: string,
  other: string
): boolean {
  if (c.place) {
    if (c.before === CONTEXT_CHARS || c.after === CONTEXT_CHARS) return true;
    const before = hunk.start < PINNED || wordsBefore(oldText, hunk.start, newText, c.start) >= PINNED;
    const after =
      oldText.length - hunk.end < PINNED || wordsAfter(oldText, hunk.end, newText, c.end) >= PINNED;
    return before && after;
  }
  if (!c.clean) return false;
  const before = hunk.start > 0 && c.before === CONTEXT_CHARS;
  const after = hunk.end < oldText.length && c.after === CONTEXT_CHARS;
  if (before && after) return true;
  if ((before || after) && !twinned(oldText, hunk, other)) return true;
  return c.siblings === 1 && expected.length > 0;
}

/**
 * Where a hunk goes in the new text, or null when it leaves the page. Nothing
 * before `body` (`bodyStart` of the new text) is looked at: no occurrence of
 * the hunk's words, no place found by its surroundings and no copy weighed
 * against one starts there, and the fuzzy search reads the body alone, so no
 * hunk of any source is placed in the frontmatter (`files.20`).
 */
function locate(
  oldText: string,
  newText: string,
  body: number,
  hunk: Hunk,
  opts: typeof DEFAULTS
): Found | null {
  /* A hunk already off the page has no place in the old text (its offsets are
     0), and a side that holds no text is found only by what surrounds its
     place, so a deletion or an insertion that went stale stays stale rather
     than come back at the start of the chapter. */
  if (hunk.anchor === 'stale' && (hunk.original.length === 0 || hunk.replacement.length === 0)) return null;
  const expectedSide: BaseSide = hunk.baseSide;
  const otherSide: BaseSide = expectedSide === 'original' ? 'replacement' : 'original';
  const expected = expectedSide === 'original' ? hunk.original : hunk.replacement;
  const other = otherSide === 'original' ? hunk.original : hunk.replacement;

  const { pool, unclear } = settleCopies(
    oldText,
    newText,
    body,
    hunk,
    expected,
    candidates(oldText, newText, body, hunk, expectedSide, expected, true, opts),
    candidates(oldText, newText, body, hunk, otherSide, other, false, opts).map((c) => ({
      ...c,
      plain: plainlyOnDisk(c, oldText, newText, hunk, expected, other)
    }))
  );
  pool.sort(betterCandidate);

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
    if (
      best.own &&
      changesBase(hunk) &&
      (unclear.has(best.start) || !placedPlainly(best, anchor, oldText, newText, hunk, expected))
    ) {
      return null;
    }
    return { start: best.start, end: best.end, side: best.side, anchor };
  }

  /* Only words are placed by the fuzzy search. A zero-width place found by
     surroundings that no longer read as before is a guess that can fall
     inside a word, where accepting the suggestion and saving would write its
     words into the middle of another ("alwaysvery  fine"), so a deletion or
     an insertion with nothing found exactly leaves the page instead. */
  if (expected.length > 0) {
    const match = fuzzyFind(newText.slice(body), expected, hunk.start - body);
    if (match && match.ratio <= opts.maxDistanceRatio) {
      return { start: body + match.start, end: body + match.end, side: expectedSide, anchor: 'fuzzy' };
    }
  }

  return null;
}

/**
 * Whether a decision Save would write (an accepted change not saved yet, or a
 * saved one turned back) may stay on this candidate of its own side. An empty
 * place, known only by its surroundings, needs them to read as they did in
 * full on one side and for at least `PINNED` characters of whole words on the
 * other, so an edit a few words off on either side leaves it where it was,
 * while Save never inserts words beside different words typed by hand at the
 * place ("Then later Mara", where the text before agrees for none). Words
 * need their surroundings in full on one side, unless they are the only such
 * words in the file and did not stand beside a copy of themselves: otherwise
 * Save would write over whichever of several the rebase picked, as when a
 * doubled word was deleted by hand together with the words either side of it
 * and only its twin is left.
 */
function placedPlainly(
  c: Candidate,
  anchor: AnchorQuality,
  oldText: string,
  newText: string,
  hunk: Hunk,
  words: string
): boolean {
  const before = c.before === CONTEXT_CHARS;
  const after = c.after === CONTEXT_CHARS;
  if (c.place) {
    if (before && after) return true;
    if (before) return wordsAfter(oldText, hunk.end, newText, c.end) >= PINNED;
    if (after) return wordsBefore(oldText, hunk.start, newText, c.start) >= PINNED;
    return false;
  }
  if (before || after) return true;
  return anchor === 'exact' && !twinned(oldText, hunk, words);
}

/**
 * A place on the side the base does not hold, against copies of the hunk's
 * own words near it. A place found by the text on one side of it can sit
 * right beside those words, or a word or two from them, and its score on the
 * other side then runs into them or into whatever was typed beside them, so an
 * edited neighbour let it beat the words by a character or two: a suggested
 * deletion of one word of "before the the storm" was taken as made when
 * "before" became "after", and an accepted one dropped from Save (the
 * `apply.23` review). Each copy of the words within `CONTEXT_CHARS` of the
 * place is weighed against it on the side the copy is on, in whole words only
 * (`wordsBefore`, `wordsAfter`). For a copy right beside the place: from the
 * place itself, how far the new text reads as the old with the words taken
 * out (`out`) and as the old with them in (`in`). For a copy further off,
 * with other words between: how far the text beyond the copy reads as the old
 * text beyond the hunk (`in`), against the place's own score on that side
 * (`out`).
 *
 * Where any copy reads further, the place goes. Where the place reads further
 * against every copy, it stands, and a copy right beside it is a copy indeed,
 * the twin of a doubled word, which leaves the pool. A tie right beside the
 * place counts for the place when the words stood twice in a row and stand
 * only once there now, since the change is then made whichever copy went
 * ("and the the frayed" changed to "but the frayed"). A tie further off counts
 * for the place when a copy right beside it lost. Any other tie removes the
 * place and keeps the copies, but as no place for Save to write a decision
 * (`unclear`), except a copy whose own surroundings read further than the
 * place's in all, which would have won anyway: "river the before" changed to
 * "night the to before" reads as well with "the" kept and "to" typed after it
 * as with "the" taken out and "night the to" typed before the place.
 */
function settleCopies(
  oldText: string,
  newText: string,
  body: number,
  hunk: Hunk,
  words: string,
  own: Candidate[],
  others: Candidate[]
): { pool: Candidate[]; unclear: Set<number> } {
  const unclear = new Set<number>();
  if (words.length === 0) return { pool: [...own, ...others], unclear };
  const twin = twinned(oldText, hunk, words);
  const copies = new Set<number>();
  const kept = others.filter((c) => {
    if (!c.place) return true;
    const at = c.start;
    const near = copiesNear(newText, body, at, words).map((start) => {
      const end = start + words.length;
      if (end === at) {
        return {
          start,
          beside: true,
          out: wordsBefore(oldText, hunk.start, newText, at),
          in: wordsBefore(oldText, hunk.end, newText, at)
        };
      }
      if (start === at) {
        return {
          start,
          beside: true,
          out: wordsAfter(oldText, hunk.end, newText, at),
          in: wordsAfter(oldText, hunk.start, newText, at)
        };
      }
      return end < at
        ? {
            start,
            beside: false,
            out: wordsBefore(oldText, hunk.start, newText, at),
            in: wordsBefore(oldText, hunk.start, newText, start)
          }
        : {
            start,
            beside: false,
            out: wordsAfter(oldText, hunk.end, newText, at),
            in: wordsAfter(oldText, hunk.end, newText, end)
          };
    });
    if (near.some((n) => n.out < n.in)) return false;
    const single = twin && copiesAt(newText, at, words) === 1;
    const beaten = near.filter((n) => n.out > n.in || (n.beside && single));
    const confirmed = beaten.some((n) => n.beside);
    const tied = near.filter((n) => !beaten.includes(n) && (n.beside || !confirmed));
    if (tied.length > 0) {
      // A copy whose surroundings read further than the place's in all would have won anyway.
      const score = c.before + c.after;
      for (const n of near) {
        const own =
          agreeBefore(oldText, hunk.start, newText, n.start) +
          agreeAfter(oldText, hunk.end, newText, n.start + words.length);
        if (own <= score) unclear.add(n.start);
      }
      return false;
    }
    for (const n of beaten) if (n.beside) copies.add(n.start);
    return true;
  });
  return { pool: [...own.filter((c) => !copies.has(c.start)), ...kept], unclear };
}

/**
 * Where `words` stand in the new text, whole, within `CONTEXT_CHARS` of a
 * place either side, and in the body (from `body` on): a copy in the
 * frontmatter can never be the hunk's own words.
 */
function copiesNear(newText: string, body: number, at: number, words: string): number[] {
  const from = Math.max(body, at - CONTEXT_CHARS - words.length);
  const window = newText.slice(from, at + CONTEXT_CHARS + words.length);
  return occurrences(window, words)
    .map((i) => from + i)
    .filter((start) => isCleanMatch(newText, start, words))
    .filter((start) => start + words.length <= at || start >= at);
}

/** How many copies of `words` stand in a row at `at`, either side of it. */
function copiesAt(text: string, at: number, words: string): number {
  let n = 0;
  for (let i = at; i >= words.length && text.startsWith(words, i - words.length); i -= words.length) n += 1;
  for (let i = at; text.startsWith(words, i); i += words.length) n += 1;
  return n;
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
  body: number,
  hunk: Hunk,
  side: BaseSide,
  text: string,
  own: boolean,
  opts: typeof DEFAULTS
): Candidate[] {
  return text.length > 0
    ? wordCandidates(oldText, newText, body, hunk, side, text, own)
    : placeCandidates(oldText, newText, body, hunk, side, own, opts);
}

/**
 * Every place `needle` could sit in the body of the new text (from `body`
 * on), scored for ranking. A copy in the frontmatter is not counted among
 * its `siblings` either.
 */
function wordCandidates(
  oldText: string,
  newText: string,
  body: number,
  hunk: Hunk,
  side: BaseSide,
  needle: string,
  own: boolean
): Candidate[] {
  const { offsets, clean } = cleanOccurrences(newText, needle, body);
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
 * to the old offset first. A place before `body` is no find either: the
 * text around it may start in the frontmatter, but the place may not.
 * Each is scored like a word, so the place the words were taken out of, whose
 * surroundings agree on both sides, outranks the twin of a doubled word, which
 * agrees on one side at most.
 */
function placeCandidates(
  oldText: string,
  newText: string,
  body: number,
  hunk: Hunk,
  side: BaseSide,
  own: boolean,
  opts: typeof DEFAULTS
): Candidate[] {
  for (const { needle, offset } of contextNeedles(oldText, hunk, opts.contextChars)) {
    // Deletions and insertions are whole words, so a place inside a word is no find.
    const places = [...new Set(occurrences(newText, needle).map((at) => at + offset))].filter(
      (at) => at >= body && !insideWord(newText, at)
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

/**
 * `agreeBefore`, short of full, in whole words: counted back only to the
 * start of the furthest word that agrees all through, in both texts. Letters
 * that agree part way into a word, as the "e" of "the" does with the "e" of
 * "before", are chance, and so is the space or the comma before a word.
 */
function wordsBefore(oldText: string, at: number, newText: string, bt: number): number {
  let k = agreeBefore(oldText, at, newText, bt);
  if (k === CONTEXT_CHARS) return k;
  while (
    k > 0 &&
    !(isWordChar(newText[bt - k]) && startsWord(newText, bt - k) && startsWord(oldText, at - k))
  ) {
    k -= 1;
  }
  return k;
}

/** `agreeAfter`, short of full, in whole words: to the end of the furthest word that agrees all through. */
function wordsAfter(oldText: string, from: number, newText: string, bfrom: number): number {
  let k = agreeAfter(oldText, from, newText, bfrom);
  if (k === CONTEXT_CHARS) return k;
  while (
    k > 0 &&
    !(isWordChar(newText[bfrom + k - 1]) && endsWord(newText, bfrom + k) && endsWord(oldText, from + k))
  ) {
    k -= 1;
  }
  return k;
}

function startsWord(text: string, at: number): boolean {
  return !isWordChar(text[at - 1]);
}

function endsWord(text: string, at: number): boolean {
  return !isWordChar(text[at]);
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
  /* Lost: the side panel says which paragraph it had and lists it there, since
     a comment usually belongs near where it was (ui.7). A comment that is
     already unanchored was returned above and keeps that number. */
  return { ...comment, paragraph: null, wasParagraph: comment.paragraph };
}
