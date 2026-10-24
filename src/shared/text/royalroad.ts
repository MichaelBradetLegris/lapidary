/**
 * Royal Road HTML (`rr.1`, PLAN C.111).
 *
 * `toRoyalRoadHtml` turns a chapter as it reads now into the HTML Royal Road's
 * chapter editor takes when it is pasted there: Copy HTML, in the Actions
 * menu, gives it the composed text (`composeReview`), so a pending suggestion
 * counts as its original, as it does for Copy result and Save to chapter.
 *
 * The rules began as the author's own converter's (`markdown_to_royalroad.html`
 * and two older pages beside it) and go further, as `rr.1` lists them:
 *
 * 1. A blank line ends a paragraph. A run of lines with no blank line between
 *    them is a tight block: every line is a paragraph of its own, all but the
 *    last opened with `TIGHT_P`, so the lines sit close together (the author's
 *    status screens). A lone paragraph is a plain `<p>`.
 * 2. `#` to `######` and a space make `<h1>` to `<h6>`.
 * 3. `***`, `**` and `*` are `<strong><em>`, `<strong>` and `<em>`, and `___`,
 *    `__` and `_` the same, by CommonMark's rules, which take `_` inside a word
 *    as a letter; markers pair within one line only. `~~` is `<s>`, and `==`
 *    leaves the words alone, as no one has yet seen Royal Road keep `<mark>`.
 * 4. A line of `*`, or of three or more `*`, `-` or `_`, is `<hr />`.
 * 5. `->` (and `-->`) is →, `---` is —, `--` is –, and `–-` is — as in the
 *    author's converter; a backslash before a mark of punctuation leaves the
 *    mark as it is and is itself left out.
 * 6. Curly quotes become straight ones unless `straightQuotes` is false.
 * 7. Obsidian's syntax as `syntaxSpans` finds it (`files.6`), never matched
 *    again here: the frontmatter, comments, tags, block IDs, embeds and
 *    footnote marks are left out; `[[target|alias]]` is its alias and
 *    `[[target]]` its target; `[words](https://...)` and a bare web address
 *    are links; a web image is `<img>`; an inline footnote's words go to the
 *    end, and a footnote's definition keeps its words where it stands; quotes
 *    and callouts are `<blockquote>`, a callout's title in bold; lists are
 *    `<ul>` and `<ol>`, tables `<table>`; code and maths are their text, a
 *    code block in a quote without the quote's `>`s; a `%%`, `<!--`, `$$` or
 *    code fence that nothing closes is as typed.
 * 8. `<u>`, `<sub>` and `<sup>` with their closing tags on the same line, and
 *    `<br>`, pass through; every other `<`, `>` and `&` is written as `&lt;`,
 *    `&gt;` and `&amp;`, so the chapter can never put markup it did not mean
 *    into the page, where the author's converter escaped nothing.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { syntaxSpans, type SyntaxSpan } from './obsidian';

export interface RoyalRoadOptions {
  /**
   * Curly quotes to straight ones, “ and ” to " and ‘ and ’ to ', as the
   * author's converter does; true unless false (`rr.1` (6)).
   */
  straightQuotes?: boolean;
}

/** How every line of a tight block but its last opens (`rr.1` (1)), as in the author's converter. */
export const TIGHT_P = '<p style="margin-bottom: 0">';

/**
 * The HTML for Royal Road's chapter editor, from a chapter's text (`rr.1`,
 * PLAN C.111): its blocks, one to a line, then the words of its inline
 * footnotes, a paragraph each. Line breaks may be CRLF; a byte order mark is
 * left out.
 */
export function toRoyalRoadHtml(text: string, options: RoyalRoadOptions = {}): string {
  const doc = new Doc(withoutBom(text).replace(/\r\n?/g, '\n'), options.straightQuotes !== false);
  const out = blocks(readItems(doc, classify(doc)), 0);
  for (const words of doc.footnotes) out.push(`<p>${words}</p>`);
  return out.join('\n');
}

// --- Lines ----------------------------------------------------------------------

type LineKind =
  | 'blank'
  | 'break'
  | 'para'
  | 'code'
  | 'hr'
  | 'heading'
  | 'callout'
  | 'item'
  | 'cont'
  | 'head'
  | 'delim'
  | 'row';

interface Line {
  kind: LineKind;
  /** how many block quote markers open it */
  depth: number;
  /** what the line's words are read from, `[from, to)` */
  from: number;
  to: number;
  /** a heading's level */
  level: number;
  /** a list item's: numbered, its number, and how far its marker is indented, in columns */
  ordered: boolean;
  start: number;
  indent: number;
  /** a callout's type, as in `[!note]` */
  type: string;
}

function line(kind: LineKind, depth: number, from: number, to: number, extra: Partial<Line> = {}): Line {
  return { kind, depth, from, to, level: 0, ordered: false, start: 1, indent: 0, type: '', ...extra };
}

