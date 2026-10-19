/**
 * The guard on a model's suggestions (`files.7`, PLAN 11.3 k).
 *
 * The prompt asks the model to leave Obsidian syntax alone (`files.8`), but a
 * suggestion may still reach into it: the target of an internal link, a tag,
 * a callout's marker, a block ID. Accepted and saved, such a change breaks
 * the link or the tag in the vault. So each of a model's suggestions is
 * screened before it reaches the page, and one that would change syntax is
 * kept out of the text: it becomes `stale` at offset 0 with `keptOut` saying
 * why, and the side panel lists it under Unanchored with `keptOutNote`, where
 * the author can still read it and make the change by hand. Compose, Save
 * and the rest never see it, as for any other unanchored suggestion.
 *
 * Only a model's own suggestion, untouched and undecided, is screened
 * (`isGuarded`). The author's edits, a suggestion the author rewrote, one
 * already decided and the hunks of a manual review are the author's to make.
 *
 * Two steps. `screenModelHunks` takes each suggestion alone, before overlaps
 * are resolved (`AnchorOptions.screen`), so one kept out never pushes a good
 * one off the page as an overlap; the first rule it fails names the reason.
 * The touching rule (`touchingRule`) runs within the overlap pass
 * (`AnchorOptions.touching`), for the same reason: a suggestion that starts
 * exactly where the one before it on the line ends could make syntax
 * together with it, such as two halves of a web address, so it is kept out
 * as `combined`. Both run when a review is made (`createAiReview`), and both
 * again when one is loaded (`guardLoadedReview`, where `guardTouching` applies
 * the touching rule to hunks that no longer overlap), so a review saved
 * before the guard is screened when it opens. A suggestion kept out stays
 * out: neither step looks at it again.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { isAuthored } from '../edit';
import type { TouchingRule } from './anchor';
import {
  SYNTAX_LABELS,
  bodyStart,
  hasMarkupChar,
  syntaxSignature,
  syntaxSpans,
  type SyntaxKind,
  type SyntaxOptions,
  type SyntaxSpan
} from '../text/obsidian';
import { bodyParagraphs, countParagraphs, splitParagraphs, type Paragraph } from '../text/paragraphs';
import type { Hunk, KeptOutReason } from '../types';

/**
 * Each reason in words, for the note: an Obsidian name for the kind of
 * syntax (`SYNTAX_LABELS`), or what the suggestion would change otherwise.
 */
export const KEPT_OUT_LABELS: Readonly<Record<KeptOutReason, string>> = {
  ...SYNTAX_LABELS,
  'paragraph-break': 'a paragraph break',
  markup: 'a markup character',
  combined: 'together with the suggestion before it'
};

/**
 * What the side panel says under a suggestion kept out of the text (11.3 k):
 * "Kept out of the text: it would change Obsidian syntax (an internal link).
 * Make this change in Obsidian or with the paragraph pen if you want it."
 * A reason this version does not know, from a review file written by a later
 * one, gets the same note without its label.
 */
export function keptOutNote(reason: KeptOutReason): string {
  const label = (KEPT_OUT_LABELS as Partial<Record<string, string>>)[reason];
  const what = label === undefined ? '' : ` (${label})`;
  return `Kept out of the text: it would change Obsidian syntax${what}. Make this change in Obsidian or with the paragraph pen if you want it.`;
}

/**
 * Whether the guard screens this hunk: a model's suggestion (`source
 * 'claude'`, which both providers use) in the model's own words, still
 * pending, its original in the text, on the page, and not kept out already.
 */
export function isGuarded(hunk: Hunk): boolean {
  return (
    hunk.source === 'claude' &&
    !isAuthored(hunk) &&
    hunk.status === 'pending' &&
    hunk.baseSide === 'original' &&
    hunk.anchor !== 'stale' &&
    hunk.keptOut === undefined
  );
}

/** A hunk taken off the page by the guard: unanchored at offset 0, with the reason. */
function keepOut(hunk: Hunk, reason: KeptOutReason): Hunk {
  return { ...hunk, anchor: 'stale', start: 0, end: 0, keptOut: reason };
}

/** A body paragraph read alone, as the guard reads one (C.72). */
const ALONE: SyntaxOptions = { frontmatter: false };

/**
 * The text of a span that is a code fence or an HTML comment nothing closes:
 * left unclosed, either is only its opening run or marker (C.72), which no
 * closed one is, and inline code is never a bare run. These two are the
 * openers a later line can close while reading as nothing new alone: a fence
 * line reads alone as an opener whether or not it could close one, as
 * `~~~ The end` and `~~~` both do, and `-->` alone is no syntax at all. An
 * unclosed `%%` or `$$` is closed only by another, which reads alone as an
 * opener, so the paragraph's own signature changes.
 */
