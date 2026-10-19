import { syntaxSpans, type SyntaxKind } from '../text/obsidian';
import { bodyParagraphs, splitParagraphs, type Paragraph } from '../text/paragraphs';

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
 * What the model is shown after the number of a paragraph it is not shown
 * (`files.8`, PLAN 5.2). The system prompt quotes it and says to skip such a
 * paragraph (`STATIC_INSTRUCTIONS`).
 */
export const HIDDEN_PARAGRAPH = "(author's note or code, hidden; skip it)";

/** The syntax whose paragraphs the model is not shown: the author's comments, code and maths. */
const HIDDEN_KINDS: ReadonlySet<SyntaxKind> = new Set<SyntaxKind>(['comment', 'code', 'math']);

const WHITE_SPACE = /\s/;

/**
 * The 0-based indices of the body paragraphs the model is not shown: those
 * lying wholly inside comments, code or maths, where every character but
 * white space lies inside a `comment`, `code` or `math` span of the chapter,
 * read whole (`syntaxSpans`, `files.6`). One such span or several: a
 * paragraph of two `%%` lines is hidden, and so is each paragraph of a code
 * block or a `%%` comment that holds a blank line, since the chapter's span
 * crosses it. A paragraph with anything else outside them is shown as
 * written, among them the words after an unclosed `%%`, `<!--`, `$$` or code
 * fence, as such an opener is a span of its marker alone (C.72).
 *
 * `text` is the LF-normalised text a review keeps, as `renderChapter` takes
 * it; `paragraphs` are its body paragraphs, when the caller has them.
 */
export function hiddenParagraphs(
  text: string,
  paragraphs: readonly Paragraph[] = bodyParagraphs(splitParagraphs(text))
): Set<number> {
  const covered = new Uint8Array(text.length);
  let any = false;
  for (const span of syntaxSpans(text)) {
    if (!HIDDEN_KINDS.has(span.kind)) continue;
    covered.fill(1, span.start, span.end);
    any = true;
  }
  const hidden = new Set<number>();
  if (!any) return hidden;
  for (const p of paragraphs) {
    if (p.isFrontmatter) continue;
    let whole = true;
    for (let i = p.start; i < p.end && whole; i += 1) {
      if (covered[i] !== 1 && !WHITE_SPACE.test(text.charAt(i))) whole = false;
    }
    if (whole) hidden.add(p.index);
  }
  return hidden;
}

/**
 * Render the chapter as numbered paragraphs, exactly as written, so the model
 * can quote from them and name the paragraph it is quoting. Frontmatter is left
 * out entirely: it is never editable and never numbered. A paragraph lying
 * wholly inside comments, code or maths (`hiddenParagraphs`) keeps its number
 * but not its text, which never reaches the model: it is sent as
 * `[N] (author's note or code, hidden; skip it)` (`files.8`, PLAN 5.2), so the
 * numbers after it still match the ones beside the paragraphs on the page.
 */
export function renderChapter(text: string, fileName: string): string {
  const paragraphs = bodyParagraphs(splitParagraphs(text));
  const hidden = hiddenParagraphs(text, paragraphs);
  const body = paragraphs
    .map((p) => `[${paragraphNumber(p.index)}] ${hidden.has(p.index) ? HIDDEN_PARAGRAPH : p.text}`)
    .join('\n\n');
  const file = escapeAttribute(fileName);
  return `<chapter file="${file}" paragraphs="${paragraphs.length}">\n${body}\n</chapter>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
