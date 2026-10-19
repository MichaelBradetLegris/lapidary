/**
 * Obsidian syntax a review leaves alone (`files.6`, PLAN 11.3 k).
 *
 * `syntaxSpans` finds the parts of a chapter that are Markdown or Obsidian
 * syntax rather than prose, as exact offsets into the LF-normalised text a
 * review keeps (`ReviewBase.text`): start inclusive, end exclusive, in order,
 * never empty and never overlapping. The guard (`files.7`) keeps out a model's
 * suggestion that would change one, so links, embeds and the rest still work
 * after Save, and the prompt (`files.8`) hides a paragraph that lies wholly
 * inside a comment, code or maths.
 *
 * A span covers only what a copyedit could break. `[[target|alias]]` is two
 * spans, `[[target|` and `]]`, so the alias between them stays prose that can
 * be corrected; a Markdown link is `[` and `](url)`, an inline footnote `^[`
 * and its `]`, and the words of a heading, a block quote or a callout's title
 * are prose after their markers. Emphasis, bold, strikethrough and highlight
 * markers, indented code, inline `$maths$`, tables and lists are never spans:
 * a copyedit that keeps their characters keeps them, and `*em*`, `$5 and $10`
 * or a paragraph indented with a tab must stay prose.
 *
 * The rules follow CommonMark and Obsidian's help, with the plan's own
 * choices (C.72): an unclosed `%%`, `<!--`, `$$` or code fence protects only
 * its opening marker, so a stray one never hides the rest of a chapter; angle
 * brackets are HTML only for a real element whose attributes all have values,
 * or for a tag with a `name=value` attribute, so angle-bracket dialogue such
 * as `<Where are you?>`, `<sigh>` or `<I know.>` stays prose; and a character
 * escaped with a backslash opens nothing. Dataview and Templater get nothing
 * of their own (Appendix D, friend defaults): a Dataview query in a code
 * block is code like any other.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { frontmatterRange } from './paragraphs';

/** Every kind of syntax `syntaxSpans` reports. */
export const SYNTAX_KINDS = [
  'frontmatter',
  'code',
  'comment',
  'math',
  'embed',
  'wikilink',
  'link',
  'image',
  'footnote',
  'block-id',
  'tag',
  'callout',
  'quote',
  'heading',
  'thematic-break',
  'url',
  'html'
] as const;

export type SyntaxKind = (typeof SYNTAX_KINDS)[number];

/**
 * Each kind in words, for the note on a suggestion kept out of the text:
 * "Kept out of the text: it would change Obsidian syntax (<label>)." (11.3 k).
 * Obsidian's own names where it has one: an internal link, an embed, a
 * callout, a block ID, a horizontal rule.
 */
export const SYNTAX_LABELS: Readonly<Record<SyntaxKind, string>> = {
  frontmatter: 'frontmatter',
  code: 'code',
  comment: 'a comment',
  math: 'maths',
  embed: 'an embed',
  wikilink: 'an internal link',
  link: 'a link',
  image: 'an image',
  footnote: 'a footnote',
  'block-id': 'a block ID',
  tag: 'a tag',
  callout: 'a callout',
  quote: 'a block quote',
  heading: 'a heading',
  'thematic-break': 'a horizontal rule',
  url: 'a web address',
  html: 'HTML'
};

export interface SyntaxSpan {
  kind: SyntaxKind;
  /** inclusive char offset into the LF-normalised text */
  start: number;
  /** exclusive end offset */
  end: number;
}

/**
 * The characters that keep a model's suggestion out of the text when its
 * original or its replacement holds one (11.3 k): `[ ] % $ ^ # < > | ~`, the
 * backtick and the line break. Any of them can open, close or split syntax,
 * wherever it lands. `*`, `=`, `_` and `-` are not among them, as emphasis,
 * highlights and lists are not protected.
 */
export const MARKUP_CHARS = '[]%$^#<>|~`\n';

