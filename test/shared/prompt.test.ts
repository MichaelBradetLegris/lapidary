import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_PARAGRAPH,
  fromPromptNumbering,
  hiddenParagraphs,
  paragraphIndexFromNumber,
  paragraphNumber,
  renderChapter
} from '../../src/shared/prompt/chapter';
import { composeText, unsavedDecisionCount } from '../../src/shared/diff/compose';
import {
  ReviewOutputSchema,
  parseReviewOutput,
  reviewOutputJsonSchema
} from '../../src/shared/prompt/schema';
import {
  STATIC_INSTRUCTIONS,
  buildSystemPrompt,
  guidelinesFingerprint
} from '../../src/shared/prompt/system';
import { syntaxSpans } from '../../src/shared/text/obsidian';
import { bodyParagraphs, splitParagraphs } from '../../src/shared/text/paragraphs';
import { CHANGE_CATEGORIES, COMMENT_CATEGORIES } from '../../src/shared/types';

const CHAPTER = `---
title: Chapter 12
---

It was the third night of rain.

"You should of told me," Mara said.`;

describe('renderChapter', () => {
  it('numbers the body paragraphs and leaves frontmatter out', () => {
    const rendered = renderChapter(CHAPTER, 'Chapter 12.md');
    expect(rendered).toBe(
      '<chapter file="Chapter 12.md" paragraphs="2">\n' +
        '[1] It was the third night of rain.\n\n' +
        '[2] "You should of told me," Mara said.\n' +
        '</chapter>'
    );
  });

  it('leaves Markdown exactly as written', () => {
    const rendered = renderChapter('A *word* and a **bold** one.\n\n# Heading', 'x.md');
    expect(rendered).toContain('[1] A *word* and a **bold** one.');
    expect(rendered).toContain('[2] # Heading');
  });

  it('escapes a file name that would break the attribute', () => {
    expect(renderChapter('body', 'a"b&c<d>.md')).toContain('file="a&quot;b&amp;c&lt;d&gt;.md"');
  });

  it('reports zero paragraphs for an empty chapter', () => {
    expect(renderChapter('', 'x.md')).toContain('paragraphs="0"');
  });
});

/* files.8: a paragraph lying wholly inside a comment, code or maths is sent as
   its number and a line saying it is hidden; its text never reaches the
   model, and the numbers after it still match the page's (PLAN 5.2). */