/** A list item's marker: `-`, `+` or `*`, or a number and `.` or `)`, then a space or the end of the line. */
const LIST_ITEM = /^([ \t]*)([-+*]|(\d{1,9})[.)])(?:[ \t]+|$)/;
/** The author's scene break: a line of one `*`. */
const LONE_STAR = /^[ \t]*\*[ \t]*$/;
/** A code fence's first line, as `syntaxSpans` reads one. */
const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/;
/** One block quote marker, and the space after it. */
const QUOTE_MARKER = /^ {0,3}>[ \t]?/;

/** Every line of the text, each read for what kind of line it is, then for continuations and tables. */
function classify(doc: Doc): Line[] {
  const { src } = doc;
  const lines: Line[] = [];
  for (let at = 0; at <= src.length;) {
    const newline = src.indexOf('\n', at);
    const end = newline < 0 ? src.length : newline;
    const found = classifyLine(doc, at, end, lines[lines.length - 1]);
    if (found) lines.push(found);
    if (newline < 0) break;
    at = newline + 1;
  }
  continuations(lines);
  tables(doc, lines);
  return lines;
}

/** What the line `[start, end)` is; null for a line wholly inside the frontmatter, a comment or a footnote's words. */
function classifyLine(doc: Doc, start: number, end: number, previous: Line | undefined): Line | null {
  const { src } = doc;
  if (doc.hidden(start, end)) return null;

  // The lines of a closed code block are its text, without the fences, at the
  // depth of the quote it is in, if any.
  const held = doc.heldAt(start);
  const fence = held ? fenceDepth(doc, held) : null;
  if (held && fence !== null) {
    return line(start === held.start || held.end <= end ? 'break' : 'code', fence, start, end);
  }

  // A line a footnote's words began on an earlier line runs on after them.
  const after = doc.pastMoved(start);
  if (after > start) return line('para', previous?.depth ?? 0, after, end);

  let at = start;
  let depth = 0;
  const quote = doc.spanAt(skipBlanks(src, start, end));
  if (quote?.kind === 'quote') {
    depth = quoteDepth(doc, quote);
    at = quote.end;
  } else if (held && held.start < start && (held.kind === 'code' || held.kind === 'math')) {
    // A line of inline code or maths begun on an earlier line of a quote: this
    // line's `>`s are inside the span, so they are passed over here.
    depth = quoteDepthAt(doc, held.start);
    const text = src.slice(start, end);
    at = start + text.length - unquoted(text, depth).length;
  }
  const first = skipBlanks(src, at, end);
  if (first === end) return line('blank', depth, at, end);

  const marker = doc.spanAt(first);
  // A code block's opening fence after the quote's markers, as in `> ````.
  if (marker && fenceDepth(doc, marker) !== null) return line('break', depth, at, end);
  if (marker?.kind === 'thematic-break') return line('hr', depth, at, end);
  if (marker?.kind === 'heading') {
    const level = doc.text(marker).trim().length;
    return line('heading', depth, marker.end, headingEnd(src, marker.end, end), { level });
  }
  if (marker?.kind === 'callout') {
    const type = /^\[!([^\]]+)\]/.exec(doc.text(marker))?.[1] ?? '';
    return line('callout', depth, marker.end, end, { type });
  }
  if (marker?.kind === 'footnote' && doc.text(marker).endsWith(':')) {
    // A footnote's definition: its words where it stands, without the mark (rule 7).
    return line('para', depth, marker.end, end);
  }

  const rest = src.slice(at, end);
  if (LONE_STAR.test(rest) && !doc.heldAt(first)) return line('hr', depth, at, end);
  const item = LIST_ITEM.exec(rest);
  if (item && !doc.heldAt(at + (item[1] ?? '').length)) {
    const ordered = item[3] !== undefined;
    const number = ordered ? Number(item[3]) : 1;
    const from = at + item[0].length;
    const empty = skipBlanks(src, from, end) === end;
    // As in CommonMark, a list breaks into a paragraph's lines only with an
    // item that holds something and, when numbered, starts at 1.
    const interrupts = previous?.kind === 'para' && previous.depth === depth;
    if (!(interrupts && (empty || (ordered && number !== 1)))) {
      const indent = columns(item[1] ?? '');
      return line('item', depth, from, end, { ordered, start: number, indent });
    }
  }
  return line('para', depth, at, end);
}

/**
 * How many quotes deep the closed fenced code block `span` stands: 0 when its
 * fence opens its line, and the number of `>`s when its fence follows a
 * quote's markers, as `> ```` does, and its closing fence is the last thing on
 * its line. Null when `span` is no such block, as inline code that runs onto
 * a second line is not. `syntaxSpans` reads a fence in a quote as inline code
 * from the opening backticks to the closing ones, the `>`s of the lines
 * between inside it (C.111).
 */
