import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bodyStart } from '../../src/shared/text/obsidian';
import {
  bodyParagraphs,
  countParagraphs,
  findParagraph,
  frontmatterRange,
  paragraphIndexAt,
  splitParagraphs
} from '../../src/shared/text/paragraphs';

const PLAIN = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';

const WITH_FRONTMATTER = `---
title: Chapter 12
tags: [draft]
---

It was the third night of rain.

"You should of told me," Mara said.`;

describe('splitParagraphs', () => {
  it('keeps exact offsets for every paragraph', () => {
    for (const p of splitParagraphs(PLAIN)) {
      expect(PLAIN.slice(p.start, p.end)).toBe(p.text);
    }
  });

  it('numbers paragraphs from zero', () => {
    expect(splitParagraphs(PLAIN).map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it('returns frontmatter separately and excludes it from numbering', () => {
    const paragraphs = splitParagraphs(WITH_FRONTMATTER);
    expect(paragraphs[0]?.isFrontmatter).toBe(true);
    expect(paragraphs[0]?.index).toBe(-1);
    expect(paragraphs[0]?.start).toBe(0);
    expect(WITH_FRONTMATTER.slice(0, paragraphs[0]?.end)).toBe('---\ntitle: Chapter 12\ntags: [draft]\n---');
    expect(bodyParagraphs(paragraphs).map((p) => p.index)).toEqual([0, 1]);
    expect(bodyParagraphs(paragraphs)[0]?.text).toBe('It was the third night of rain.');
  });

  it('treats a run of blank lines carrying spaces as one separator', () => {
    const text = 'one\n  \n\t\n\ntwo';
    const paragraphs = splitParagraphs(text);
    expect(paragraphs.map((p) => p.text)).toEqual(['one', 'two']);
    expect(text.slice(paragraphs[1]!.start, paragraphs[1]!.end)).toBe('two');
  });

  it('keeps single newlines inside a paragraph', () => {
    expect(splitParagraphs('a\nb\n\nc').map((p) => p.text)).toEqual(['a\nb', 'c']);
  });

  it('drops leading and trailing blank space without shifting offsets', () => {
    const text = '\n\nhello\n\n';
    const paragraphs = splitParagraphs(text);
    expect(paragraphs).toHaveLength(1);
    expect(text.slice(paragraphs[0]!.start, paragraphs[0]!.end)).toBe('hello');
  });

  it('starts the first paragraph at the start of the body, where it follows the closing --- at once (files.22)', () => {
    // The usual layout in Obsidian. The line break after the closing --- is the frontmatter's, not the paragraph's.
    const text = '---\ntitle: x\n---\nFirst words.\n\nSecond.';
    const [front, first, second] = splitParagraphs(text);
    expect(front).toMatchObject({ isFrontmatter: true, start: 0, end: '---\ntitle: x\n---'.length });
    expect(first).toMatchObject({ index: 0, start: bodyStart(text), text: 'First words.' });
    expect(second).toMatchObject({ index: 1, text: 'Second.' });
    // With a blank line between, as before: the paragraph starts after it.
    const spaced = '---\ntitle: x\n---\n\nFirst words.';
    expect(bodyParagraphs(splitParagraphs(spaced))[0]).toMatchObject({
      start: bodyStart(spaced) + 1,
      text: 'First words.'
    });
    // A first line of the body that is a horizontal rule is the paragraph's own.
    const rule = '---\ntitle: x\n---\n---\nThree days later.';
    expect(bodyParagraphs(splitParagraphs(rule))[0]?.text).toBe('---\nThree days later.');
  });

  it('starts or ends no paragraph with a line break, at either end of a text with one blank line there', () => {
    expect(splitParagraphs('\nFirst.\n\nLast.\n').map((p) => [p.start, p.text])).toEqual([
      [1, 'First.'],
      [9, 'Last.']
    ]);
    // A blank line holding spaces is a blank line; spaces before the first words are indentation.
    expect(splitParagraphs(' \t\n  First.\n  ').map((p) => [p.start, p.text])).toEqual([[3, '  First.']]);
    expect(splitParagraphs('Last.  ').map((p) => p.text)).toEqual(['Last.  ']);
  });

  it('cuts as many paragraphs as the separator does, none starting or ending with a line break, whatever the layout', () => {
    const line = fc.constantFrom('', ' ', '\t', 'words', '  indented', '---', 'a b');
    // No head, a text that starts with a line break, or frontmatter, its closing line bare or with spaces.
    const front = fc.constantFrom(null, '', '---\ntitle: x\n---', '---\ntitle: x\n---  ');
    fc.assert(
      fc.property(front, fc.array(line, { maxLength: 12 }), (head, lines) => {
        const text = head === null ? lines.join('\n') : [head, ...lines].join('\n');
        const paragraphs = splitParagraphs(text);
        const body = bodyParagraphs(paragraphs);
        const at = bodyStart(text);
        // Indices are the paragraphs counted as the separator cuts them, so no number moves.
        expect(body.map((p) => p.index)).toEqual(body.map((_, i) => i));
        expect(body).toHaveLength(countParagraphs(text.slice(at)));
        for (const p of body) {
          expect(text.slice(p.start, p.end)).toBe(p.text);
          expect(p.start).toBeGreaterThanOrEqual(at);
          expect(p.text).not.toMatch(/^[ \t]*\n|\n[ \t]*$/);
          expect(p.text.trim().length).toBeGreaterThan(0);
        }
        // Nothing but blank lines lies between the paragraphs, or before the first and after the last.
        let cursor = at;
        for (const p of body) {
          expect(text.slice(cursor, p.start)).toMatch(/^\s*$/);
          cursor = p.end;
        }
        expect(text.slice(cursor)).toMatch(/^\s*$/);
      }),
      { numRuns: 1000 }
    );
  });

  it('does not see frontmatter that starts later in the file', () => {
    expect(frontmatterRange('text\n\n---\na: b\n---')).toBeNull();
  });

  it('does not see an unterminated frontmatter block', () => {
    expect(frontmatterRange('---\na: b\n\nno close')).toBeNull();
  });
});

describe('paragraph lookup', () => {
  it('maps an offset back to its paragraph', () => {
    const paragraphs = splitParagraphs(PLAIN);
    expect(paragraphIndexAt(paragraphs, 0)).toBe(0);
    expect(paragraphIndexAt(paragraphs, PLAIN.indexOf('Second'))).toBe(1);
    expect(paragraphIndexAt(paragraphs, PLAIN.length - 1)).toBe(2);
  });

  it('finds a numbered paragraph and ignores frontmatter', () => {
    const paragraphs = splitParagraphs(WITH_FRONTMATTER);
    expect(findParagraph(paragraphs, 0)?.text).toBe('It was the third night of rain.');
    expect(findParagraph(paragraphs, -1)).toBeUndefined();
    expect(findParagraph(paragraphs, 9)).toBeUndefined();
  });
});