/** Whether `text` holds one of `MARKUP_CHARS`. */
export function hasMarkupChar(text: string): boolean {
  for (const c of MARKUP_CHARS) if (text.includes(c)) return true;
  return false;
}

/**
 * Where the body starts: just past the line break that ends the frontmatter's
 * closing `---` line, or the end of the text when nothing follows it, and 0
 * when there is no frontmatter. Everything before it is frontmatter, the
 * first span `syntaxSpans` gives. It reads the frontmatter as
 * `splitParagraphs` does (`frontmatterRange`), so the two agree.
 */
export function bodyStart(text: string): number {
  const range = frontmatterRange(text);
  if (!range) return 0;
  return text.charCodeAt(range.end) === LINE_FEED ? range.end + 1 : range.end;
}

/**
 * The syntax in `text`, in order of position. `text` is LF-normalised, a
 * whole chapter or one paragraph of it; a construct is found only where it
 * opens and closes inside the text it is given.
 *
 * Two passes. Code, comments and maths come first, left to right: whichever
 * opens first runs to its close, and nothing inside it is anything else, so a
 * `%%` in code is code and a link in a comment is comment. Then, outside
 * them, the markers at the start of each line and the marks within lines,
 * again left to right, each in characters no earlier span holds.
 */
export function syntaxSpans(text: string): SyntaxSpan[] {
  const scan = new Scan(text);
  const body = bodyStart(text);
  if (body > 0) scan.claim('frontmatter', [0, body]);
  findRaw(scan, body);
  findMarks(scan, body);
  return scan.spans.sort((a, b) => a.start - b.start);
}

/**
 * What the syntax in `text` is, without where it is: each span's kind and
 * exact text, in order. A copyedit of the prose around the syntax leaves it
 * unchanged, however far it moves the spans; one that adds, removes or alters
 * any syntax changes it. The guard compares it before and after applying a
 * model's suggestion alone (`files.7`).
 */
export function syntaxSignature(text: string): string {
  return JSON.stringify(syntaxSpans(text).map((span) => [span.kind, text.slice(span.start, span.end)]));
}

const LINE_FEED = 10;
const BACKSLASH = 92;

/** The spans found so far, and which characters they hold. */
class Scan {
  readonly spans: SyntaxSpan[] = [];
  private readonly held: Uint8Array;
  private blankLines: number[] | null = null;

  constructor(readonly text: string) {
    this.held = new Uint8Array(text.length);
  }

  isHeld(at: number): boolean {
    return this.held[at] === 1;
  }

  /** The first character from `at` on that no span holds. */
  pastHeld(at: number): number {
    let i = at;
    while (i < this.text.length && this.held[i] === 1) i += 1;
    return i;
  }

  isFree(start: number, end: number): boolean {
    for (let i = start; i < end; i += 1) if (this.held[i] === 1) return false;
    return true;
  }

  /**
   * Records each `[start, end)` part as a span of `kind`, but only when every
   * part is inside the text, not empty and held by no span; true when it did.
   */
  claim(kind: SyntaxKind, ...parts: ReadonlyArray<readonly [number, number]>): boolean {
    for (const [start, end] of parts) {
      if (start < 0 || end <= start || end > this.text.length || !this.isFree(start, end)) return false;
    }
    for (const [start, end] of parts) {
      this.held.fill(1, start, end);
      this.spans.push({ kind, start, end });
    }
    return true;
  }

  /**
   * Where the paragraph holding `at` ends: the line break that starts the
   * next blank line, or the end of the text. Inline code, link text and an
   * inline footnote never run past it.
   */
  paragraphEnd(at: number): number {
    this.blankLines ??= [...this.text.matchAll(/\n[ \t]*(?=\n|$)/g)].map((m) => m.index);
    const lines = this.blankLines;
    let low = 0;
    let high = lines.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((lines[middle] ?? 0) < at) low = middle + 1;
      else high = middle;
    }
    return lines[low] ?? this.text.length;
  }
}

