import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { commitDecisions, composeText, findOverlaps } from '../../src/shared/diff/compose';
import {
  MANUAL_REASON,
  SUPERSEDE_PREFIX,
  applyBlockEdit,
  chapterBodyOf,
  chapterForEdit,
  fullEditResult,
  fullEditText,
  normalizeChapterDraft,
  planChapterEdit,
  type BlockEditPlan
} from '../../src/shared/edit';
import { resetIdCounter } from '../../src/shared/ids';
import { bodyPieces, bodyParagraphs, splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkSource, HunkStatus } from '../../src/shared/types';

/* rr.2: Full edit, the whole chapter in one box. On Done the box is planned in
   one pass by the paragraph box's rules (PLAN 7.4) on the paragraphs the
   full-text diff aligns (4.4), and the plan composes to exactly the chapter
   with the box's words in place of its body. */

const FRONT = '---\ntitle: The Flood\ntags: [draft]\n---';
const P1 = 'Rain had fallen for three days.';
const P2 = 'The river rose over the old stones.';
const P3 = 'Mara watched it from the mill door.';
const P4 = 'Nobody came down the road that night.';
const BODY = [P1, P2, P3, P4].join('\n\n');
const CHAPTER = `${FRONT}\n${BODY}`;

function hunkAt(
  base: string,
  original: string,
  replacement: string,
  extra: Partial<Hunk> = {},
  from = 0
): Hunk {
  const start = base.indexOf(original, from);
  if (start < 0) throw new Error(`no "${original}" in the text`);
  return {
    id: extra.id ?? `h-${original}`,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'word-choice',
    reason: `Reason for ${original}.`,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

/** Plan and apply one Full edit, failing loudly if it planned nothing, and check it composes to the box. */
function fullEdit(
  base: string,
  hunks: Hunk[],
  text: string,
  ids?: string[],
  editLimit?: number
): { plan: BlockEditPlan; hunks: Hunk[]; composed: string } {
  const plan = planChapterEdit({
    base,
    hunks,
    text,
    ...(ids ? { ids } : {}),
    ...(editLimit === undefined ? {} : { editLimit })
  });
  if (plan.kind !== 'edit') throw new Error('expected an edit');
  const next = applyBlockEdit(hunks, plan);
  const composed = composeText(base, next);
  expect(composed).toBe(fullEditResult(base, hunks, text));
  expect(findOverlaps(next)).toEqual([]);
  return { plan, hunks: next, composed };
}

/** The new hunks as [original, replacement] pairs, in text order. */
function changes(plan: BlockEditPlan): [string, string][] {
  return [...plan.added].sort((a, b) => a.start - b.start).map((h) => [h.original, h.replacement]);
}

beforeEach(() => resetIdCounter(0));

describe('what Full edit opens on', () => {
  it('is the body as the page reads it, with the frontmatter apart', () => {
    const accepted = hunkAt(CHAPTER, 'old', 'ancient', { status: 'accepted' });
    const pending = hunkAt(CHAPTER, 'watched', 'saw');
    const chapter = chapterForEdit(CHAPTER, [accepted, pending]);
    expect(chapter.frontmatter).toBe(FRONT);
    expect(fullEditText(CHAPTER, [accepted, pending])).toBe(BODY.replace('old', 'ancient'));
    expect(chapter.text.slice(0, chapter.start)).toBe(`${FRONT}\n`);
    expect(chapter.lead).toBe('');
  });

  it('starts at the first paragraph and ends at the last, past any blank lines round them', () => {
    const text = `\n\n${P1}\n\n${P2}\n\n\n`;
    const chapter = chapterBodyOf(text);
    expect(text.slice(chapter.start, chapter.end)).toBe(`${P1}\n\n${P2}`);
    expect(chapter.frontmatter).toBeNull();
  });

  it('puts words typed into a chapter with no body after a blank line, unless the text ends a line', () => {
    expect(chapterBodyOf(FRONT)).toMatchObject({ start: FRONT.length, end: FRONT.length, lead: '\n\n' });
    expect(chapterBodyOf(`${FRONT}\n`)).toMatchObject({ lead: '' });
    expect(chapterBodyOf('')).toMatchObject({ start: 0, end: 0, lead: '' });
    expect(fullEditResult(FRONT, [], 'First words.')).toBe(`${FRONT}\n\nFirst words.`);
    expect(fullEditResult('', [], 'First words.')).toBe('First words.');
  });

  it('reads the body as paragraphs with no frontmatter looked for', () => {
    const text = '---\nThree days later.\n---\n\nShe woke.';
    expect(bodyPieces(text).map((p) => p.text)).toEqual(['---\nThree days later.\n---', 'She woke.']);
    expect(bodyPieces(`x\n\n  \n\n${P1}\n \n${P2}`, 3).map((p) => p.text)).toEqual([P1, P2]);
  });
});

describe('the box tidied', () => {
  it('drops line breaks at either end, keeps spaces, and makes a box of spaces empty', () => {
    expect(normalizeChapterDraft('\r\n\nWords.  \n\n')).toBe('Words.  ');
    expect(normalizeChapterDraft('  \n \t ')).toBe('');
  });

  it('changes nothing when the box reads as the body did, line breaks at the ends or not', () => {
    for (const text of [BODY, `\n\n${BODY}\n`, BODY.replace(/\n/g, '\r\n')]) {
      expect(planChapterEdit({ base: CHAPTER, hunks: [], text })).toEqual({ kind: 'noop' });
    }
  });
});

describe('planning a Full edit', () => {
  it('turns three changed paragraphs and a paragraph break into four accepted hunks of the author s own', () => {
    const typed = [
      'Rain had fallen for four days.',
      'The river rose over the worn stones.',
      'Mara watched it from the mill door,\n\nand did not move.',
      'Nobody came up the road that night.'
    ].join('\n\n');
    // The third paragraph gained a comma, a break and words before its full stop: one change.
    const { plan, composed } = fullEdit(CHAPTER, [], typed, ['m1', 'm2', 'm3', 'm4']);
    expect(changes(plan)).toEqual([
      ['three', 'four'],
      ['old', 'worn'],
      ['', ',\n\nand did not move'],
      ['down', 'up']
    ]);
    for (const hunk of plan.added) {
      expect(hunk).toMatchObject({
        source: 'manual',
        status: 'accepted',
        anchor: 'exact',
        category: 'other',
        reason: MANUAL_REASON,
        baseSide: 'original'
      });
      expect(CHAPTER.slice(hunk.start, hunk.end)).toBe(hunk.original);
    }
    expect(composed).toBe(`${FRONT}\n${typed}`);
  });

  it('gives a break added in a paragraph a hunk of its own, the space it replaced', () => {
    const typed = BODY.replace('rose over', 'rose\n\nover');
    const { plan } = fullEdit(CHAPTER, [], typed);
    expect(changes(plan)).toEqual([[' ', '\n\n']]);
  });

  it('takes a break out to join two paragraphs', () => {
    const typed = BODY.replace(`${P1}\n\n${P2}`, `${P1} ${P2}`);
    const { plan } = fullEdit(CHAPTER, [], typed);
    expect(changes(plan)).toEqual([['\n\n', ' ']]);
  });

  it('puts a paragraph added between two behind a blank line after the first (4.4)', () => {
    const typed = [P1, P2, 'A heron lifted from the reeds.', P3, P4].join('\n\n');
    const { plan, hunks } = fullEdit(CHAPTER, [], typed);
    expect(changes(plan)).toEqual([['', '\n\nA heron lifted from the reeds.']]);
    expect(hunks[0]?.start).toBe(CHAPTER.indexOf(P2) + P2.length);
  });

  it('puts a paragraph added at the top before the first, after the frontmatter, followed by a blank line', () => {
    const typed = `It began on a Tuesday.\n\n${BODY}`;
    const { plan } = fullEdit(CHAPTER, [], typed);
    expect(changes(plan)).toEqual([['', 'It began on a Tuesday.\n\n']]);
    expect(plan.added[0]?.start).toBe(CHAPTER.indexOf(P1));
  });

  it('puts a paragraph added at the end after the last, behind a blank line', () => {
    const { plan } = fullEdit(CHAPTER, [], `${BODY}\n\nThe end.`);
    expect(changes(plan)).toEqual([['', '\n\nThe end.']]);
    expect(plan.added[0]?.start).toBe(CHAPTER.length);
  });

  it('deletes a paragraph with the blank line after it where one follows, else the one before (4.4)', () => {
    const middle = fullEdit(CHAPTER, [], [P1, P2, P4].join('\n\n'));
    expect(changes(middle.plan)).toEqual([[`${P3}\n\n`, '']]);
    const first = fullEdit(CHAPTER, [], [P2, P3, P4].join('\n\n'));
    expect(changes(first.plan)).toEqual([[`${P1}\n\n`, '']]);
    const last = fullEdit(CHAPTER, [], [P1, P2, P3].join('\n\n'));
    expect(changes(last.plan)).toEqual([[`\n\n${P4}`, '']]);
  });

  it('deletes the whole body, and nothing of the frontmatter, when the box is emptied', () => {
    for (const text of ['', '   \n  ']) {
      const { plan, composed } = fullEdit(CHAPTER, [], text);
      expect(changes(plan)).toEqual([[BODY, '']]);
      expect(composed).toBe(`${FRONT}\n`);
    }
  });

  it('changes the blank lines alone where only they changed', () => {
    const typed = BODY.replace(`${P2}\n\n${P3}`, `${P2}\n\n\n${P3}`);
    const { plan } = fullEdit(CHAPTER, [], typed);
    expect(plan.added).toHaveLength(1);
    expect(fullEditResult(CHAPTER, [], typed)).toBe(`${FRONT}\n${typed}`);
  });

  it('pairs a stretch too changed for one word diff by position, as the full-text diff does (4.4 step 2)', () => {
    // Every paragraph changed and one taken out: one stretch, its diff over the limit.
    const typed = [
      P1.replace('Rain', 'Snow'),
      P2.replace('river', 'stream'),
      P4.replace('road', 'lane')
    ].join('\n\n');
    const usual = fullEdit(CHAPTER, [], typed);
    expect(changes(usual.plan)).toEqual([
      ['Rain', 'Snow'],
      ['river', 'stream'],
      [`${P3}\n\n`, ''],
      ['road', 'lane']
    ]);
    /* Paired by position: P3 against P4's words, too changed for the limit, so
       replaced whole, and P4 taken out with the blank line before it; the two
       meet, so they are one change, still exactly as typed. */
    const paired = fullEdit(CHAPTER, [], typed, undefined, 2);
    expect(paired.composed).toBe(usual.composed);
    expect(changes(paired.plan)).toEqual([
      ['Rain', 'Snow'],
      ['river', 'stream'],
      [`${P3}\n\nNobody came down the road`, 'Nobody came down the lane']
    ]);
    // A limit of 0 still gives the chapter typed.
    expect(fullEdit(CHAPTER, [], typed, undefined, 0).composed).toBe(usual.composed);
  });

  it('pairs by position, unasked, a stretch past 1,000 edits (GAP_EDIT_LIMIT, C.112)', () => {
    /* A short paragraph taken out and every other word of the long one after
       it changed: one stretch of about 1,200 edits. One word diff keeps each
       changed word as a change of its own; past the limit the short paragraph
       is paired with the rewritten one, too changed for a diff of its own, so
       its words are replaced whole (the full stop both end in trimmed off), and
       the long one is taken out with the blank line after it, still exactly as
       typed. */
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`);
    const long = `${words.join(' ')}.`;
    const rewritten = `${words.map((w, i) => (i % 2 === 0 ? w.toUpperCase() : w)).join(' ')}.`;
    const base = `${FRONT}\n${P1}\n\nShort one here.\n\n${long}\n\n${P4}`;
    const typed = `${P1}\n\n${rewritten}\n\n${P4}`;
    const unlimited = fullEdit(base, [], typed, undefined, Number.MAX_SAFE_INTEGER);
    expect(unlimited.plan.added.length).toBeGreaterThan(500);
    const usual = fullEdit(base, [], typed);
    expect(usual.composed).toBe(unlimited.composed);
    expect(changes(usual.plan)).toEqual([
      ['Short one here', rewritten.slice(0, -1)],
      [`${long}\n\n`, '']
    ]);
  });

  it('adds words to a chapter with nothing but frontmatter, after a blank line', () => {
    const { plan, composed } = fullEdit(FRONT, [], 'The first words.');
    expect(changes(plan)).toEqual([['', '\n\nThe first words.']]);
    expect(composed).toBe(`${FRONT}\n\nThe first words.`);
    const empty = fullEdit('', [], 'The first words.');
    expect(empty.composed).toBe('The first words.');
  });

  it('never puts a change in the frontmatter, even with the body right under its closing line', () => {
    const typed = `A new opening.\n\n${BODY.replace('Rain', 'Snow')}`;
    const { plan, composed } = fullEdit(CHAPTER, [], typed);
    const bodyStart = CHAPTER.indexOf(P1);
    for (const hunk of plan.added) expect(hunk.start).toBeGreaterThanOrEqual(bodyStart);
    expect(composed.startsWith(`${FRONT}\n`)).toBe(true);
  });
});

describe('Full edit and the suggestions on the page, as a paragraph box treats them (7.4)', () => {
  it('supersedes a model suggestion its change takes, keeping its reasoning', () => {
    const watched = hunkAt(CHAPTER, 'watched', 'saw');
    const { plan, hunks } = fullEdit(CHAPTER, [watched], BODY.replace('watched it', 'stared at it'), ['m1']);
    expect(plan.superseded).toHaveLength(1);
    const superseded = hunks.find((h) => h.id === watched.id);
    expect(superseded).toMatchObject({ status: 'dismissed', anchor: 'stale', supersededBy: 'm1' });
    expect(superseded?.reason).toBe(`${SUPERSEDE_PREFIX}Reason for watched.`);
  });

  it('accepts a suggestion whose fix was typed exactly, and adds no hunk for it', () => {
    const watched = hunkAt(CHAPTER, 'watched', 'saw');
    const { plan, hunks } = fullEdit(CHAPTER, [watched], BODY.replace('watched', 'saw'));
    expect(plan.added).toEqual([]);
    expect(hunks.find((h) => h.id === watched.id)?.status).toBe('accepted');
  });

  it('turns an accepted suggestion down when the file s own words are typed back', () => {
    const accepted = hunkAt(CHAPTER, 'watched', 'saw', { status: 'accepted' });
    const { plan, hunks } = fullEdit(CHAPTER, [accepted], BODY);
    expect(plan.added).toEqual([]);
    expect(hunks.find((h) => h.id === accepted.id)?.status).toBe('dismissed');
  });

  it("replaces the author's own earlier edit instead of stacking a second one on it", () => {
    const first = fullEdit(CHAPTER, [], BODY.replace('old', 'worn'), ['m1']);
    const again = fullEdit(CHAPTER, first.hunks, BODY.replace('old', 'mossy'), ['m2']);
    expect(again.plan.removed).toEqual(['m1']);
    expect(again.hunks.filter((h) => h.source === 'manual').map((h) => h.replacement)).toEqual(['mossy']);
  });

  it('leaves the suggestions of paragraphs it does not change as they were', () => {
    const watched = hunkAt(CHAPTER, 'watched', 'saw');
    const nobody = hunkAt(CHAPTER, 'Nobody', 'No one', { status: 'accepted' });
    const typed = fullEditText(CHAPTER, [watched, nobody]).replace('old', 'worn');
    expect(typed).toContain('No one came');
    const { hunks } = fullEdit(CHAPTER, [watched, nobody], typed);
    expect(hunks.find((h) => h.id === watched.id)).toEqual(watched);
    expect(hunks.find((h) => h.id === nobody.id)).toEqual(nobody);
  });

  it('deletes a paragraph with the blank line before it when the next one starts with a suggestion', () => {
    // P4 starts with a suggestion: the blank line after P3 would take it with P3.
    const nobody = hunkAt(CHAPTER, 'Nobody', 'No one');
    const { plan, hunks } = fullEdit(CHAPTER, [nobody], [P1, P2, P4].join('\n\n'));
    expect(changes(plan)).toEqual([[`\n\n${P3}`, '']]);
    expect(hunks.find((h) => h.id === nobody.id)).toEqual(nobody);
  });

  it('puts a paragraph in before the next one when the one before ends in a suggestion', () => {
    const stop = hunkAt(CHAPTER, 'stones.', 'stones!');
    const typed = [P1, P2, 'A heron lifted.', P3, P4].join('\n\n');
    const { plan, hunks } = fullEdit(CHAPTER, [stop], typed);
    expect(changes(plan)).toEqual([['', 'A heron lifted.\n\n']]);
    expect(plan.added[0]?.start).toBe(CHAPTER.indexOf(P3));
    expect(hunks.find((h) => h.id === stop.id)).toEqual(stop);
  });

  it('takes the suggestion whole only where both places touch one, as a box would', () => {
    const stop = hunkAt(CHAPTER, 'stones.', 'stones!');
    const mara = hunkAt(CHAPTER, 'Mara', 'Mira');
    const typed = [P1, P2, 'A heron lifted.', P3, P4].join('\n\n');
    const { plan, hunks } = fullEdit(CHAPTER, [stop, mara], typed, ['m1']);
    expect(plan.superseded.map((h) => h.id)).toEqual([stop.id]);
    expect(hunks.find((h) => h.id === mara.id)).toEqual(mara);
  });

  it('keeps a saved suggestion saved where its paragraph is not changed', () => {
    const watched = hunkAt(CHAPTER, 'watched', 'saw', { status: 'accepted' });
    const saved = commitDecisions(CHAPTER, [watched]);
    const typed = fullEditText(saved.text, saved.hunks).replace('old', 'worn');
    const { hunks } = fullEdit(saved.text, saved.hunks, typed);
    expect(hunks.find((h) => h.id === watched.id)).toEqual(saved.hunks[0]);
  });
});

/* ------------------------------------------------------------------ */
/* Property: a Full edit composes to exactly the chapter typed           */
/* ------------------------------------------------------------------ */

interface PieceSpec {
  isHunk: boolean;
  gap: number;
  span: number;
  status: HunkStatus;
  paragraphBreak: boolean;
  source: HunkSource;
  /** a hunk with no original: an insertion */
  insertion: boolean;
}

const specArb: fc.Arbitrary<PieceSpec> = fc.record({
  isHunk: fc.boolean(),
  gap: fc.integer({ min: 1, max: 4 }),
  span: fc.integer({ min: 1, max: 3 }),
  status: fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'),
  paragraphBreak: fc.boolean(),
  source: fc.constantFrom<HunkSource>('diff', 'manual', 'claude'),
  insertion: fc.boolean()
});

/** A chapter and non-overlapping hunks built together, as in properties.test.ts, with insertions too. */
function buildCase(specs: readonly PieceSpec[], front: string): { base: string; hunks: Hunk[] } {
  let text = front;
  let word = 0;
  let repl = 0;
  const hunks: Hunk[] = [];
  const push = (token: string): void => {
    if (text.length > front.length && !text.endsWith('\n')) text += ' ';
    text += token;
  };
  for (const spec of specs) {
    for (let i = 0; i < spec.gap; i += 1) push(`w${word++}`);
    if (spec.paragraphBreak) text += '\n\n';
    if (!spec.isHunk) continue;
    if (spec.insertion) {
      // Before the next word, which every case has: the trailing word at least.
      const at = text.length + (text.length > front.length && !text.endsWith('\n') ? 1 : 0);
      hunks.push({
        id: `h${hunks.length}`,
        start: at,
        end: at,
        baseSide: 'original',
        original: '',
        replacement: `i${repl++} `,
        paragraph: 0,
        source: spec.source,
        status: spec.status,
        anchor: 'exact'
      });
      continue;
    }
    const tokens: string[] = [];
    for (let i = 0; i < spec.span; i += 1) tokens.push(`w${word++}`);
    const original = tokens.join(' ');
    const start = text.length + (text.length > front.length && !text.endsWith('\n') ? 1 : 0);
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

type Op =
  | { kind: 'replace' | 'delete' | 'insert' | 'punctuate' | 'split'; at: number }
  | { kind: 'join' | 'drop-paragraph' | 'add-paragraph' | 'blank-line'; at: number };

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Op['kind']>(
    'replace',
    'delete',
    'insert',
    'punctuate',
    'split',
    'join',
    'drop-paragraph',
    'add-paragraph',
    'blank-line'
  ),
  at: fc.nat({ max: 80 })
});

/** Edit a chapter's body the way an author would in one box: words, breaks and whole paragraphs. */
function applyOps(body: string, ops: readonly Op[]): string {
  let paragraphs = body.split('\n\n');
  let fresh = 0;
  for (const op of ops) {
    if (paragraphs.length === 0) paragraphs = [`add${fresh++}`];
    const p = op.at % paragraphs.length;
    const words = (paragraphs[p] ?? '').split(' ');
    const w = op.at % Math.max(1, words.length);
    switch (op.kind) {
      case 'replace':
        words[w] = `new${fresh++}`;
        paragraphs[p] = words.join(' ');
        break;
      case 'delete':
        if (words.length > 1) words.splice(w, 1);
        paragraphs[p] = words.join(' ');
        break;
      case 'insert':
        words.splice(w, 0, `add${fresh++}`);
        paragraphs[p] = words.join(' ');
        break;
      case 'punctuate':
        words[w] = `${words[w] ?? ''};`;
        paragraphs[p] = words.join(' ');
        break;
      case 'split':
        if (words.length > 1 && w > 0) {
          paragraphs.splice(p, 1, words.slice(0, w).join(' '), words.slice(w).join(' '));
        }
        break;
      case 'join':
        if (p + 1 < paragraphs.length) paragraphs.splice(p, 2, `${paragraphs[p]} ${paragraphs[p + 1]}`);
        break;
      case 'drop-paragraph':
        if (paragraphs.length > 1) paragraphs.splice(p, 1);
        break;
      case 'add-paragraph':
        paragraphs.splice(op.at % (paragraphs.length + 1), 0, `para${fresh++} words here.`);
        break;
      case 'blank-line':
        if (p + 1 < paragraphs.length) paragraphs[p] = `${paragraphs[p]}\n`;
        break;
    }
  }
  return paragraphs.join('\n\n');
}

describe('Full edits, generated', () => {
  const caseArb = fc.record({
    specs: fc.array(specArb, { minLength: 1, maxLength: 10 }),
    front: fc.constantFrom('', `${FRONT}\n`, `${FRONT}\n\n`),
    ops: fc.array(opArb, { minLength: 1, maxLength: 6 }),
    /** start after a save, so some hunks hold their replacement in the base */
    saved: fc.boolean(),
    /** then flip some decisions, as an author does after saving */
    flips: fc.array(fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed'), { maxLength: 10 }),
    /** the word diff's limit: the usual one, or so low that changed paragraphs are paired by position (4.4 step 2) */
    editLimit: fc.constantFrom<number | undefined>(undefined, undefined, 0, 2, 6)
  });

  it('compose to exactly the chapter typed, with no overlaps, the frontmatter as it was and every new hunk accepted', () => {
    fc.assert(
      fc.property(caseArb, ({ specs, front, ops, saved, flips, editLimit }) => {
        resetIdCounter(0);
        const built = buildCase(specs, front);
        const committed = saved
          ? commitDecisions(built.base, built.hunks)
          : { text: built.base, hunks: built.hunks };
        const base = committed.text;
        const hunks = committed.hunks.map((h, i) => (flips[i] ? { ...h, status: flips[i] } : h));

        const initial = fullEditText(base, hunks);
        const typed = applyOps(initial, ops);
        const plan = planChapterEdit({
          base,
          hunks,
          text: typed,
          ...(editLimit === undefined ? {} : { editLimit })
        });
        if (normalizeChapterDraft(typed) === initial) {
          expect(plan.kind).toBe('noop');
          return;
        }
        if (plan.kind !== 'edit') throw new Error('expected an edit');
        const next = applyBlockEdit(hunks, plan);

        const result = fullEditResult(base, hunks, typed);
        expect(composeText(base, next)).toBe(result);
        expect(findOverlaps(next)).toEqual([]);
        // The frontmatter, and what comes before the body, read as they did.
        const chapter = chapterForEdit(base, hunks);
        expect(result.slice(0, chapter.start)).toBe(chapter.text.slice(0, chapter.start));
        const firstBody = bodyParagraphs(splitParagraphs(base))[0];
        for (const added of plan.added) {
          expect(added).toMatchObject({ source: 'manual', status: 'accepted', anchor: 'exact' });
          expect(base.slice(added.start, added.end)).toBe(added.original);
          if (firstBody) expect(added.start).toBeGreaterThanOrEqual(firstBody.start);
        }
        for (const gone of plan.superseded) {
          expect(gone).toMatchObject({ status: 'dismissed', anchor: 'stale' });
          expect(plan.added.map((h) => h.id)).toContain(gone.supersededBy);
        }
      }),
      { numRuns: 500 }
    );
  });
});
