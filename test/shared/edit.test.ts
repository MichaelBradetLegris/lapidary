import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  commitDecisions,
  composeText,
  findOverlaps,
  unsavedDecisionCount
} from '../../src/shared/diff/compose';
import { rebaseReview } from '../../src/shared/diff/rebase';
import {
  MANUAL_REASON,
  SUPERSEDE_PREFIX,
  applyBlockEdit,
  blockSpanFor,
  editSuggestion,
  isAuthored,
  liveTextIn,
  normalizeDraft,
  planBlockEdit,
  supersedeHunk,
  type BlockEditPlan,
  type Span
} from '../../src/shared/edit';
import { resetIdCounter } from '../../src/shared/ids';
import { buildRenderBlocks } from '../../src/shared/render';
import { createReview } from '../../src/shared/review';
import { bodyParagraphs, splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkSource, HunkStatus, Review } from '../../src/shared/types';

/* The author's own example, from the screenshot with the second feedback round:
   Claude suggested "Tilting" -> "As he tilted", and the author wants to rewrite
   the whole opening of the sentence instead. */
const BASE = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';
const FIRST: Span = { start: 0, end: 40 };
const SECOND: Span = { start: 42, end: 66 };

function claudeHunk(over: Partial<Hunk> = {}): Hunk {
  return {
    id: 'h1',
    start: 0,
    end: 7,
    baseSide: 'original',
    original: 'Tilting',
    replacement: 'As he tilted',
    paragraph: 0,
    category: 'awkward',
    reason: 'Participial opener.',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...over
  };
}

