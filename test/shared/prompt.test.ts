import { describe, expect, it } from 'vitest';
import {
  fromPromptNumbering,
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
