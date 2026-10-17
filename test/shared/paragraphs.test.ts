import { describe, expect, it } from 'vitest';
import {
  bodyParagraphs,
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
