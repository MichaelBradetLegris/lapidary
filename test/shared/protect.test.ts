import { describe, expect, it } from 'vitest';
import { anchorChanges, resolveOverlaps } from '../../src/shared/diff/anchor';
import {
  KEPT_OUT_LABELS,
  guardTouching,
  isGuarded,
  keptOutNote,
  screenModelHunks,
  touchingRule
} from '../../src/shared/diff/protect';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { createAiReview, guardLoadedReview, upgradeLoadedReview } from '../../src/shared/review';
import { MARKUP_CHARS, SYNTAX_KINDS, SYNTAX_LABELS, type SyntaxKind } from '../../src/shared/text/obsidian';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, KeptOutReason, Review, ReviewBase } from '../../src/shared/types';

/* files.7 (PLAN 11.3 k): a model's suggestion that would change Obsidian
   syntax is kept out of the text, as a stale hunk at offset 0 whose keptOut
   says why, and the side panel lists it under Unanchored with keptOutNote. */

let seq = 0;

/**
 * A pending model suggestion in `text`. `place` is a piece of the text that
 * occurs in it once, with `¦` where the suggestion starts (its start when
 * there is none); `original` follows there.
 */
function suggest(
  text: string,
  place: string,
  original: string,
  replacement: string,
  extra: Partial<Hunk> = {}
): Hunk {
  const mark = place.indexOf('¦');
  const piece = place.replace('¦', '');
  const at = text.indexOf(piece);
  if (at < 0 || text.includes(piece, at + 1)) throw new Error(`"${piece}" is not in the text exactly once`);
  const start = at + Math.max(0, mark);
  if (text.slice(start, start + original.length) !== original) {
    throw new Error(`"${original}" is not at the mark in "${place}"`);
  }
  seq += 1;
  return {
    id: `h${seq}`,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'grammar',
    reason: 'The model said so.',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

/** What the screen makes of one suggestion alone: its reason, or null when it stays on the page. */
function verdict(text: string, hunk: Hunk): KeptOutReason | null {
  const [out] = screenModelHunks(text, [hunk]);
  if (out === hunk) return null;
  expect(out).toEqual({ ...hunk, anchor: 'stale', start: 0, end: 0, keptOut: out?.keptOut });
  return out?.keptOut ?? null;
}

const CHAPTER = [
  '---',
  'title: The Mill',
  'tags: [novel]',
  '---',
  '# The Mill at Dawn',
  '',
  'Mara crossed the bridge. See [[Chapter 2]] and [[Chapter 3|the flood chapter]] for the rest.',
  '',
  '![[map.png]] showed the river, and ![an old map](town.png) showed the town.',
  '',
  'The [mill](https://example.com/mill) stood by the water^[a note on the river], as [^1] said. #draft',
  '',
  '> [!note] The miller',
  '> He kept the wheel turning.',
  '',
  '> Quoted words from the miller.',
  '',
  'Use `git status` each night, and %%a private note%% before <!-- an old note --> bed.',
  '',
  '$$x^2$$ was all she wrote, at https://example.org/notes in <span class="aside">the margin</span>.',
  '',
  '* * *',
  '',
  'The wheel turned all night. ^wheel-1',
  '',
  '```',
  'let x = 1;',
  '```',
  '',
  '[^1]: The miller himself.'
].join('\n');

/* One suggestion per kind that reaches into a span of that kind. */
const INTO: ReadonlyArray<[SyntaxKind, string, string, string]> = [
  ['frontmatter', 'title: The ¦Mill', 'Mill', 'Mills'],
  ['code', 'Use `git ¦status`', 'status', 'log'],
  ['code', 'let ¦x = 1;', 'x', 'y'],
  ['comment', 'a ¦private note%%', 'private', 'secret'],
  ['comment', '<!-- an ¦old note -->', 'old', 'older'],
  ['math', '$$x^¦2$$', '2', '3'],
  ['embed', '![[¦map.png]]', 'map', 'chart'],
  ['wikilink', 'See [[Chapter ¦2]]', '2', 'Two'],
  ['link', 'The [mill](https://example.com/¦mill)', 'mill', 'mills'],
  ['image', '![an ¦old map]', 'old', 'ancient'],
  ['footnote', 'as [^¦1] said', '1', '2'],
  ['footnote', 'water¦^[a note', '^[', ' ('],
  ['footnote', '[^¦1]: The miller', '1', '2'],
  ['block-id', '^wheel-¦1', '1', '2'],
  ['tag', '#¦draft', 'draft', 'drafts'],
  ['callout', '> [!¦note] The miller', 'note', 'info'],
  ['quote', '¦> Quoted words', '> ', ''],
  ['heading', '¦# The Mill at Dawn', '# ', ''],
  ['thematic-break', '¦* * *', '* * *', '***'],
  ['url', 'https://example.org/¦notes', 'notes', 'note'],
  ['html', '<span class="¦aside">', 'aside', 'note']
];

/* Prose beside, between or inside syntax, which a copyedit may change. */
const PROSE: ReadonlyArray<[string, string, string]> = [
  ['Mara ¦crossed the bridge', 'crossed', 'walked over'],
  ['# The Mill at ¦Dawn', 'Dawn', 'dawn'],
  ['the ¦flood chapter', 'flood', 'flooded'],
  ['The [¦mill](https', 'mill', 'Mill'],
  ['on the ¦river]', 'river', 'stream'],
  ['[!note] The ¦miller', 'miller', 'Miller'],
  ['> Quoted ¦words', 'words', 'phrases'],
  ['the ¦margin</span>', 'margin', 'margins'],
  ['The wheel ¦turned all', 'turned', 'spun'],
  ['The miller ¦himself.', 'himself', 'alone']
];

describe('screenModelHunks: a suggestion reaching into syntax', () => {
  it.each(INTO)('keeps out one that reaches into %s', (kind, place, original, replacement) => {
    expect(verdict(CHAPTER, suggest(CHAPTER, place, original, replacement))).toBe(kind);
  });

  it('has a case for every kind of syntax', () => {
    expect(new Set(INTO.map(([kind]) => kind))).toEqual(new Set(SYNTAX_KINDS));
  });

  it.each(PROSE)('leaves prose to be corrected: %s', (place, original, replacement) => {
    expect(verdict(CHAPTER, suggest(CHAPTER, place, original, replacement))).toBeNull();
  });

  it('keeps out an insertion strictly inside a span, and leaves one at its edge to the signature', () => {
    expect(verdict(CHAPTER, suggest(CHAPTER, '[[Chapter¦ 2]]', '', 's'))).toBe('wikilink');
    const text = 'See [[Mill]] today.';
    // `[[Mill]]s` keeps the link as it was.
    expect(verdict(text, suggest(text, '[[Mill]]¦ today', '', 's'))).toBeNull();
    expect(verdict(text, suggest(text, 'See ¦[[Mill]]', '', 'the '))).toBeNull();
  });
});

describe('screenModelHunks: the frontmatter and paragraph rules', () => {
  const TEXT = '---\ntitle: x\n---\nThe body starts here.\n\nA second paragraph.';
  const closing = TEXT.indexOf('---\nThe body') + 3;

  it('keeps out anything that starts before the body, the line break after the closing --- included', () => {
    expect(verdict(TEXT, suggest(TEXT, 'title: ¦x', 'x', 'y'))).toBe('frontmatter');
    const atBreak = {
      ...suggest(TEXT, 'The body', '', ''),
      start: closing,
      end: closing,
      replacement: 'Now '
    };
    expect(verdict(TEXT, atBreak)).toBe('frontmatter');
    expect(verdict(TEXT, suggest(TEXT, '¦The body', '', 'Now '))).toBeNull();
    // At the very start, before the opening ---, and running from the frontmatter into the body.
    expect(verdict(TEXT, suggest(TEXT, '¦---\ntitle', '', 'Draft. '))).toBe('frontmatter');
    expect(verdict(TEXT, suggest(TEXT, 'title: ¦x\n---\nThe', 'x\n---\nThe', 'The'))).toBe('frontmatter');
  });

  it('keeps out a suggestion inside a comment, maths or code that runs across a blank line', () => {
    // Read alone, the second paragraph has only an unclosed %%: the chapter's spans decide.
    const text = 'Rain.\n\n%%\nnote\n\nmore words\n%%\n\nSun.';
    expect(verdict(text, suggest(text, '¦more words', 'more', 'fewer'))).toBe('comment');
    const maths = 'Rain.\n\n$$\nx\n\ny plus z\n$$';
    expect(verdict(maths, suggest(maths, 'y ¦plus', 'plus', 'and'))).toBe('math');
  });

  it('keeps out a suggestion that crosses a blank line, before the markup rule', () => {
    const hunk = suggest(TEXT, 'here.¦\n\nA second', '\n\n', ' ');
    expect(verdict(TEXT, hunk)).toBe('paragraph-break');
  });

  it('keeps out a suggestion that would add or remove a paragraph', () => {
    const three = 'First one.\n\nGone soon.\n\nLast one.';
    expect(verdict(three, suggest(three, '¦Gone soon.', 'Gone soon.', ''))).toBe('paragraph-break');
    const lines = 'Line one\nline two\nline three';
    expect(verdict(lines, suggest(lines, '¦line two', 'line two', ''))).toBe('paragraph-break');
    expect(verdict(lines, suggest(lines, '¦line two', 'line two', 'the second'))).toBeNull();
  });

  it('reads a paragraph alone as part of the body: its --- lines are horizontal rules, not frontmatter (C.72)', () => {
    const text = 'Rain.\n\n---\nThree days later.\n---\n\nSun.';
    expect(verdict(text, suggest(text, 'Three ¦days', 'days', 'weeks'))).toBeNull();
    expect(verdict(text, suggest(text, '¦---\nThree', '---', '***'))).toBe('thematic-break');
  });
});

describe('screenModelHunks: the markup rule', () => {
  it("keeps out a suggestion whose words hold [ ] % $ ^ # < > | ~, a backtick or a line break: '%ab%'", () => {
    const text = 'He typed ab there, ten per cent of the time.';
    expect(verdict(text, suggest(text, 'typed ¦ab', 'ab', '%ab%'))).toBe('markup');
    expect(verdict(text, suggest(text, 'ten ¦per cent', 'per cent', '%'))).toBe('markup');
    for (const c of MARKUP_CHARS) {
      expect(verdict(text, suggest(text, 'typed ¦ab', 'ab', `a${c}b`)), JSON.stringify(c)).toBe('markup');
    }
    const lone = 'He typed %ab% there.';
    expect(verdict(lone, suggest(lone, 'typed ¦%ab%', '%ab%', 'ab'))).toBe('markup');
    // A lone pair of % is no comment, so the words between them are prose.
    expect(verdict(lone, suggest(lone, 'typed %¦ab%', 'ab', 'cd'))).toBeNull();
    const lines = 'Line one\nline two';
    expect(verdict(lines, suggest(lines, 'Line ¦one\nline', 'one\nline', 'one line'))).toBe('markup');
  });

  it("leaves a comma, an apostrophe, dashes and the other punctuation of prose: 'a,b'", () => {
    const text = 'He wrote a b there, and didnt stop - not once.';
    expect(verdict(text, suggest(text, 'wrote ¦a b', 'a b', 'a,b'))).toBeNull();
    expect(verdict(text, suggest(text, 'and ¦didnt', 'didnt', "didn't"))).toBeNull();
    expect(verdict(text, suggest(text, 'stop ¦- not', '- not', '\u2014 not'))).toBeNull();
    expect(verdict(text, suggest(text, '¦He wrote', 'He wrote', '"He wrote:'))).toBeNull();
  });
});

describe('screenModelHunks: the signature rule, a suggestion applied alone', () => {
  const CASES: ReadonlyArray<[KeptOutReason, string, string, string, string]> = [
    // A word run into a tag ends it as a tag, and one added to it renames it.
    ['tag', 'Mara wrote #draft notes.', 'wrote ¦#draft', '', 'x'],
    ['tag', 'Mara wrote #draft notes.', '#draft¦ notes', '', 's'],
    // Taking the backslash away makes a tag, which the markup rule cannot see (C.72).
    ['tag', 'Mara wrote \\#draft notes.', 'wrote ¦\\#draft', '\\', ''],
    ['tag', 'Room #4 was cold.', '#4¦ was', '', 'a'],
    ['url', 'Read it at example.com today.', 'at ¦example.com', 'example.com', 'https://example.com'],
    ['block-id', 'The end. ^done', '^done¦', '', ' now'],
    ['thematic-break', 'Scene one.\n--\nScene two.', '--¦\nScene two', '', '-'],
    ['heading', '# Title\nText.', '¦# Title', '', '    ']
  ];

  it.each(CASES)('keeps out a change to %s: %j', (kind, text, place, original, replacement) => {
    expect(verdict(text, suggest(text, place, original, replacement))).toBe(kind);
  });

  it('names what the suggestion adds when it takes nothing away', () => {
    const text = 'See https://example.com/a and write here.';
    expect(verdict(text, suggest(text, 'and ¦write', 'write', 'https://example.com/b'))).toBe('url');
    // A tag made in front of a web address that stays: the tag, not the address.
    const escaped = 'Mara wrote \\#draft at https://example.com today.';
    expect(verdict(escaped, suggest(escaped, 'wrote ¦\\#draft', '\\', ''))).toBe('tag');
  });

  it('names the syntax as it was when one kind gives way to another', () => {
    // The address runs on through the tag, which is a tag no more.
    const text = 'Go to example.com #draft now.';
    expect(
      verdict(text, suggest(text, 'to ¦example.com #draft', 'example.com ', 'https://example.com'))
    ).toBe('tag');
  });
});

describe('screenModelHunks: a paragraph the chapter reads in a wider context (the files.7 review)', () => {
  const FENCE = '`'.repeat(3);
  /* Read alone, the paragraph after the blank line ends in what looks like an
     unclosed opener, whose run a suggestion after it leaves as it was. */
  const BLOCK = (fence: string): string =>
    `Rain fell.\n\n${fence}\nlet x = 1;\n\nlet y = 2;\n${fence}\n\nSun came out.`;

  it.each([FENCE, '~~~'])(
    'keeps out words added after the closing %s of a block that holds a blank line',
    (fence) => {
      const text = BLOCK(fence);
      for (const added of ['.', ' x']) {
        expect(verdict(text, suggest(text, `${fence}¦\n\nSun`, '', added)), added).toBe('code');
      }
    }
  );

  it('keeps out an indent added to the opening fence of such a block, which runs out of its paragraph', () => {
    const text = BLOCK(FENCE);
    expect(verdict(text, suggest(text, `¦${FENCE}\nlet x`, '', ' '))).toBe('code');
    const after = `Rain fell.\n\nNow.\n${FENCE}\nlet x = 1;\n\nlet y = 2;\n${FENCE}\n\nSun came out.`;
    expect(verdict(after, suggest(after, `Now.\n¦${FENCE}`, '', '  '))).toBe('code');
  });

  it('keeps out a line made into the closer of an opener the chapter leaves unclosed in an earlier paragraph', () => {
    const backticks = `Rain fell.\n\n${FENCE}\n\nSun came out.\n\n${FENCE}js\nlet x;`;
    expect(verdict(backticks, suggest(backticks, `${FENCE}¦js`, 'js', ''))).toBe('code');
    const tildes = 'Rain fell.\n\n~~~\n\nSun came out.\n\n~~~ The end';
    expect(verdict(tildes, suggest(tildes, '~~~¦ The end', ' The end', ''))).toBe('code');
    const spaced = 'Rain fell. <!-- a note\n\nSun came out.\n\nIt went on - > there.';
    expect(verdict(spaced, suggest(spaced, 'on -¦ > there', ' ', '-'))).toBe('comment');
    const arrow = 'Rain fell. <!-- a note\n\nSun came out.\n\nIt went on -> there.';
    expect(verdict(arrow, suggest(arrow, 'on ¦-> there', '', '-'))).toBe('comment');
  });

  it('leaves the prose of such paragraphs to be corrected, and what closes as before', () => {
    const text = `Rain fell.\n\nNow.\n${FENCE}\nlet x = 1;\n\nlet y = 2;\n${FENCE}\nThe sun came out.`;
    expect(verdict(text, suggest(text, '¦Now.', 'Now', 'Then'))).toBeNull();
    expect(verdict(text, suggest(text, 'The ¦sun came', 'sun', 'Sun'))).toBeNull();
    const comment = 'Rain.\n\n%%\nnote\n\nmore\n%%\n\nSun.';
    expect(verdict(comment, suggest(comment, 'more\n%%¦\n\nSun', '', ' x'))).toBeNull();
    const maths = 'Rain.\n\n$$\nx\n\ny\n$$\n\nSun.';
    expect(verdict(maths, suggest(maths, 'y\n$$¦\n\nSun', '', '.'))).toBeNull();
    const unclosed = 'Rain fell. <!-- a note\n\nSun came out.\n\nIt went on - > there.';
    expect(verdict(unclosed, suggest(unclosed, 'Sun ¦came', 'came', 'had come'))).toBeNull();
    expect(verdict(unclosed, suggest(unclosed, 'went on - > ¦there', 'there', 'away'))).toBeNull();
  });
});

describe('the touching rule in the overlap pass (the files.7 review)', () => {
  it("keeps out a touching suggestion before overlaps are measured, so it pushes none off the page: 'abcd efgh'", () => {
    const text = 'abcd efgh';
    const ab = suggest(text, '¦abcd', 'ab', 'AB');
    const cd = suggest(text, 'ab¦cd', 'cd', 'CD');
    const d = suggest(text, 'abc¦d e', 'd', 'D');
    const out = resolveOverlaps([d, cd, ab], touchingRule(text));
    expect(out).toEqual([ab, { ...cd, anchor: 'stale', start: 0, end: 0, keptOut: 'combined' }, d]);
    expect(out[0]).toBe(ab);
    expect(out[2]).toBe(d);
    // Without the rule, cd stays on the page and pushes d off as an overlap.
    expect(resolveOverlaps([d, cd, ab]).map((h) => h.reason ?? null)).toEqual([
      'The model said so.',
      'The model said so.',
      'The model said so. [Overlapped an earlier suggestion.]'
    ]);
  });

  it("measures against the hunk before that stayed, the author's own included, and still pushes off one that overlaps it", () => {
    const text = 'abcd efgh';
    const mine = suggest(text, '¦abcd', 'ab', 'AB', { source: 'manual', status: 'accepted' });
    const inside = suggest(text, 'a¦bcd', 'b', 'B');
    const cd = suggest(text, 'ab¦cd', 'cd', 'CD');
    const d = suggest(text, 'abc¦d e', 'd', 'D');
    const out = resolveOverlaps([mine, inside, cd, d], touchingRule(text));
    expect(out.map((h) => [h.original, h.anchor === 'stale', h.keptOut ?? null])).toEqual([
      ['ab', false, null],
      ['b', true, null],
      ['cd', true, 'combined'],
      ['d', false, null]
    ]);
    expect(out[1]?.reason).toContain('Overlapped');
  });
});

describe('guardTouching', () => {
  it("keeps out a suggestion that starts where the one before it ends: 'a,b'", () => {
    const text = 'a,b';
    const a = suggest(text, '¦a,', 'a', 'A');
    const comma = suggest(text, 'a¦,', ',', ';');
    const out = guardTouching(text, [a, comma]);
    expect(out[0]).toBe(a);
    expect(out[1]).toEqual({ ...comma, anchor: 'stale', start: 0, end: 0, keptOut: 'combined' });
  });

  it('goes by position, whatever the order, and measures the next one against the one before a hunk it kept out', () => {
    const text = 'abc def';
    const [a, b, c] = ['a', 'b', 'c'].map((x) => suggest(text, `¦${x}`, x, x.toUpperCase())) as [
      Hunk,
      Hunk,
      Hunk
    ];
    const out = guardTouching(text, [b, c, a]);
    expect(out.map((h) => h.keptOut)).toEqual(['combined', undefined, undefined]);
    expect(out[1]).toBe(c);
    expect(out[2]).toBe(a);
  });

  it('keeps out the second of two insertions at one place, and one beside an insertion', () => {
    const text = 'It was dark night.';
    const one = suggest(text, 'dark¦ night', '', ',');
    const two = suggest(text, 'dark¦ night', '', ' and stormy');
    expect(guardTouching(text, [one, two]).map((h) => h.keptOut)).toEqual([undefined, 'combined']);
    const word = suggest(text, 'dark ¦night', 'night', 'evening');
    const before = suggest(text, 'dark¦ night', ' ', ', ');
    expect(guardTouching(text, [before, word]).map((h) => h.keptOut)).toEqual([undefined, 'combined']);
  });

  it("keeps out a model suggestion beside the author's own edit, never the edit", () => {
    const text = 'a,b';
    const mine = suggest(text, '¦a,', 'a', 'A', { source: 'manual', status: 'accepted' });
    const model = suggest(text, 'a¦,', ',', ';');
    expect(guardTouching(text, [mine, model]).map((h) => h.keptOut)).toEqual([undefined, 'combined']);
    const later = suggest(text, 'a¦,', ',', ';', { source: 'manual', status: 'accepted' });
    const first = suggest(text, '¦a,', 'a', 'A');
    const out = guardTouching(text, [first, later]);
    expect(out[0]).toBe(first);
    expect(out[1]).toBe(later);
  });

  it('leaves suggestions apart, on different lines, or beside one already off the page', () => {
    const text = 'one two\nthree';
    const one = suggest(text, '¦one', 'one', 'One');
    const two = suggest(text, '¦two', 'two', 'Two');
    expect(guardTouching(text, [one, two])).toEqual([one, two]);
    const line = suggest(text, 'one ¦two\n', 'two\n', 'two\n', { source: 'manual', status: 'accepted' });
    const three = suggest(text, '¦three', 'three', 'Three');
    expect(guardTouching(text, [line, three]).map((h) => h.keptOut)).toEqual([undefined, undefined]);
    const gone = { ...one, anchor: 'stale' as const, start: 0, end: 0, keptOut: 'markup' as const };
    const first = suggest(text, '¦one', 'one', 'One');
    expect(guardTouching(text, [gone, first])).toEqual([gone, first]);
  });
});

describe('what the guard leaves alone', () => {
  /* Each would be kept out as a model's pending suggestion. */
  const target = (extra: Partial<Hunk>): Hunk => suggest(CHAPTER, 'See [[Chapter ¦2]]', '2', 'Two', extra);
  const author = (extra: Partial<Hunk>): Hunk => suggest(CHAPTER, '[[Chapter ¦3|', '3', 'Three', extra);

  it("screens only pending model suggestions in the model's own words", () => {
    const untouched = [
      target({ edited: true }),
      target({ source: 'manual', reason: 'Edited by author' }),
      target({ source: 'diff' }),
      target({ status: 'accepted' }),
      target({ status: 'dismissed' }),
      target({ baseSide: 'replacement' }),
      target({ anchor: 'stale', start: 0, end: 0 }),
      target({ anchor: 'stale', start: 0, end: 0, keptOut: 'wikilink' })
    ];
    for (const hunk of untouched) expect(isGuarded(hunk)).toBe(false);
    const out = screenModelHunks(CHAPTER, untouched);
    out.forEach((hunk, i) => expect(hunk).toBe(untouched[i]));
    expect(isGuarded(target({}))).toBe(true);
    expect(isGuarded(target({ anchor: 'fuzzy' }))).toBe(true);
    expect(isGuarded(target({ anchor: 'ambiguous' }))).toBe(true);
    // A suggestion that carries a reason was kept out already, wherever it sits.
    expect(isGuarded(target({ keptOut: 'wikilink' }))).toBe(false);
  });

  it('leaves edited and manual hunks beside a model suggestion, and keeps out only the suggestion', () => {
    const text = 'a,b,c';
    const edited = suggest(text, '¦a,b', 'a', 'A', { edited: true });
    const model = suggest(text, 'a¦,b', ',', ';');
    const manual = suggest(text, 'a,¦b', 'b', 'B', { source: 'manual', status: 'accepted' });
    const out = guardTouching(text, screenModelHunks(text, [edited, model, manual]));
    expect(out[0]).toBe(edited);
    expect(out[1]?.keptOut).toBe('combined');
    expect(out[2]).toBe(manual);
    expect(screenModelHunks(CHAPTER, [author({ source: 'manual' })])[0]?.keptOut).toBeUndefined();
  });
});

describe('the guard is idempotent and keeps identity', () => {
  const hunks = (): Hunk[] => [
    suggest(CHAPTER, 'See [[Chapter ¦2]]', '2', 'Two'),
    suggest(CHAPTER, 'Mara ¦crossed', 'crossed', 'walked over'),
    suggest(CHAPTER, 'the ¦flood', 'flood', 'flooded', { status: 'accepted' }),
    suggest(CHAPTER, '#¦draft', 'draft', 'drafts', { edited: true }),
    suggest(CHAPTER, 'The wheel ¦turned', 'turned', 'spun'),
    suggest(CHAPTER, 'The wheel turned¦ all', ' all', ' the whole')
  ];

  it('screens and guards a screened set to the same objects', () => {
    const once = guardTouching(CHAPTER, screenModelHunks(CHAPTER, hunks()));
    expect(once.map((h) => h.keptOut)).toEqual([
      'wikilink',
      undefined,
      undefined,
      undefined,
      undefined,
      'combined'
    ]);
    const twice = guardTouching(CHAPTER, screenModelHunks(CHAPTER, once));
    twice.forEach((hunk, i) => expect(hunk).toBe(once[i]));
  });

  it('gives back the very hunks it leaves, in their order', () => {
    const input = hunks();
    const out = screenModelHunks(CHAPTER, input);
    expect(out).not.toBe(input);
    out.forEach((hunk, i) => {
      if (hunk.keptOut === undefined) expect(hunk).toBe(input[i]);
      else expect(hunk.id).toBe(input[i]?.id);
    });
  });

  it('guardLoadedReview returns the review itself when nothing is kept out, or again', () => {
    const clean = review(CHAPTER, hunks().slice(1, 5));
    expect(guardLoadedReview(clean)).toBe(clean);
    const old = review(CHAPTER, hunks());
    const guarded = guardLoadedReview(old);
    expect(guarded).not.toBe(old);
    expect(guarded.hunks.map((h) => h.keptOut)).toEqual([
      'wikilink',
      undefined,
      undefined,
      undefined,
      undefined,
      'combined'
    ]);
    expect(guardLoadedReview(guarded)).toBe(guarded);
    expect({ ...guarded, hunks: old.hunks }).toEqual(old);
  });
});

function base(text: string): ReviewBase {
  return { text, hash: 'h', eol: 'lf', bom: false, trailingNewline: true };
}

function review(text: string, hunks: Hunk[]): Review {
  return {
    version: 1,
    id: 'chapter--2026-09-20T18-04-11-201Z',
    sourcePath: 'C:/vault/Chapter.md',
    createdAt: '2026-09-20T18:04:11.201Z',
    updatedAt: '2026-09-21T09:12:40.555Z',
    base: base(text),
    generator: { kind: 'claude', provider: 'claude' },
    hunks,
    comments: []
  };
}

describe('a review made or loaded', () => {
  const made = (text: string, changes: Parameters<typeof createAiReview>[0]['changes']): Review =>
    createAiReview({
      sourcePath: 'C:/vault/Chapter.md',
      base: base(text),
      changes,
      comments: [{ paragraph: 0, category: 'flow', text: 'A note.' }],
      generator: { kind: 'claude', provider: 'claude' },
      now: '2026-10-19T09:00:00.000Z'
    });

  it('keeps out a suggestion before overlaps are resolved, so it pushes no good one off the page', () => {
    const text = 'The teh mill turned.';
    const changes = [
      {
        paragraph: 0,
        before: 'teh mill',
        after: 'the [[mill]]',
        category: 'typo' as const,
        reason: 'Link it.'
      },
      { paragraph: 0, before: 'mill turned', after: 'mills turned', category: 'grammar' as const }
    ];
    const r = made(text, changes);
    const out = r.hunks.find((h) => h.original === 'teh mill');
    const plural = r.hunks.find((h) => h.replacement === 'mills');
    expect(out).toMatchObject({ anchor: 'stale', start: 0, end: 0, keptOut: 'markup', reason: 'Link it.' });
    expect(plural).toMatchObject({ anchor: 'exact', original: 'mill' });
    expect(plural?.keptOut).toBeUndefined();
    // Unscreened, the same two overlap, and the good one is the one demoted.
    const bare = anchorChanges(text, splitParagraphs(text), changes);
    expect(bare.find((h) => h.replacement === 'mills')?.reason).toContain('Overlapped');
    expect(r.comments).toHaveLength(1);
  });

  it('applies the touching rule as overlaps are resolved', () => {
    const r = made('It was a dark,stormy night.', [
      { paragraph: 0, before: 'dark,', after: 'dark;' },
      { paragraph: 0, before: ',stormy', after: ', stormy' }
    ]);
    expect(r.hunks.map((h) => [h.original, h.replacement, h.anchor, h.keptOut])).toEqual([
      [',', ';', 'exact', undefined],
      ['', ' ', 'stale', 'combined']
    ]);
  });

  it('keeps out a touching suggestion in the overlap pass, so it pushes no good one off the page', () => {
    const r = made('abcd efgh', [
      { paragraph: 0, before: 'ab', after: 'AB' },
      { paragraph: 0, before: 'cd', after: 'CD' },
      { paragraph: 0, before: 'd e', after: 'D e' }
    ]);
    expect(
      r.hunks.map((h) => [h.original, h.replacement, h.anchor === 'stale', h.keptOut, h.reason])
    ).toEqual([
      ['ab', 'AB', false, undefined, undefined],
      ['cd', 'CD', true, 'combined', undefined],
      ['d', 'D', false, undefined, undefined]
    ]);
  });

  it('keeps out a full stop after the closing fence of a code block that holds a blank line', () => {
    const fence = '`'.repeat(3);
    const text = `Rain fell.\n\n${fence}\nlet x = 1;\n\nlet y = 2;\n${fence}\n\nSun came out.`;
    const [hunk] = made(text, [
      { paragraph: 2, before: `let y = 2;\n${fence}`, after: `let y = 2;\n${fence}.` }
    ]).hunks;
    expect(hunk).toMatchObject({
      anchor: 'stale',
      start: 0,
      end: 0,
      keptOut: 'code',
      original: '',
      replacement: '.'
    });
  });

  it('keeps everything a kept-out suggestion said: words, category, reason, paragraph, pending', () => {
    const text = 'Rain fell.\n\nSee [[Chapter 2]] for the rest.';
    const [hunk] = made(text, [
      {
        paragraph: 1,
        before: 'Chapter 2',
        after: 'Chapter Two',
        category: 'consistency',
        reason: 'Spell it out.'
      }
    ]).hunks;
    expect(hunk).toMatchObject({
      start: 0,
      end: 0,
      anchor: 'stale',
      keptOut: 'wikilink',
      original: '2',
      replacement: 'Two',
      category: 'consistency',
      reason: 'Spell it out.',
      paragraph: 1,
      status: 'pending',
      source: 'claude',
      baseSide: 'original'
    });
  });

  it('screens a review saved before the guard as it loads, and leaves what the author decided', () => {
    const decided = suggest(CHAPTER, '#¦draft', 'draft', 'drafts', { status: 'accepted' });
    const pending = suggest(CHAPTER, 'See [[Chapter ¦2]]', '2', 'Two');
    const loaded = upgradeLoadedReview(review(CHAPTER, [decided, pending]));
    expect(loaded.hunks[0]).toBe(decided);
    expect(loaded.hunks[1]).toMatchObject({ anchor: 'stale', keptOut: 'wikilink', status: 'pending' });
  });

  it('keeps a kept-out suggestion out when the chapter changes on disk', () => {
    const text = 'It cost ten per cent more.';
    const r = made(text, [{ paragraph: 0, before: 'per cent', after: '%' }]);
    expect(r.hunks[0]?.keptOut).toBe('markup');
    const { review: moved } = rebaseReview(r, base('It cost ten per cent more today.'));
    expect(moved.hunks[0]).toBe(r.hunks[0]);
  });
});

describe('the guard through a rebase (files.20)', () => {
  const onDisk = (r: Review, text: string): ReturnType<typeof rebaseReview> =>
    rebaseReview(r, { ...base(text), hash: 'next' });

  it('keeps out a suggestion that a change on disk put inside syntax, and counts it apart from those lost', () => {
    const text = 'She walked to the old mill at dusk.\n\nRain fell on teh roof.';
    const mill = suggest(text, 'old ¦mill', 'mill', 'watermill');
    const teh = suggest(text, '¦teh roof', 'teh', 'the');
    const r = review(text, [mill, teh]);
    // The author made the mill a link in Obsidian, and fixed "teh" there too.
    const next = 'She walked to the old [[mill]] at dusk.\n\nRain fell on the roof.';
    const { review: moved, stats } = onDisk(r, next);
    expect(moved.hunks.find((h) => h.id === mill.id)).toMatchObject({
      anchor: 'stale',
      start: 0,
      end: 0,
      keptOut: 'wikilink',
      status: 'pending',
      original: 'mill',
      replacement: 'watermill'
    });
    expect(moved.hunks.find((h) => h.id === teh.id)).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement'
    });
    expect(stats).toMatchObject({ anchored: 1, stale: 1, newlyStale: 0, keptOut: 1, adopted: 1 });
  });

  it('screens again a suggestion that was off the page and is found inside syntax', () => {
    const text = 'Rain fell.\n\nThe sun came out.';
    const lost = { ...suggest(text, 'The ¦sun', 'sun', 'Sun'), anchor: 'stale' as const, start: 0, end: 0 };
    const { review: moved, stats } = onDisk(review(text, [lost]), 'Rain fell. #sun\n\nThe moon came out.');
    expect(moved.hunks[0]).toMatchObject({ anchor: 'stale', keptOut: 'tag', start: 0, end: 0 });
    expect(stats).toMatchObject({ newlyStale: 0, keptOut: 1 });
  });

  it('leaves where it is found a suggestion the author decided, as the guard does when a review loads', () => {
    const text = 'She walked to the old mill at dusk.';
    const next = 'She walked to the old [[mill]] at dusk.';
    for (const status of ['accepted', 'dismissed'] as const) {
      const mill = suggest(text, 'old ¦mill', 'mill', 'watermill', { status });
      const { review: moved, stats } = onDisk(review(text, [mill]), next);
      expect(moved.hunks[0]).toMatchObject({ anchor: 'exact', status, start: next.indexOf('mill') });
      expect(moved.hunks[0]?.keptOut).toBeUndefined();
      expect(stats).toMatchObject({ newlyStale: 0, keptOut: 0 });
    }
  });

  it('screens before overlaps are resolved, so a suggestion kept out pushes none off the page', () => {
    const text = 'She wrote draft notes.';
    const tn = suggest(text, 'draf¦t n', 't n', 'T N');
    // ", N" overlapped "T N" when the review was made, so it was off the page.
    const comma = {
      ...suggest(text, 'draft¦ notes', ' n', ', N'),
      anchor: 'stale' as const,
      start: 0,
      end: 0
    };
    const next = 'She wrote #draft notes.';
    const { review: moved, stats } = onDisk(review(text, [tn, comma]), next);
    expect(moved.hunks.find((h) => h.id === tn.id)).toMatchObject({ anchor: 'stale', keptOut: 'tag' });
    expect(moved.hunks.find((h) => h.id === comma.id)).toMatchObject({
      start: next.indexOf(' notes'),
      end: next.indexOf(' notes') + 2
    });
    expect(moved.hunks.find((h) => h.id === comma.id)?.anchor).not.toBe('stale');
    expect(stats).toMatchObject({ anchored: 1, newlyStale: 0, keptOut: 1 });
  });

  it("measures touching in the overlap pass: 'ab-cd efgh' made into 'abcd efgh' on disk", () => {
    const text = 'ab-cd efgh';
    const ab = suggest(text, '¦ab-', 'ab', 'AB');
    const cd = suggest(text, '-¦cd', 'cd', 'CD');
    // d e overlapped cd when the review was made, so it was off the page.
    const de = { ...suggest(text, 'c¦d e', 'd e', 'D E'), anchor: 'stale' as const, start: 0, end: 0 };
    const { review: moved, stats } = onDisk(review(text, [ab, cd, de]), 'abcd efgh');
    const byId = (id: string): Hunk | undefined => moved.hunks.find((h) => h.id === id);
    expect(byId(ab.id)).toMatchObject({ start: 0, end: 2 });
    expect(byId(cd.id)).toMatchObject({ anchor: 'stale', keptOut: 'combined' });
    // Kept out in the pass, cd pushes nothing off the page: d e, which overlapped only cd, stays.
    expect(byId(de.id)).toMatchObject({ start: 3, end: 6 });
    expect(byId(de.id)?.anchor).not.toBe('stale');
    expect(stats).toMatchObject({ anchored: 2, newlyStale: 0, keptOut: 1 });
  });

  it('counts as could not be found only what was on the page, and loading the result changes nothing', () => {
    const text = 'Rain fell on teh roof.\n\nThe mill stood by teh river.\n\nShe saw it.';
    const roof = suggest(text, '¦teh roof', 'teh', 'the');
    const river = suggest(text, '¦teh river', 'teh', 'the');
    const gone = { ...suggest(text, '¦She saw', 'She', 'He'), anchor: 'stale' as const, start: 0, end: 0 };
    const out: Hunk = {
      ...suggest(text, 'The ¦mill', 'mill', 'Mill'),
      anchor: 'stale',
      start: 0,
      end: 0,
      keptOut: 'markup'
    };
    const r = review(text, [roof, river, gone, out]);
    // The last two paragraphs were rewritten in Obsidian: the second "teh" goes, as an overlap of the first.
    const next = 'Rain fell on teh roof.\n\nNothing stood by a pond.\n\nIt was late.';
    const { review: moved, stats } = onDisk(r, next);
    expect(moved.hunks.find((h) => h.id === out.id)).toBe(out);
    expect(stats).toEqual({
      anchored: 1,
      stale: 3,
      newlyStale: 1,
      keptOut: 0,
      adopted: 0,
      orphanedComments: 0
    });
    expect(guardLoadedReview(moved)).toBe(moved);
  });
});