function atLineStart(text: string, i: number): boolean {
  return i === 0 || text.charCodeAt(i - 1) === LINE_FEED;
}

function endOfLine(text: string, i: number): number {
  const end = text.indexOf('\n', i);
  return end < 0 ? text.length : end;
}

/** An odd number of backslashes before `i`: the character there is literal. */
function isEscaped(text: string, i: number): boolean {
  let count = 0;
  for (let j = i - 1; j >= 0 && text.charCodeAt(j) === BACKSLASH; j -= 1) count += 1;
  return count % 2 === 1;
}

/** How many times the character at `i` repeats from there. */
function runLength(text: string, i: number): number {
  const c = text.charAt(i);
  let j = i;
  while (j < text.length && text.charAt(j) === c) j += 1;
  return j - i;
}

// --- Code, comments and maths -------------------------------------------------

/**
 * Comments and maths: each runs from its opener to the first closer after it,
 * across lines and blank lines, or is only its opener when nothing closes it.
 * `<!--` is closed from its own third character on, so `<!-->` and `<!--->`
 * are whole comments, as in CommonMark.
 */
const DELIMITED: ReadonlyArray<{ open: string; close: string; from: number; kind: SyntaxKind }> = [
  { open: '%%', close: '%%', from: 2, kind: 'comment' },
  { open: '<!--', close: '-->', from: 2, kind: 'comment' },
  { open: '$$', close: '$$', from: 2, kind: 'math' }
];

function findRaw(scan: Scan, from: number): void {
  const { text } = scan;
  // Openers with no closer left in the text: once a search finds none, no
  // later opener of that kind will either.
  const unclosed = new Set<string>();
  let i = from;
  while (i < text.length) {
    const fence = atLineStart(text, i) ? fenceAt(text, i) : null;
    if (fence && scan.claim('code', [fence.start, fence.end])) {
      i = fence.end;
    } else if (text.charAt(i) === '`' && !isEscaped(text, i)) {
      const run = runLength(text, i);
      const close = closingBackticks(scan, i + run, run);
      i = close >= 0 && scan.claim('code', [i, close + run]) ? close + run : i + run;
    } else {
      i = delimitedAt(scan, i, unclosed);
    }
  }
}

