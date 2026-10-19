/**
 * Small changes (PLAN 11.7, `small.3`): what counts as one, and the words the
 * page uses for characters that are hard to see or cannot be seen at all.
 *
 * A change that touches only punctuation, a space or a one-letter word is
 * trimmed to one character or none (4.3, step 5), so its mark in the line is
 * only as wide as that character. Such changes are drawn bigger, never stored
 * bigger: nothing here changes a hunk, an offset or the text in the line.
 *
 * Each surface asks the question of the text it shows: the line asks
 * `isSmallLive` of the live face, the keycap above it `isSmallText` of the
 * ghost face, and the margin marks and the list rows `isSmallChange` of both
 * sides, so a row looks the same whatever its status.
 *
 * One table of names (`whitespaceName`, `characterName`, `sideText`) feeds the
 * suggestions list, the tooltip, the focused suggestion's box, the Unanchored
 * pairs and the aria-label, so a hyphen swapped for a space reads
 * "- (hyphen) -> (space)" everywhere instead of "- -> (nothing)", which
 * described it as a deletion. Words, not symbols such as U+2423 or U+00B6: a
 * new reader does not know them, and the prose font may lack them.
 *
 * Non-ASCII characters are written as \u escapes, so this file survives an
 * encoding round trip (C.18). Pure (CLAUDE.md rule 4).
 */

import type { Hunk } from '../types';

const MARKS = /\p{M}/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * Small text: at most one code point once combining marks are taken out, or at
 * most three with no letter or digit. So "", ",", " ", "i", "--" and "..." are
 * small, and "an", "it" and "----" are not. trim.ts widens every change of a
 * letter to its whole word, so among trimmed changes this is exactly
 * punctuation, whitespace and one-letter words, all under one em wide.
 */
export function isSmallText(text: string): boolean {
  const points = [...text.replace(MARKS, '')];
  if (points.length <= 1) return true;
  return points.length <= 3 && !points.some((p) => LETTER_OR_DIGIT.test(p));
}

/**
 * The text in the line: the replacement once accepted, the original otherwise,
 * as `hunkFaces` in render.ts has it. Repeated here so that render.ts can use
 * this module without the two importing each other.
 */
function liveFace(hunk: Pick<Hunk, 'status' | 'original' | 'replacement'>): string {
  return hunk.status === 'accepted' ? hunk.replacement : hunk.original;
}

/**
 * Whether the line draws a capsule under this suggestion: its live face is
 * small and holds no line break. A box holding a break is split across two
 * lines, so it gets none, as a paragraph join does.
 */
export function isSmallLive(hunk: Pick<Hunk, 'status' | 'original' | 'replacement'>): boolean {
  const live = liveFace(hunk);
  return !LINE_BREAK.test(live) && isSmallText(live);
}

/** Both sides small: a margin bar while pending, and a list row with its context. */
export function isSmallChange(hunk: Pick<Hunk, 'original' | 'replacement'>): boolean {
  return isSmallText(hunk.original) && isSmallText(hunk.replacement);
}

/** Invisible characters by name, singular and plural. */
const BLANK_NAMES: Record<string, readonly [string, string]> = {
  ' ': ['space', 'spaces'],
  '\u00a0': ['no-break space', 'no-break spaces'],
  '\u202f': ['narrow no-break space', 'narrow no-break spaces'],
  '\t': ['tab', 'tabs'],
  '\u2002': ['en space', 'en spaces'],
  '\u2003': ['em space', 'em spaces'],
  '\u2009': ['thin space', 'thin spaces'],
  '\u200a': ['hair space', 'hair spaces'],
  '\u3000': ['wide space', 'wide spaces'],
  '\u200b': ['zero-width space', 'zero-width spaces'],
  '\u200c': ['zero-width non-joiner', 'zero-width non-joiners'],
  '\u200d': ['zero-width joiner', 'zero-width joiners'],
  '\u2060': ['word joiner', 'word joiners'],
  '\ufeff': ['zero-width no-break space', 'zero-width no-break spaces'],
  '\u00ad': ['soft hyphen', 'soft hyphens']
};

/** Any other whitespace, such as a four-per-em space. */
const OTHER_SPACE = ['space', 'spaces'] as const;

