import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOpenAiText } from '../../src/shared/ai/openaiReply';
import { composeForFile } from '../../src/shared/diff/compose';
import { keptOutNote } from '../../src/shared/diff/protect';
import {
  HIDDEN_PARAGRAPH,
  fromPromptNumbering,
  paragraphNumber,
  renderChapter
} from '../../src/shared/prompt/chapter';
import { createAiReview, toChangeCategory } from '../../src/shared/review';
import { normalizeText } from '../../src/shared/text/eol';
import { SYNTAX_KINDS, bodyStart, syntaxSignature, syntaxSpans } from '../../src/shared/text/obsidian';
import { bodyParagraphs, splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, KeptOutReason, Review } from '../../src/shared/types';
import { OBSIDIAN_REVIEW } from '../helpers/mockOpenAi';

/* files.9: the Obsidian sample chapter and the mock's review of it. The
   chapter holds every kind of syntax files.6 knows, with seeded errors in its
   prose and inside its syntax; the mock's `obsidian` scenario answers it with
   OBSIDIAN_REVIEW. Made into a review as the app makes one, exactly the fixes
   to the prose stay in the text, the ones that reach into syntax are kept out
   with their notes, and saving every fix leaves the syntax as it was, byte
   for byte. */

const RAW = readFileSync(
  new URL('../../samples/manuscript/Chapter 03 - Obsidian.md', import.meta.url),
  'utf8'
);
const SHAPE = normalizeText(RAW);
const TEXT = SHAPE.text;
const SOURCE = 'C:/vault/Chapter 03 - Obsidian.md';

/** The review the app makes of the mock's reply: parsed, renumbered from the prompt's numbers, anchored and screened. */
function reviewOfReply(): Review {
  const parsed = parseOpenAiText(JSON.stringify(OBSIDIAN_REVIEW));
  if (!parsed.ok || !parsed.value) throw new Error(`the reply did not parse: ${parsed.problem ?? ''}`);
  const output = fromPromptNumbering(parsed.value);
  return createAiReview({
    sourcePath: SOURCE,
    base: { ...SHAPE, hash: 'sample' },
    changes: output.changes.map((c) => ({ ...c, category: toChangeCategory(c.category) })),
    comments: output.comments,
    generator: { kind: 'openai', provider: 'openai', model: 'gpt-5-mini' },
    raw: parsed.raw
  });
}

const onPage = (hunks: readonly Hunk[]): Hunk[] => hunks.filter((h) => h.anchor !== 'stale');
const offPage = (hunks: readonly Hunk[]): Hunk[] => hunks.filter((h) => h.anchor === 'stale');

/** The fixes to the prose, in the order of the chapter: what is in the text, and what replaces it there. */
const INLINE: ReadonlyArray<[string, string]> = [
  ["was'nt", "wasn't"], // prose
  ['flod', 'flood'], // a link's alias
  ['realy', 'really'], // between emphasis markers
  ['laid', 'lain'], // between highlight markers
  ['leter', 'letter'], // a heading's words
  ['wrote', 'written'], // prose
  ['wrok', 'work'], // between HTML tags
  ['alot', 'a lot'], // a block quote's words, beside "$5", "$2" and "Room #4"
  ['agianst', 'against'], // a callout's title
  ['teh', 'the'], // a link's text
  ['was', 'were'], // an inline footnote's words
  ['fond', 'found'], // a block link's alias
  ['wich', 'which'] // a footnote definition's words
];

/**
 * The changes kept out of the text, in the order of the chapter: the words
 * each would change, trimmed as every suggestion is to the words that differ,
 * as Unanchored shows them, and why it is kept out.
 */
const KEPT_OUT: ReadonlyArray<[string, string, KeptOutReason]> = [
  [' ^stone', '', 'block-id'],
  ['-', '\u2013', 'embed'], // the hyphen in ![[Chapter 02 - After]]
  ['chekc', 'check', 'comment'],
  ['Millers', "Miller's", 'wikilink'],
  ['3 dollars', '$3', 'markup'],
  ['regsiters', 'registers', 'url'],
  ['recieved', 'received', 'code'],
  ['[^1].', '.[^1]', 'footnote'],
  ['skecth', 'sketch', 'image'],
  ['continuty', 'continuity', 'tag']
];

describe('the Obsidian sample chapter (files.9)', () => {
  it('holds every kind of syntax the detector knows', () => {
    const kinds = new Set(syntaxSpans(TEXT).map((s) => s.kind));
    expect([...SYNTAX_KINDS].filter((kind) => !kinds.has(kind))).toEqual([]);
    expect(SHAPE).toMatchObject({ eol: 'lf', bom: false, trailingNewline: true });
  });

  it('leaves single dollar signs, a number after #, emphasis and highlights as prose', () => {
    const spans = syntaxSpans(TEXT);
    for (const piece of ['$5 a week and $2', 'Room #4', '*realy*', '==It had laid', 'the kitchen.==']) {
      const at = TEXT.indexOf(piece);
      expect(at, piece).toBeGreaterThan(0);
      expect(
        spans.filter((s) => s.start < at + piece.length && at < s.end),
        piece
      ).toEqual([]);
    }
  });

  it('hides the note, code, maths and comment paragraphs from the model, typos and all', () => {
    const prompt = renderChapter(TEXT, 'Chapter 03 - Obsidian.md');
    for (const n of [14, 15, 16, 17]) expect(prompt).toContain(`[${n}] ${HIDDEN_PARAGRAPH}\n`);
    expect(prompt.split(HIDDEN_PARAGRAPH)).toHaveLength(5);
    for (const words of [
      'paid 2s',
      'ninteen',
      '1852 - 1833',
      'Decide before the rewrite',
      'The black glass'
    ]) {
      expect(prompt).not.toContain(words);
    }
    // The comment beside prose is still sent, so a model can reach into it.
    expect(prompt).toContain('[6] %% chekc whether');
  });
});

