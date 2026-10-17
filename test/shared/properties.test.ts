import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  commitDecisions,
  composeText,
  findOverlaps,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import { insideWord } from '../../src/shared/diff/fuzzy';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { editSuggestion } from '../../src/shared/edit';
import { createReview } from '../../src/shared/review';
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