function blankName(point: string): readonly [string, string] | null {
  if (Object.hasOwn(BLANK_NAMES, point)) return BLANK_NAMES[point] ?? null;
  return /^\s$/u.test(point) ? OTHER_SPACE : null;
}

/** "a and b", "a, b and c". */
function joinNames(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}

/**
 * The name of text that cannot be seen: "space", "2 spaces", "no-break space",
 * "tab", "line break", "paragraph break". Null when any of it can be seen, and
 * for the empty string, which is "(nothing)" (`sideText`). Text holding line
 * breaks is named by them, whatever spaces come with them: one is a line
 * break, two or more a paragraph break.
 */
export function whitespaceName(text: string): string | null {
  const points = [...text.replace(/\r\n?/g, '\n')];
  if (points.length === 0) return null;
  const isBreak = (p: string): boolean => p === '\n' || p === '\u2028' || p === '\u2029';
  if (!points.every((p) => isBreak(p) || blankName(p) !== null)) return null;
  const breaks = points.filter(isBreak);
  if (breaks.length > 1 || breaks.includes('\u2029')) return 'paragraph break';
  if (breaks.length === 1) return 'line break';
  const names = points.map((p) => blankName(p) ?? OTHER_SPACE);
  const first = names[0] ?? OTHER_SPACE;
  if (points.every((p) => p === points[0])) {
    return points.length === 1 ? first[0] : `${points.length} ${first[1]}`;
  }
  return points.length <= 3 ? joinNames(names.map((n) => n[0])) : `${points.length} spaces`;
}

/** Visible characters that are easy to mistake for one another, by name. */
const CHARACTER_NAMES: Record<string, readonly [string, string]> = {
  '-': ['hyphen', 'hyphens'],
  '\u2010': ['hyphen', 'hyphens'],
  '\u2011': ['non-breaking hyphen', 'non-breaking hyphens'],
  '\u2012': ['figure dash', 'figure dashes'],
  '\u2013': ['en dash', 'en dashes'],
  '\u2014': ['em dash', 'em dashes'],
  '\u2015': ['horizontal bar', 'horizontal bars'],
  '\u2212': ['minus sign', 'minus signs'],
  ',': ['comma', 'commas'],
  '.': ['full stop', 'full stops'],
  ';': ['semicolon', 'semicolons'],
  ':': ['colon', 'colons'],
  '!': ['exclamation mark', 'exclamation marks'],
  '?': ['question mark', 'question marks'],
  "'": ['straight apostrophe', 'straight apostrophes'],
  '\u2019': ['curly apostrophe', 'curly apostrophes'],
  '\u2018': ['opening single quote', 'opening single quotes'],
  '"': ['straight double quote', 'straight double quotes'],
  '\u201c': ['opening double quote', 'opening double quotes'],
  '\u201d': ['closing double quote', 'closing double quotes'],
  '\u00ab': ['opening guillemet', 'opening guillemets'],
  '\u00bb': ['closing guillemet', 'closing guillemets'],
  '\u2026': ['ellipsis', 'ellipses'],
  '(': ['opening bracket', 'opening brackets'],
  ')': ['closing bracket', 'closing brackets'],
  '[': ['opening square bracket', 'opening square brackets'],
  ']': ['closing square bracket', 'closing square brackets'],
  '{': ['opening brace', 'opening braces'],
  '}': ['closing brace', 'closing braces'],
  '/': ['slash', 'slashes'],
  '\\': ['backslash', 'backslashes'],
  '*': ['asterisk', 'asterisks'],
  _: ['underscore', 'underscores'],
  '&': ['ampersand', 'ampersands'],
  '#': ['hash', 'hashes'],
  '|': ['vertical bar', 'vertical bars'],
  '~': ['tilde', 'tildes'],
  '`': ['backtick', 'backticks'],
  '\u00b7': ['middle dot', 'middle dots'],
  '\u2022': ['bullet', 'bullets']
};

const COUNT_WORDS = ['', 'one', 'two', 'three'];

/** One character's name, visible or not, or null for a letter, a digit and the rest. */
function nameOf(point: string): readonly [string, string] | null {
  if (Object.hasOwn(CHARACTER_NAMES, point)) return CHARACTER_NAMES[point] ?? null;
  if (point === '\n') return ['line break', 'line breaks'];
  return blankName(point);
}