describe('keptOutNote', () => {
  it('reads as 11.3 (k) words it, with the label of what would change', () => {
    expect(keptOutNote('wikilink')).toBe(
      'Kept out of the text: it would change Obsidian syntax (an internal link). Make this change in Obsidian or with the paragraph pen if you want it.'
    );
    expect(keptOutNote('frontmatter')).toContain('syntax (frontmatter).');
    expect(keptOutNote('paragraph-break')).toContain('syntax (a paragraph break).');
    expect(keptOutNote('markup')).toContain('syntax (a markup character).');
    expect(keptOutNote('combined')).toContain('syntax (together with the suggestion before it).');
  });

  it('has a label for every reason, the syntax kinds by their own labels', () => {
    expect(Object.keys(KEPT_OUT_LABELS).sort()).toEqual(
      [...SYNTAX_KINDS, 'paragraph-break', 'markup', 'combined'].sort()
    );
    for (const kind of SYNTAX_KINDS) expect(KEPT_OUT_LABELS[kind]).toBe(SYNTAX_LABELS[kind]);
  });

  it('words a reason from a later version without a label', () => {
    expect(keptOutNote('ink-blot' as KeptOutReason)).toBe(
      'Kept out of the text: it would change Obsidian syntax. Make this change in Obsidian or with the paragraph pen if you want it.'
    );
  });
});
