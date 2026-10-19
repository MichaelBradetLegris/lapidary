import { diffArrays, diffWordsWithSpace } from 'diff';
import { nextId } from '../ids';
import { bodyParagraphs, paragraphIndexAt, splitParagraphs, type Paragraph } from '../text/paragraphs';
import type { Hunk } from '../types';
import { trimCommonAffixes } from './trim';

interface Span {
  start: number;
  end: number;
  original: string;
  replacement: string;
}

/**
 * Full-text diff to hunks (plan section 4.4).
 *
 * Paragraphs are aligned first so that an edit inside one paragraph never drags
 * neighbouring prose into the diff. Inside a changed pair, consecutive changed
 * word tokens collapse into a single hunk, and hunks separated only by
 * whitespace are merged so a reworded phrase reads as one suggestion.
 *
 * All offsets refer to `original`. Frontmatter is never diffed.
 */
export function diffToHunks(original: string, corrected: string): Hunk[] {
  const allParagraphs = splitParagraphs(original);
  const oParas = bodyParagraphs(allParagraphs);
  const cParas = bodyParagraphs(splitParagraphs(corrected));

  const parts = diffArrays(
    oParas.map((p) => p.text),
    cParas.map((p) => p.text)
  );

  const spans: Span[] = [];
  let oi = 0;
  /* The end of the last body paragraph of `original` passed so far, or null
     while the diff is still at the top of the body. */
  let lastOriginalEnd: number | null = null;
  let removed: Paragraph[] = [];
  let added: string[] = [];

  const flush = (): void => {
    if (removed.length === 0 && added.length === 0) return;
    spans.push(...pairBlock(original, removed, added, insertionPoint(original, lastOriginalEnd, oParas[oi])));
    removed = [];
    added = [];
  };

  for (const part of parts) {
    if (part.removed) {
      for (let i = 0; i < part.value.length; i += 1) {
        const p = oParas[oi];
        oi += 1;
        if (!p) continue;
        removed.push(p);
        lastOriginalEnd = p.end;
      }
    } else if (part.added) {
      added.push(...part.value);
    } else {
      flush();
      for (let i = 0; i < part.value.length; i += 1) {
        const p = oParas[oi];
        oi += 1;
        if (p) lastOriginalEnd = p.end;
      }
    }
  }
  flush();

  const hunks: Hunk[] = [];
  for (const span of spans) {
    const trimmed = trimCommonAffixes(span.original, span.replacement);
    if (trimmed.original === trimmed.replacement) continue;
    const start = span.start + trimmed.prefix;
    hunks.push({
      id: nextId('d'),
      start,
      end: span.end - trimmed.suffix,
      baseSide: 'original',
      original: trimmed.original,
      replacement: trimmed.replacement,
      paragraph: paragraphIndexAt(allParagraphs, start),
      source: 'diff',
      status: 'pending',
      anchor: 'exact'
    });
  }

  return hunks.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Where the paragraphs a changed block adds go when it removes none, and the
 * words each is inserted as (`k` counts them from 0).
 */
interface Insertion {
  at: number;
  words: (text: string, k: number) => string;
}

/**
 * The place for paragraphs added with no removed one to follow: after the
 * last body paragraph passed (`lastEnd`), each behind a blank line; at the top
 * of the body, before the first paragraph (`next`), each followed by one
 * (`files.22`); and in a body that has no paragraph at all, at the end of the
 * text, which is never before `bodyStart`, the first behind a blank line
 * unless it starts the text or a line. So no paragraph is ever inserted in the
 * frontmatter or at the line break that closes it, where the page would not
 * show it and the frontmatter could end up on the same line as the body.
 */
function insertionPoint(original: string, lastEnd: number | null, next: Paragraph | undefined): Insertion {
  if (lastEnd !== null) return { at: lastEnd, words: (text) => `\n\n${text}` };
  if (next) return { at: next.start, words: (text) => `${text}\n\n` };
  const opensLine = original.length === 0 || original.endsWith('\n');
  return {
    at: original.length,
    words: (text, k) => (k === 0 && opensLine ? text : `\n\n${text}`)
  };
}

/**
 * Pair the removed and added paragraphs of one changed block by position. Extra
 * removed paragraphs become whole-paragraph deletions; extra added ones become
 * insertions after the last removed one, or at `place` when none was removed.
 */
function pairBlock(
  original: string,
  removed: readonly Paragraph[],
  added: readonly string[],
  place: Insertion
): Span[] {
  const spans: Span[] = [];
  const paired = Math.min(removed.length, added.length);

  for (let i = 0; i < paired; i += 1) {
    const p = removed[i];
    const text = added[i];
    if (!p || text === undefined) continue;
    spans.push(...wordSpans(p.text, p.start, text));
  }

  for (let i = paired; i < removed.length; i += 1) {
    const p = removed[i];
    if (!p) continue;
    // Swallow the blank line after the paragraph so deleting it does not leave a gap, where a paragraph
    // follows it: blank lines that end the text belong to no paragraph, so no block of the page would
    // hold a deletion that took them, and the page could not draw it (files.22).
    const trailing = /^\n(?:[ \t]*\n)+(?=[ \t]*\S)/.exec(original.slice(p.end));
    const end = p.end + (trailing?.[0].length ?? 0);
    spans.push({ start: p.start, end, original: original.slice(p.start, end), replacement: '' });
  }

  const last = removed[removed.length - 1];
  const after: Insertion = last ? { at: last.end, words: (text) => `\n\n${text}` } : place;
  for (let i = paired; i < added.length; i += 1) {
    const text = added[i];
    if (text === undefined) continue;
    spans.push({ start: after.at, end: after.at, original: '', replacement: after.words(text, i - paired) });
  }

  return spans;
}

/** Word-level spans inside one paragraph, in offsets relative to `base`. */
function wordSpans(originalText: string, base: number, correctedText: string): Span[] {
  const parts = diffWordsWithSpace(originalText, correctedText);
  const raw: Span[] = [];
  let offset = 0;
  let run: Span | null = null;

  for (const part of parts) {
    if (part.added === true || part.removed === true) {
      run ??= { start: offset, end: offset, original: '', replacement: '' };
      if (part.removed === true) {
        run.original += part.value;
        offset += part.value.length;
        run.end = offset;
      } else {
        run.replacement += part.value;
      }
      continue;
    }
    if (run) {
      raw.push(run);
      run = null;
    }
    offset += part.value.length;
  }
  if (run) raw.push(run);

  const merged: Span[] = [];
  for (const span of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const gap = originalText.slice(prev.end, span.start);
      if (gap.trim().length === 0) {
        prev.end = span.end;
        prev.original += gap + span.original;
        prev.replacement += gap + span.replacement;
        continue;
      }
    }
    merged.push({ ...span });
  }

  return merged.map((s) => ({ ...s, start: s.start + base, end: s.end + base }));
}