function reviewWith(hunks: Hunk[], base = BASE): Review {
  return createReview({
    sourcePath: 'C:/vault/Chapter 01.md',
    base: { text: base, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    hunks,
    generator: { kind: 'claude' },
    now: '2026-09-11T00:00:00.000Z'
  });
}

/** Plan and apply one paragraph edit, failing loudly if it planned nothing. */
function edit(
  hunks: Hunk[],
  span: Span,
  text: string,
  ids?: string[],
  base = BASE
): {
  plan: BlockEditPlan;
  hunks: Hunk[];
} {
  const plan = planBlockEdit({
    base,
    paragraphs: splitParagraphs(base),
    hunks,
    span,
    text,
    ...(ids ? { ids } : {})
  });
  if (plan.kind !== 'edit') throw new Error('expected an edit');
  return { plan, hunks: applyBlockEdit(hunks, plan) };
}

beforeEach(() => resetIdCounter(0));

it('the fixture spans are the two paragraphs', () => {
  expect(BASE.slice(FIRST.start, FIRST.end)).toBe('Tilting his head aside, the man watched.');
  expect(BASE.slice(SECOND.start, SECOND.end)).toBe('She said nothing at all.');
});

describe('live text of a span', () => {
  it('is the base text when nothing inside it is accepted', () => {
    expect(liveTextIn(BASE, [claudeHunk()], { start: 0, end: 23 })).toBe('Tilting his head aside,');
  });

  it('applies an accepted suggestion, because that is what the page says', () => {
    const accepted = [claudeHunk({ status: 'accepted' })];
    expect(liveTextIn(BASE, accepted, { start: 0, end: 23 })).toBe('As he tilted his head aside,');
  });

  it('leaves a dismissed suggestion out', () => {
    const dismissed = [claudeHunk({ status: 'dismissed' })];
    expect(liveTextIn(BASE, dismissed, { start: 0, end: 23 })).toBe('Tilting his head aside,');
  });
});

describe('the span a paragraph editor opens on', () => {
  it('is the paragraph itself', () => {
    expect(blockSpanFor(BASE, splitParagraphs(BASE), [], 1)).toEqual({ ...SECOND, paragraphs: [1] });
  });

  it('takes both paragraphs when a deletion straddles the blank line between them', () => {
    const deletion = claudeHunk({
      id: 'd',
      start: 40,
      end: 66,
      original: '\n\nShe said nothing at all.',
      replacement: '',
      source: 'diff'
    });
    expect(blockSpanFor(BASE, splitParagraphs(BASE), [deletion], 1)).toEqual({
      start: 0,
      end: 66,
      paragraphs: [0, 1]
    });
  });
});

describe('the text box', () => {
  it('drops line breaks at either end but keeps spaces', () => {
    expect(normalizeDraft('\r\n\n  Indented line.\r\nSecond line.\n\n')).toBe(
      '  Indented line.\nSecond line.'
    );
  });
});

describe('planning a paragraph edit', () => {
  it('turns one changed word into one small accepted hunk', () => {
    const { plan } = edit([], FIRST, 'Tilting his head aside, the boy watched.', ['m1']);
    expect(plan.added).toEqual([
      {
        id: 'm1',
        start: 28,
        end: 31,
        baseSide: 'original',
        original: 'man',
        replacement: 'boy',
        paragraph: 0,
        category: 'other',
        reason: MANUAL_REASON,
        source: 'manual',
        status: 'accepted',
        anchor: 'exact'
      }
    ]);
    expect(plan.superseded).toEqual([]);
  });

  it('gives changes far apart a hunk each rather than one that owns the paragraph', () => {
    const { plan, hunks } = edit([], FIRST, 'Tilting her head aside, the man waited.');
    expect(plan.added.map((h) => [h.original, h.replacement])).toEqual([
      ['his', 'her'],
      ['watched', 'waited']
    ]);
    expect(composeText(BASE, hunks)).toBe(
      'Tilting her head aside, the man waited.\n\nShe said nothing at all.'
    );
  });

  it('handles the author s example: the suggestion is superseded and the text is theirs', () => {
    const typed = 'He tilted, his head aside, and the man watched.';
    const { plan, hunks } = edit([claudeHunk()], FIRST, typed);

    expect(plan.added[0]).toMatchObject({ start: 0, end: 7, original: 'Tilting', replacement: 'He tilted,' });
    expect(plan.superseded).toHaveLength(1);
    expect(plan.superseded[0]).toMatchObject({
      id: 'h1',
      status: 'dismissed',
      anchor: 'stale',
      supersededBy: plan.added[0]?.id
    });
    // The suggestion's own reasoning survives behind the prefix.
    expect(plan.superseded[0]?.reason).toBe(`${SUPERSEDE_PREFIX}Participial opener.`);
    expect(composeText(BASE, hunks)).toBe(`${typed}\n\nShe said nothing at all.`);
    expect(findOverlaps(hunks)).toEqual([]);
  });

  it('starts from the page, so an accepted suggestion is part of what the author edits', () => {
    const accepted = claudeHunk({ status: 'accepted' });
    expect(liveTextIn(BASE, [accepted], FIRST)).toBe('As he tilted his head aside, the man watched.');
    const { hunks } = edit([accepted], FIRST, 'As he tilted his head aside, the boy watched.');
    // "man" is nowhere near the suggestion, which stays exactly as it was.
    expect(hunks.find((h) => h.id === 'h1')).toEqual(accepted);
    expect(composeText(BASE, hunks)).toBe(
      'As he tilted his head aside, the boy watched.\n\nShe said nothing at all.'
    );
  });

  it('swallows a suggestion that a change merely touches, such as punctuation right after it', () => {
    const watched = claudeHunk({
      id: 'w',
      start: 32,
      end: 39,
      original: 'watched',
      replacement: 'looked on'
    });
    const { plan, hunks } = edit([watched], FIRST, 'Tilting his head aside, the man watched!');
    expect(plan.superseded.map((h) => h.id)).toEqual(['w']);
    expect(plan.added[0]).toMatchObject({ original: 'watched.', replacement: 'watched!' });
    expect(composeText(BASE, hunks)).toBe(
      'Tilting his head aside, the man watched!\n\nShe said nothing at all.'
    );
  });

  it('turns a suggestion down, with no new hunk, when the author types the file s words back', () => {
    const accepted = claudeHunk({ status: 'accepted' });
    const { plan, hunks } = edit([accepted], FIRST, 'Tilting his head aside, the man watched.');
    expect(plan.added).toEqual([]);
    expect(plan.superseded).toEqual([]);
    expect(plan.decided).toEqual([{ ...accepted, status: 'dismissed' }]);
    expect(composeText(BASE, hunks)).toBe(BASE);
  });

  it('accepts a suggestion outright when the author types exactly its fix', () => {
    const { plan, hunks } = edit([claudeHunk()], FIRST, 'As he tilted his head aside, the man watched.');
    expect(plan.added).toEqual([]);
    expect(plan.superseded).toEqual([]);
    // Category and reason survive, which a new hunk of the author's would have buried.
    expect(plan.decided).toEqual([claudeHunk({ status: 'accepted' })]);
    expect(composeText(BASE, hunks)).toBe(
      'As he tilted his head aside, the man watched.\n\nShe said nothing at all.'
    );
  });

  it('after a save, typing the file s words back accepts the suggestion they came from', () => {
    // Accept, save, then turn the suggestion back down: the file holds its words.
    const saved = commitDecisions(BASE, [claudeHunk({ status: 'accepted' })]);
    const turnedDown = saved.hunks.map((h) => ({ ...h, status: 'dismissed' as const }));
    const span: Span = { start: 0, end: saved.text.indexOf('\n\n') };
    expect(liveTextIn(saved.text, turnedDown, span)).toBe('Tilting his head aside, the man watched.');

    const { plan, hunks } = edit(
      turnedDown,
      span,
      'As he tilted his head aside, the man watched.',
      undefined,
      saved.text
    );
    expect(plan.added).toEqual([]);
    expect(plan.decided.map((h) => [h.id, h.status])).toEqual([['h1', 'accepted']]);
    expect(composeText(saved.text, hunks)).toBe(saved.text);
  });

  it('replaces the author s own earlier edit instead of stacking a second one on it', () => {
    const first = edit([claudeHunk()], FIRST, 'He tilted his head aside, the man watched.', ['m1']);
    const again = edit(first.hunks, FIRST, 'He cocked his head aside, the man watched.', ['m2']);

    expect(again.plan.removed).toEqual(['m1']);
    expect(again.hunks.some((h) => h.id === 'm1')).toBe(false);
    // The suggestion m1 had superseded now points at m2, so a rebase still
    // keeps it off the page.
    expect(again.hunks.find((h) => h.id === 'h1')?.supersededBy).toBe('m2');
    expect(composeText(BASE, again.hunks)).toBe(
      'He cocked his head aside, the man watched.\n\nShe said nothing at all.'
    );
  });

  it('does nothing when the box says what the page says', () => {
    const plan = planBlockEdit({
      base: BASE,
      paragraphs: splitParagraphs(BASE),
      hunks: [claudeHunk({ status: 'accepted' })],
      span: FIRST,
      text: '\nAs he tilted his head aside, the man watched.\n'
    });
    expect(plan.kind).toBe('noop');
  });

  it('deletes an emptied last paragraph together with the blank line before it', () => {
    const { plan, hunks } = edit([], SECOND, '   ');
    expect(plan.added[0]).toMatchObject({ start: 40, end: 66, replacement: '' });
    expect(composeText(BASE, hunks)).toBe('Tilting his head aside, the man watched.');
    // The deletion starts in the blank line, and the page must still draw it.
    const blocks = buildRenderBlocks(BASE, splitParagraphs(BASE), hunks);
    expect(blocks.map((b) => b.paragraphs)).toEqual([[0, 1]]);
    expect(blocks[0]?.segments.some((s) => s.kind === 'hunk' && s.hunk.id === plan.added[0]?.id)).toBe(true);
  });

  it('deletes an emptied first paragraph with the blank line after it', () => {
    const { hunks } = edit([claudeHunk()], FIRST, '');
    expect(composeText(BASE, hunks)).toBe('She said nothing at all.');
    expect(hunks.find((h) => h.id === 'h1')).toMatchObject({ anchor: 'stale', status: 'dismissed' });
  });

  it('never reaches into the frontmatter when the first paragraph is deleted', () => {
    const withFrontmatter = `---\ntitle: One\n---\n\n${BASE}`;
    const paragraphs = splitParagraphs(withFrontmatter);
    const first = bodyParagraphs(paragraphs)[0];
    if (!first) throw new Error('fixture');
    const { hunks } = edit([], { start: first.start, end: first.end }, '', undefined, withFrontmatter);
    expect(composeText(withFrontmatter, hunks)).toBe('---\ntitle: One\n---\n\nShe said nothing at all.');
  });
});

describe('editing a suggestion in place', () => {
  it('keeps source, category and reason, and records that the words are the author s', () => {
    const next = editSuggestion(BASE, claudeHunk(), 'Tilting his head', true);
    expect(next).toMatchObject({
      source: 'claude',
      category: 'awkward',
      reason: 'Participial opener.',
      replacement: 'Tilting his head',
      edited: true,
      status: 'accepted'
    });
    expect(isAuthored(next)).toBe(true);
    expect(isAuthored(claudeHunk())).toBe(false);
    expect(isAuthored({ source: 'manual' })).toBe(true);
  });

  it('does not accept on the author s behalf when Accept now is unticked', () => {
    expect(editSuggestion(BASE, claudeHunk(), 'x', false).status).toBe('pending');
    expect(editSuggestion(BASE, claudeHunk({ status: 'dismissed' }), 'x', false).status).toBe('dismissed');
    // An accepted hunk whose text changed while "Accept now" is off goes back
    // to pending, so the new words are never written without a decision.
    expect(editSuggestion(BASE, claudeHunk({ status: 'accepted' }), 'x', false).status).toBe('pending');
  });

  it('leaves a suggestion the file does not hold yet on its original', () => {
    const next = editSuggestion(BASE, claudeHunk(), 'He tilted', true);
    expect(next).toMatchObject({ original: 'Tilting', baseSide: 'original', replacement: 'He tilted' });
    expect(composeText(BASE, [next])).toBe(`He tilted${BASE.slice(7)}`);
    expect(unsavedDecisionCount([next])).toBe(1);
  });

  it('counts nothing unsaved when the new words are the file s own', () => {
    // Before apply.22 this left an accepted "Tilting" -> "Tilting" counted as
    // one unsaved change that would write nothing.
    const ticked = editSuggestion(BASE, claudeHunk(), 'Tilting', true);
    expect(ticked).toMatchObject({
      original: 'Tilting',
      replacement: 'Tilting',
      baseSide: 'replacement',
      status: 'accepted'
    });
    expect(composeText(BASE, [ticked])).toBe(BASE);
    expect(unsavedDecisionCount([ticked])).toBe(0);

    const unticked = editSuggestion(BASE, claudeHunk({ status: 'accepted' }), 'Tilting', false);
    expect(unticked).toMatchObject({ baseSide: 'original', status: 'pending' });
    expect(composeText(BASE, [unticked])).toBe(BASE);
    expect(unsavedDecisionCount([unticked])).toBe(0);
  });

  it('only takes the new words on a stale suggestion, which has no place in the text', () => {
    const stale = claudeHunk({ anchor: 'stale', start: 0, end: 0, baseSide: 'replacement' });
    expect(editSuggestion(BASE, stale, 'He tilted', true)).toEqual({
      ...stale,
      replacement: 'He tilted',
      edited: true,
      status: 'accepted'
    });
  });
});

/* apply.22: "began" -> "begun" accepted and saved, then rewritten as "started",
   as seen in a dev:clean window. The page showed "started", nothing counted as
   unsaved, and a second Save left "begun" in the file. */
describe('rewriting a suggestion already saved into the chapter (apply.22)', () => {
  const BEFORE = 'The water had began to climb.\n\nShe watched it.';

  function savedCase(status: HunkStatus = 'accepted'): { base: string; hunk: Hunk } {
    const hunk: Hunk = {
      id: 'g',
      start: 14,
      end: 19,
      baseSide: 'original',
      original: 'began',
      replacement: 'begun',
      paragraph: 0,
      category: 'grammar',
      reason: 'Past participle.',
      source: 'claude',
      status: 'accepted',
      anchor: 'exact'
    };
    expect(BEFORE.slice(hunk.start, hunk.end)).toBe('began');
    const committed = commitDecisions(BEFORE, [hunk]);
    const saved = committed.hunks[0];
    if (!saved) throw new Error('no hunk');
    return { base: committed.text, hunk: { ...saved, status } };
  }

  it('starts from what Save to chapter leaves', () => {
    const { base, hunk } = savedCase();
    expect(base).toBe('The water had begun to climb.\n\nShe watched it.');
    expect(hunk).toMatchObject({ baseSide: 'replacement', status: 'accepted', start: 14, end: 19 });
    expect(unsavedDecisionCount([hunk])).toBe(0);
  });

  it('ticked, the new words are one unsaved change and Save writes them', () => {
    const { base, hunk } = savedCase();
    const next = editSuggestion(base, hunk, 'started', true);
    expect(next).toMatchObject({
      start: 14,
      end: 19,
      baseSide: 'original',
      original: 'begun',
      replacement: 'started',
      status: 'accepted',
      edited: true,
      source: 'claude',
      category: 'grammar',
      reason: 'Past participle.'
    });
    expect(composeText(base, [next])).toBe('The water had started to climb.\n\nShe watched it.');
    expect(unsavedDecisionCount([next])).toBe(1);

    // Save to chapter folds it in; a second rewrite is a change against "started".
    const saved = commitDecisions(base, [next]);
    expect(saved.text).toBe('The water had started to climb.\n\nShe watched it.');
    expect(unsavedDecisionCount(saved.hunks)).toBe(0);
    const again = editSuggestion(saved.text, saved.hunks[0]!, 'risen', true);
    expect(composeText(saved.text, [again])).toBe('The water had risen to climb.\n\nShe watched it.');
    expect(unsavedDecisionCount([again])).toBe(1);
  });

  it('unticked, the page keeps the saved words, and the model s original is not put back', () => {
    const { base, hunk } = savedCase();
    const next = editSuggestion(base, hunk, 'started', false);
    expect(next).toMatchObject({ baseSide: 'original', original: 'begun', replacement: 'started' });
    expect(next.status).toBe('pending');
    expect(composeText(base, [next])).toBe(base);
    expect(composeText(base, [next])).not.toContain('began');
    expect(unsavedDecisionCount([next])).toBe(0);

    // Accepting it afterwards writes the new words.
    const accepted = { ...next, status: 'accepted' as const };
    expect(composeText(base, [accepted])).toBe('The water had started to climb.\n\nShe watched it.');
    expect(unsavedDecisionCount([accepted])).toBe(1);
  });

  it('rewriting back to the saved words leaves nothing unsaved, ticked or not', () => {
    const { base, hunk } = savedCase();
    const rewritten = editSuggestion(base, hunk, 'started', true);

    const back = editSuggestion(base, rewritten, 'begun', true);
    expect(back).toMatchObject({
      original: 'begun',
      replacement: 'begun',
      baseSide: 'replacement',
      status: 'accepted'
    });
    expect(composeText(base, [back])).toBe(base);
    expect(unsavedDecisionCount([back])).toBe(0);

    const backUnticked = editSuggestion(base, rewritten, 'begun', false);
    expect(backUnticked.status).toBe('pending');
    expect(composeText(base, [backUnticked])).toBe(base);
    expect(unsavedDecisionCount([backUnticked])).toBe(0);
  });

  it('a saved change the author turned back takes the new words against the saved ones', () => {
    // Turned back after the save: the page reads "began" and Save would write it.
    const { base, hunk } = savedCase('pending');
    expect(composeText(base, [hunk])).toBe(BEFORE);
    expect(unsavedDecisionCount([hunk])).toBe(1);

    const ticked = editSuggestion(base, hunk, 'started', true);
    expect(composeText(base, [ticked])).toBe('The water had started to climb.\n\nShe watched it.');
    expect(unsavedDecisionCount([ticked])).toBe(1);

    // Unticked, the rewrite waits as a suggestion against what the file says.
    const unticked = editSuggestion(base, hunk, 'started', false);
    expect(unticked).toMatchObject({ baseSide: 'original', original: 'begun', status: 'pending' });
    expect(composeText(base, [unticked])).toBe(base);
    expect(unsavedDecisionCount([unticked])).toBe(0);

    const dismissed = editSuggestion(base, { ...hunk, status: 'dismissed' }, 'started', false);
    expect(dismissed.status).toBe('dismissed');
    expect(composeText(base, [dismissed])).toBe(base);

    // Accepting the saved words again keeps the original a turn-back restores.
    const reaccepted = editSuggestion(base, hunk, 'begun', true);
    expect(reaccepted).toMatchObject({ original: 'began', baseSide: 'replacement', status: 'accepted' });
    expect(unsavedDecisionCount([reaccepted])).toBe(0);
  });

  it('a saved deletion rewritten becomes an insertion of the new words', () => {
    const doubled = 'Down by the the river.';
    const deletion: Hunk = {
      ...claudeHunk(),
      start: 8,
      end: 12,
      original: 'the ',
      replacement: '',
      status: 'accepted'
    };
    expect(doubled.slice(8, 12)).toBe('the ');
    const saved = commitDecisions(doubled, [deletion]);
    expect(saved.text).toBe('Down by the river.');
    const hunk = saved.hunks[0]!;
    expect(hunk).toMatchObject({ start: 8, end: 8, baseSide: 'replacement' });

    const next = editSuggestion(saved.text, hunk, 'all ', true);
    expect(next).toMatchObject({ original: '', replacement: 'all ', baseSide: 'original' });
    expect(composeText(saved.text, [next])).toBe('Down by all the river.');
    expect(unsavedDecisionCount([next])).toBe(1);
  });
});

describe('superseded suggestions stay out of the way', () => {
  it('rebase leaves them unanchored even when their words are still findable', () => {
    const { hunks } = edit([claudeHunk()], FIRST, 'He tilted his head aside, the man watched.', ['m1']);
    const review = reviewWith(hunks);

    // The chapter changes elsewhere, so everything re-anchors.
    const nextText = `A line before.\n\n${BASE}`;
    const { review: rebased } = rebaseReview(review, {
      text: nextText,
      hash: 'h2',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    });

    const movedManual = rebased.hunks.find((h) => h.id === 'm1');
    const movedClaude = rebased.hunks.find((h) => h.id === 'h1');
    expect(movedManual?.anchor).not.toBe('stale');
    expect(nextText.slice(movedManual?.start, movedManual?.end)).toBe('Tilting');
    // "Tilting" is still right there, and it still must not come back.
    expect(movedClaude?.anchor).toBe('stale');
    expect(movedClaude?.status).toBe('dismissed');
    expect(movedClaude?.reason).toContain('Participial opener.');
  });

  it('does not double the prefix if a hunk is superseded twice', () => {
    const once = supersedeHunk(claudeHunk(), 'm1');
    const twice = supersedeHunk(once, 'm2');
    expect(twice.reason).toBe(`${SUPERSEDE_PREFIX}Participial opener.`);
  });

  it('describes a suggestion that carried no reason of its own', () => {
    const bare = supersedeHunk(claudeHunk({ reason: undefined }), 'm1');
    expect(bare.reason).toBe(`${SUPERSEDE_PREFIX}Tilting → As he tilted`);
  });
});

/* ------------------------------------------------------------------ */
/* Property: a paragraph edit composes to exactly what was typed       */
/* ------------------------------------------------------------------ */

interface PieceSpec {
  isHunk: boolean;
  gap: number;
  span: number;
  status: HunkStatus;
  paragraphBreak: boolean;
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

/** A text and non-overlapping hunks built together, as in properties.test.ts. */
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
    for (let i = 0; i < spec.gap; i += 1) push(`w${word++}`);
    if (spec.paragraphBreak) text += '\n\n';
    if (!spec.isHunk) continue;
    const tokens: string[] = [];
    for (let i = 0; i < spec.span; i += 1) tokens.push(`w${word++}`);
    const original = tokens.join(' ');
    const start = text.length + (text.length > 0 && !text.endsWith('\n') ? 1 : 0);
    push(original);
    hunks.push({
      id: `h${hunks.length}`,
      start,
      end: start + original.length,
      baseSide: 'original',
      original,
      replacement: `r${repl++} r${repl++},`,
      paragraph: 0,
      source: spec.source,
      status: spec.status,
      anchor: 'exact'
    });
  }
  push(`w${word}.`);
  return { base: text, hunks };
}