function fenceDepth(doc: Doc, span: SyntaxSpan): number | null {
  const { src } = doc;
  const text = doc.text(span);
  if (span.kind !== 'code' || !text.includes('\n') || !FENCE_LINE.test(text)) return null;
  const lineStart = src.lastIndexOf('\n', span.start - 1) + 1;
  if (lineStart === span.start) return 0;
  const quote = doc.spanAt(skipBlanks(src, lineStart, span.start));
  if (quote?.kind !== 'quote' || skipBlanks(src, quote.end, span.start) !== span.start) return null;
  const lineEnd = endOfLine(src, span.end);
  if (skipBlanks(src, span.end, lineEnd) !== lineEnd) return null;
  return quoteDepth(doc, quote);
}

/** How many quotes deep a quote span's markers go: `> > ` is 2. */
function quoteDepth(doc: Doc, quote: SyntaxSpan): number {
  return doc.text(quote).split('>').length - 1;
}

/** The quote depth of the line that holds `at`, by the quote span that opens it, if any, before `at`. */
function quoteDepthAt(doc: Doc, at: number): number {
  const lineStart = doc.src.lastIndexOf('\n', at - 1) + 1;
  const quote = doc.spanAt(skipBlanks(doc.src, lineStart, at));
  return quote?.kind === 'quote' && quote.end <= at ? quoteDepth(doc, quote) : 0;
}

/** A line without the first `depth` of its quote's markers, each with one space after it. */
function unquoted(text: string, depth: number): string {
  let out = text;
  for (let n = 0; n < depth; n += 1) {
    const marker = QUOTE_MARKER.exec(out);
    if (!marker) break;
    out = out.slice(marker[0].length);
  }
  return out;
}

/**
 * Lines that carry on what the line before began, as CommonMark reads them: a
 * paragraph line under a list item is more of that item, and one under a
 * quoted paragraph with fewer `>` markers is more of that quote.
 */
function continuations(lines: Line[]): void {
  for (let i = 1; i < lines.length; i += 1) {
    const current = lines[i];
    const previous = lines[i - 1];
    if (!current || !previous || current.kind !== 'para') continue;
    if ((previous.kind === 'item' || previous.kind === 'cont') && current.depth <= previous.depth) {
      current.kind = 'cont';
      current.depth = previous.depth;
    } else if (current.depth < previous.depth && (previous.kind === 'para' || previous.kind === 'callout')) {
      current.depth = previous.depth;
    }
  }
}

/**
 * Tables: a line with a `|` in it over a line of `---` cells, as many as it
 * has, then the lines with a `|` in them that follow.
 */
function tables(doc: Doc, lines: Line[]): void {
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const head = lines[i];
    const rule = lines[i + 1];
    if (!head || !rule || head.kind !== 'para' || rule.kind !== 'para' || rule.depth !== head.depth) continue;
    if (!doc.hasPipe(head)) continue;
    const aligns = delimiterRow(doc.src.slice(rule.from, rule.to));
    if (!aligns || aligns.length !== doc.cells(head).length) continue;
    head.kind = 'head';
    rule.kind = 'delim';
    let j = i + 2;
    for (
      let row = lines[j];
      row?.kind === 'para' && row.depth === head.depth && doc.hasPipe(row);
      row = lines[j]
    ) {
      row.kind = 'row';
      j += 1;
    }
    i = j - 1;
  }
}

type Align = '' | 'left' | 'center' | 'right';

/** The alignment of each cell of a table's delimiter row, such as `| :--- | :---: |`, or null when it is not one. */
function delimiterRow(text: string): Align[] | null {
  let row = text.trim();
  if (!row.includes('|')) return null;
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  const cells = row.split('|').map((cell) => cell.trim());
  if (!cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : '';
  });
}

/** Where a heading's words end: before the spaces and the closing `#`s CommonMark allows after them. */
function headingEnd(src: string, from: number, end: number): number {
  let stop = end;
  while (stop > from && isBlank(src.charAt(stop - 1))) stop -= 1;
  let hashes = stop;
  while (hashes > from && src.charAt(hashes - 1) === '#') hashes -= 1;
  if (hashes < stop && (hashes === from || isBlank(src.charAt(hashes - 1)))) stop = hashes;
  return stop;
}

// --- Items: the lines read, in order ----------------------------------------------

type Item =
  | { kind: 'blank' | 'break' | 'hr'; depth: number }
  | { kind: 'para'; depth: number; html: string }
  | { kind: 'heading'; depth: number; level: number; html: string }
  | ListItem
  | Table;

interface ListItem {
  kind: 'item';
  depth: number;
  ordered: boolean;
  start: number;
  indent: number;
  html: string;
}

interface Table {
  kind: 'table';
  depth: number;
  aligns: Align[];
  head: string[];
  rows: string[][];
}

/**
 * Each line's words, read once and in order, so the inline footnotes are
 * gathered in the order they come. A line that reads as nothing, such as one
 * of tags or a comment, is left out, so the lines round it join.
 */