const UNCLOSED = /^(?:`{3,}|~{3,}|<!--)$/;

/** A line that could close one of those: a fence line, or one holding `-->`. */
const CLOSER = /^ {0,3}(?:`{3,}|~{3,})|-->/;

/** What the screen needs of the chapter, read once for all its suggestions. */
interface Chapter {
  text: string;
  /** where the body starts (`bodyStart`): every offset before it is frontmatter */
  body: number;
  paragraphs: Paragraph[];
  /** the chapter's spans, read as a whole note: the overlap rule and `readsWider` use these */
  spans: SyntaxSpan[];
  /** where the first code fence or HTML comment the chapter leaves unclosed starts, or Infinity */
  unclosed: number;
  /** each paragraph's signature read alone, by its start, as it is first needed */
  signatures: Map<number, string>;
  /** the chapter's own signature, read whole, once a suggestion needs it */
  signature?: string;
}

function readChapter(text: string): Chapter {
  const spans = syntaxSpans(text);
  const unclosed = spans.find((s) => UNCLOSED.test(text.slice(s.start, s.end)));
  return {
    text,
    body: bodyStart(text),
    paragraphs: bodyParagraphs(splitParagraphs(text)),
    spans,
    unclosed: unclosed?.start ?? Infinity,
    signatures: new Map()
  };
}

/**
 * Whether the chapter reads a suggestion's paragraph in a wider context than
 * the paragraph alone shows: a span of the chapter runs into it or out of it
 * across a blank line, such as a code fence holding one; or a code fence or
 * HTML comment the chapter leaves unclosed comes before it, and the line the
 * suggestion is on (`line`, as it would read once made) could close it.
 * Otherwise the paragraph read alone finds just what the chapter finds in it
 * (C.72), before the suggestion and after, and the paragraph's own signature
 * is enough.
 */
function readsWider(chapter: Chapter, paragraph: Paragraph, line: string): boolean {
  const crossed = chapter.spans.some(
    (s) =>
      (s.start < paragraph.start && paragraph.start < s.end) ||
      (s.start < paragraph.end && paragraph.end < s.end)
  );
  return crossed || (chapter.unclosed < paragraph.start && CLOSER.test(line));
}

/** The line of `text` that holds `from` to `to`, which hold no line break. */
function lineAround(text: string, from: number, to: number): string {
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const end = text.indexOf('\n', to);
  return text.slice(start, end < 0 ? text.length : end);
}

/**
 * Whether the hunk reaches into a span: shares a character with it, or, for
 * a hunk that holds none, an insertion, sits strictly inside it. An insertion
 * at either edge of a span is left to the signature rule, which tells
 * `[[Mill]]s` (the link as it was) from `x#draft` (no tag any more).
 */
function reaches(span: SyntaxSpan, hunk: Hunk): boolean {
  return hunk.start === hunk.end
    ? span.start < hunk.start && hunk.start < span.end
    : span.start < hunk.end && hunk.start < span.end;
}

/**
 * The first rule of 11.3 (k) a guarded hunk fails, as its reason, or null
 * when it may stay on the page. In order: it starts before the body
 * (`frontmatter`); it does not lie inside one body paragraph
 * (`paragraph-break`); it reaches into a span of the chapter (that span's
 * kind); its original or its replacement holds a character of
 * `MARKUP_CHARS` (`markup`); applied alone, it changes its paragraph's
 * syntax, read alone with `{ frontmatter: false }` (the kind of what
 * changed), or its paragraph count (`paragraph-break`); or, in a paragraph
 * the chapter reads in a wider context (`readsWider`), it changes the
 * chapter's syntax read whole (the kind of what changed), as `.` after the
 * closing fence of a code block that holds a blank line would: the fence
 * would no longer close.
 */
function failedRule(chapter: Chapter, hunk: Hunk): KeptOutReason | null {
  if (hunk.start < chapter.body) return 'frontmatter';
  const paragraph = chapter.paragraphs.find((p) => p.start <= hunk.start && hunk.end <= p.end);
  if (!paragraph) return 'paragraph-break';
  const span = chapter.spans.find((s) => reaches(s, hunk));
  if (span) return span.kind;
  if (hasMarkupChar(hunk.original) || hasMarkupChar(hunk.replacement)) return 'markup';

  const before = paragraph.text;
  const after =
    before.slice(0, hunk.start - paragraph.start) +
    hunk.replacement +
    before.slice(hunk.end - paragraph.start);
  let signature = chapter.signatures.get(paragraph.start);
  if (signature === undefined) {
    signature = syntaxSignature(before, ALONE);
    chapter.signatures.set(paragraph.start, signature);
  }
  if (syntaxSignature(after, ALONE) !== signature) return changedKind(before, after, ALONE);
  if (countParagraphs(after) !== countParagraphs(before)) return 'paragraph-break';

  const at = hunk.start - paragraph.start;
  const line = lineAround(after, at, at + hunk.replacement.length);
  if (!readsWider(chapter, paragraph, line)) return null;
  const { text } = chapter;
  const changed = text.slice(0, hunk.start) + hunk.replacement + text.slice(hunk.end);
  chapter.signature ??= syntaxSignature(text);
  return syntaxSignature(changed) === chapter.signature ? null : changedKind(text, changed, {});
}

