import { describe, expect, it } from 'vitest';
import {
  REVIEW_SIZE_INFO,
  REVIEW_SIZE_INFO_WORDS,
  REVIEW_SIZE_WARN,
  REVIEW_SIZE_WARN_WORDS,
  chapterStats,
  reviewSizeAdvice
} from '../../src/shared/text/stats';

/* files.10: what Review with AI says under a long chapter's word count. The
   word count itself is tested in phase5b.test.ts. */

describe('reviewSizeAdvice', () => {
  it('says nothing under 12,000 words', () => {
    for (const words of [0, 1, 4_500, 11_999]) expect(reviewSizeAdvice(words)).toBeNull();
  });

  it('notes a long chapter from 12,000 words, inclusive, up to 39,999', () => {
    for (const words of [12_000, 12_001, 25_000, 39_999]) {
      expect(reviewSizeAdvice(words)).toEqual({ level: 'info', text: REVIEW_SIZE_INFO });
    }
  });

  it('warns from 40,000 words, inclusive', () => {
    for (const words of [40_000, 40_001, 150_000]) {
      expect(reviewSizeAdvice(words)).toEqual({ level: 'warn', text: REVIEW_SIZE_WARN });
    }
  });

  it('keeps the thresholds the plan gives', () => {
    expect(REVIEW_SIZE_INFO_WORDS).toBe(12_000);
    expect(REVIEW_SIZE_WARN_WORDS).toBe(40_000);
  });

  it('says nothing for a count that is not a number', () => {
    expect(reviewSizeAdvice(Number.NaN)).toBeNull();
    expect(reviewSizeAdvice(-1)).toBeNull();
  });

  it('words the note and the warning plainly', () => {
    expect(REVIEW_SIZE_INFO).toBe(
      "A long chapter. The review may take several minutes, and uses more of your plan's limits or your API credit than a short one."
    );
    expect(REVIEW_SIZE_WARN).toBe(
      'A very long chapter. The model may reach its output limit before it has written every suggestion; the review then fails, and what it used still counts. A lower effort leaves more room for the reply, and shorter files are safer.'
    );
  });

  it("counts as the dialog counts: the body's words, never the frontmatter", () => {
    const body = (words: number): string => Array.from({ length: words }, (_, i) => `w${i}`).join(' ');
    const frontmatter = `---\ntags: [${Array.from({ length: 50 }, (_, i) => `t${i}`).join(', ')}]\n---\n\n`;
    const under = `${frontmatter}${body(REVIEW_SIZE_INFO_WORDS - 1)}\n`;
    expect(chapterStats(under).words).toBe(11_999);
    expect(reviewSizeAdvice(chapterStats(under).words)).toBeNull();
    const at = `${frontmatter}${body(REVIEW_SIZE_INFO_WORDS - 1)}\n\nlast\n`;
    expect(reviewSizeAdvice(chapterStats(at).words)?.level).toBe('info');
  });
});