function readItems(doc: Doc, lines: Line[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    if (!current) continue;
    const { kind, depth } = current;
    if (kind === 'blank' || kind === 'break' || kind === 'hr') {
      items.push({ kind, depth });
    } else if (kind === 'code') {
      const html = tidy(escapeHtml(unquoted(doc.src.slice(current.from, current.to), depth)));
      items.push(html ? { kind: 'para', depth, html } : { kind: 'blank', depth });
    } else if (kind === 'callout') {
      const title = doc.line(current.from, current.to) || escapeHtml(calloutName(current.type));
      items.push({ kind: 'para', depth, html: `<strong>${title}</strong>` });
    } else if (kind === 'heading') {
      const html = doc.line(current.from, current.to);
      if (html) items.push({ kind: 'heading', depth, level: current.level, html });
    } else if (kind === 'item') {
      const html = doc.line(current.from, current.to);
      const { ordered, start, indent } = current;
      if (html) items.push({ kind: 'item', depth, ordered, start, indent, html });
    } else if (kind === 'cont') {
      const html = doc.line(current.from, current.to);
      const last = items[items.length - 1];
      if (html && last?.kind === 'item') last.html = `${last.html}<br />${html}`;
      else if (html) items.push({ kind: 'para', depth, html });
    } else if (kind === 'head') {
      const rule = lines[i + 1];
      const aligns = rule ? (delimiterRow(doc.src.slice(rule.from, rule.to)) ?? []) : [];
      const head = doc.cells(current).map(([from, to]) => doc.line(from, to));
      const rows: string[][] = [];
      let j = i + 2;
      for (let row = lines[j]; row?.kind === 'row'; row = lines[j]) {
        const cells = doc.cells(row).map(([from, to]) => doc.line(from, to));
        rows.push(head.map((_, c) => cells[c] ?? ''));
        j += 1;
      }
      items.push({ kind: 'table', depth, aligns, head, rows });
      i = j - 1;
    } else if (kind === 'para') {
      const html = doc.line(current.from, current.to);
      if (html) items.push({ kind: 'para', depth, html });
    }
  }
  return items;
}

/** A callout's type as Obsidian titles a callout that has no title of its own: `[!note]` and `[!NOTE]` are "Note". */
function calloutName(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

// --- Blocks -------------------------------------------------------------------------

/** The blocks of `items` at quote depth `depth`, each one string of HTML. */
function blocks(items: readonly Item[], depth: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (!item) break;
    if (item.depth > depth) {
      let j = i + 1;
      while ((items[j]?.depth ?? -1) > depth) j += 1;
      const inner = blocks(items.slice(i, j), depth + 1);
      if (inner.length > 0) out.push(['<blockquote>', ...inner, '</blockquote>'].join('\n'));
      i = j;
    } else if (item.kind === 'para') {
      let j = i + 1;
      while (items[j]?.kind === 'para' && items[j]?.depth === depth) j += 1;
      for (let k = i; k < j; k += 1) {
        const para = items[k];
        if (para?.kind === 'para') out.push(`${k < j - 1 ? TIGHT_P : '<p>'}${para.html}</p>`);
      }
      i = j;
    } else if (item.kind === 'item') {
      const list: ListItem[] = [];
      let j = i;
      for (;;) {
        const next = items[j];
        if (next?.kind === 'item' && next.depth === depth) {
          list.push(next);
          j += 1;
          continue;
        }
        // Blank lines between two items leave them in one list.
        let k = j;
        while (items[k]?.kind === 'blank') k += 1;
        const after = items[k];
        if (k > j && after?.kind === 'item' && after.depth === depth) {
          j = k;
          continue;
        }
        break;
      }
      for (let k = 0; k < list.length;) {
        const [html, next] = listHtml(list, k, 0);
        out.push(html);
        k = next;
      }
      i = j;
    } else {
      if (item.kind === 'heading') out.push(`<h${item.level}>${item.html}</h${item.level}>`);
      else if (item.kind === 'hr') out.push('<hr />');
      else if (item.kind === 'table') out.push(tableHtml(item));
      i += 1;
    }
  }
  return out;
}

/**
 * One list from `items[first]`: its items, and under each the items indented
 * two columns or more past the list's first as a list of their own. It ends at
 * an item indented less than `floor`, which belongs to the list it is nested
 * in, or at one of the other kind, numbered or not. Returns the HTML and where
 * the next list starts.
 */
function listHtml(items: readonly ListItem[], first: number, floor: number): [string, number] {
  const head = items[first];
  if (!head) return ['', first + 1];
  const entries: string[] = [];
  let i = first;
  while (i < items.length) {
    const item = items[i];
    if (!item || item.indent < floor) break;
    if (item.indent >= head.indent + 2 && entries.length > 0) {
      const [nested, next] = listHtml(items, i, head.indent + 2);
      entries[entries.length - 1] += `\n${nested}`;
      i = next;
      continue;
    }
    if (item.ordered !== head.ordered) break;
    entries.push(item.html);
    i += 1;
  }
  const tag = head.ordered ? 'ol' : 'ul';
  const open = head.ordered && head.start !== 1 ? `<ol start="${head.start}">` : `<${tag}>`;
  return [[open, ...entries.map((html) => `<li>${html}</li>`), `</${tag}>`].join('\n'), i];
}

