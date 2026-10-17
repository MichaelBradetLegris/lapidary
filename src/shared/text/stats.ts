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