describe('renderChapter hides notes and code (files.8)', () => {
  const hiddenLine = (n: number): string => `[${n}] ${HIDDEN_PARAGRAPH}`;

  it('words the hidden line exactly as the plan gives it', () => {
    expect(HIDDEN_PARAGRAPH).toBe("(author's note or code, hidden; skip it)");
    expect(renderChapter('%% Ellen, not Mara. %%', 'x.md')).toBe(
      '<chapter file="x.md" paragraphs="1">\n' +
        "[1] (author's note or code, hidden; skip it)\n" +
        '</chapter>'
    );
  });

  it('hides a comment, an HTML comment, a code block and maths, and keeps every number', () => {
    const text =
      '---\ntitle: The Flood\n---\n\n' +
      [
        'It was teh third night.',
        '%% Ellen, not Mara. %%',
        '<!-- Check the date of the flood. -->',
        '```\nlet river = 1;\n```',
        '~~~python\nprint("rain")\n~~~',
        '$$\nE = mc^2\n$$',
        '`inline code alone`',
        'She should of known.'
      ].join('\n\n');
    expect(hiddenParagraphs(text)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(renderChapter(text, 'Chapter 1.md')).toBe(
      '<chapter file="Chapter 1.md" paragraphs="8">\n' +
        '[1] It was teh third night.\n\n' +
        [2, 3, 4, 5, 6, 7].map(hiddenLine).join('\n\n') +
        '\n\n[8] She should of known.\n' +
        '</chapter>'
    );
  });

  it('hides each paragraph of a comment or code block that holds a blank line', () => {
    const text =
      'Before.\n\n%%\nEllen.\n\nMore of the note.\n%%\n\n```\nlet a = 1;\n\nlet b = 2;\n```\n\nAfter.';
    expect(renderChapter(text, 'x.md')).toBe(
      '<chapter file="x.md" paragraphs="6">\n[1] Before.\n\n' +
        [2, 3, 4, 5].map(hiddenLine).join('\n\n') +
        '\n\n[6] After.\n</chapter>'
    );
  });

  it('hides a paragraph made of several notes, with white space round them', () => {
    expect(hiddenParagraphs('%% one %%\n<!-- two -->')).toEqual(new Set([0]));
    expect(hiddenParagraphs('  %% indented %%  \n\t$$x$$ ')).toEqual(new Set([0]));
    expect(hiddenParagraphs('`a` `b`')).toEqual(new Set([0]));
  });

  it('sends a paragraph with any prose outside the note or code as written', () => {
    const shown = [
      'Rain %% Ellen %% fell.',
      'It was `x`.',
      '%% note %% and prose',
      '<!-- note -->.',
      'Cost $5 and $10.',
      'Text with $x$ maths inline.',
      '    indented code is prose here',
      '\\%% not a comment \\%%'
    ];
    const text = shown.join('\n\n');
    expect(hiddenParagraphs(text)).toEqual(new Set());
    expect(renderChapter(text, 'x.md')).toBe(
      `<chapter file="x.md" paragraphs="${shown.length}">\n` +
        shown.map((p, k) => `[${k + 1}] ${p}`).join('\n\n') +
        '\n</chapter>'
    );
  });

  it('shows the words after an unclosed opener, which protects only itself (C.72)', () => {
    const text = '%% an opener nothing closes\n\nThe river rose.\n\n```\nnot closed either';
    expect(hiddenParagraphs(text)).toEqual(new Set());
    expect(renderChapter(text, 'x.md')).toContain('[1] %% an opener nothing closes\n\n[2] The river rose.');
  });

  it('reads the chapter whole: a paragraph a comment runs into is shown when prose follows the close', () => {
    const text = 'Start.\n\n%% Ellen,\n\nnot Mara %% she said.\n\nEnd.';
    expect(renderChapter(text, 'x.md')).toBe(
      '<chapter file="x.md" paragraphs="4">\n[1] Start.\n\n' +
        hiddenLine(2) +
        '\n\n[3] not Mara %% she said.\n\n[4] End.\n</chapter>'
    );
  });

  it('never hides a paragraph of other syntax, even one that is nothing but syntax', () => {
    const syntaxOnly = [
      '> [!note]',
      '[[The Mill]]',
      '![[Image.png]]',
      '![alt](mill.png)',
      '[^1]',
      '^a1b2',
      '#draft',
      '# ',
      '---',
      '<br>',
      'https://example.com',
      '> > '
    ];
    for (const text of syntaxOnly) {
      const spans = syntaxSpans(text, { frontmatter: false });
      const covered = spans.reduce((n, s) => n + text.slice(s.start, s.end).replace(/\s/g, '').length, 0);
      expect(covered, text).toBe(text.replace(/\s/g, '').length);
      expect(hiddenParagraphs(`Prose.\n\n${text}`), text).toEqual(new Set());
    }
    const text = '> [!note] A callout.\n\n[[The Mill|teh mill]]\n\n<span>Hi</span>';
    expect(hiddenParagraphs(text)).toEqual(new Set());
  });

  it("never lets a hidden paragraph's text reach the prompt", () => {
    const text =
      'Mara waited.\n\n%% SECRET-1 Ellen %%\n\n<!-- SECRET-2 -->\n\n```\nSECRET-3\n\nSECRET-4\n```\n\n$$\nSECRET-5\n$$\n\nShe left.';
    const rendered = renderChapter(text, 'x.md');
    expect(rendered).not.toContain('SECRET');
    expect(rendered).not.toContain('Ellen');
    expect(rendered).toContain('[1] Mara waited.');
    expect(rendered).toContain('[7] She left.');
  });

  /* Chapters built from prose and from notes and code, each note carrying a
     word of its own, joined by blank lines: every paragraph of a note is
     hidden, every other one sent as written, with its number, and no note's
     word reaches the prompt. */
  const PROSE = [
    'It was teh third night of rain.',
    '"You should of told me," she said.',
    'See [[The Mill|teh mill]] at dusk.',
    'Rain %%an aside%% fell on the [roof](https://example.com).',
    'A `code` word, and $x$ inline.',
    '<Where are you?> she called.',
    'Cost $5 and $10. #draft',
    '> [!note] A callout\n> with two lines.',
    '- a list\n- of items',
    // A rule, but not `---`, which as the first piece of a chapter with another below would open frontmatter.
    '* * *',
    '<span>Hi</span> there.',
    '\tAn indented line.'
  ];
  const NOTES: ReadonlyArray<(word: string) => string> = [
    (w) => `%% ${w} %%`,
    (w) => `<!-- ${w} -->`,
    (w) => `\`\`\`\n${w}\n\`\`\``,
    (w) => `~~~js\n${w}\n\n${w} again\n~~~`,
    (w) => `%%\n${w}\n\n${w} again\n%%`,
    (w) => `$$\n${w}\n$$`,
    (w) => `\`${w}\``,
    (w) => `%% ${w} %%\n<!-- ${w} -->`,
    (w) => `  %% ${w} %%  `,
    (w) => `<!--\n${w}\n\n\n${w}\n-->`
  ];
  const pieceArb = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...PROSE).map((text) => ({ note: false, make: () => text })) },
    {
      weight: 2,
      arbitrary: fc.constantFrom(...NOTES).map((make) => ({ note: true, make: (word: string) => make(word) }))
    }
  );

  it('hides every paragraph of a note and sends every other one as written (property)', () => {
    fc.assert(
      fc.property(
        fc.array(pieceArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom('', '---\ntitle: x\n---\n', '---\ntitle: x\n---\n\n'),
        fc.array(fc.constantFrom('\n\n', '\n\n\n', '\n \n'), { minLength: 10, maxLength: 10 }),
        (pieces, front, gaps) => {
          let text = front;
          const expected: string[] = [];
          pieces.forEach((piece, k) => {
            const body = piece.make(`SECRET${k}x`);
            if (k > 0) text += gaps[k] ?? '\n\n';
            text += body;
            for (const p of bodyParagraphs(splitParagraphs(body)))
              expected.push(piece.note ? HIDDEN_PARAGRAPH : p.text);
          });
          const rendered = renderChapter(text, 'x.md');
          const lines = expected.map((line, k) => `[${k + 1}] ${line}`);
          // Where the body starts on the line after the frontmatter, the first paragraph starts at that line
          // break (files.22), and sent as written it shows it, so it is compared without it.
          expect(rendered.replace('] \n', '] ')).toBe(
            `<chapter file="x.md" paragraphs="${expected.length}">\n${lines.join('\n\n')}\n</chapter>`
          );
          expect(rendered).not.toContain('SECRET');
        }
      ),
      { numRuns: 1000 }
    );
  });

  /* Any chapter, syntax crossing paragraphs and openers left unclosed
     included: each paragraph is sent as written or as the hidden line, in
     order, and hidden exactly when nothing but white space lies outside the
     chapter's comment, code and maths spans. */
  const FRAGMENTS = [
    'rain',
    'Mara',
    'teh',
    ',',
    '.',
    '%%',
    '<!--',
    '-->',
    '$$',
    '$',
    '`',
    '```',
    '~~~',
    '[[Mill]]',
    '#draft',
    '> ',
    '\\',
    ' ',
    '\n',
    '\n\n'
  ];

  it('hides exactly the paragraphs with nothing outside comment, code and maths (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...FRAGMENTS), { maxLength: 40 }), (fragments) => {
        const text = fragments.join('');
        const paragraphs = bodyParagraphs(splitParagraphs(text));
        const inside = new Set<number>();
        for (const span of syntaxSpans(text)) {
          if (span.kind !== 'comment' && span.kind !== 'code' && span.kind !== 'math') continue;
          for (let i = span.start; i < span.end; i += 1) inside.add(i);
        }
        const hidden = hiddenParagraphs(text);
        const lines = paragraphs.map((p) => {
          const outside = [...p.text].some((c, k) => !inside.has(p.start + k) && c.trim() !== '');
          expect(hidden.has(p.index)).toBe(!outside);
          return `[${p.index + 1}] ${outside ? p.text : HIDDEN_PARAGRAPH}`;
        });
        expect(renderChapter(text, 'x.md')).toBe(
          `<chapter file="x.md" paragraphs="${paragraphs.length}">\n${lines.join('\n\n')}\n</chapter>`
        );
      }),
      { numRuns: 2000 }
    );
  });
});

