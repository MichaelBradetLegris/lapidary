import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { commitDecisions, composeText, findOverlaps } from '../../src/shared/diff/compose';
import { rebaseReview } from '../../src/shared/diff/rebase';
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
