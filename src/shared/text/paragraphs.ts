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

/**
 * Split text into paragraphs with exact offsets. Whitespace-only spans between
 * separators are dropped; every returned paragraph has at least one non-blank
 * character and `text === source.slice(start, end)`.
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
    out.push({
      index,
      start: cursor + span.start,
      end: cursor + span.end,
      text: raw,
      isFrontmatter: false
    });
    index += 1;
  }

  return out;
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