describe("the mock's review of it (OBSIDIAN_REVIEW)", () => {
  it('is in the strict shape and quotes each paragraph by the number the prompt gives it', () => {
    expect(parseOpenAiText(JSON.stringify(OBSIDIAN_REVIEW)).ok).toBe(true);
    const shown = new Map(
      bodyParagraphs(splitParagraphs(TEXT)).map((p) => [paragraphNumber(p.index), p.text])
    );
    for (const change of OBSIDIAN_REVIEW.changes) {
      const paragraph = shown.get(change.paragraph) ?? '';
      expect(paragraph.split(change.before), change.before).toHaveLength(2);
    }
  });

  it('keeps exactly the fixes to the prose in the text, each where the model put it', () => {
    const review = reviewOfReply();
    const inline = onPage(review.hunks);
    expect(inline.map((h) => [h.original, h.replacement])).toEqual(INLINE);
    expect(inline.every((h) => h.anchor === 'exact' && h.keptOut === undefined)).toBe(true);
    for (const h of inline) expect(TEXT.slice(h.start, h.end)).toBe(h.original);
  });

  it('keeps out each change that reaches into syntax, with its reason and note, and loses none', () => {
    const review = reviewOfReply();
    const out = offPage(review.hunks);
    expect(out.map((h) => [h.original, h.replacement, h.keptOut])).toEqual(KEPT_OUT);
    expect(out.every((h) => h.start === 0 && h.end === 0 && h.status === 'pending')).toBe(true);
    expect(review.hunks).toHaveLength(OBSIDIAN_REVIEW.changes.length);
    expect(keptOutNote('embed')).toBe(
      'Kept out of the text: it would change Obsidian syntax (an embed). Make this change in Obsidian or with the paragraph pen if you want it.'
    );
    expect(out.map((h) => keptOutNote(h.keptOut!).match(/\(([^)]+)\)/)?.[1])).toEqual([
      'a block ID',
      'an embed',
      'a comment',
      'an internal link',
      'a markup character',
      'a web address',
      'code',
      'a footnote',
      'an image',
      'a tag'
    ]);
  });

  it('anchors its comments to the paragraphs they name', () => {
    const review = reviewOfReply();
    expect(review.comments.map((c) => c.paragraph)).toEqual([1, 9, null]);
  });

  it('saves every fix to the prose and leaves the syntax and the frontmatter byte for byte', () => {
    const review = reviewOfReply();
    const saved = composeForFile({
      ...review,
      hunks: review.hunks.map((h) => (h.anchor === 'stale' ? h : { ...h, status: 'accepted' as const }))
    });
    const expected = RAW.replace("was'nt", "wasn't")
      .replace('the flod]]', 'the flood]]')
      .replace('*realy*', '*really*')
      .replace('had laid', 'had lain')
      .replace('## The leter', '## The letter')
      .replace('never wrote', 'never written')
      .replace('<u>wrok</u>', '<u>work</u>')
      .replace('alot of', 'a lot of')
      .replace('agianst', 'against')
      .replace('[teh tithe', '[the tithe')
      .replace('copies was lost', 'copies were lost')
      .replace('she fond it', 'she found it')
      .replace('wich is', 'which is');
    expect(saved).toBe(expected);

    const after = normalizeText(saved).text;
    expect(syntaxSignature(after)).toBe(syntaxSignature(TEXT));
    expect(after.slice(0, bodyStart(after))).toBe(TEXT.slice(0, bodyStart(TEXT)));
    const texts = (text: string): string[] =>
      syntaxSpans(text)
        .filter((s) => ['wikilink', 'embed', 'callout', 'comment', 'footnote', 'block-id'].includes(s.kind))
        .map((s) => text.slice(s.start, s.end));
    expect(texts(after)).toEqual(texts(TEXT));
    // Five pieces of internal links, an embed, two callouts, three comments, four footnote marks, a block ID.
    expect(texts(after)).toHaveLength(16);
    // What the guard kept out is still there to be fixed by hand.
    for (const words of ['^stone', 'Chapter 02 - After', 'chekc', '[[Millers Lane]]', '3 dollars']) {
      expect(after).toContain(words);
    }
    for (const words of ['regsiters', '`recieved`', 'wheel[^1].', 'skecth', '#continuty']) {
      expect(after).toContain(words);
    }
  });
});