/**
 * The kind of syntax that differs between a text and the same text with a
 * suggestion applied, both read with `options`: a paragraph alone, or the
 * chapter whole. Past the spans the two share at the start and at the end,
 * the first span of the text as it was, or, where the suggestion only adds
 * syntax, the first one it adds. `markup` only when nothing differs, which
 * the caller has ruled out.
 */
function changedKind(before: string, after: string, options: SyntaxOptions): SyntaxKind | 'markup' {
  const was = syntaxSpans(before, options).map((s) => ({ kind: s.kind, text: before.slice(s.start, s.end) }));
  const now = syntaxSpans(after, options).map((s) => ({ kind: s.kind, text: after.slice(s.start, s.end) }));
  const same = (i: number, j: number): boolean =>
    was[i]?.kind === now[j]?.kind && was[i]?.text === now[j]?.text;
  let head = 0;
  while (head < was.length && head < now.length && same(head, head)) head += 1;
  let tail = 0;
  while (
    tail < was.length - head &&
    tail < now.length - head &&
    same(was.length - 1 - tail, now.length - 1 - tail)
  ) {
    tail += 1;
  }
  const changed = head < was.length - tail ? was[head] : now[head];
  return changed?.kind ?? 'markup';
}

/**
 * Screens a model's suggestions one by one against the chapter they are
 * anchored in (`text`, LF-normalised), and keeps out each guarded one that
 * fails a rule (`failedRule`): `anchor 'stale'`, `start = end = 0`,
 * `keptOut` set to the reason, everything else as it was. Every other hunk,
 * and every guarded one that passes, comes back as the same object, so
 * screening again changes nothing. Runs before `resolveOverlaps`
 * (`AnchorOptions.screen`): overlapping hunks are each screened alone.
 */
export function screenModelHunks(text: string, hunks: readonly Hunk[]): Hunk[] {
  let chapter: Chapter | null = null;
  return hunks.map((hunk) => {
    if (!isGuarded(hunk)) return hunk;
    chapter ??= readChapter(text);
    const reason = failedRule(chapter, hunk);
    return reason === null ? hunk : keepOut(hunk, reason);
  });
}

/**
 * The touching rule of 11.3 (k) for the chapter `text`: a guarded hunk that
 * starts exactly where the hunk on the page before it ends, on its line,
 * comes back kept out as `combined`, since two suggestions that each keep the
 * syntax alone could make some together, as `http` and `s://` would; any
 * other comes back as null and stays. The one before it is any hunk on the
 * page, the author's own included. `createAiReview` hands it to the overlap
 * pass (`AnchorOptions.touching`), so a hunk it keeps out is off the page
 * before the hunks after it are measured, and pushes none of them off as an
 * overlap (the `files.7` review).
 */
export function touchingRule(text: string): TouchingRule {
  return (hunk, previous) =>
    hunk.start === previous.end && endsOnLine(text, previous) && isGuarded(hunk)
      ? keepOut(hunk, 'combined')
      : null;
}

/**
 * The touching rule (`touchingRule`) over hunks that do not overlap, such as
 * a loaded review's: of the hunks on the page, in order of position, each is
 * put to the rule against the one before it that stayed; a hunk kept out is
 * no longer on the page, so the next one is measured against the one before
 * it. Hunks keep their order, and the same objects come back for those it
 * leaves, so running it again changes nothing.
 */
export function guardTouching(text: string, hunks: readonly Hunk[]): Hunk[] {
  const rule = touchingRule(text);
  const onPage = hunks
    .map((hunk, index) => ({ hunk, index }))
    .filter(({ hunk }) => hunk.anchor !== 'stale')
    .sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end || a.index - b.index);
  const out = [...hunks];
  let previous: Hunk | null = null;
  for (const { hunk, index } of onPage) {
    const off = previous ? rule(hunk, previous) : null;
    if (off) {
      out[index] = off;
      continue;
    }
    previous = hunk;
  }
  return out;
}

/**
 * Whether a hunk ends on the line of the place just after it, as it does
 * unless the text it covers ends with a line break: the hunk after it then
 * starts a line of its own, and the two do not touch on one line.
 */
function endsOnLine(text: string, hunk: Hunk): boolean {
  return hunk.end === hunk.start || text.charAt(hunk.end - 1) !== '\n';
}