describe('output schema', () => {
  it('accepts a well formed answer', () => {
    const result = parseReviewOutput({
      changes: [{ paragraph: 0, before: 'began', after: 'begun', category: 'grammar', reason: 'tense' }],
      comments: [{ paragraph: 1, quote: 'Mara', category: 'clarity', text: 'Who is speaking?' }]
    });
    expect(result.ok).toBe(true);
    expect(result.value?.changes).toHaveLength(1);
  });

  it('accepts empty arrays, which is how "nothing to fix" is expressed', () => {
    expect(parseReviewOutput({ changes: [], comments: [] }).ok).toBe(true);
  });

  it('rejects an empty before', () => {
    const result = parseReviewOutput({
      changes: [{ paragraph: 0, before: '', after: 'x', category: 'typo', reason: 'r' }],
      comments: []
    });
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('before');
  });

  it('rejects an unknown category', () => {
    const result = parseReviewOutput({
      changes: [{ paragraph: 0, before: 'a', after: 'b', category: 'vibes', reason: 'r' }],
      comments: []
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a negative paragraph index', () => {
    expect(
      parseReviewOutput({
        changes: [{ paragraph: -1, before: 'a', after: 'b', category: 'typo', reason: 'r' }],
        comments: []
      }).ok
    ).toBe(false);
  });

  it('allows a null comment paragraph but not a null change paragraph', () => {
    expect(
      parseReviewOutput({ changes: [], comments: [{ paragraph: null, category: 'plot', text: 'x' }] }).ok
    ).toBe(true);
    expect(
      parseReviewOutput({
        changes: [{ paragraph: null, before: 'a', after: 'b', category: 'typo', reason: 'r' }],
        comments: []
      }).ok
    ).toBe(false);
  });

  it('rejects anything that is not an object', () => {
    expect(parseReviewOutput(undefined).ok).toBe(false);
    expect(parseReviewOutput('nope').ok).toBe(false);
    expect(parseReviewOutput({ changes: [] }).ok).toBe(false);
  });

  it('exports a draft-07 JSON Schema listing both categories', () => {
    const json = JSON.stringify(reviewOutputJsonSchema);
    expect(reviewOutputJsonSchema['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    for (const category of CHANGE_CATEGORIES) expect(json).toContain(`"${category}"`);
    for (const category of COMMENT_CATEGORIES) expect(json).toContain(`"${category}"`);
    expect(json).toContain('"changes"');
    expect(json).toContain('"comments"');
  });

  it('keeps the schema shallow, which is what the SDK retries best against', () => {
    expect(Object.keys(ReviewOutputSchema.shape)).toEqual(['changes', 'comments']);
  });
});

describe('system prompt', () => {
  it('appends the author guidelines after the static instructions', () => {
    const prompt = buildSystemPrompt('# My rules\n\nUse UK spelling.');
    expect(prompt.startsWith(STATIC_INSTRUCTIONS)).toBe(true);
    expect(prompt.endsWith('# My rules\n\nUse UK spelling.')).toBe(true);
  });

  it('is unchanged when there are no guidelines, so prompt caching still applies', () => {
    expect(buildSystemPrompt('   \n  ')).toBe(STATIC_INSTRUCTIONS);
  });

  it('states the rules the anchoring depends on', () => {
    expect(STATIC_INSTRUCTIONS).toContain('character for character');
    expect(STATIC_INSTRUCTIONS).toContain('unique inside that paragraph');
    expect(STATIC_INSTRUCTIONS).toContain('eight consecutive words');
    expect(STATIC_INSTRUCTIONS).toContain('empty arrays');
  });

  it('states the Obsidian rule whatever the guidelines file says (files.8)', () => {
    const rule = STATIC_INSTRUCTIONS.slice(
      STATIC_INSTRUCTIONS.indexOf('The chapter is a note in an Obsidian vault')
    );
    expect(rule.length).toBeLessThan(STATIC_INSTRUCTIONS.length);
    // Leave the syntax as written.
    expect(rule).toContain(
      'Leave links, embeds, tags, block IDs, footnote and callout markers, comments, code, maths, web addresses and HTML exactly as written.'
    );
    for (const example of [
      '[[Page]]',
      '![[Image.png]]',
      '#tag',
      '^a1b2',
      'a footnote reference such as [^1]',
      "the [^1]: at the start of a footnote's line",
      'the ^[ and ] around an inline footnote',
      "a callout's > [!note] and the > before each of its lines",
      '%% ... %%',
      '<!-- ... -->',
      '$$ ... $$',
      '`code`'
    ])
      expect(rule).toContain(example);
    // Only the markers of a footnote or a callout are syntax (11.3 k), never their words.
    expect(rule).not.toContain('^[...]');
    expect(rule).not.toMatch(/footnotes, callouts/);
    // The words a reader sees, in a link, a footnote or a callout, may be corrected.
    expect(rule).toContain('The words a reader sees are prose and may be corrected');
    expect(rule).toContain('[[Page|alias]]');
    expect(rule).toContain('the text in the square brackets of [text](url)');
    expect(rule).toContain('the words of a footnote, after [^1]: or between ^[ and ]');
    expect(rule).toContain('and the title and body of a callout.');
    expect(rule).toContain(
      'Change only those words, never the brackets, the markers, the target or the address.'
    );
    // Comments are private notes.
    expect(rule).toContain("are the author's private notes. Do not correct them and do not comment on them.");
    // Angle-bracket dialogue is prose.
    expect(rule).toContain('<Where are you?>');
    expect(rule).toContain('are prose, often dialogue');
    // The markup rule as the guard applies it (11.3 k): to the words a change
    // alters, once trimmed, so markup quoted unchanged around them is harmless
    // (C.75; protect.test.ts pins the guard's side).
    expect(rule).toContain(
      'Never add, remove or change one of [ ] % $ ^ # < > | ~, a backtick or a line break, and never let one change alter words on both sides of one of them: the app sets such a change aside.'
    );
    expect(rule).toContain('Change only words and ordinary punctuation, and give each place its own change.');
    expect(rule).toContain('Quoting these characters unchanged around the words you change is fine.');
    expect(rule).not.toMatch(/"before" or "after" holds/);
    expect(rule).not.toMatch(/[Qq]uote only/);
    // The hidden paragraph.
    expect(rule).toContain(`A paragraph shown as "${HIDDEN_PARAGRAPH}" is a note or code hidden from you.`);
    expect(rule).toContain('Make no change to it and do not comment on it.');
    // In the static part, so it is there with any guidelines and none.
    expect(buildSystemPrompt('')).toContain(rule);
    expect(buildSystemPrompt('# Mine\n\nAnything.').indexOf(rule)).toBe(STATIC_INSTRUCTIONS.indexOf(rule));
  });

  it('fingerprints guidelines stably and distinctly', () => {
    expect(guidelinesFingerprint('abc')).toBe(guidelinesFingerprint('abc'));
    expect(guidelinesFingerprint('abc')).not.toBe(guidelinesFingerprint('abd'));
    expect(guidelinesFingerprint('')).toBeTruthy();
  });
});

describe('paragraph numbers (Phase 5d)', () => {
  it('shows people and models numbers from 1 and keeps indices from 0', () => {
    expect(paragraphNumber(0)).toBe(1);
    expect(paragraphNumber(36)).toBe(37);
    expect(paragraphIndexFromNumber(37)).toBe(36);
  });

  it('never produces a negative index from a model that answered 0 anyway', () => {
    expect(paragraphIndexFromNumber(0)).toBe(0);
  });

  it('translates a model reply, leaving everything but the numbers alone', () => {
    const reply = {
      changes: [{ paragraph: 3, before: 'a', after: 'b', category: 'typo' as const, reason: 'r' }],
      comments: [
        { paragraph: 1, category: 'plot' as const, text: 'See paragraph 3.' },
        { paragraph: null, category: 'flow' as const, text: 'Whole chapter.' }
      ]
    };
    expect(fromPromptNumbering(reply)).toEqual({
      changes: [{ paragraph: 2, before: 'a', after: 'b', category: 'typo', reason: 'r' }],
      comments: [
        { paragraph: 0, category: 'plot', text: 'See paragraph 3.' },
        { paragraph: null, category: 'flow', text: 'Whole chapter.' }
      ]
    });
  });
});

describe('decisions the chapter file does not have yet', () => {
  const base = 'The river had began.';
  const hunk = {
    id: 'h',
    start: 14,
    end: 19,
    baseSide: 'original' as const,
    original: 'began',
    replacement: 'begun',
    paragraph: 0,
    source: 'claude' as const,
    status: 'pending' as const,
    anchor: 'exact' as const
  };

  it('counts an accepted change that was never saved', () => {
    expect(unsavedDecisionCount([hunk])).toBe(0);
    expect(unsavedDecisionCount([{ ...hunk, status: 'accepted' }])).toBe(1);
  });

  it('counts a saved change the author has since turned back, and ignores unanchored ones', () => {
    const saved = { ...hunk, status: 'accepted' as const, baseSide: 'replacement' as const };
    expect(unsavedDecisionCount([saved])).toBe(0);
    expect(unsavedDecisionCount([{ ...saved, status: 'dismissed' }])).toBe(1);
    expect(unsavedDecisionCount([{ ...hunk, status: 'accepted', anchor: 'stale' }])).toBe(0);
    expect(composeText(base, [hunk])).toBe(base);
  });
});
