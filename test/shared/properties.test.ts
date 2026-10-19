import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  commitDecisions,
  composeText,
  findOverlaps,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import { anchorChanges, type ChangeInput } from '../../src/shared/diff/anchor';
import { insideWord } from '../../src/shared/diff/fuzzy';
import { isGuarded, screenModelHunks } from '../../src/shared/diff/protect';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { diffToHunks } from '../../src/shared/diff/wordDiff';
import {
  applyBlockEdit,
  blockSpanFor,
  editSuggestion,
  liveTextIn,
  normalizeDraft,
  planBlockEdit
} from '../../src/shared/edit';
import { buildRenderBlocks } from '../../src/shared/render';
import { createAiReview, createReview, guardLoadedReview } from '../../src/shared/review';
import { bodyStart, syntaxSignature } from '../../src/shared/text/obsidian';
import { bodyParagraphs, frontmatterRange, splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkSource, HunkStatus, Review, ReviewBase } from '../../src/shared/types';

interface PieceSpec {
  isHunk: boolean;
  gap: number;
  span: number;
  status: HunkStatus;
  paragraphBreak: boolean;
  /** 'manual' hunks are the author's own edits; they compose and rebase alike */
  source: HunkSource;
}

const specArb: fc.Arbitrary<PieceSpec> = fc.record({
  isHunk: fc.boolean(),
  gap: fc.integer({ min: 1, max: 4 }),
  span: fc.integer({ min: 1, max: 3 }),
  status: fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'),
  paragraphBreak: fc.boolean(),
  source: fc.constantFrom<HunkSource>('diff', 'manual', 'claude')
});

/**
 * Build a text and a set of hunks together, so offsets are correct and spans can
 * never overlap by construction. Every token is unique ("w7", "r3"), which keeps
 * re-anchoring unambiguous and lets the round-trip assertions be exact.
 */
function buildCase(specs: readonly PieceSpec[]): { base: string; hunks: Hunk[] } {
  let text = '';
  let word = 0;
  let repl = 0;
  const hunks: Hunk[] = [];

  const push = (token: string): void => {
    if (text.length > 0 && !text.endsWith('\n')) text += ' ';
    text += token;
  };

  for (const spec of specs) {
    for (let i = 0; i < spec.gap; i += 1) {
      push(`w${word}`);
      word += 1;
    }
    if (spec.paragraphBreak) text += '\n\n';
    if (!spec.isHunk) continue;

    const tokens: string[] = [];
    for (let i = 0; i < spec.span; i += 1) {
      tokens.push(`w${word}`);
      word += 1;
    }
    const original = tokens.join(' ');
    const replacement = `r${repl} r${repl + 1}`;
    repl += 2;

    const start = text.length + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
    push(original);
    hunks.push({
      id: `h${hunks.length}`,
      start,
      end: start + original.length,
      baseSide: 'original',
      original,
      replacement,
      paragraph: 0,
      source: spec.source,
      ...(spec.source === 'manual' ? { category: 'other' as const, reason: 'Edited by author' } : {}),
      ...(spec.source === 'claude' && spec.span > 1 ? { edited: true } : {}),
      status: spec.status,
      anchor: 'exact'
    });
  }

  // Trailing word so no hunk sits at the very end of the text.
  push(`w${word}`);
  return { base: text, hunks };
}

function reviewOf(base: string, hunks: Hunk[]): Review {
  return createReview({
    sourcePath: 'C:/vault/Chapter.md',
    base: { text: base, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    hunks,
    generator: { kind: 'manual' },
    now: '2026-09-08T00:00:00.000Z'
  });
}

function nextBase(text: string): ReviewBase {
  return { text, hash: 'h2', eol: 'lf', bom: false, trailingNewline: true };
}

const casesArb = fc.array(specArb, { minLength: 1, maxLength: 8 }).map(buildCase);

describe('generated cases are well formed', () => {
  it('hunk offsets always name their own text and never overlap', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        for (const h of hunks) expect(base.slice(h.start, h.end)).toBe(h.original);
        expect(findOverlaps(hunks)).toEqual([]);
      }),
      { numRuns: 300 }
    );
  });
});

describe('compose is a pure function of base and decisions', () => {
  it('gives the same answer whatever order the hunks arrive in', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        expect(composeText(base, [...hunks].reverse())).toBe(composeText(base, hunks));
      }),
      { numRuns: 300 }
    );
  });

  it('contains every accepted replacement and no dismissed one', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const out = composeText(base, hunks);
        for (const h of hunks) {
          if (h.status === 'accepted') expect(out).toContain(h.replacement);
          else expect(out).not.toContain(h.replacement);
        }
      }),
      { numRuns: 300 }
    );
  });
});

describe('commit round trip', () => {
  it('compose(commit(base, hunks)) === compose(base, hunks)', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const composed = composeText(base, hunks);
        const committed = commitDecisions(base, hunks);
        expect(committed.text).toBe(composed);
        expect(composeText(committed.text, committed.hunks)).toBe(composed);
        for (const h of committed.hunks) {
          const want = h.status === 'accepted' ? h.replacement : h.original;
          expect(committed.text.slice(h.start, h.end)).toBe(want);
        }
      }),
      { numRuns: 300 }
    );
  });
});

describe('rebase round trip', () => {
  it('compose(rebase(review, compose(review))) === compose(review)', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const review = reviewOf(base, hunks);
        const composed = composeText(base, hunks);
        const { review: rebased } = rebaseReview(review, nextBase(composed));
        expect(composeText(rebased.base.text, rebased.hunks)).toBe(composed);
      }),
      { numRuns: 300 }
    );
  });

  it('preserves every decision across the round trip', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const review = reviewOf(base, hunks);
        const { review: rebased } = rebaseReview(review, nextBase(composeText(base, hunks)));
        for (const before of hunks) {
          const after = rebased.hunks.find((h) => h.id === before.id);
          expect(after?.status).toBe(before.status);
          expect(after?.anchor).not.toBe('stale');
        }
      }),
      { numRuns: 300 }
    );
  });

  it('rebasing onto the same text changes nothing', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const review = reviewOf(base, hunks);
        const { review: rebased } = rebaseReview(review, nextBase(base));
        expect(rebased.hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide, h.anchor])).toEqual(
          hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide, h.anchor])
        );
      }),
      { numRuns: 300 }
    );
  });

  it('keeps the author s own edits through a round trip like any other hunk', () => {
    // Manual hunks carry no special case in compose or rebase, and this is the
    // property that says so: the generated cases mix them in freely (item 3).
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const manual = hunks.filter((h) => h.source === 'manual');
        fc.pre(manual.length > 0);
        const review = reviewOf(base, hunks);
        const composed = composeText(base, hunks);
        const { review: rebased } = rebaseReview(review, nextBase(composed));
        expect(composeText(rebased.base.text, rebased.hunks)).toBe(composed);
        for (const before of manual) {
          const after = rebased.hunks.find((h) => h.id === before.id);
          expect(after?.status).toBe(before.status);
          expect(after?.source).toBe('manual');
          expect(after?.reason).toBe(before.reason);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('survives text being inserted in front of the chapter', () => {
    fc.assert(
      fc.property(casesArb, ({ base, hunks }) => {
        const review = reviewOf(base, hunks);
        const shifted = `prelude one two three\n\n${base}`;
        const { review: rebased, stats } = rebaseReview(review, nextBase(shifted));
        expect(stats.stale).toBe(0);
        for (const h of rebased.hunks) {
          expect(shifted.slice(h.start, h.end)).toBe(h.original);
        }
      }),
      { numRuns: 200 }
    );
  });
});

/* ------------------------------------------------------------------ */
/* apply.22: rewriting a suggestion after Save to chapter              */
/* ------------------------------------------------------------------ */

const savedRewriteArb = fc.record({
  specs: fc.array(specArb, { minLength: 1, maxLength: 8 }),
  /** decisions changed after the save, as an author does */
  flips: fc.array(
    fc.option(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), { nil: undefined }),
    { maxLength: 8 }
  ),
  /** which hunk the editor opens on */
  which: fc.nat(),
  /** "Accept now" */
  accept: fc.boolean(),
  /** then rewrite the words back to what the file says, with this "Accept now" */
  back: fc.option(fc.boolean(), { nil: undefined }),
  /** then decide on the rewritten suggestion once more, as a click on the word does */
  then: fc.option(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), { nil: undefined })
});