function tableHtml(table: Table): string {
  const cell = (tag: 'th' | 'td', html: string, align: Align | undefined): string =>
    `<${tag}${align ? ` style="text-align: ${align}"` : ''}>${html}</${tag}>`;
  const row = (cells: string[], tag: 'th' | 'td'): string =>
    `<tr>${cells.map((html, c) => cell(tag, html, table.aligns[c])).join('')}</tr>`;
  const body = table.rows.length > 0 ? ['<tbody>', ...table.rows.map((r) => row(r, 'td')), '</tbody>'] : [];
  return ['<table>', '<thead>', row(table.head, 'th'), '</thead>', ...body, '</table>'].join('\n');
}

// --- The text and its syntax ------------------------------------------------------------

/** `<u>`, `<sub>` or `<sup>`, or its closing tag, as typed with no attributes. */
const PASSED_PAIR = /^<(\/?)(u|sub|sup)\s*>$/i;
/** `<br>`, `<br/>` or `<br />`. */
const BREAK = /^<br\s*\/?>$/i;
/** `->` and `-->`, `–-` (an en dash and a hyphen), `---` and `--`, tried in that order at each place. */
const DASHES = /-+>|–-|---|--/g;
/** The characters a backslash escapes, as in CommonMark. */
const ASCII_PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

/** A token of a line's words: HTML ready to write, or a run of emphasis markers still to pair. */
type Token = { kind: 'html'; html: string } | Delimiter;

interface Delimiter {
  kind: 'delimiter';
  char: string;
  /** how many of the run's markers are still unpaired */
  count: number;
  /** how many markers the run had */
  length: number;
  canOpen: boolean;
  canClose: boolean;
  /** tags this run opens, written after its unpaired markers, outermost first */
  opens: string[];
  /** tags this run closes, written before its unpaired markers, innermost first */
  closes: string[];
}

/** The chapter's text with its syntax (`syntaxSpans`), and what reading it has gathered. */
class Doc {
  readonly spans: SyntaxSpan[];
  /** The words of the inline footnotes, in the order they come, for the end. */
  readonly footnotes: string[] = [];
  /** A link's `[` and its `](...)`, an inline footnote's `^[` and its `]`, and a passed tag and its closing tag. */
  private readonly partners = new Map<number, number>();
  /** Where each inline footnote runs, from its `^[` to its `]`: its words are read at the end. */
  private readonly moved: Array<readonly [number, number]> = [];
  /** The `<` and `>` round an address written `<https://...>`, which are left out. */
  private readonly autolinkBrackets = new Set<number>();
  private readonly byStart = new Map<number, number>();

  constructor(
    readonly src: string,
    private readonly straightQuotes: boolean
  ) {
    this.spans = syntaxSpans(src);
    const links: number[] = [];
    const notes: number[] = [];
    const tags = new Map<string, number[]>();
    let tagLine = -1;
    this.spans.forEach((span, i) => {
      this.byStart.set(span.start, i);
      const text = this.text(span);
      if (span.kind === 'link') {
        if (text === '[') links.push(i);
        else this.pair(links.pop(), i);
      } else if (span.kind === 'footnote') {
        if (text === '^[') notes.push(i);
        else if (text === ']') {
          const open = notes.pop();
          this.pair(open, i);
          if (open !== undefined) this.moved.push([this.spans[open]?.start ?? span.start, span.end]);
        }
      } else if (span.kind === 'html') {
        const tag = PASSED_PAIR.exec(text);
        if (!tag) return;
        // A tag passes only with its closing tag on the same line.
        const lineEnd = endOfLine(src, span.start);
        if (lineEnd !== tagLine) tags.clear();
        tagLine = lineEnd;
        const name = (tag[2] ?? '').toLowerCase();
        const open = tags.get(name) ?? [];
        tags.set(name, open);
        if (tag[1] === '') open.push(i);
        else this.pair(open.pop(), i);
      } else if (span.kind === 'url') {
        if (
          src.charAt(span.start - 1) === '<' &&
          src.charAt(span.end) === '>' &&
          !isEscaped(src, span.start - 1)
        ) {
          this.autolinkBrackets.add(span.start - 1);
          this.autolinkBrackets.add(span.end);
        }
      }
    });
  }

  text(span: SyntaxSpan): string {
    return this.src.slice(span.start, span.end);
  }

  /** The span that starts at `at`, if any. */
  spanAt(at: number): SyntaxSpan | undefined {
    const i = this.byStart.get(at);
    return i === undefined ? undefined : this.spans[i];
  }

  /** The span that holds the character at `at`, if any. */
  heldAt(at: number): SyntaxSpan | undefined {
    const span = this.spans[this.firstEndingAfter(at)];
    return span && span.start <= at ? span : undefined;
  }