/** A comment or maths opening at `i`: claims it and returns its end, or returns `i + 1`. */
function delimitedAt(scan: Scan, i: number, unclosed: Set<string>): number {
  const { text } = scan;
  const c = text.charAt(i);
  if (c !== '%' && c !== '<' && c !== '$') return i + 1;
  const d = DELIMITED.find((each) => text.startsWith(each.open, i));
  if (!d || isEscaped(text, i)) return i + 1;
  const close = unclosed.has(d.open) ? -1 : text.indexOf(d.close, i + d.from);
  if (close < 0) unclosed.add(d.open);
  const end = close < 0 ? i + d.open.length : close + d.close.length;
  return scan.claim(d.kind, [i, end]) ? end : i + 1;
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * A code fence opening the line at `lineStart`: up to three spaces, then
 * three or more backticks or tildes, and for backticks an info string with
 * none in it. It closes at a line of the same character, at least as many,
 * with nothing after them but spaces; the block is then every line from the
 * opening one to the closing one. Unclosed, only the opening run is
 * protected, as an unclosed comment is (C.72).
 */
function fenceAt(text: string, lineStart: number): { start: number; end: number } | null {
  const lineEnd = endOfLine(text, lineStart);
  const open = FENCE_OPEN.exec(text.slice(lineStart, lineEnd));
  if (!open) return null;
  const indent = open[1] ?? '';
  const run = open[2] ?? '';
  if (run.startsWith('`') && (open[3] ?? '').includes('`')) return null;
  for (let at = lineEnd + 1; at <= text.length;) {
    const end = endOfLine(text, at);
    const close = FENCE_CLOSE.exec(text.slice(at, end))?.[1] ?? '';
    if (close.charAt(0) === run.charAt(0) && close.length >= run.length) return { start: lineStart, end };
    at = end + 1;
  }
  const start = lineStart + indent.length;
  return { start, end: start + run.length };
}

/** The next run of exactly `length` backticks in the paragraph, or -1: then the opening run is plain text. */
function closingBackticks(scan: Scan, from: number, length: number): number {
  const { text } = scan;
  const stop = scan.paragraphEnd(from);
  for (let j = from; j < stop;) {
    if (text.charAt(j) !== '`') {
      j += 1;
      continue;
    }
    const run = runLength(text, j);
    if (run === length) return j;
    j += run;
  }
  return -1;
}

// --- Markers at the start of a line, and marks within lines -------------------

function findMarks(scan: Scan, from: number): void {
  const { text } = scan;
  // Where the current line's text starts, past its block quote markers, which
  // counts as the start of the line for a tag (`>#todo`).
  let lineText = from;
  let i = from;
  while (i < text.length) {
    if (scan.isHeld(i)) {
      i = scan.pastHeld(i);
      continue;
    }
    if (atLineStart(text, i)) {
      const line = lineMarks(scan, i);
      lineText = line.text;
      if (line.next > i) {
        i = line.next;
        continue;
      }
    }
    i = inlineMark(scan, i, lineText);
  }
}

/** Block quote markers, nested ones included, and the one space after them. */
const QUOTE = /^ {0,3}>(?:[ \t]*>)*[ \t]?/;
/** A horizontal rule: three or more of one of `-`, `*` or `_`, spaces between allowed, nothing else. */
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** A heading's one to six `#` and the space after them. */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const CALLOUT = /^[ \t]*\[![^[\]\n]+\][+-]?/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^[\]\s]+\]:/;

/**
 * The markers that open the line at `lineStart`: block quote markers, then,
 * on what follows them, a horizontal rule, a heading's `#`, a callout's
 * `[!type]` (only after a quote marker) or a footnote definition's `[^x]:`.
 * Up to three spaces may come first; a tab makes the line indented prose.
 * Returns where the line's text starts, past any quote markers, and where to
 * look on from.
 */
function lineMarks(scan: Scan, lineStart: number): { text: number; next: number } {
  const { text } = scan;
  const lineEnd = endOfLine(text, lineStart);
  let at = lineStart;
  let quoted = false;
  const quote = QUOTE.exec(text.slice(lineStart, lineEnd));
  if (quote && scan.claim('quote', [lineStart + quote[0].indexOf('>'), lineStart + quote[0].length])) {
    at = lineStart + quote[0].length;
    quoted = true;
  }
  const rest = text.slice(at, lineEnd);
  if (RULE.test(rest) && scan.claim('thematic-break', [at + rest.search(/\S/), at + rest.trimEnd().length])) {
    return { text: at, next: lineEnd };
  }
  const heading = HEADING.exec(rest);
  if (heading) return { text: at, next: claimMatch(scan, 'heading', at, heading[0]) };
  const callout = quoted ? CALLOUT.exec(rest) : null;
  if (callout) return { text: at, next: claimMatch(scan, 'callout', at, callout[0]) };
  const definition = FOOTNOTE_DEFINITION.exec(rest);
  if (definition) return { text: at, next: claimMatch(scan, 'footnote', at, definition[0]) };
  return { text: at, next: at };
}

/** Claims `match`, found at `at`, from its first character that is not a space; where to go on from. */
function claimMatch(scan: Scan, kind: SyntaxKind, at: number, match: string): number {
  const end = at + match.length;
  return scan.claim(kind, [at + match.search(/\S/), end]) ? end : at;
}

/** Claims what opens at `i`, if anything; returns where to look next, always past `i`. */
function inlineMark(scan: Scan, i: number, lineText: number): number {
  const { text } = scan;
  let next = -1;
  switch (text.charAt(i)) {
    case '!':
      if (isEscaped(text, i) || text.charAt(i + 1) !== '[') break;
      if (text.charAt(i + 2) === '[') next = embedAt(scan, i);
      if (next < 0) next = imageAt(scan, i);
      break;
    case '[':
      if (isEscaped(text, i)) break;
      if (text.charAt(i + 1) === '[') next = wikilinkAt(scan, i);
      else if (text.charAt(i + 1) === '^') next = footnoteRefAt(scan, i);
      if (next < 0) next = linkAt(scan, i);
      break;
    case '^':
      if (isEscaped(text, i)) break;
      next = text.charAt(i + 1) === '[' ? inlineFootnoteAt(scan, i) : blockIdAt(scan, i, lineText);
      break;
    case '#':
      next = tagAt(scan, i, lineText);
      break;
    case '<':
      next = htmlAt(scan, i);
      break;
    case 'h':
    case 'H':
      next = urlAt(scan, i);
      break;
  }
  return next > i ? next : i + 1;
}

/**
 * The `[[...]]` whose first `[` is at `open`: where it ends and where its
 * first `|` is (-1 for none), or null when there is none. One line, something
 * inside, and no bracket but the closing two; Obsidian allows none in a
 * note's name.
 */
function wikiClose(text: string, open: number): { end: number; pipe: number } | null {
  let pipe = -1;
  for (let j = open + 2; j < text.length; j += 1) {
    const c = text.charAt(j);
    if (c === ']') return j > open + 2 && text.charAt(j + 1) === ']' ? { end: j + 2, pipe } : null;
    if (c === '[' || c === '\n') return null;
    if (c === '|' && pipe < 0) pipe = j;
  }
  return null;
}

/** `![[...]]`, whole: changing any of it changes what is embedded. */
function embedAt(scan: Scan, i: number): number {
  const link = wikiClose(scan.text, i + 1);
  return link && scan.claim('embed', [i, link.end]) ? link.end : -1;
}

/** `[[target]]` whole, or `[[target|` and `]]` with the alias between them left as prose. */
function wikilinkAt(scan: Scan, i: number): number {
  const link = wikiClose(scan.text, i);
  if (!link) return -1;
  if (link.pipe < 0) return scan.claim('wikilink', [i, link.end]) ? link.end : -1;
  return scan.claim('wikilink', [i, link.pipe + 1], [link.end - 2, link.end]) ? link.pipe + 1 : -1;
}

/**
 * The `]` matching the `[` at `open`, in the same paragraph, or -1. Brackets
 * nest, an escaped one does not count, and brackets inside code or any other
 * span already found are passed over.
 */
function closeBracket(scan: Scan, open: number): number {
  const { text } = scan;
  const stop = scan.paragraphEnd(open);
  let depth = 0;
  for (let j = open; j < stop; j += 1) {
    if (scan.isHeld(j)) continue;
    const c = text.charAt(j);
    if (c === '\\') j += 1;
    else if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Where a link's `(destination "title")` ends, the `)` included, given the
 * `]` at `close`; -1 when none follows it. CommonMark's rules on one line: a
 * destination in angle brackets, or one with no space whose parentheses
 * balance (Obsidian asks for `%20` in a path with spaces), then an optional
 * title in quotes or parentheses after a space.
 */
function linkTail(scan: Scan, close: number): number {
  const { text } = scan;
  if (text.charAt(close + 1) !== '(') return -1;
  let j = skipBlanks(text, close + 2);
  if (text.charAt(j) === '<') {
    for (j += 1; text.charAt(j) !== '>'; j += 1) {
      const c = text.charAt(j);
      if (c === '' || c === '\n' || c === '<') return -1;
      if (c === '\\') j += 1;
    }
    j += 1;
  } else {
    let depth = 0;
    for (; j < text.length; j += 1) {
      const c = text.charAt(j);
      if (c === '\\') {
        j += 1;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === '(') depth += 1;
      else if (c === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    if (depth !== 0) return -1;
  }
  const destinationEnd = j;
  j = skipBlanks(text, j);
  const quote = text.charAt(j);
  if (j > destinationEnd && (quote === '"' || quote === "'" || quote === '(')) {
    const closer = quote === '(' ? ')' : quote;
    for (j += 1; text.charAt(j) !== closer; j += 1) {
      const c = text.charAt(j);
      if (c === '' || c === '\n') return -1;
      if (c === '\\') j += 1;
    }
    j = skipBlanks(text, j + 1);
  }
  if (text.charAt(j) !== ')') return -1;
  return scan.isFree(close, j + 1) ? j + 1 : -1;
}

function skipBlanks(text: string, from: number): number {
  let j = from;
  while (text.charAt(j) === ' ' || text.charAt(j) === '\t') j += 1;
  return j;
}

/** `![alt](destination)`, whole. */
function imageAt(scan: Scan, i: number): number {
  const close = closeBracket(scan, i + 1);
  const end = close < 0 ? -1 : linkTail(scan, close);
  return end > 0 && scan.claim('image', [i, end]) ? end : -1;
}

/** `[` and `](destination)`, with the link's text between them left as prose. */
function linkAt(scan: Scan, i: number): number {
  const close = closeBracket(scan, i);
  const end = close < 0 ? -1 : linkTail(scan, close);
  return end > 0 && scan.claim('link', [i, i + 1], [close, end]) ? i + 1 : -1;
}

const FOOTNOTE_REF = /\[\^[^[\]\s]+\]/y;

/** `[^label]`, whole. */
function footnoteRefAt(scan: Scan, i: number): number {
  FOOTNOTE_REF.lastIndex = i;
  const ref = FOOTNOTE_REF.exec(scan.text);
  return ref && scan.claim('footnote', [i, i + ref[0].length]) ? i + ref[0].length : -1;
}

/** `^[` and its `]`, with the footnote's own text between them left as prose. */
function inlineFootnoteAt(scan: Scan, i: number): number {
  const close = closeBracket(scan, i + 1);
  return close > 0 && scan.claim('footnote', [i, i + 2], [close, close + 1]) ? i + 2 : -1;
}

/**
 * Latin letters, digits and dashes after a `^` that starts the line or
 * follows a space, with nothing after them on the line but spaces
 * (Obsidian's help, Internal links).
 */
const BLOCK_ID = /\^[A-Za-z0-9-]+(?=[ \t]*(?:\n|$))/y;

function blockIdAt(scan: Scan, i: number, lineText: number): number {
  const { text } = scan;
  const before = text.charAt(i - 1);
  if (!(atLineStart(text, i) || i === lineText || before === ' ' || before === '\t')) return -1;
  BLOCK_ID.lastIndex = i;
  const id = BLOCK_ID.exec(text);
  return id && scan.claim('block-id', [i, i + id[0].length]) ? i + id[0].length : -1;
}

/**
 * A tag's name runs to the first space or punctuation mark; letters and
 * digits of any script, emoji, `_`, `-` and `/` belong to it (Obsidian's
 * help, Tags). The two Unicode ranges are general and supplemental
 * punctuation: dashes, curly quotes, the ellipsis.
 */
const TAG = /#([^\s!"#$%&'()*+,.:;<=>?@[\]\\^`{|}~\u2000-\u206F\u2E00-\u2E7F]+)/uy;

/**
 * `#name` at the start of a line, after a space or `(`, or straight after a
 * line's quote markers, when the name holds something besides digits: `#1984`
 * and `Room #4` are prose, `#y1984` is a tag.
 */
function tagAt(scan: Scan, i: number, lineText: number): number {
  const { text } = scan;
  if (isEscaped(text, i)) return -1;
  const before = text.charAt(i - 1);
  if (!(atLineStart(text, i) || i === lineText || before === '(' || /\s/u.test(before))) return -1;
  TAG.lastIndex = i;
  const name = TAG.exec(text)?.[1] ?? '';
  if (name === '' || /^[0-9]+$/.test(name)) return -1;
  const end = i + 1 + name.length;
  return scan.claim('tag', [i, end]) ? end : -1;
}

/** The element names 11.3 (k) counts as HTML, in any case. */
const HTML_ELEMENTS = new Set([
  'a',
  'abbr',
  'audio',
  'b',
  'blockquote',
  'br',
  'center',
  'code',
  'del',
  'details',
  'div',
  'em',
  'font',
  'hr',
  'i',
  'iframe',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'td',
  'th',
  'tr',
  'u',
  'ul',
  'video'
]);

const HTML_ATTRIBUTE = /[ \t]+[A-Za-z_:][\w.:-]*(?:[ \t]*=[ \t]*(?:"[^"\n]*"|'[^'\n]*'|[^\s"'=<>`]+))?/g;
const HTML_TAG = new RegExp(`<(/?)([A-Za-z][A-Za-z0-9-]*)((?:${HTML_ATTRIBUTE.source})*)[ \\t]*(/?)>`, 'y');

/**
 * An HTML tag on one line, as CommonMark reads one, that counts as HTML: a
 * closing tag of a real element; an opening one of a real element whose
 * attributes all have values (`<br/>`, `<span class="aside">`); or any tag
 * with a `name=value` attribute (`<x-note data-id="1">`). A word after the
 * name is not an attribute here, so `<I know.>` is dialogue, at the cost of
 * a bare one such as `<details open>` going unprotected (C.72).
 */
function htmlAt(scan: Scan, i: number): number {
  const { text } = scan;
  if (isEscaped(text, i)) return -1;
  HTML_TAG.lastIndex = i;
  const tag = HTML_TAG.exec(text);
  if (!tag) return -1;
  const real = HTML_ELEMENTS.has((tag[2] ?? '').toLowerCase());
  const attributes = [...(tag[3] ?? '').matchAll(HTML_ATTRIBUTE)].map((a) => a[0]);
  const valued = attributes.filter((a) => a.includes('=')).length;
  const counts =
    tag[1] === '/'
      ? real && attributes.length === 0 && tag[4] === ''
      : (real && valued === attributes.length) || valued > 0;
  const end = i + tag[0].length;
  return counts && scan.claim('html', [i, end]) ? end : -1;
}

const URL_START = /https?:\/\/[\p{L}\p{N}]/iuy;
const URL_STOP = /[\s<>"`|]/u;
const URL_TRAILING = `.,:;!?'*_~`;

/**
 * A bare `http://` or `https://` address, up to a space, an angle bracket, a
 * quote mark, a pipe or a span already found. As GitHub's autolinks do, it
 * leaves out the punctuation that ends a sentence, and a `)` or `]` that
 * closes nothing inside it.
 */
function urlAt(scan: Scan, i: number): number {
  const { text } = scan;
  URL_START.lastIndex = i;
  if (!URL_START.test(text)) return -1;
  let end = i;
  while (end < text.length && !scan.isHeld(end) && !URL_STOP.test(text.charAt(end))) end += 1;
  for (;;) {
    const url = text.slice(i, end);
    const last = url.charAt(url.length - 1);
    const unbalanced =
      (last === ')' && count(url, ')') > count(url, '(')) ||
      (last === ']' && count(url, ']') > count(url, '['));
    if (last === '' || (!URL_TRAILING.includes(last) && !unbalanced)) break;
    end -= 1;
  }
  return scan.claim('url', [i, end]) ? end : -1;
}

function count(text: string, c: string): number {
  return text.split(c).length - 1;
}