/** The composed text either side of one hunk, from every other hunk's decision. */
function around(base: string, hunks: readonly Hunk[], target: Hunk): { before: string; after: string } {
  const others = hunks.filter((h) => h.id !== target.id);
  const after = others
    .filter((h) => h.start >= target.end)
    .map((h) => ({ ...h, start: h.start - target.end, end: h.end - target.end }));
  return {
    before: composeText(
      base.slice(0, target.start),
      others.filter((h) => h.end <= target.start)
    ),
    after: composeText(base.slice(target.end), after)
  };
}

describe('rewriting a saved suggestion (apply.22)', () => {
  it('composes the new words, counts them unsaved, and compose stays a function of base and hunks', () => {
    fc.assert(
      fc.property(savedRewriteArb, ({ specs, flips, which, accept, back, then }) => {
        const built = buildCase(specs);
        fc.pre(built.hunks.length > 0);
        // Save to chapter: accepted hunks now hold their replacement in the base.
        const saved = commitDecisions(built.base, built.hunks);
        const base = saved.text;
        const hunks = saved.hunks.map((h, i) => {
          const status = flips[i];
          return status ? { ...h, status } : h;
        });
        const target = hunks[which % hunks.length];
        if (!target) throw new Error('no hunk');
        const inFile = base.slice(target.start, target.end);
        const words = 'z0 z1'; // in no generated text
        const { before, after } = around(base, hunks, target);
        const othersUnsaved = unsavedDecisionCount(hunks.filter((h) => h.id !== target.id));

        const rewrite = (list: readonly Hunk[], to: string, tick: boolean): Hunk[] =>
          list.map((h) => (h.id === target.id ? editSuggestion(base, h, to, tick) : h));
        let edited = rewrite(hunks, words, accept);
        if (back !== undefined) edited = rewrite(edited, inFile, back);
        if (then !== undefined) {
          edited = edited.map((h) => (h.id === target.id ? { ...h, status: then } : h));
        }
        const rewritten = edited.find((h) => h.id === target.id);
        if (!rewritten) throw new Error('lost the hunk');
        const composed = composeText(base, edited);

        // The page reads the new words while they are accepted, and the file's
        // own words otherwise: when they wait, when they were rewritten back
        // (both sides are then the file's words, so no decision can change
        // what shows), and when the author turned them back or dismissed them.
        const shown = back === undefined && rewritten.status === 'accepted' ? words : inFile;
        expect(composed).toBe(before + shown + after);
        expect(base.slice(rewritten.start, rewritten.end)).toBe(inFile);
        expect(findOverlaps(edited)).toEqual([]);
        const own = shown === words ? 1 : 0;
        expect(unsavedDecisionCount([rewritten])).toBe(own);
        expect(unsavedDecisionCount(edited)).toBe(othersUnsaved + own);
        if (shown === words) expect(unsavedDecisionCount(edited)).toBeGreaterThan(0);
        if (hunks.every((_, i) => flips[i] === undefined)) {
          // Nothing else was decided after the save, so the count is 0 exactly
          // when the page reads like the file, whatever was decided on the
          // rewritten suggestion afterwards.
          expect(unsavedDecisionCount(edited) === 0).toBe(composed === base);
          if (back !== undefined) {
            // Rewriting back to the saved words is a no-op, and stays one.
            expect(composed).toBe(base);
            expect(unsavedDecisionCount(edited)).toBe(0);
          }
        }

        // A pure function of base plus hunks.
        expect(composeText(base, [...edited].reverse())).toBe(composed);
        expect(composeText(base, structuredClone(edited))).toBe(composed);

        // The next Save writes exactly that, and leaves nothing unsaved.
        const next = commitDecisions(base, edited);
        expect(next.text).toBe(composed);
        expect(composeText(next.text, next.hunks)).toBe(composed);
        expect(unsavedDecisionCount(next.hunks)).toBe(0);

        // Rebase round trips: onto the composed text, and onto the same text.
        const review = reviewOf(base, edited);
        const { review: rebased } = rebaseReview(review, nextBase(composed));
        expect(composeText(rebased.base.text, rebased.hunks)).toBe(composed);
        for (const h of edited) {
          const moved = rebased.hunks.find((r) => r.id === h.id);
          expect(moved?.anchor).not.toBe('stale');
          expect(moved?.status).toBe(h.status);
        }
        const { review: same } = rebaseReview(review, nextBase(base));
        expect(composeText(same.base.text, same.hunks)).toBe(composed);
        expect(unsavedDecisionCount(same.hunks)).toBe(unsavedDecisionCount(edited));
      }),
      { numRuns: 500 }
    );
  });
});

/* ------------------------------------------------------------------ */
/* apply.23: deletions and insertions through a rebase                 */
/* ------------------------------------------------------------------ */

/** Words any chapter repeats, so a doubled one usually has others of its kind about. */
const COMMON = ['the', 'had'] as const;
type Common = (typeof COMMON)[number];

/** Which word of a doubled pair is deleted, and the space that goes with it. */
type DoubledForm = 'first-trailing' | 'first-leading' | 'second-trailing' | 'second-leading';

type Piece =
  | { kind: 'word' }
  | { kind: 'common'; word: Common }
  | { kind: 'para' }
  | { kind: 'doubled'; word: Common; form: DoubledForm; status: HunkStatus }
  | { kind: 'delete'; status: HunkStatus }
  | { kind: 'insert'; status: HunkStatus }
  | { kind: 'replace'; status: HunkStatus };

const commonArb = fc.constantFrom<Common>(...COMMON);
const statusArb = fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed');

const pieceArb: fc.Arbitrary<Piece> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Piece>({ kind: 'word' }) },
  { weight: 2, arbitrary: commonArb.map((word): Piece => ({ kind: 'common', word })) },
  { weight: 1, arbitrary: fc.constant<Piece>({ kind: 'para' }) },
  {
    weight: 3,
    arbitrary: fc
      .record({
        word: commonArb,
        form: fc.constantFrom<DoubledForm>(
          'first-trailing',
          'first-leading',
          'second-trailing',
          'second-leading'
        ),
        status: statusArb
      })
      .map((p): Piece => ({ kind: 'doubled', ...p }))
  },
  { weight: 1, arbitrary: statusArb.map((status): Piece => ({ kind: 'delete', status })) },
  { weight: 1, arbitrary: statusArb.map((status): Piece => ({ kind: 'insert', status })) },
  { weight: 1, arbitrary: statusArb.map((status): Piece => ({ kind: 'replace', status })) }
);

const piecesArb = fc.array(pieceArb, { minLength: 1, maxLength: 14 });

/**
 * A chapter of unique filler words ("w12"), words that recur, doubled words
 * with a deletion of one of the pair, and deletions, insertions and
 * replacements of filler words, with every hunk's offsets exact. `spacing`
 * puts at least that many characters between one hunk and the next.
 */
function buildChapter(pieces: readonly Piece[], spacing = 0): { base: string; hunks: Hunk[] } {
  let text = '';
  let fresh = 0;
  let lastEnd = Number.NEGATIVE_INFINITY;
  const hunks: Hunk[] = [];

  const push = (token: string): number => {
    if (text.length > 0 && !text.endsWith('\n')) text += ' ';
    const at = text.length;
    text += token;
    return at;
  };
  const filler = (): number => push(`w${fresh++}`);
  const room = (): void => {
    while (text.length + 1 - lastEnd < spacing) filler();
  };
  const add = (start: number, original: string, replacement: string, status: HunkStatus): void => {
    hunks.push({
      id: `h${hunks.length}`,
      start,
      end: start + original.length,
      baseSide: 'original',
      original,
      replacement,
      paragraph: 0,
      source: 'diff',
      status,
      anchor: 'exact'
    });
    lastEnd = start + original.length;
  };

  for (const piece of pieces) {
    switch (piece.kind) {
      case 'word':
        filler();
        break;
      case 'common':
        push(piece.word);
        break;
      case 'para':
        if (text.length > 0 && !text.endsWith('\n')) text += '\n\n';
        break;
      case 'doubled': {
        room();
        // A filler word either side, so every form has the space it takes.
        filler();
        const first = push(piece.word);
        const second = push(piece.word);
        filler();
        const word = piece.word;
        if (piece.form === 'first-trailing') add(first, `${word} `, '', piece.status);
        else if (piece.form === 'first-leading') add(first - 1, ` ${word}`, '', piece.status);
        else if (piece.form === 'second-trailing') add(second, `${word} `, '', piece.status);
        else add(second - 1, ` ${word}`, '', piece.status);
        break;
      }
      case 'delete': {
        room();
        const at = filler();
        const word = text.slice(at);
        filler();
        add(at, `${word} `, '', piece.status);
        break;
      }
      case 'insert': {
        room();
        add(filler(), '', `i${hunks.length} `, piece.status);
        break;
      }
      case 'replace': {
        room();
        const at = filler();
        add(at, text.slice(at), `r${hunks.length}`, piece.status);
        break;
      }
    }
  }
  filler(); // never end on a hunk
  return { base: text, hunks };
}

