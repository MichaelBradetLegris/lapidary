import { anchorChanges, type ChangeInput } from './diff/anchor';
import { guardTouching, isGuarded, screenModelHunks, touchingRule } from './diff/protect';
import { diffToHunks } from './diff/wordDiff';
import { nextId, slugify } from './ids';
import { normalizeText } from './text/eol';
import { bodyStart } from './text/obsidian';
import {
  bodyParagraphs,
  findParagraph,
  paragraphIndexAt,
  splitParagraphs,
  type Paragraph
} from './text/paragraphs';
import {
  CHANGE_CATEGORIES,
  COMMENT_CATEGORIES,
  type ChangeCategory,
  type CommentCategory,
  type GeneratorKind,
  type GeneratorProvider,
  type Hunk,
  type Review,
  type ReviewBase,
  type ReviewComment,
  type ReviewGenerator
} from './types';

/** Last path segment without its extension, for any platform's separators. */
export function chapterName(sourcePath: string): string {
  const segments = sourcePath.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? '';
  return last.replace(/\.[^.]+$/, '') || 'untitled';
}

/** Lower-case extension including the dot, or '' when the name carries none. */
export function chapterExtension(sourcePath: string): string {
  const segments = sourcePath.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? '';
  const match = /\.[^.]+$/.exec(last);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Folder name for a chapter's reviews. The extension is part of it for anything
 * but `.md`, so `Chapter 01.md` and `Chapter 01.txt` cannot share a folder and
 * silently show each other's reviews. `.md` keeps the bare slug, which is what
 * every review written before `.txt` support already uses.
 */
export function chapterSlug(sourcePath: string): string {
  const base = slugify(chapterName(sourcePath));
  const ext = chapterExtension(sourcePath);
  return ext === '' || ext === '.md' ? base : `${base}-${ext.slice(1)}`;
}

export function makeReviewId(sourcePath: string, createdAt: string): string {
  return `${chapterSlug(sourcePath)}--${createdAt.replace(/[:.]/g, '-')}`;
}

export function toChangeCategory(value: unknown): ChangeCategory {
  return (CHANGE_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as ChangeCategory)
    : 'other';
}

export function toCommentCategory(value: unknown): CommentCategory {
  return (COMMENT_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as CommentCategory)
    : 'other';
}

export interface CommentInput {
  paragraph: number | null;
  quote?: string;
  category: string;
  text: string;
}

export function toComments(inputs: readonly CommentInput[]): ReviewComment[] {
  return inputs.map((c) => ({
    id: nextId('c'),
    paragraph: c.paragraph,
    ...(c.quote ? { quote: c.quote } : {}),
    category: toCommentCategory(c.category),
    text: c.text,
    status: 'open' as const
  }));
}

export interface CreateReviewArgs {
  sourcePath: string;
  base: ReviewBase;
  hunks: Hunk[];
  comments?: ReviewComment[];
  generator: ReviewGenerator;
  raw?: unknown;
  now?: string;
}

export function createReview(args: CreateReviewArgs): Review {
  const createdAt = args.now ?? new Date().toISOString();
  return {
    version: 1,
    id: makeReviewId(args.sourcePath, createdAt),
    sourcePath: args.sourcePath,
    createdAt,
    updatedAt: createdAt,
    base: args.base,
    generator: args.generator,
    ...(args.raw === undefined ? {} : { raw: args.raw }),
    hunks: args.hunks,
    comments: args.comments ?? []
  };
}

/**
 * A review built from a model's change list, anchored into the chapter. Each
 * suggestion is screened before overlaps are resolved, and the touching rule
 * runs within the overlap pass, so one that would change Obsidian syntax is
 * kept out of the text and listed under Unanchored, and pushes no other off
 * the page as an overlap (`files.7`, PLAN 4.3 and 11.3 k).
 */
export function createAiReview(args: {
  sourcePath: string;
  base: ReviewBase;
  changes: readonly ChangeInput[];
  comments: readonly CommentInput[];
  generator: ReviewGenerator;
  raw?: unknown;
  now?: string;
}): Review {
  const text = args.base.text;
  const paragraphs = splitParagraphs(text);
  // `source: 'claude'` is the hunk's provenance marker for "a model wrote this",
  // and everything downstream keys off it. Renaming it would invalidate every
  // review on disk for no gain, so both providers keep using it.
  const hunks = anchorChanges(text, paragraphs, args.changes, {
    source: 'claude',
    screen: (located) => screenModelHunks(text, located),
    touching: touchingRule(text)
  });
  return createReview({
    sourcePath: args.sourcePath,
    base: args.base,
    hunks,
    comments: toComments(args.comments),
    generator: args.generator,
    ...(args.raw === undefined ? {} : { raw: args.raw }),
    ...(args.now ? { now: args.now } : {})
  });
}

/**
 * A review built by diffing two texts. `originalRaw` and `correctedRaw` are the
 * texts exactly as pasted or read, so their EOL and BOM are captured here.
 */
export function createDiffReview(args: {
  sourcePath?: string;
  originalRaw: string;
  correctedRaw: string;
  hash?: string;
  kind?: 'manual' | 'file';
  now?: string;
}): Review {
  const original = normalizeText(args.originalRaw);
  const corrected = normalizeText(args.correctedRaw);
  const base: ReviewBase = {
    text: original.text,
    hash: args.hash ?? '',
    eol: original.eol,
    bom: original.bom,
    trailingNewline: original.trailingNewline
  };
  return createReview({
    sourcePath: args.sourcePath ?? '',
    base,
    hunks: diffToHunks(original.text, corrected.text),
    generator: { kind: args.kind ?? 'manual' },
    ...(args.now ? { now: args.now } : {})
  });
}

/**
 * Bring a review loaded from disk up to the current shape.
 *
 * The Phase 5b migration: the `paste` generator kind became `manual` when paste
 * mode was split into "New chapter" and "Submit manual review". Reviews written
 * before that must still open, so the old value is translated on load rather
 * than rejected. The object is returned untouched when nothing needs changing,
 * so identity checks stay cheap.
 */
export function migrateReview(review: Review): Review {
  const kind = (review.generator as { kind: string }).kind;
  if (kind !== 'paste') return review;
  return { ...review, generator: { ...review.generator, kind: 'manual' } };
}

/**
 * The provider a generator kind implies, for a model-written review: `openai`
 * too, for a review saved on an OpenAI API key before codex.6.
 */
function providerForKind(kind: GeneratorKind): GeneratorProvider | undefined {
  return kind === 'claude' || kind === 'chatgpt' || kind === 'openai' ? kind : undefined;
}

/**
 * The Phase 5c load step: fill in `generator.provider` where it is missing.
 *
 * No review written before Phase 5c carries the field, and every model-written
 * review from that era was Claude's, so a `claude` kind gets `provider: 'claude'`.
 * A manual or file review has no provider and is left alone. Kept apart from
 * `migrateReview` so each step keeps its own identity-when-unchanged contract;
 * `loadReviewFile` applies both.
 */
export function withGeneratorProvider(review: Review): Review {
  const generator: ReviewGenerator = review.generator;
  if (generator.provider) return review;
  const provider = providerForKind(generator.kind);
  if (!provider) return review;
  return { ...review, generator: { ...generator, provider } };
}

/**
 * The guard on a review loaded from disk (`files.7`): its model suggestions
 * still pending are screened as a new review's are, then the touching rule
 * runs (`guardTouching`: a saved review's hunks on the page never overlap,
 * so there is no overlap pass to run it in), so a review saved before the
 * guard existed opens with a suggestion that would change Obsidian syntax
 * under Unanchored, kept out of the text.
 * What the author decided, wrote or rewrote is left as it is, and so is a
 * suggestion kept out already. The review comes back untouched when nothing
 * is kept out, so loading it again changes nothing.
 */
export function guardLoadedReview(review: Review): Review {
  const text = review.base.text;
  const hunks = guardTouching(text, screenModelHunks(text, review.hunks));
  return hunks.every((hunk, i) => hunk === review.hunks[i]) ? review : { ...review, hunks };
}

/**
 * A review loaded from disk keeps on the page only hunks the page draws: none
 * before the first body paragraph or past the last (`files.22`, C.76), so none
 * in the frontmatter, at the line break that closes it, or in the blank lines
 * at either end of the text. A zero-width hunk at the very start of the first
 * paragraph or the very end of the last is drawn there and stays. In a body
 * with no paragraph, where the page has no block to draw in, only a hunk that
 * starts before the body (`bodyStart`) is taken off.
 *
 * Until `files.22` a paragraph took the line break at either end of the body
 * when that was a single one: the break after the closing `---` where the body
 * starts on the next line, the first line of a text that starts with a blank
 * line, and the last line of one that ends with a blank line (a file that ends
 * in two line breaks). The paragraph box and the full-text diff made hunks on
 * those breaks: the deletion of one, often joined to a change of the words
 * beside it, and a paragraph added at the top; and the diff deleted a last
 * paragraph with the blank lines that end the text. Since `files.22` no
 * paragraph holds them, so the page does not draw such a hunk, and Save would
 * still write it, putting the body on the closing line, where Obsidian no
 * longer reads the frontmatter, and a box opened on that paragraph again could
 * make a hunk that overlaps it. Each is taken off the page as a rebase takes one (4.5,
 * `files.20`): unanchored, its words and decision kept, listed under
 * Unanchored. A model suggestion the guard screens is left to it, which keeps
 * it out with the reason `frontmatter` or `paragraph-break`. The review comes
 * back untouched when nothing moved. Nothing the app makes since `files.22`
 * has such a hunk, before Save or after it (`remapAfterCommit`).
 */
export function unanchorOutsideBody(review: Review): Review {
  const text = review.base.text;
  const body = bodyParagraphs(splitParagraphs(text));
  const first = body[0];
  const last = body[body.length - 1];
  const from = first ? first.start : bodyStart(text);
  const to = last ? last.end : text.length;
  let moved = false;
  const hunks = review.hunks.map((hunk) => {
    if (hunk.anchor === 'stale' || isGuarded(hunk) || (hunk.start >= from && hunk.end <= to)) return hunk;
    moved = true;
    return { ...hunk, anchor: 'stale' as const, start: 0, end: 0 };
  });
  return moved ? { ...review, hunks } : review;
}

/** Every load-time upgrade, in order. What `reviews.ts` runs on each file it reads. */
export function upgradeLoadedReview(review: Review): Review {
  return guardLoadedReview(
    unanchorOutsideBody(repairCommentAnchors(withGeneratorProvider(migrateReview(review))))
  );
}

/* ------------------------------------------------------------------ */
/* Keeping comments and labels on their paragraphs (files.21)          */
/* ------------------------------------------------------------------ */

interface CommitPair {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/** Where each anchored hunk sat before a commit and where it sits after, in order. */
function commitPairs(oldHunks: readonly Hunk[], newHunks: readonly Hunk[]): CommitPair[] {
  const after = new Map(newHunks.map((h) => [h.id, h]));
  return oldHunks
    .filter((h) => h.anchor !== 'stale')
    .flatMap((h) => {
      const moved = after.get(h.id);
      return moved && moved.anchor !== 'stale'
        ? [{ oldStart: h.start, oldEnd: h.end, newStart: moved.start, newEnd: moved.end }]
        : [];
    })
    .sort((a, b) => a.oldStart - b.oldStart || a.oldEnd - b.oldEnd);
}

/**
 * An offset in the old base, moved through a commit. Text before it that
 * changed length shifts it; an offset inside a changed span lands at the
 * corresponding point of the new span, or its end if the span got shorter.
 */
function mapOffset(offset: number, pairs: readonly CommitPair[]): number {
  let delta = 0;
  for (const pair of pairs) {
    if (offset < pair.oldStart || (offset === pair.oldStart && pair.oldStart !== pair.oldEnd)) break;
    if (offset >= pair.oldEnd && pair.oldStart !== pair.oldEnd) {
      delta = pair.newEnd - pair.oldEnd;
      continue;
    }
    if (pair.oldStart === pair.oldEnd) {
      // An insertion at this very offset: the paragraph start stays before it.
      if (offset === pair.oldStart) return pair.newStart;
      delta = pair.newEnd - pair.oldEnd;
      continue;
    }
    return Math.min(pair.newStart + (offset - pair.oldStart), pair.newEnd);
  }
  return offset + delta;
}

/** The paragraph holding the occurrence of `quote` nearest to `near`, or null. */
function paragraphOfQuote(
  text: string,
  paragraphs: readonly Paragraph[],
  quote: string,
  near: number,
  within?: { start: number; end: number }
): number | null {
  let best: { distance: number; at: number } | null = null;
  for (let at = text.indexOf(quote); at >= 0; at = text.indexOf(quote, at + 1)) {
    if (within && (at < within.start || at + quote.length > within.end)) continue;
    const distance = Math.abs(at - near);
    if (!best || distance < best.distance) best = { distance, at };
  }
  return best ? paragraphIndexAt(paragraphs, best.at) : null;
}

/** Whether `text` is blank: nothing but spaces, tabs and line breaks. */
const BLANK = /^[ \t\n]*$/;

/**
 * A hunk that a save left starting in the blank text before the first body
 * paragraph, which starts at `at`, moved to the paragraph's start, where the
 * page draws it (the `files.22` review, C.76). The full-text diff puts some
 * words behind a blank line: a paragraph added to a body that had none, with
 * the line break that closes the frontmatter where the text ended at its
 * closing `---`, and a last paragraph deleted with the blank line before it.
 * When a save leaves no words before them, the hunk starts in blank text,
 * before the first paragraph and even before `bodyStart`, and so does a
 * zero-width one at that place, left undecided or dismissed. The page draws
 * neither, and the load step would take them off the page
 * (`unanchorOutsideBody`).
 *
 * The blank text is left out of the side the base holds, so what the hunk
 * writes either way is as it was but for blank lines: taken out again, its
 * words go, and the frontmatter's closing line break and the blank line stay.
 * A zero-width hunk goes to the paragraph's start, and its words, which went in
 * behind blank text, go in there followed by that blank text, so paragraphs
 * keep their order. A hunk that starts in the frontmatter's words, or lies on
 * blank text alone, stays as it is: the app makes neither.
 */
function intoFirstParagraph(text: string, at: number, hunk: Hunk): Hunk {
  if (hunk.anchor === 'stale' || hunk.start >= at) return hunk;
  const blank = text.slice(hunk.start, at);
  if (!BLANK.test(blank)) return hunk;
  if (hunk.end > hunk.start) {
    if (hunk.end <= at) return hunk;
    const own = hunk.baseSide;
    return { ...hunk, start: at, [own]: hunk[own].slice(blank.length) };
  }
  const other = hunk.baseSide === 'original' ? 'replacement' : 'original';
  const words = hunk[other].replace(/^[ \t\n]+/, '');
  if (words.length === 0) return hunk;
  return { ...hunk, start: at, end: at, [other]: `${words}${blank}` };
}

/**
 * Comments and hunk labels after a save folds the decisions into a new base
 * (`markSaved`). A save that adds, joins or deletes a paragraph renumbers every
 * paragraph after it, and paragraph numbers are all a comment has. So each
 * comment follows its paragraph's position through the commit. When that
 * paragraph was split, the comment goes with the part that holds its quote;
 * when the quote moved elsewhere, it goes to the nearest paragraph that holds
 * it. A hunk the save left in the blank text before the first paragraph moves
 * to its start (`intoFirstParagraph`), and hunk labels are recomputed from
 * their new offsets.
 */
export function remapAfterCommit(
  oldBase: string,
  oldHunks: readonly Hunk[],
  committed: { text: string; hunks: readonly Hunk[] },
  comments: readonly ReviewComment[]
): { hunks: Hunk[]; comments: ReviewComment[] } {
  const oldParagraphs = splitParagraphs(oldBase);
  const newParagraphs = splitParagraphs(committed.text);
  const pairs = commitPairs(oldHunks, committed.hunks);
  const first = bodyParagraphs(newParagraphs)[0];

  const hunks = committed.hunks.map((was) => {
    if (was.anchor === 'stale') return was;
    const h = first ? intoFirstParagraph(committed.text, first.start, was) : was;
    const paragraph = paragraphIndexAt(newParagraphs, h.start);
    return paragraph === h.paragraph ? h : { ...h, paragraph };
  });

  const remapped = comments.map((comment) => {
    if (comment.paragraph === null) return comment;
    const old = findParagraph(oldParagraphs, comment.paragraph);
    if (!old) return comment;
    const start = mapOffset(old.start, pairs);
    const end = Math.max(start, mapOffset(old.end, pairs));
    let paragraph = paragraphIndexAt(newParagraphs, start);
    if (comment.quote) {
      paragraph =
        paragraphOfQuote(committed.text, newParagraphs, comment.quote, start, { start, end }) ??
        paragraphOfQuote(committed.text, newParagraphs, comment.quote, start) ??
        paragraph;
    }
    return paragraph === comment.paragraph ? comment : { ...comment, paragraph };
  });

  return { hunks, comments: remapped };
}

/**
 * Comments saved before `remapAfterCommit` existed can sit one or more
 * paragraphs away from their quote, after a save that split or joined a
 * paragraph (reported 2026-10-14). Run on every load: a comment whose quote is
 * not in its paragraph moves to the nearest paragraph that holds it. A comment
 * whose quote is found nowhere stays put. The review comes back untouched when
 * nothing moved.
 */
export function repairCommentAnchors(review: Review): Review {
  const paragraphs = splitParagraphs(review.base.text);
  let changed = false;
  const comments = review.comments.map((comment) => {
    if (comment.paragraph === null || !comment.quote) return comment;
    const own = findParagraph(paragraphs, comment.paragraph);
    if (own?.text.includes(comment.quote)) return comment;
    const near = own?.start ?? 0;
    const found = paragraphOfQuote(review.base.text, paragraphs, comment.quote, near);
    if (found === null || found === comment.paragraph) return comment;
    changed = true;
    return { ...comment, paragraph: found };
  });
  return changed ? { ...review, comments } : review;
}

/**
 * The review with `sourcePath` set to the chapter it is being used for: the
 * same object when it already says so, otherwise a copy (same id). Used when a
 * review is opened for a chapter whose path is spelled differently or that it
 * was adopted by, so the next save writes into that chapter's folder (files.1).
 */
export function rehomeReview(review: Review, sourcePath: string): Review {
  return review.sourcePath === sourcePath ? review : { ...review, sourcePath };
}
