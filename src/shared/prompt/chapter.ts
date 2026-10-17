import { bodyParagraphs, splitParagraphs } from '../text/paragraphs';

/**
 * Paragraphs are numbered from 1 everywhere a person or a model reads them: in
 * the prompt, in the gutter beside each paragraph, and on comment cards. The
 * app itself keeps 0-based indices (`Paragraph.index`, `Hunk.paragraph`,
 * `ReviewComment.paragraph`). These two functions are the only crossing between
 * the two, so a comment that says "see paragraph 12" means the paragraph the
 * author sees labelled 12 (Phase 5d). Before Phase 5d the prompt numbered from
 * 0, which is why `ReviewGenerator.paragraphBase` records which one a review's
 * raw output used.
 */
export const PROMPT_PARAGRAPH_BASE = 1;

/** The number a person or a model sees for a 0-based paragraph index. */
export function paragraphNumber(index: number): number {
  return index + PROMPT_PARAGRAPH_BASE;
}

/** The 0-based index for a number a model gave back. Never below 0. */
export function paragraphIndexFromNumber(number: number): number {
  return Math.max(0, number - PROMPT_PARAGRAPH_BASE);
}

/**
 * Translate a model's output from the numbers it was shown to the app's
 * indices. Everything else passes through untouched.
 */
export function fromPromptNumbering<
  C extends { paragraph: number },
  M extends { paragraph: number | null }
>(output: { changes: readonly C[]; comments: readonly M[] }): { changes: C[]; comments: M[] } {
  return {
    changes: output.changes.map((change) => ({
      ...change,
      paragraph: paragraphIndexFromNumber(change.paragraph)
    })),
    comments: output.comments.map((comment) => ({
      ...comment,
      paragraph: comment.paragraph === null ? null : paragraphIndexFromNumber(comment.paragraph)
    }))
  };
}

/**
 * Render the chapter as numbered paragraphs, exactly as written, so the model
 * can quote from them and name the paragraph it is quoting. Frontmatter is left
 * out entirely: it is never editable and never numbered.
 */
export function renderChapter(text: string, fileName: string): string {
  const paragraphs = bodyParagraphs(splitParagraphs(text));
  const body = paragraphs.map((p) => `[${paragraphNumber(p.index)}] ${p.text}`).join('\n\n');
  const file = escapeAttribute(fileName);
  return `<chapter file="${file}" paragraphs="${paragraphs.length}">\n${body}\n</chapter>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