/** Another editor's change, word by word; a word of `null` is a new one ("x3"). */
type Edit =
  | { op: 'insert'; at: number; word: string | null }
  | { op: 'delete'; at: number }
  | { op: 'replace'; at: number; word: string | null }
  | { op: 'append' }
  | { op: 'prepend' };

function editArb(words: fc.Arbitrary<string | null>, ops: ReadonlyArray<Edit['op']>): fc.Arbitrary<Edit> {
  const all: Array<fc.Arbitrary<Edit>> = [];
  if (ops.includes('insert'))
    all.push(fc.record({ op: fc.constant('insert' as const), at: fc.nat(), word: words }));
  if (ops.includes('delete')) all.push(fc.record({ op: fc.constant('delete' as const), at: fc.nat() }));
  if (ops.includes('replace'))
    all.push(fc.record({ op: fc.constant('replace' as const), at: fc.nat(), word: words }));
  if (ops.includes('append')) all.push(fc.constant({ op: 'append' as const }));
  if (ops.includes('prepend')) all.push(fc.constant({ op: 'prepend' as const }));
  return fc.oneof(...all);
}

const ALL_OPS: ReadonlyArray<Edit['op']> = ['insert', 'delete', 'replace', 'append', 'prepend'];
/** Edits that take nothing out of the file: words added anywhere, a paragraph before or after. */
const ADDING_OPS: ReadonlyArray<Edit['op']> = ['insert', 'append', 'prepend'];
const anyWord = fc.option(commonArb, { nil: null });
const newWord = fc.constant(null);

/**
 * Apply edits to a text. `marks` are places in it that move with the text;
 * with `away`, an edit within that many characters of a mark is skipped, so
 * the text around every mark reads as it did.
 */
function applyEdits(
  text: string,
  edits: readonly Edit[],
  marks: readonly number[] = [],
  away?: number
): { text: string; marks: number[] } {
  let out = text;
  let at = [...marks];
  let fresh = 0;
  const word = (w: string | null): string => w ?? `x${fresh++}`;
  const near = (from: number, to: number): boolean =>
    away !== undefined && at.some((m) => from < m + away && to > m - away);
  const splice = (from: number, to: number, insert: string): void => {
    out = out.slice(0, from) + insert + out.slice(to);
    const delta = insert.length - (to - from);
    at = at.map((m) => (m >= to ? m + delta : m));
  };

  for (const edit of edits) {
    if (edit.op === 'append') {
      splice(out.length, out.length, `\n\n${word(null)} ${word(null)}`);
      continue;
    }
    if (edit.op === 'prepend') {
      splice(0, 0, `${word(null)} ${word(null)}\n\n`);
      continue;
    }
    const words = [...out.matchAll(/\S+/g)];
    const target = words[edit.at % Math.max(1, words.length)];
    if (!target) continue;
    const from = target.index;
    const to = from + target[0].length;
    if (edit.op === 'insert') {
      if (!near(from, from)) splice(from, from, `${word(edit.word)} `);
    } else if (edit.op === 'replace') {
      if (!near(from, to)) splice(from, to, word(edit.word));
    } else {
      // The word and one space beside it.
      const a = out[to] === ' ' || out[from - 1] !== ' ' ? from : from - 1;
      const b = out[to] === ' ' ? to + 1 : to;
      if (!near(a, b)) splice(a, b, '');
    }
  }
  return { text: out, marks: at };
}

/**
 * Which sides of a span in `b` read as they did around one in `a`: the 40
 * characters before it, or up to the start of the text where both begin
 * there, and the same after it with the end of the text. A side with no text
 * in `a` never counts.
 */
function sidesAsBefore(
  a: string,
  aStart: number,
  aEnd: number,
  b: string,
  bStart: number,
  bEnd: number
): { before: boolean; after: boolean } {
  const n = 40;
  const lead = (t: string, at: number): string => (at >= n ? t.slice(at - n, at) : `^${t.slice(0, at)}`);
  const tail = (t: string, at: number): string =>
    t.length - at >= n ? t.slice(at, at + n) : `${t.slice(at)}$`;
  return {
    before: aStart > 0 && lead(a, aStart) === lead(b, bStart),
    after: aEnd < a.length && tail(a, aEnd) === tail(b, bEnd)
  };
}

/** Save to chapter: every decision folded into the base. */
function savedChapter(base: string, hunks: readonly Hunk[]): Review {
  const { text, hunks: folded } = commitDecisions(base, hunks);
  return reviewOf(text, folded);
}

/** A saved deletion: in the file, so a zero-width hunk on its replacement side. */
function isSavedDeletion(h: Hunk): boolean {
  return (
    h.status === 'accepted' && h.baseSide === 'replacement' && h.replacement === '' && h.anchor !== 'stale'
  );
}

/**
 * After a rebase of a review with every decision saved: the page reads as the
 * file, so Save would write nothing, and each saved deletion is still saved,
 * off the page, or back as a suggestion only over its own words put back
 * where they were taken out (C.5): the text reads as it did on both sides of
 * them, or on one side when they were not one of a doubled pair, whose twin
 * is all that may be left of them. One already off the page stays off it.
 */
function expectSavedDeletionsKept(before: Review, text: string, after: Review): void {
  expect(composeText(text, after.hunks)).toBe(text);
  expect(unsavedDecisionCount(after.hunks)).toBe(0);
  expect(findOverlaps(after.hunks)).toEqual([]);
  expectBaseSidesInPlace(text, after.hunks);

  const old = before.base.text;
  for (const was of before.hunks) {
    if (was.status !== 'accepted' || was.baseSide !== 'replacement' || was.replacement !== '') continue;
    const now = after.hunks.find((h) => h.id === was.id);
    if (!now) throw new Error('lost a hunk');
    if (was.anchor === 'stale') {
      expect(now.anchor).toBe('stale');
      continue;
    }
    if (now.anchor === 'stale') continue;
    if (now.baseSide === 'replacement') {
      expect(now.status).toBe('accepted');
      expect(now.start).toBe(now.end);
      continue;
    }
    expect(now.status).toBe('pending');
    expect(text.slice(now.start, now.end)).toBe(was.original);
    const sides = sidesAsBefore(old, was.start, was.end, text, now.start, now.end);
    const doubled =
      old.slice(Math.max(0, was.start - was.original.length), was.start) === was.original ||
      old.slice(was.end, was.end + was.original.length) === was.original;
    expect(doubled ? sides.before && sides.after : sides.before || sides.after).toBe(true);
  }
}

/** Every hunk the rebase placed holds the text of its base side, unless it was placed fuzzily. */
function expectBaseSidesInPlace(text: string, hunks: readonly Hunk[]): void {
  for (const h of hunks) {
    if (h.anchor === 'stale' || h.anchor === 'fuzzy') continue;
    expect(text.slice(h.start, h.end)).toBe(h.baseSide === 'original' ? h.original : h.replacement);
  }
}