/**
 * The name of small punctuation: "hyphen", "comma", "two hyphens", "comma and
 * closing double quote". Null for text that is not small, for any text with a
 * character the table does not name (a letter, say), and for text that cannot
 * be seen, which `whitespaceName` names.
 */
export function characterName(text: string): string | null {
  if (text.length === 0 || !isSmallText(text) || whitespaceName(text) !== null) return null;
  const points = [...text];
  const names = points.map(nameOf);
  if (names.some((n) => n === null)) return null;
  const first = names[0];
  if (!first) return null;
  if (points.every((p) => p === points[0])) {
    return points.length === 1 ? first[0] : `${COUNT_WORDS[points.length] ?? points.length} ${first[1]}`;
  }
  return joinNames(names.map((n) => n?.[0] ?? ''));
}

/**
 * One side of a change as the page writes it: "(nothing)" for the empty
 * string only, "(space)" or "(paragraph break)" for text that cannot be seen,
 * "- (hyphen)" for small punctuation, and any other text as it is.
 */
export function sideText(text: string): string {
  if (text.length === 0) return '(nothing)';
  const blank = whitespaceName(text);
  if (blank) return `(${blank})`;
  const name = characterName(text);
  return name ? `${text} (${name})` : text;
}

/** A change in a list row, with a few words of the line on either side. */
export interface ChangeInContext {
  /** the words before the change, from the start of its line, with an ellipsis in front when cut */
  before: string;
  /** what the change takes out, as `sideText` writes it; null when it takes nothing out */
  original: string | null;
  /** what it puts in, as `sideText` writes it; null for a deletion */
  replacement: string | null;
  /** the words after it, to the end of its line, with an ellipsis after them when cut */
  after: string;
}

/**
 * The words before `end`, at most `words` of them and `maxChars` characters,
 * never across a line break, with the whitespace that touches the cut kept.
 */
function wordsBefore(text: string, words: number, maxChars: number): string {
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  let taken = '';
  let count = 0;
  while (tokens.length > 0) {
    const token = tokens[tokens.length - 1] ?? '';
    const isSpace = /^\s+$/.test(token);
    if (!isSpace && (count === words || (count > 0 && taken.length + token.length > maxChars))) break;
    tokens.pop();
    taken = token + taken;
    if (!isSpace) count += 1;
  }
  if (taken.length > maxChars) return `\u2026${taken.slice(taken.length - maxChars + 1)}`;
  return tokens.some((t) => t.trim().length > 0) ? `\u2026${taken.trimStart()}` : taken;
}

function wordsAfter(text: string, words: number, maxChars: number): string {
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  let taken = '';
  let count = 0;
  while (tokens.length > 0) {
    const token = tokens[0] ?? '';
    const isSpace = /^\s+$/.test(token);
    if (!isSpace && (count === words || (count > 0 && taken.length + token.length > maxChars))) break;
    tokens.shift();
    taken += token;
    if (!isSpace) count += 1;
  }
  if (taken.length > maxChars) return `${taken.slice(0, maxChars - 1)}\u2026`;
  return tokens.some((t) => t.trim().length > 0) ? `${taken.trimEnd()}\u2026` : taken;
}

/**
 * A few words on either side of a change, from the review's base text, for
 * the list row of a small change: "...with Mira [-> , (comma)] who had...", two
 * words a side and at most 14 characters, as the row is narrow.
 * The context is the base outside the change's span, so it reads right
 * whichever side the base holds, and it never crosses a line break.
 */
export function changeInContext(
  base: string,
  hunk: Pick<Hunk, 'start' | 'end' | 'original' | 'replacement'>,
  { before = 2, after = 2, maxChars = 14 }: { before?: number; after?: number; maxChars?: number } = {}
): ChangeInContext {
  const lineStart = base.lastIndexOf('\n', hunk.start - 1) + 1;
  const nextBreak = base.indexOf('\n', hunk.end);
  const lineEnd = nextBreak < 0 ? base.length : nextBreak;
  return {
    before: hunk.start > lineStart ? wordsBefore(base.slice(lineStart, hunk.start), before, maxChars) : '',
    original: hunk.original.length > 0 ? sideText(hunk.original) : null,
    replacement: hunk.replacement.length > 0 ? sideText(hunk.replacement) : null,
    after: lineEnd > hunk.end ? wordsAfter(base.slice(hunk.end, lineEnd), after, maxChars) : ''
  };
}
