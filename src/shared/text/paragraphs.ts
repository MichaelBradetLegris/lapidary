export interface Paragraph {
  /**
   * Position among the paragraphs Claude is shown. Frontmatter is not numbered
   * and carries -1. Stable for the life of a review.
   */
  index: number;
  /** inclusive char offset into the LF-normalized text */
  start: number;
  /** exclusive char offset; the blank-line separator that follows is not included */
  end: number;
  text: string;
  isFrontmatter: boolean;
}

/**
 * A run of one or more blank lines. Slightly wider than the plan's
 * `/\n[ \t]*\n+/` so that several blank lines carrying stray spaces still count
 * as a single separator.
 */
const SEPARATOR = /\n(?:[ \t]*\n)+/g;

const FRONTMATTER = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(?=\n|$)/;

/** Byte range of a leading YAML frontmatter block, or null when there is none. */
export function frontmatterRange(text: string): { start: number; end: number } | null {
  const match = FRONTMATTER.exec(text);
  if (!match) return null;
  return { start: 0, end: match[0].length };
}

/** Blank lines at the start of a span: lines of nothing but spaces and tabs, each with its line break. */
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/;

/** Blank lines at the end of a span, each with the line break before it. */
const TRAILING_BLANK_LINES = /(?:\n[ \t]*)+$/;

/**
 * Split text into paragraphs with exact offsets. Whitespace-only spans between
 * separators are dropped; every returned paragraph has at least one non-blank
 * character and `text === source.slice(start, end)`.
 *
 * No paragraph starts or ends with a line break (`files.22`, C.76). A
 * separator is two line breaks or more, so a single one at either end of the
 * body would otherwise be read as part of the paragraph beside it: the line
 * break after the frontmatter's closing `---`, where the body starts on the
 * next line, as Obsidian usually lays a note out; a text that starts with one
 * blank line; a text that ends with one, past the final newline `normalizeText`
 * keeps apart. Those blank lines belong to no paragraph, so the first body
 * paragraph starts at `bodyStart` or later, and the paragraph box, the prompt
 * and the full-text diff never see them. Spaces at the start of a paragraph's
 * first line stay: they may be indentation.
 */
export function splitParagraphs(text: string): Paragraph[] {
  const out: Paragraph[] = [];
  const fm = frontmatterRange(text);
  let cursor = 0;

  if (fm) {
    out.push({
      index: -1,
      start: fm.start,
      end: fm.end,
      text: text.slice(fm.start, fm.end),
      isFrontmatter: true
    });
    cursor = fm.end;
  }

  const rest = text.slice(cursor);
  const spans: Array<{ start: number; end: number }> = [];
  SEPARATOR.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = SEPARATOR.exec(rest)) !== null) {
    spans.push({ start: last, end: match.index });
    last = match.index + match[0].length;
  }
  spans.push({ start: last, end: rest.length });

  let index = 0;
  for (const span of spans) {
    const raw = rest.slice(span.start, span.end);
    if (raw.trim().length === 0) continue;
    const lead = LEADING_BLANK_LINES.exec(raw)?.[0].length ?? 0;
    const trail = TRAILING_BLANK_LINES.exec(raw)?.[0].length ?? 0;
    out.push({
      index,
      start: cursor + span.start + lead,
      end: cursor + span.end - trail,
      text: raw.slice(lead, raw.length - trail),
      isFrontmatter: false
    });
    index += 1;
  }

  return out;
}

/** A paragraph of body text: its words, from `start` to `end` in the text it was read from. */
export interface BodyPiece {
  start: number;
  end: number;
  text: string;
}

/**
 * The paragraphs of `text` between `from` and `to`, read as body text: split
 * as `splitParagraphs` splits the body, a run of blank lines between two, and
 * blank lines at either end of a piece left out, but with no frontmatter
 * looked for, so a `---` line at the start is just a line. Full edit reads the
 * chapter's words and the author's so (`planChapterEdit`, rr.2).
 */
export function bodyPieces(text: string, from = 0, to = text.length): BodyPiece[] {
  const rest = text.slice(from, to);
  const pieces: BodyPiece[] = [];
  const separator = new RegExp(SEPARATOR.source, 'g');
  let last = 0;
  const push = (start: number, end: number): void => {
    const raw = rest.slice(start, end);
    if (raw.trim().length === 0) return;
    const lead = LEADING_BLANK_LINES.exec(raw)?.[0].length ?? 0;
    const trail = TRAILING_BLANK_LINES.exec(raw)?.[0].length ?? 0;
    pieces.push({
      start: from + start + lead,
      end: from + end - trail,
      text: raw.slice(lead, raw.length - trail)
    });
  };
  let match: RegExpExecArray | null;
  while ((match = separator.exec(rest)) !== null) {
    push(last, match.index);
    last = match.index + match[0].length;
  }
  push(last, rest.length);
  return pieces;
}

/**
 * How many paragraphs `text` holds when it is read as part of a chapter's
 * body: split as `splitParagraphs` splits, but with no frontmatter looked
 * for, so a `---` line at its start is just a line. The guard counts one
 * paragraph so, before and after a suggestion (`files.7`).
 */
export function countParagraphs(text: string): number {
  let count = 0;
  for (const piece of text.split(SEPARATOR)) if (piece.trim().length > 0) count += 1;
  return count;
}

/** The numbered paragraphs, i.e. everything Claude is allowed to edit. */
export function bodyParagraphs(paragraphs: readonly Paragraph[]): Paragraph[] {
  return paragraphs.filter((p) => !p.isFrontmatter);
}

/** Index of the paragraph containing `offset`, or the nearest one before it. */
export function paragraphIndexAt(paragraphs: readonly Paragraph[], offset: number): number {
  let best = 0;
  for (const p of paragraphs) {
    if (p.isFrontmatter) continue;
    if (offset >= p.start && offset <= p.end) return p.index;
    if (p.start <= offset) best = p.index;
  }
  return best;
}

export function findParagraph(paragraphs: readonly Paragraph[], index: number): Paragraph | undefined {
  return paragraphs.find((p) => !p.isFrontmatter && p.index === index);
}