  /** The first span that ends after `at`; the spans never overlap, so their ends are in order too. */
  firstEndingAfter(at: number): number {
    let low = 0;
    let high = this.spans.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.spans[middle]?.end ?? 0) <= at) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /**
   * Whether the line `[start, end)` lies wholly inside the frontmatter or a
   * comment, or inside an inline footnote begun on an earlier line, whose
   * words are read at the end.
   */
  hidden(start: number, end: number): boolean {
    const span = this.heldAt(start);
    const hides =
      span?.kind === 'frontmatter' || (span?.kind === 'comment' && !isUnclosedComment(this.text(span)));
    if (span && hides && span.end >= end) return true;
    return this.moved.some(([from, to]) => from < start && end <= to);
  }

  /** Past the inline footnote that holds `at`, begun before it, or `at` itself. */
  pastMoved(at: number): number {
    let out = at;
    for (const [from, to] of this.moved) if (from < out && out < to) out = to;
    return out;
  }

  /** Whether the line has a `|` that is neither escaped nor inside a span, such as an internal link's. */
  hasPipe(line: Line): boolean {
    for (let at = line.from; at < line.to; at += 1) if (this.isCellBreak(at)) return true;
    return false;
  }

  /** A table line's cells, as ranges: between its `|`s, with a leading and a trailing one left out. */
  cells(line: Line): Array<[number, number]> {
    let from = skipBlanks(this.src, line.from, line.to);
    let to = line.to;
    while (to > from && isBlank(this.src.charAt(to - 1))) to -= 1;
    if (from < to && this.isCellBreak(from)) from += 1;
    if (to > from && this.isCellBreak(to - 1)) to -= 1;
    const out: Array<[number, number]> = [];
    let start = from;
    for (let at = from; at < to; at += 1) {
      if (!this.isCellBreak(at)) continue;
      out.push([start, at]);
      start = at + 1;
    }
    out.push([start, to]);
    return out;
  }

  private isCellBreak(at: number): boolean {
    return this.src.charAt(at) === '|' && !isEscaped(this.src, at) && !this.heldAt(at);
  }

  /** A line's words as HTML, its runs of spaces made one and trimmed; past an inline footnote begun earlier. */
  line(from: number, to: number): string {
    const start = this.pastMoved(from);
    return start < to ? tidy(this.render(start, to, false)) : '';
  }

  /** The text from `from` to `to` as HTML: its syntax read, its emphasis paired, the rest escaped. */
  private render(from: number, to: number, inLink: boolean): string {
    const tokens: Token[] = [];
    let at = from;
    let k = this.firstEndingAfter(from);
    while (at < to) {
      const span = this.spans[k];
      if (!span || span.start >= to) {
        this.prose(at, to, tokens);
        break;
      }
      if (span.end <= at) {
        k += 1;
        continue;
      }
      if (span.start > at) {
        this.prose(at, span.start, tokens);
        at = span.start;
      }
      at = Math.max(this.syntax(k, at, to, inLink, tokens), at + 1);
      k += 1;
    }
    pairEmphasis(tokens);
    return tokens.map(tokenHtml).join('');
  }

  /**
   * What the span `spans[k]` gives, from `at` (inside it, or at its start) to
   * no further than `to`, onto `tokens`; returns where the text goes on.
   */
  private syntax(k: number, at: number, to: number, inLink: boolean, tokens: Token[]): number {
    const span = this.spans[k];
    if (!span) return to;
    const end = Math.min(span.end, to);
    const text = this.text(span);
    const html = (value: string): void => {
      tokens.push({ kind: 'html', html: value });
    };
    switch (span.kind) {
      case 'code': {
        const run = /^(?:`+|~+)/.exec(text)?.[0].length ?? 0;
        if (run === text.length) {
          // A fence or backticks that nothing closes, as typed.
          html(escapeHtml(this.src.slice(at, end)));
          return end;
        }
        const inner = [span.start + run, span.end - run] as const;
        const from = Math.max(inner[0], at);
        const upTo = Math.min(inner[1], to);
        let words = from < upTo ? this.src.slice(from, upTo) : '';
        if (from === inner[0] && upTo === inner[1] && /^ [\s\S]* $/.test(words) && words.trim() !== '') {
          words = words.slice(1, -1);
        }
        html(escapeHtml(words.replace(/\n/g, ' ')));
        return end;
      }
      case 'comment':
        // A `%%` or `<!--` that nothing closes, as typed (C.72), as an unclosed `$$` is.
        if (isUnclosedComment(text)) html(escapeHtml(this.src.slice(at, end)));
        return end;
      case 'math': {
        if (text === '$$') {
          html('$$');
          return end;
        }
        const from = Math.max(span.start + 2, at);
        const upTo = Math.min(span.end - 2, to);
        if (from < upTo) html(escapeHtml(this.src.slice(from, upTo).replace(/\n/g, ' ')));
        return end;
      }
      case 'wikilink':
        // `[[target|` and `]]` round an alias, which is read as the words it is.
        if (text !== ']]' && !text.endsWith('|')) html(this.plain(text.slice(2, -2)));
        return end;
      case 'link': {
        const close = this.partner(k);
        if (text !== '[' || !close || close.end > to) return end;
        const url = destination(this.text(close));
        const linked = !inLink && /^(?:https?:\/\/|mailto:)\S/i.test(url);
        const words = this.render(span.end, close.start, inLink || linked);
        html(linked ? `<a href="${escapeAttribute(url)}">${words}</a>` : words);
        return close.end;
      }
      case 'image': {
        const close = matchingBracket(text, 1);
        const url = destination(text.slice(close));
        if (/^https?:\/\/\S/i.test(url)) {
          const alt = escapeAttribute(this.typeset(text.slice(2, close).replace(/\\(.)/g, '$1')));
          html(`<img src="${escapeAttribute(url)}" alt="${alt}" />`);
        }
        return end;
      }
      case 'footnote': {
        const close = this.partner(k);
        if (text !== '^[' || !close) return end;
        const words = tidy(this.render(span.end, close.start, false));
        if (words) this.footnotes.push(words);
        return Math.min(close.end, to);
      }
      case 'url':
        html(inLink ? escapeHtml(text) : `<a href="${escapeAttribute(text)}">${escapeHtml(text)}</a>`);
        return end;
      case 'html': {
        if (BREAK.test(text)) {
          html('<br />');
          return end;
        }
        const tag = PASSED_PAIR.exec(text);
        const close = this.partner(k);
        if (tag?.[1] === '' && close && close.end <= to) {
          const name = (tag[2] ?? '').toLowerCase();
          html(`<${name}>${this.render(span.end, close.start, inLink)}</${name}>`);
          return close.end;
        }
        html(escapeHtml(this.src.slice(at, end)));
        return end;
      }
      default:
        // The frontmatter, embeds, tags, block IDs, footnote marks, and the
        // line markers the blocks have read already.
        return end;
    }
  }

  private pair(open: number | undefined, close: number): void {
    if (open === undefined) return;
    this.partners.set(open, close);
    this.partners.set(close, open);
  }

  private partner(k: number): SyntaxSpan | undefined {
    const i = this.partners.get(k);
    return i === undefined ? undefined : this.spans[i];
  }

  /**
   * Text that is no syntax, from `from` to `to`, onto `tokens`: escapes read,
   * runs of `*` and `_` and pairs of `~` and `=` kept apart for pairing, the
   * rest typeset and escaped.
   */
  private prose(from: number, to: number, tokens: Token[]): void {
    const { src } = this;
    let pending = '';
    const flush = (): void => {
      if (pending) tokens.push({ kind: 'html', html: this.plain(pending) });
      pending = '';
    };
    for (let i = from; i < to;) {
      const c = src.charAt(i);
      if (this.autolinkBrackets.has(i)) {
        i += 1;
      } else if (c === '\\') {
        const next = src.charAt(i + 1);
        if (next === '\n' || next === '') {
          // A line break in Markdown: each line is a paragraph of its own already.
          i += 1;
        } else if (i + 1 < to && ASCII_PUNCTUATION.includes(next)) {
          flush();
          tokens.push({ kind: 'html', html: escapeHtml(next) });
          i += 2;
        } else {
          pending += c;
          i += 1;
        }
      } else if (c === '\n') {
        pending += ' ';
        i += 1;
      } else if (c === '*' || c === '_' || c === '~' || c === '=') {
        let run = 1;
        while (i + run < to && src.charAt(i + run) === c) run += 1;
        if (c === '*' || c === '_' || run === 2) {
          flush();
          tokens.push(this.delimiter(c, i, run));
        } else {
          pending += src.slice(i, i + run);
        }
        i += run;
      } else {
        pending += c;
        i += 1;
      }
    }
    flush();
  }

  /** A run of `run` markers at `at`, with whether it can open or close, by CommonMark's flanking rules. */
  private delimiter(char: string, at: number, run: number): Delimiter {
    const before = this.src.charAt(at - 1);
    const after = this.src.charAt(at + run);
    const left = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
    const right = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
    // `_` inside a word is a letter of it: snake_case stays as it is.
    const canOpen = char === '_' ? left && (!right || isPunctuation(before)) : left;
    const canClose = char === '_' ? right && (!left || isPunctuation(after)) : right;
    return { kind: 'delimiter', char, count: run, length: run, canOpen, canClose, opens: [], closes: [] };
  }

  /** Words as a reader sees them: rules 5 and 6, then escaped. */
  private plain(text: string): string {
    return escapeHtml(this.typeset(text));
  }

  private typeset(text: string): string {
    const dashed = text.replace(DASHES, (m) => (m.endsWith('>') ? '→' : m === '--' ? '–' : '—'));
    return this.straightQuotes ? dashed.replace(/[“”]/g, '"').replace(/[‘’]/g, "'") : dashed;
  }
}

// --- Emphasis -------------------------------------------------------------------------

/**
 * Pairs the runs of markers, as CommonMark's "process emphasis" does: each run
 * that can close looks back for the nearest run of the same marker that can
 * open, under the rule of three, and the runs between them are left as text.
 * `***x***` is written `<strong><em>x</em></strong>`, as `rr.1` (3) has it.
 * Once a closer finds no opener, later closers of its kind look no further
 * back than it did (CommonMark's `openers_bottom`), so a line of thousands of
 * markers that pair with nothing is read in one pass.
 */
function pairEmphasis(tokens: Token[]): void {
  const bottoms = new Map<string, number>();
  for (let c = 0; c < tokens.length; c += 1) {
    const closer = tokens[c];
    if (closer?.kind !== 'delimiter' || !closer.canClose) continue;
    const kind = `${closer.char}${closer.canOpen ? 1 : 0}${closer.length % 3}`;
    while (closer.count > 0) {
      const o = openerFor(tokens, c, closer, bottoms.get(kind) ?? -1);
      const opener = tokens[o];
      if (opener?.kind !== 'delimiter') {
        bottoms.set(kind, c - 1);
        break;
      }
      const [used, tag] = pairing(opener, closer);
      opener.count -= used;
      closer.count -= used;
      if (tag) {
        opener.opens.unshift(`<${tag}>`);
        closer.closes.push(`</${tag}>`);
      }
      for (let between = o + 1; between < c; between += 1) {
        const token = tokens[between];
        if (token?.kind === 'delimiter') {
          token.canOpen = false;
          token.canClose = false;
        }
      }
    }
  }
}

/** The nearest run before `c`, and after `bottom`, that can open what `closer` closes; -1 for none. */
function openerFor(tokens: readonly Token[], c: number, closer: Delimiter, bottom: number): number {
  for (let o = c - 1; o > bottom; o -= 1) {
    const t = tokens[o];
    if (t?.kind !== 'delimiter' || t.char !== closer.char || !t.canOpen || t.count === 0) continue;
    if (closer.char === '~' || closer.char === '=') return o;
    const ruleOfThree =
      (t.canClose || closer.canOpen) &&
      (t.length + closer.length) % 3 === 0 &&
      (t.length % 3 !== 0 || closer.length % 3 !== 0);
    if (!ruleOfThree) return o;
  }
  return -1;
}

/** How many markers a pair uses from each run, and the tag it makes ('' for a highlight, whose words stand alone). */
function pairing(opener: Delimiter, closer: Delimiter): [number, string] {
  if (closer.char === '~') return [2, 's'];
  if (closer.char === '=') return [2, ''];
  if (opener.count === 3 && closer.count === 3) return [1, 'em'];
  return opener.count >= 2 && closer.count >= 2 ? [2, 'strong'] : [1, 'em'];
}

function tokenHtml(token: Token): string {
  if (token.kind === 'html') return token.html;
  return token.closes.join('') + token.char.repeat(token.count) + token.opens.join('');
}

// --- Small helpers ---------------------------------------------------------------------

/**
 * Whether a comment span is an opener that nothing closes, which `syntaxSpans`
 * gives as the marker alone (C.72); a closed comment is always longer.
 */
function isUnclosedComment(text: string): boolean {
  return text === '%%' || text === '<!--';
}

/** The text without a byte order mark at its start. */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** Runs of spaces and tabs made one, and none at either end. */
function tidy(html: string): string {
  return html.replace(/[ \t]+/g, ' ').trim();
}

/** A link's or an image's destination, from its tail `](destination "title")`, without angle brackets or escapes. */
function destination(tail: string): string {
  const inner = tail.slice(tail.indexOf('(') + 1, tail.lastIndexOf(')')).trim();
  const raw = inner.startsWith('<')
    ? inner.slice(1, Math.max(inner.indexOf('>'), 1))
    : /^\S*/.exec(inner)?.[0];
  return (raw ?? '').replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/** The `]` that closes the `[` at `open` in `text`, brackets nesting and escaped ones passed over. */
function matchingBracket(text: string, open: number): number {
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    const c = text.charAt(j);
    if (c === '\\') j += 1;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return text.length;
}

function isBlank(c: string): boolean {
  return c === ' ' || c === '\t';
}

function skipBlanks(src: string, from: number, end: number): number {
  let at = from;
  while (at < end && isBlank(src.charAt(at))) at += 1;
  return at;
}

function isSpace(c: string): boolean {
  return c === '' || /\s/u.test(c);
}

function isPunctuation(c: string): boolean {
  return /[\p{P}\p{S}]/u.test(c);
}

/** An odd number of backslashes before `at`: the character there is literal. */
function isEscaped(src: string, at: number): boolean {
  let count = 0;
  for (let j = at - 1; j >= 0 && src.charAt(j) === '\\'; j -= 1) count += 1;
  return count % 2 === 1;
}

function endOfLine(src: string, at: number): number {
  const end = src.indexOf('\n', at);
  return end < 0 ? src.length : end;
}

/** The width of a list item's indent in columns, a tab reaching the next multiple of four. */
function columns(indent: string): number {
  let width = 0;
  for (const c of indent) width = c === '\t' ? width + 4 - (width % 4) : width + 1;
  return width;
}