type Op = { kind: 'replace' | 'delete' | 'insert' | 'punctuate'; at: number };

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Op['kind']>('replace', 'delete', 'insert', 'punctuate'),
  at: fc.nat({ max: 50 })
});

/** Apply word-level edits to a paragraph's text, the way an author would. */
function applyOps(text: string, ops: readonly Op[]): string {
  const words = text.split(' ');
  let fresh = 0;
  for (const op of ops) {
    if (words.length === 0) break;
    const i = op.at % words.length;
    if (op.kind === 'replace') words[i] = `new${fresh++}`;
    else if (op.kind === 'delete' && words.length > 1) words.splice(i, 1);
    else if (op.kind === 'insert') words.splice(i, 0, `add${fresh++}`);
    else if (op.kind === 'punctuate') words[i] = `${words[i] ?? ''};`;
  }
  return words.join(' ');
}

describe('paragraph edits, generated', () => {
  const editArb = fc.record({
    specs: fc.array(specArb, { minLength: 1, maxLength: 8 }),
    which: fc.nat(),
    ops: fc.array(opArb, { minLength: 1, maxLength: 5 }),
    /** start after a save, so some hunks hold their replacement in the base */
    saved: fc.boolean(),
    /** then flip some decisions, as an author does after saving */
    flips: fc.array(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), { maxLength: 8 })
  });

  it('compose to exactly the typed text, with no overlaps and every new hunk accepted', () => {
    fc.assert(
      fc.property(editArb, ({ specs, which, ops, saved, flips }) => {
        const built = buildCase(specs);
        const committed = saved
          ? commitDecisions(built.base, built.hunks)
          : { text: built.base, hunks: built.hunks };
        const base = committed.text;
        const hunks = committed.hunks.map((h, i) => (flips[i] ? { ...h, status: flips[i] } : h));
        const paragraphs = splitParagraphs(base);
        const body = bodyParagraphs(paragraphs);
        const target = body[which % body.length];
        if (!target) return;
        const span = blockSpanFor(base, paragraphs, hunks, target.index);
        if (!span) throw new Error('no block for a body paragraph');

        const live = liveTextIn(base, hunks, span);
        const typed = applyOps(live, ops);
        fc.pre(typed.trim().length > 0);

        const composed = composeText(base, hunks);
        const prefix = composeText(
          base.slice(0, span.start),
          hunks.filter((h) => h.start < span.start)
        );
        expect(composed.slice(prefix.length, prefix.length + live.length)).toBe(live);
        const suffix = composed.slice(prefix.length + live.length);

        const plan = planBlockEdit({ base, paragraphs, hunks, span, text: typed });
        if (typed === live) {
          expect(plan.kind).toBe('noop');
          return;
        }
        if (plan.kind !== 'edit') throw new Error('expected an edit');
        const next = applyBlockEdit(hunks, plan);

        expect(composeText(base, next)).toBe(prefix + typed + suffix);
        expect(findOverlaps(next)).toEqual([]);
        for (const added of plan.added) {
          expect(added).toMatchObject({ source: 'manual', status: 'accepted', anchor: 'exact' });
          expect(base.slice(added.start, added.end)).toBe(added.original);
        }
      }),
      { numRuns: 400 }
    );
  });
});