describe('deletions through a rebase (apply.23)', () => {
  it('a saved deletion never comes back as a suggestion on another word, whatever else changed', () => {
    fc.assert(
      fc.property(
        piecesArb,
        fc.array(editArb(anyWord, ALL_OPS), { maxLength: 5 }),
        fc.array(editArb(anyWord, ALL_OPS), { maxLength: 3 }),
        (pieces, edits, more) => {
          const built = buildChapter(pieces);
          const before = savedChapter(built.base, built.hunks);
          const text = applyEdits(before.base.text, edits).text;
          const after = rebaseReview(before, nextBase(text)).review;
          expectSavedDeletionsKept(before, text, after);
          // And through the next change too, deletions already off the page included.
          const later = applyEdits(text, more).text;
          expectSavedDeletionsKept(after, later, rebaseReview(after, nextBase(later)).review);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('a saved deletion stays saved where it was when the file changes away from it', () => {
    fc.assert(
      fc.property(piecesArb, fc.array(editArb(anyWord, ALL_OPS), { maxLength: 6 }), (pieces, edits) => {
        const built = buildChapter(pieces);
        const before = savedChapter(built.base, built.hunks);
        const deletions = before.hunks.filter(isSavedDeletion);
        fc.pre(deletions.length > 0);
        const { text, marks } = applyEdits(
          before.base.text,
          edits,
          deletions.map((h) => h.start),
          48
        );
        const { review: after } = rebaseReview(before, nextBase(text));
        expect(composeText(text, after.hunks)).toBe(text);
        deletions.forEach((was, i) => {
          const now = after.hunks.find((h) => h.id === was.id);
          expect(now).toMatchObject({
            status: 'accepted',
            baseSide: 'replacement',
            start: marks[i],
            end: marks[i]
          });
          expect(now?.anchor).not.toBe('stale');
        });
      }),
      { numRuns: 300 }
    );
  });

  it('an accepted deletion already made in the file is taken as saved, or left off the page, and Save writes the file as it is', () => {
    fc.assert(
      fc.property(piecesArb, fc.array(editArb(newWord, ADDING_OPS), { maxLength: 5 }), (pieces, edits) => {
        const built = buildChapter(pieces);
        const review = reviewOf(built.base, built.hunks);
        // The file as Save, or the same edits made by hand, wrote it, then
        // words added anywhere by another editor, right beside a deletion too.
        const text = applyEdits(composeText(built.base, built.hunks), edits).text;
        const { review: after } = rebaseReview(review, nextBase(text));

        expect(unsavedDecisionCount(after.hunks)).toBe(0);
        expect(composeText(text, after.hunks)).toBe(text);
        expect(findOverlaps(after.hunks)).toEqual([]);
        expectBaseSidesInPlace(text, after.hunks);
        for (const was of built.hunks) {
          if (was.status !== 'accepted' || was.replacement !== '') continue;
          const now = after.hunks.find((h) => h.id === was.id);
          if (now?.anchor === 'stale') continue;
          expect(now).toMatchObject({ status: 'accepted', baseSide: 'replacement' });
          expect(now?.start).toBe(now?.end);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('an accepted deletion already made in the file is taken as saved where it was when the file changes away from it', () => {
    fc.assert(
      fc.property(piecesArb, fc.array(editArb(newWord, ADDING_OPS), { maxLength: 6 }), (pieces, edits) => {
        const built = buildChapter(pieces, 41);
        const made = commitDecisions(built.base, built.hunks);
        const accepted = built.hunks.filter((h) => h.status === 'accepted' && h.replacement === '');
        fc.pre(accepted.length > 0);
        const points = accepted.map((h) => made.hunks.find((m) => m.id === h.id)?.start ?? -1);
        const { text, marks } = applyEdits(made.text, edits, points, 48);
        const { review: after } = rebaseReview(reviewOf(built.base, built.hunks), nextBase(text));
        expect(composeText(text, after.hunks)).toBe(text);
        accepted.forEach((was, i) => {
          const now = after.hunks.find((h) => h.id === was.id);
          expect(now).toMatchObject({
            status: 'accepted',
            baseSide: 'replacement',
            start: marks[i],
            end: marks[i]
          });
          expect(now?.anchor).not.toBe('stale');
        });
      }),
      { numRuns: 200 }
    );
  });

  it('compose and rebase round trips keep deletions and insertions, doubled words and all', () => {
    fc.assert(
      fc.property(piecesArb, (pieces) => {
        const built = buildChapter(pieces, 41);
        const review = reviewOf(built.base, built.hunks);
        const composed = composeText(built.base, built.hunks);
        expect(composeText(built.base, [...built.hunks].reverse())).toBe(composed);
        const committed = commitDecisions(built.base, built.hunks);
        expect(committed.text).toBe(composed);
        expect(composeText(committed.text, committed.hunks)).toBe(composed);

        // Onto the composed text: the same text, every decision kept.
        const { review: onto } = rebaseReview(review, nextBase(composed));
        expect(composeText(composed, onto.hunks)).toBe(composed);
        for (const was of built.hunks) {
          const now = onto.hunks.find((h) => h.id === was.id);
          expect(now?.anchor).not.toBe('stale');
          expect(now?.status).toBe(was.status);
        }

        // Onto the same text: nothing moves.
        const { review: same, stats } = rebaseReview(review, nextBase(built.base));
        expect(same.hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide])).toEqual(
          built.hunks.map((h) => [h.id, h.start, h.end, h.status, h.baseSide])
        );
        expect(stats).toMatchObject({ stale: 0, adopted: 0 });
        expect(composeText(built.base, same.hunks)).toBe(composed);
      }),
      { numRuns: 300 }
    );
  });
});

/* ------------------------------------------------------------------ */
/* apply.23 review: words that stay, and no place by a guess           */
/* ------------------------------------------------------------------ */

describe('deletions and insertions whose words stay (apply.23 review)', () => {
  /** Words of the passage around the hunk; none is a hunk's word. */
  const PASSAGE = [
    'before',
    'since',
    'once',
    'like',
    'made',
    'river',
    'mill',
    'rain',
    'night',
    'was',
    'and',
    'of',
    'to',
    'into',
    'over',
    'she',
    'he',
    'were'
  ];
  /**
   * Words another editor types: new to the passage, so an edit never puts back
   * a word that stood beside the hunk, which would read the same as the hunk's
   * own words taken out. Several share letters with the passage and with the
   * hunk's words ("after" and "before", "then" and "the").
   */
  const TYPED = ['after', 'where', 'there', 'tide', 'stone', 'bank', 'wore', 'gone', 'her', 'then'];
  /** Long enough that the start of the file is never within 40 characters of the hunk. */
  const LEAD = 'Far away and long before any of this w1 w2 w3 w4 w5 w6 w7 w8';

  type Kind = 'pending deletion' | 'accepted deletion' | 'saved insertion';

  const caseArb = fc.record({
    kind: fc.constantFrom<Kind>('pending deletion', 'accepted deletion', 'saved insertion'),
    word: fc.constantFrom('the', 'that', 'had'),
    doubled: fc.boolean(),
    second: fc.boolean(),
    left: fc.array(fc.constantFrom(...PASSAGE), { minLength: 1, maxLength: 8 }),
    right: fc.array(fc.constantFrom(...PASSAGE), { minLength: 1, maxLength: 8 }),
    edits: fc.array(
      fc.record({
        left: fc.boolean(),
        at: fc.nat(),
        op: fc.constantFrom('replace', 'insert', 'delete'),
        word: fc.constantFrom(...TYPED)
      }),
      { minLength: 1, maxLength: 2 }
    )
  });

  it('keeps its decision on its own words through one or two words changed beside them or near', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        // A deletion may be one word of a doubled pair, whose twin is left alone.
        const run = c.kind !== 'saved insertion' && c.doubled ? [c.word, c.word] : [c.word];
        const build = (left: string[], right: string[]): string =>
          [LEAD, ...left, ...run, ...right].join(' ');
        const offset = run.length === 2 && c.second ? c.word.length + 1 : 0;
        const words = `${c.word} `;
        const base = build(c.left, c.right);
        const start = [LEAD, ...c.left].join(' ').length + 1 + offset;
        const hunk: Hunk = {
          id: 'h1',
          start,
          end: start + words.length,
          baseSide: c.kind === 'saved insertion' ? 'replacement' : 'original',
          original: c.kind === 'saved insertion' ? '' : words,
          replacement: c.kind === 'saved insertion' ? words : '',
          paragraph: 0,
          source: 'diff',
          status: c.kind === 'pending deletion' ? 'pending' : 'accepted',
          anchor: 'exact'
        };

        const left = [...c.left];
        const right = [...c.right];
        for (const edit of c.edits) {
          const words = edit.left ? left : right;
          const i = edit.at % (words.length + (edit.op === 'insert' ? 1 : 0));
          if (edit.op === 'replace') words[i] = edit.word;
          else if (edit.op === 'insert') words.splice(i, 0, edit.word);
          else if (words.length > 1) words.splice(i, 1);
        }
        const text = build(left, right);
        fc.pre(text !== base);
        const at = [LEAD, ...left].join(' ').length + 1 + offset;

        const { review: after, stats } = rebaseReview(reviewOf(base, [hunk]), nextBase(text));
        const now = after.hunks[0]!;
        // Never taken as made, or undone, by hand.
        expect(stats.adopted).toBe(0);
        expect(now.status).toBe(hunk.status);
        expect(now.baseSide).toBe(hunk.baseSide);
        // Off the page only when the text changed on both sides of the words (C.52).
        const sides = sidesAsBefore(base, hunk.start, hunk.end, text, at, at + words.length);
        if (sides.before || sides.after) expect(now.anchor).not.toBe('stale');
        if (now.anchor === 'stale') return;
        // On its words, or on their twin: either word of a doubled pair deletes to the same text.
        const twin = run.length === 2 ? at + (c.second ? -1 : 1) * words.length : at;
        expect([at, twin]).toContain(now.start);
        expect(now.end).toBe(now.start + words.length);
        // Save deletes an accepted deletion's words, and writes nothing for the others.
        expect(composeText(text, after.hunks)).toBe(
          c.kind === 'accepted deletion' ? text.slice(0, at) + text.slice(at + words.length) : text
        );
      }),
      { numRuns: 1000 }
    );
  });

  it('never places a deletion or an insertion inside a word, through rounds of edits', () => {
    fc.assert(
      fc.property(
        piecesArb,
        fc.array(fc.array(editArb(anyWord, ALL_OPS), { maxLength: 4 }), { minLength: 1, maxLength: 3 }),
        (pieces, rounds) => {
          const built = buildChapter(pieces);
          let review = reviewOf(built.base, built.hunks);
          let text = built.base;
          for (const edits of rounds) {
            text = applyEdits(text, edits).text;
            review = rebaseReview(review, nextBase(text)).review;
            for (const h of review.hunks) {
              if (h.anchor === 'stale' || h.start !== h.end) continue;
              expect(insideWord(text, h.start)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

/* ------------------------------------------------------------------ */
/* files.20: kept out, and out of the frontmatter, through a rebase    */
/* ------------------------------------------------------------------ */

describe('kept out, and out of the frontmatter, through a rebase (files.20)', () => {
  const sourcesArb = fc.array(fc.constantFrom<HunkSource>('diff', 'manual', 'claude'), {
    minLength: 1,
    maxLength: 6
  });

  /**
   * Where the body goes after a frontmatter: after a blank line, or on the
   * line right after the closing `---`, as Obsidian writes it, so that the
   * body, and a hunk at its very start, begins at `bodyStart` (the `files.20`
   * review).
   */
  type FrontLayout = 'none' | 'blank' | 'tight';

  /**
   * A chapter of apply.23's pieces, with the hunks' sources mixed, a few
   * suggestions kept out of the text on words it holds, and, when asked, a
   * frontmatter that holds the whole body again on one line: a rebase that
   * read the frontmatter would find every hunk's words, and most of the text
   * around them, there too.
   */
  function frontedChapter(
    pieces: readonly Piece[],
    sources: readonly HunkSource[],
    kept: readonly number[],
    layout: FrontLayout
  ): { base: string; hunks: Hunk[]; keptOut: Hunk[] } {
    const built = buildChapter(pieces);
    const front =
      layout === 'none'
        ? ''
        : `---\ntitle: ${built.base.replace(/\n+/g, ' ')}\n---\n${layout === 'blank' ? '\n' : ''}`;
    const words = [...built.base.matchAll(/w\d+/g)].map((m) => m[0]);
    const keptOut = kept.flatMap((k, i): Hunk[] => {
      const word = words[k % words.length];
      return word === undefined
        ? []
        : [
            {
              id: `k${i}`,
              start: 0,
              end: 0,
              baseSide: 'original',
              original: word,
              replacement: `[[${word}]]`,
              paragraph: 0,
              category: 'grammar',
              reason: 'The model said so.',
              source: 'claude',
              status: 'pending',
              anchor: 'stale',
              keptOut: 'markup'
            }
          ];
    });
    const hunks = built.hunks.map((h, i) => ({
      ...h,
      start: h.start + front.length,
      end: h.end + front.length,
      source: sources[i % sources.length] ?? 'diff'
    }));
    return { base: front + built.base, hunks: [...hunks, ...keptOut], keptOut };
  }

  /**
   * The words a hunk on the page holds on its base side replaced by a new
   * one ("y3"), or, for a hunk that holds none, the word either side of its
   * place, in the body: the body then has them no more, and the frontmatter,
   * its closing `---` included, still may.
   */
  function strike(text: string, hunk: Hunk, fresh: string): string {
    if (hunk.start < hunk.end) return text.slice(0, hunk.start) + fresh + text.slice(hunk.end);
    const before = /\S+\s*$/.exec(text.slice(bodyStart(text), hunk.start));
    const after = /^\s*\S+/.exec(text.slice(hunk.start));
    const from = before ? hunk.start - before[0].length : hunk.start;
    const to = after ? hunk.start + after[0].length : hunk.start;
    return `${text.slice(0, from)}${fresh}a ${fresh}b${text.slice(to)}`;
  }

  it('a kept-out suggestion stays kept out and in place, and no hunk of any source is placed before the body, through rounds of edits', () => {
    // Rounds in which words of a hunk on the page were left in the frontmatter and nowhere else.
    let tempted = 0;
    // Chapters with a hunk at the very start of a body that follows the closing line at once.
    let atBody = 0;
    fc.assert(
      fc.property(
        piecesArb,
        sourcesArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
        fc.constantFrom<FrontLayout>('blank', 'tight', 'tight', 'none'),
        fc.array(
          fc.record({
            strike: fc.option(fc.nat(), { nil: null }),
            edits: fc.array(editArb(anyWord, ALL_OPS), { maxLength: 4 })
          }),
          { minLength: 1, maxLength: 3 }
        ),
        (pieces, sources, kept, layout, rounds) => {
          const chapter = frontedChapter(pieces, sources, kept, layout);
          let review = reviewOf(chapter.base, chapter.hunks);
          let text = chapter.base;
          // Onto the text it already has, a rebase finds every hunk on the page on its own words or place,
          // where it was, at the very start of the body included (the files.20 review).
          const start = bodyStart(text);
          if (start > 0 && review.hunks.some((h) => h.anchor !== 'stale' && h.start === start)) atBody += 1;
          const same = rebaseReview(review, nextBase(text)).review;
          for (const h of review.hunks) {
            if (h.anchor === 'stale') continue;
            const now = same.hunks.find((s) => s.id === h.id);
            expect(['exact', 'ambiguous'], JSON.stringify({ text, h, now })).toContain(now?.anchor);
            expect(now).toMatchObject({ start: h.start, end: h.end, status: h.status, baseSide: h.baseSide });
          }
          for (const [round, change] of rounds.entries()) {
            // Another editor changes the body, the words of one hunk among them; the frontmatter stays as it was.
            const onPage = review.hunks.filter((h) => h.anchor !== 'stale');
            const target = change.strike === null ? undefined : onPage[change.strike % onPage.length];
            if (target) text = strike(text, target, `y${round}`);
            const body = bodyStart(text);
            text = text.slice(0, body) + applyEdits(text.slice(body), change.edits).text;
            const words = onPage
              .map((h) => (h.baseSide === 'original' ? h.original : h.replacement))
              .filter((w) => w.length > 0);
            if (words.some((w) => text.slice(0, body).includes(w) && !text.includes(w, body))) tempted += 1;

            const { review: next, stats, changes } = rebaseReview(review, nextBase(text));
            for (const h of next.hunks) {
              if (h.anchor !== 'stale')
                expect(h.start, JSON.stringify({ text, h })).toBeGreaterThanOrEqual(body);
            }
            for (const was of chapter.keptOut) expect(next.hunks.find((h) => h.id === was.id)).toEqual(was);
            // What the cards count: those the rebase took off the page, and those it kept out.
            const before = new Map(review.hunks.map((h) => [h.id, h]));
            const off = next.hunks.filter((h) => h.anchor === 'stale');
            const newly = off.filter(
              (h) => h.keptOut !== undefined && before.get(h.id)?.keptOut === undefined
            );
            const lost = off.filter((h) => h.keptOut === undefined && before.get(h.id)?.anchor !== 'stale');
            expect(stats.stale).toBe(off.length);
            expect(stats.keptOut).toBe(newly.length);
            expect(stats.newlyStale).toBe(lost.length);
            // And the hunks behind them, which the reload card reads (the files.20 review).
            expect(changes.keptOut).toEqual(newly.map((h) => h.id));
            expect(changes.newlyStale).toEqual(lost.map((h) => h.id));
            expect(changes.adopted).toHaveLength(stats.adopted);
            expect(
              changes.adopted.every(
                (id) => next.hunks.find((h) => h.id === id)?.status !== before.get(id)?.status
              )
            ).toBe(true);
            // A rebased review loads as it is: the guard has run on it.
            expect(guardLoadedReview(next)).toBe(next);
            review = next;
          }
        }
      ),
      { numRuns: 500 }
    );
    expect(tempted).toBeGreaterThan(100);
    expect(atBody).toBeGreaterThan(25);
  });
});

/* ------------------------------------------------------------------ */
/* files.7: the guard on model suggestions                             */
/* ------------------------------------------------------------------ */

describe('the guard on model suggestions (files.7)', () => {
  /* Chapters of prose lines and Obsidian syntax, built as obsidian.test.ts
     builds them, with frontmatter or without. */
  const WORDS = ['rain', 'night', 'river', 'Mara', 'lamp', 'stone', 'quiet', 'door'];
  const MARKS = [
    '[[Chapter 2]]',
    '[[Chapter 2|the flood chapter]]',
    '![[map.png]]',
    '[the mill](https://example.com/mill)',
    '![a map](map.png)',
    '[^1]',
    '^[a note on the river]',
    '#draft',
    '(#draft)',
    '\\#draft',
    '`code`',
    '%%a private note%%',
    '<!-- a note -->',
    '$$x^2$$',
    '<span class="aside">',
    '</span>',
    'https://example.com/a',
    '#1984',
    'Room #4',
    '$5 and $10',
    '*em*',
    '==hi==',
    '<Where are you?>',
    '-',
    '--',
    '%',
    '|',
    // A comment opener nothing may close, and arrows a suggestion could make into its closer.
    '<!--',
    '->',
    '- >'
  ];
  const OPENINGS = ['', '', '', '> ', '## ', '> [!note] ', '[^2]: ', '- ', '- - ', '1. ', '\t', '    '];
  const ENDINGS = ['', '', ' ^mill-1'];
  const BLOCKS = [
    '---',
    '---\nThree days later.\n---',
    '* * *',
    '```\nlet x = 1;\n```',
    '~~~\ncode\n~~~',
    // Fences that hold a blank line: read alone, the closing fence opens one (the files.7 review).
    '```\nlet x = 1;\n\nlet y = 2;\n```',
    '~~~\ncode\n\nmore\n~~~',
    // A fence line alone, and fence lines with words after the run, which close nothing until they go.
    '```',
    '~~~ The end',
    '```js\nlet z = 3;',
    '%%\nnote\n\nmore\n%%',
    '$$\nx\n$$'
  ];
  const proseLine = fc
    .tuple(
      fc.constantFrom(...OPENINGS),
      fc.array(
        fc.oneof(
          { weight: 2, arbitrary: fc.constantFrom(...WORDS) },
          { weight: 1, arbitrary: fc.constantFrom(...MARKS) }
        ),
        { minLength: 1, maxLength: 8 }
      ),
      fc.constantFrom(...ENDINGS)
    )
    .map(([opening, tokens, ending]) => `${opening}${tokens.join(' ')}${ending}`);
  const line = fc.oneof(
    { weight: 4, arbitrary: proseLine },
    { weight: 1, arbitrary: fc.constantFrom(...BLOCKS) }
  );
  const chapterArb = fc
    .tuple(fc.boolean(), fc.array(fc.tuple(line, fc.boolean()), { minLength: 1, maxLength: 12 }))
    .map(
      ([front, lines]) =>
        (front ? '---\ntitle: The Mill\n---\n' : '') +
        lines.map(([text, blank], k) => (k === 0 ? '' : blank ? '\n\n' : '\n') + text).join('')
    );

  /* A model's change: a stretch of one paragraph with part of it replaced by
     a word, punctuation or nothing, as a copyedit would, or by something
     that is syntax or makes it, with or without a markup character. */
  const PROSE_TOKENS = [
    '',
    'rain',
    'Mara',
    'the ',
    ' ',
    ',',
    '.',
    "'",
    'x',
    '1',
    ':',
    '(',
    ')',
    '!',
    '-',
    '*',
    '_'
  ];
  const SYNTAX_TOKENS = [
    '--',
    '---',
    '=',
    '\\',
    '/',
    'http',
    's://example.com',
    'https://example.com',
    '    ',
    '\t',
    '#',
    '[',
    ']',
    '[[',
    ']]',
    '%',
    '%%',
    '$',
    '^',
    '<',
    '>',
    '|',
    '~',
    '`',
    '\n',
    '\n\n',
    '> ',
    '# '
  ];
  const pickArb = fc.record({
    paragraph: fc.nat(),
    from: fc.nat(),
    length: fc.nat(),
    at: fc.nat(),
    cut: fc.nat(),
    token: fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...PROSE_TOKENS) },
      { weight: 2, arbitrary: fc.constantFrom(...SYNTAX_TOKENS) }
    )
  });
  type Pick = typeof pickArb extends fc.Arbitrary<infer T> ? T : never;

  /** The changes a model might send for `text`, made from the picks. */
  function changesFor(text: string, picks: readonly Pick[]): ChangeInput[] {
    const body = bodyParagraphs(splitParagraphs(text));
    return picks.flatMap((pick) => {
      const paragraph = body[pick.paragraph % body.length];
      if (!paragraph) return [];
      const from = pick.from % paragraph.text.length;
      const before = paragraph.text.slice(from, from + 1 + (pick.length % 16));
      const at = pick.at % (before.length + 1);
      const cut = at + (pick.cut % (before.length - at + 1));
      const after = before.slice(0, at) + pick.token + before.slice(cut);
      return after === before
        ? []
        : [{ paragraph: paragraph.index, before, after, category: 'grammar' as const }];
    });
  }

  /**
   * Every model hunk left on the page, applied alone, keeps the chapter's
   * syntax, its frontmatter and its paragraph count; every one kept out is
   * at offset 0; and no two left on the page touch. Gives the counts of both.
   */
  function keepsTheSyntax(text: string, hunks: readonly Hunk[]): { onPage: number; keptOut: number } {
    const signature = syntaxSignature(text);
    const front = bodyStart(text);
    const count = splitParagraphs(text).length;
    let onPage = 0;
    let keptOut = 0;
    for (const hunk of hunks) {
      if (hunk.source !== 'claude') continue;
      if (hunk.anchor === 'stale') {
        if (hunk.keptOut !== undefined) {
          expect([hunk.start, hunk.end]).toEqual([0, 0]);
          keptOut += 1;
        }
        continue;
      }
      const after = composeText(text, [{ ...hunk, status: 'accepted' }]);
      expect(syntaxSignature(after), JSON.stringify({ text, hunk })).toBe(signature);
      expect(bodyStart(after)).toBe(front);
      expect(after.slice(0, front)).toBe(text.slice(0, front));
      expect(splitParagraphs(after).length).toBe(count);
      onPage += 1;
    }
    const page = hunks.filter((h) => h.anchor !== 'stale').sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < page.length; i += 1) expect(page[i]?.start).not.toBe(page[i - 1]?.end);
    return { onPage, keptOut };
  }

  it('each model suggestion left on the page, applied alone, keeps the syntax, the frontmatter and the paragraph count', () => {
    let onPage = 0;
    let keptOut = 0;
    fc.assert(
      fc.property(chapterArb, fc.array(pickArb, { minLength: 1, maxLength: 12 }), (text, picks) => {
        const review = createAiReview({
          sourcePath: 'C:/vault/Chapter.md',
          base: { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
          changes: changesFor(text, picks),
          comments: [],
          generator: { kind: 'claude', provider: 'claude' }
        });
        const counts = keepsTheSyntax(text, review.hunks);
        onPage += counts.onPage;
        keptOut += counts.keptOut;
        // Loaded again, a review the guard made is the same review.
        expect(guardLoadedReview(review)).toBe(review);
      }),
      { numRuns: 1000 }
    );
    expect(onPage).toBeGreaterThan(1000);
    expect(keptOut).toBeGreaterThan(1000);
  });

  it('so does each one left on the page of a review made before the guard, once it is loaded', () => {
    let onPage = 0;
    fc.assert(
      fc.property(chapterArb, fc.array(pickArb, { minLength: 1, maxLength: 12 }), (text, picks) => {
        const hunks = anchorChanges(text, splitParagraphs(text), changesFor(text, picks), {
          source: 'claude'
        });
        const loaded = guardLoadedReview(reviewOf(text, hunks));
        onPage += keepsTheSyntax(text, loaded.hunks).onPage;
        expect(guardLoadedReview(loaded)).toBe(loaded);
      }),
      { numRuns: 500 }
    );
    expect(onPage).toBeGreaterThan(500);
  });

  /* Short chapters of fence, comment and maths lines, with and without words
     after them, so that one often opens in one paragraph and closes, or could
     close, in another, and one edit at any place: what a paragraph read alone
     does not show (the files.7 review). */
  const PAIRING_LINES = [
    '```',
    '~~~',
    '```js',
    '~~~ The end',
    '<!--',
    '-->',
    '- >',
    '->',
    '%%',
    '$$',
    'Rain fell.',
    'Sun came out.'
  ];
  const pairingArb = fc
    .array(fc.tuple(fc.constantFrom(...PAIRING_LINES), fc.boolean()), { minLength: 2, maxLength: 10 })
    .map((lines) => lines.map(([text, blank], k) => (k === 0 ? '' : blank ? '\n\n' : '\n') + text).join(''));

  it('so does one in a chapter whose code, comments and maths open in one paragraph and close in another', () => {
    let onPage = 0;
    let keptOut = 0;
    fc.assert(
      fc.property(
        pairingArb,
        fc.nat(),
        fc.nat({ max: 12 }),
        fc.constantFrom('', ' ', '  ', '-', '.', 'x', ' x', 'js'),
        (text, at, length, replacement) => {
          const start = at % (text.length + 1);
          const end = Math.min(text.length, start + length);
          const original = text.slice(start, end);
          if (original === replacement) return;
          const hunk: Hunk = {
            id: 'h1',
            start,
            end,
            baseSide: 'original',
            original,
            replacement,
            paragraph: 0,
            source: 'claude',
            status: 'pending',
            anchor: 'exact'
          };
          const [out] = screenModelHunks(text, [hunk]);
          if (out?.keptOut !== undefined) {
            keptOut += 1;
            return;
          }
          onPage += 1;
          const after = composeText(text, [{ ...hunk, status: 'accepted' }]);
          expect(syntaxSignature(after), JSON.stringify({ text, hunk })).toBe(syntaxSignature(text));
          expect(splitParagraphs(after).length).toBe(splitParagraphs(text).length);
        }
      ),
      { numRuns: 3000 }
    );
    expect(onPage).toBeGreaterThan(300);
    expect(keptOut).toBeGreaterThan(300);
  });

  /* Another editor's words, syntax among them: a link's brackets, a tag, a
     heading's #, a code span's backtick, a comment's %%, a rule, a quote. */
  const typedArb = fc.option(
    fc.constantFrom(
      'the',
      'Mara',
      '#',
      '#late',
      '[[',
      ']]',
      '`',
      '%%',
      '---',
      '>',
      'https://example.com',
      ','
    ),
    { nil: null }
  );
  /* What another editor puts round a suggestion's words: syntax, or not
     (emphasis and brackets are prose here); and, for `join`, the text between
     it and the hunk before it taken out, so the two touch. */
  const WRAPS: ReadonlyArray<readonly [string, string]> = [
    ['[[', ']]'],
    ['`', '`'],
    ['%%', '%%'],
    ['#', ''],
    ['', '#x'],
    ['[', '](https://example.com)'],
    ['*', '*'],
    ['(', ')']
  ];
  const wrapArb = fc.record({
    hunk: fc.nat(),
    wrap: fc.oneof(fc.constantFrom(...WRAPS), fc.constant('join' as const))
  });

  /** `text` with each wrap made round the hunk it picks among those on the page, last place first. */
  function wrapped(
    text: string,
    hunks: readonly Hunk[],
    wraps: ReadonlyArray<typeof wrapArb extends fc.Arbitrary<infer T> ? T : never>
  ): string {
    const page = hunks.filter((h) => h.anchor !== 'stale').sort((a, b) => a.start - b.start || a.end - b.end);
    const cuts: Array<{ from: number; to: number; insert: string }> = [];
    for (const { hunk, wrap } of wraps) {
      const i = hunk % Math.max(1, page.length);
      const h = page[i];
      if (!h) continue;
      if (wrap === 'join') {
        const previous = page[i - 1];
        if (previous && previous.end < h.start) cuts.push({ from: previous.end, to: h.start, insert: '' });
        continue;
      }
      cuts.push({ from: h.end, to: h.end, insert: wrap[1] }, { from: h.start, to: h.start, insert: wrap[0] });
    }
    let out = text;
    let last = Infinity;
    for (const cut of cuts.sort((a, b) => b.from - a.from || b.to - a.to)) {
      if (cut.to > last) continue;
      out = out.slice(0, cut.from) + cut.insert + out.slice(cut.to);
      last = cut.from;
    }
    return out;
  }

  it('so does each one left on the page after a change on disk, and the review the rebase gives loads as it is (files.20)', () => {
    let onPage = 0;
    let keptOut = 0;
    fc.assert(
      fc.property(
        chapterArb,
        fc.array(pickArb, { minLength: 1, maxLength: 12 }),
        fc.array(wrapArb, { maxLength: 3 }),
        fc.array(editArb(typedArb, ALL_OPS), { maxLength: 4 }),
        (text, picks, wraps, edits) => {
          const review = createAiReview({
            sourcePath: 'C:/vault/Chapter.md',
            base: { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
            changes: changesFor(text, picks),
            comments: [],
            generator: { kind: 'claude', provider: 'claude' }
          });
          const later = applyEdits(wrapped(text, review.hunks, wraps), edits).text;
          const { review: moved, stats } = rebaseReview(review, nextBase(later));
          keptOut += stats.keptOut;
          // What the guard screens: each one left on the page keeps the syntax, and touches no hunk before it.
          const signature = syntaxSignature(later);
          const front = bodyStart(later);
          const count = splitParagraphs(later).length;
          const page = moved.hunks
            .filter((h) => h.anchor !== 'stale')
            .sort((a, b) => a.start - b.start || a.end - b.end);
          page.forEach((hunk, i) => {
            if (!isGuarded(hunk)) return;
            const after = composeText(later, [{ ...hunk, status: 'accepted' }]);
            expect(syntaxSignature(after), JSON.stringify({ later, hunk })).toBe(signature);
            expect(after.slice(0, front)).toBe(later.slice(0, front));
            expect(splitParagraphs(after).length).toBe(count);
            expect(hunk.start).not.toBe(page[i - 1]?.end);
            onPage += 1;
          });
          for (const hunk of moved.hunks) {
            if (hunk.keptOut !== undefined)
              expect([hunk.anchor, hunk.start, hunk.end]).toEqual(['stale', 0, 0]);
          }
          expect(guardLoadedReview(moved)).toBe(moved);
        }
      ),
      { numRuns: 1000 }
    );
    expect(onPage).toBeGreaterThan(1000);
    expect(keptOut).toBeGreaterThan(100);
  });
});

describe('no hunk before the body (files.22)', () => {
  /**
   * The layouts a chapter's start takes: no frontmatter; a text that starts
   * with a blank line; a frontmatter with the body on the line after its
   * closing `---`, as Obsidian writes it; one with a blank line between, or
   * two, one of them holding a space; and one whose closing line carries
   * spaces.
   */
  const FRONTS = [
    '',
    '\n',
    '---\ntitle: x\n---\n',
    '---\ntitle: x\n---\n\n',
    '---\ntitle: x\n---\n \n\n',
    '---\ntitle: x\ntags: [a]\n---  \n'
  ];
  /** How the text ends: at the last words, or with a blank line or two, one holding a space. */
  const TAILS = ['', '\n', '\n \n'];

  /** The body paragraphs' words, as the page and the prompt read them. */
  const bodyOf = (text: string): string[] => bodyParagraphs(splitParagraphs(text)).map((p) => p.text);

  /** Every hunk on the page is drawn in a block of the body, never left out or in the frontmatter's. */
  function drawn(text: string, hunks: readonly Hunk[]): boolean {
    const ids = new Set(
      buildRenderBlocks(text, splitParagraphs(text), hunks)
        .filter((block) => !block.isFrontmatter)
        .flatMap((block) => block.segments.flatMap((s) => (s.kind === 'hunk' ? [s.hunk.id] : [])))
    );
    return hunks.every((h) => h.anchor === 'stale' || ids.has(h.id));
  }

  /** The text before the body, and the frontmatter as Obsidian reads it, are as they were. */
  function frontKept(before: string, after: string): void {
    const at = bodyStart(before);
    expect(after.slice(0, at)).toBe(before.slice(0, at));
    expect(frontmatterRange(after)).toEqual(frontmatterRange(before));
  }

  type Typing = 'nothing' | 'words' | 'top' | 'end' | 'breaks' | 'empty';

  it('the paragraph box makes no hunk before the body, and Done with nothing typed makes none at all', () => {
    const counts: Record<Typing, number> = { nothing: 0, words: 0, top: 0, end: 0, breaks: 0, empty: 0 };
    let first = 0;
    fc.assert(
      fc.property(
        fc.record({
          front: fc.constantFrom(...FRONTS),
          tail: fc.constantFrom(...TAILS),
          specs: fc.array(specArb, { minLength: 1, maxLength: 6 }),
          saved: fc.boolean(),
          which: fc.nat(),
          typing: fc.constantFrom<Typing>('nothing', 'words', 'top', 'end', 'breaks', 'empty'),
          words: fc.array(fc.nat({ max: 20 }), { minLength: 1, maxLength: 3 })
        }),
        ({ front, tail, specs, saved, which, typing, words }) => {
          const built = buildCase(specs);
          const shifted = built.hunks.map((h) => ({
            ...h,
            start: h.start + front.length,
            end: h.end + front.length
          }));
          const made = { text: `${front}${built.base}${tail}`, hunks: shifted };
          const { text: base, hunks } = saved ? commitDecisions(made.text, made.hunks) : made;
          const paragraphs = splitParagraphs(base);
          const body = bodyParagraphs(paragraphs);
          const target = body[which % body.length];
          if (!target) throw new Error('a chapter with no body paragraph');
          if (target.index === 0) first += 1;
          const span = blockSpanFor(base, paragraphs, hunks, target.index);
          if (!span) throw new Error('no block for a body paragraph');
          const live = liveTextIn(base, hunks, span);
          expect(live).not.toMatch(/^\n|\n$/);

          const pieces = live.split(' ');
          for (const k of words) pieces[k % pieces.length] = `new${k}`;
          const typed = {
            nothing: live,
            words: pieces.join(' '),
            top: `Added words here.\n\n${live}`,
            end: `${live}\n\nAdded words here.`,
            breaks: `\n\n${live}\n`,
            empty: ''
          }[typing];
          counts[typing] += 1;

          const plan = planBlockEdit({ base, paragraphs, hunks, span, text: typed });
          if (normalizeDraft(typed) === live) {
            expect(plan).toEqual({ kind: 'noop' });
            return;
          }
          if (plan.kind !== 'edit') throw new Error('expected an edit');
          const at = bodyStart(base);
          for (const added of plan.added) {
            expect(added.start, JSON.stringify({ base, typed })).toBeGreaterThanOrEqual(at);
            expect(base.slice(added.start, added.end)).toBe(added.original);
          }
          const next = applyBlockEdit(hunks, plan);
          const composed = composeText(base, next);
          frontKept(base, composed);
          // Nothing before the box changes either, but for the blank line an emptied last paragraph takes
          // with it, and what is typed at its top goes in there.
          if (typing !== 'empty') {
            const prefix = composeText(
              base.slice(0, span.start),
              hunks.filter((h) => h.start < span.start)
            );
            expect(composed.startsWith(prefix)).toBe(true);
            if (typing === 'top') expect(composed.slice(prefix.length)).toMatch(/^Added words here\.\n\n/);
          }
          expect(drawn(base, next)).toBe(true);
        }
      ),
      { numRuns: 1000 }
    );
    for (const typing of Object.keys(counts) as Typing[]) expect(counts[typing], typing).toBeGreaterThan(100);
    expect(first).toBeGreaterThan(300);
  });

  const WORDS = ['rain', 'mill', 'Mara', 'river', 'the', 'fell'];
  const paragraphArb = fc
    .array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 })
    .map((words) => `${words.join(' ')}.`);
  type Fate = 'keep' | 'change' | 'drop';

  it('the full-text diff makes no hunk before the body, and puts a paragraph added at the top before the first one', () => {
    let atTop = 0;
    let layoutOnly = 0;
    let empty = 0;
    fc.assert(
      fc.property(
        fc.record({
          front: fc.constantFrom(...FRONTS),
          frontC: fc.constantFrom(...FRONTS),
          tail: fc.constantFrom(...TAILS),
          tailC: fc.constantFrom(...TAILS),
          /** the final newline normalizeText keeps apart, taken off the original text */
          strip: fc.boolean(),
          separator: fc.constantFrom('\n\n', '\n\n\n', '\n \n'),
          paragraphs: fc.array(paragraphArb, { maxLength: 5 }),
          fates: fc.array(fc.constantFrom<Fate>('keep', 'keep', 'change', 'drop'), {
            minLength: 5,
            maxLength: 5
          }),
          inserts: fc.array(fc.record({ at: fc.nat({ max: 6 }), text: paragraphArb }), { maxLength: 3 }),
          decisions: fc.array(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), {
            maxLength: 12
          })
        }),
        ({ front, frontC, tail, tailC, strip, separator, paragraphs, fates, inserts, decisions }) => {
          let original = `${front}${paragraphs.join(separator)}${tail}`;
          if (strip) original = original.replace(/\n$/, '');
          const kept = paragraphs.flatMap((p, i): string[] => {
            const fate = fates[i] ?? 'keep';
            if (fate === 'drop') return [];
            return [fate === 'change' ? `Then ${p}` : p];
          });
          for (const insert of inserts)
            kept.splice(Math.min(insert.at, kept.length), 0, `New ${insert.text}`);
          if (inserts.some((insert) => insert.at === 0)) atTop += 1;
          const corrected = `${frontC}${kept.join('\n\n')}${tailC}`;
          if (bodyOf(original).length === 0) empty += 1;

          const hunks = diffToHunks(original, corrected);
          const at = bodyStart(original);
          for (const hunk of hunks) {
            expect(hunk.start, JSON.stringify({ original, corrected })).toBeGreaterThanOrEqual(at);
            expect(original.slice(hunk.start, hunk.end)).toBe(hunk.original);
          }
          if (bodyOf(original).length > 0) expect(drawn(original, hunks)).toBe(true);
          if (JSON.stringify(bodyOf(original)) === JSON.stringify(bodyOf(corrected))) {
            expect(hunks).toEqual([]);
            if (original !== corrected) layoutOnly += 1;
          }

          // Accepted, every hunk gives the corrected body; decided anyhow, the frontmatter stays as it is.
          const all = composeText(
            original,
            hunks.map((h) => ({ ...h, status: 'accepted' as const }))
          );
          expect(bodyOf(all)).toEqual(bodyOf(corrected));
          frontKept(original, all);
          const some = composeText(
            original,
            hunks.map((h, i) => ({ ...h, status: decisions[i] ?? h.status }))
          );
          frontKept(original, some);
        }
      ),
      { numRuns: 1000 }
    );
    expect(atTop).toBeGreaterThan(100);
    expect(layoutOnly).toBeGreaterThan(20);
    expect(empty).toBeGreaterThan(50);
  });
});
