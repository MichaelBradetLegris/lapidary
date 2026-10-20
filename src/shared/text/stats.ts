import { bodyParagraphs, splitParagraphs } from './paragraphs';

export interface ChapterStats {
  /** paragraphs Claude would be shown, so frontmatter is not counted */
  paragraphs: number;
  words: number;
  characters: number;
}

/**
 * A word is a run of anything that is not whitespace. Markdown markers and
 * punctuation ride along with the word they belong to, which is how a word
 * processor counts and close enough for the "this is how big the job is" line
 * in the review dialog (item 6).
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

export function chapterStats(text: string): ChapterStats {
  const body = bodyParagraphs(splitParagraphs(text));
  return {
    paragraphs: body.length,
    words: body.reduce((sum, p) => sum + countWords(p.text), 0),
    characters: text.length
  };
}

/* ------------------------------------------------------------------ */
/* Long chapters (files.10)                                            */
/* ------------------------------------------------------------------ */

/** From this many words, Review with AI says the chapter is long. */
export const REVIEW_SIZE_INFO_WORDS = 12_000;

/** From this many words, it warns that the reply may not fit. */
export const REVIEW_SIZE_WARN_WORDS = 40_000;

export const REVIEW_SIZE_INFO =
  "A long chapter. The review may take several minutes, and uses more of your plan's limits or your API credit than a short one.";

export const REVIEW_SIZE_WARN =
  'A very long chapter. The model may reach its output limit before it has written every suggestion; the review then fails, and what it used still counts. A lower effort leaves more room for the reply, and shorter files are safer.';

export interface ReviewSizeAdvice {
  /** info: a grey note; warn: an orange box */
  level: 'info' | 'warn';
  text: string;
}

/**
 * What Review with AI says under the chapter's word count (PLAN 5.5): nothing
 * under 12,000 words, a note from 12,000, a warning from 40,000. `words` is
 * `chapterStats(...).words`, the count the dialog shows, so the frontmatter
 * is not counted. A review's reply lists every suggestion at once, so it
 * grows with the chapter, and a reply cut off at the model's output limit
 * brings nothing back (`replyLimitMessage`, C.77).
 */
export function reviewSizeAdvice(words: number): ReviewSizeAdvice | null {
  if (!(words >= REVIEW_SIZE_INFO_WORDS)) return null;
  if (words >= REVIEW_SIZE_WARN_WORDS) return { level: 'warn', text: REVIEW_SIZE_WARN };
  return { level: 'info', text: REVIEW_SIZE_INFO };
}
