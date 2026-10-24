/**
 * Author edits, expressed as hunks.
 *
 * The app can only write a manuscript file through the Save action, and Save
 * composes `base.text` plus hunk decisions (CLAUDE.md rules 1 and 5). So an edit
 * the author types by hand cannot be a direct write into the text: it becomes a
 * hunk like any other, which keeps it reversible, re-anchorable and visible in
 * every list.
 *
 * The author edits a whole paragraph at a time (Phase 5d). The paragraph's text
 * as the page shows it goes into a text box; when the author is done, the words
 * they changed are found by a word diff and each changed run becomes one manual
 * hunk. A run that touches a suggestion takes that suggestion whole and
 * supersedes it, because half a suggestion cannot be edited without breaking the
 * no-overlap invariant. Full edit (rr.2) is the whole chapter in one box, its
 * paragraphs aligned with the page's first, as the full-text diff aligns them,
 * and then planned by the same rules (`planChapterEdit`).
 *
 * Everything here is pure (CLAUDE.md rule 4).
 */

import { diffArrays, diffWordsWithSpace } from 'diff';
import { activeHunks, composeText, decidedText, desiredSide } from './diff/compose';
import { trimCommonAffixes } from './diff/trim';
import { nextId } from './ids';
import { buildRenderBlocks } from './render';
import {
  bodyParagraphs,
  bodyPieces,
  paragraphIndexAt,
  splitParagraphs,
  type BodyPiece,
  type Paragraph
} from './text/paragraphs';
import type { Hunk } from './types';

export interface Span {
  /** inclusive char offset into review.base.text */
  start: number;
  /** exclusive */
  end: number;
}

/* ------------------------------------------------------------------ */
/* What a span reads as on the page                                    */
/* ------------------------------------------------------------------ */

/**
 * One stretch of the page. A plain run is base text shown as it is; a hunk run
 * shows whichever side of the hunk its decision asks for. `ls`/`le` are offsets
 * into the page text, `bs`/`be` into `base.text`.
 */
export interface LiveRun {
  ls: number;
  le: number;
  bs: number;
  be: number;
  hunk: Hunk | null;
}

export interface LiveLayout {
  /** the span as the chapter would read it right now */
  text: string;
  runs: LiveRun[];
}

/**
 * Lay a span of the base text out the way the page shows it: base text with the
 * decisions of every anchored hunk inside the span applied. Hunks that cross the
 * span's edges are left out; callers pass whole render blocks, which never cut a
 * hunk in two.
 */
export function liveLayout(base: string, hunks: readonly Hunk[], span: Span): LiveLayout {
  const runs: LiveRun[] = [];
  let text = '';
  let cursor = span.start;

  const plain = (to: number): void => {
    if (to <= cursor) return;
    const piece = base.slice(cursor, to);
    runs.push({ ls: text.length, le: text.length + piece.length, bs: cursor, be: to, hunk: null });
    text += piece;
  };

  for (const hunk of activeHunks(hunks)) {
    if (hunk.start < span.start || hunk.end > span.end || hunk.start < cursor) continue;
    plain(hunk.start);
    const shown = decidedText(base, hunk);
    runs.push({ ls: text.length, le: text.length + shown.length, bs: hunk.start, be: hunk.end, hunk });
    text += shown;
    cursor = hunk.end;
  }
  plain(span.end);

  return { text, runs };
}

/** The text of a span as the chapter reads right now. */
export function liveTextIn(base: string, hunks: readonly Hunk[], span: Span): string {
  return liveLayout(base, hunks, span).text;
}

/* ------------------------------------------------------------------ */
/* The span a paragraph edit covers                                    */
/* ------------------------------------------------------------------ */

export interface BlockSpan extends Span {
  /** every paragraph index inside the span, first one first */
  paragraphs: number[];
}

/**
 * The span the editor opens on for one paragraph. Usually that is the paragraph
 * itself. When a hunk straddles the blank line between two paragraphs, which is
 * how a whole-paragraph deletion is stored, the page shows them as one block, and
 * the editor takes the whole block so it never cuts that hunk in two.
 */
export function blockSpanFor(
  base: string,
  paragraphs: readonly Paragraph[],
  hunks: readonly Hunk[],
  paragraph: number
): BlockSpan | null {
  const block = buildRenderBlocks(base, paragraphs, hunks).find(
    (b) => !b.isFrontmatter && b.paragraphs.includes(paragraph)
  );
  if (!block) return null;
  return { start: block.start, end: block.end, paragraphs: block.paragraphs };
}

/* ------------------------------------------------------------------ */
/* Superseding                                                         */
/* ------------------------------------------------------------------ */

/** Prefix kept in front of a superseded suggestion's own reasoning. */
export const SUPERSEDE_PREFIX = 'Superseded by your edit: ';

/** The reason recorded on a hunk the author wrote from scratch. */
export const MANUAL_REASON = 'Edited by author';

/**
 * A suggestion the author's own edit has swallowed. It is dismissed and
 * unanchored, so it leaves the page, and `supersededBy` stops a later rebase
 * from re-anchoring it on top of the edit that replaced it. Its reasoning is
 * kept intact behind the prefix, because the author may still want to read what
 * the suggestion said.
 */
export function supersedeHunk(hunk: Hunk, byId: string): Hunk {
  const reason = hunk.reason ?? `${hunk.original || '(nothing)'} → ${hunk.replacement || '(nothing)'}`;
  return {
    ...hunk,
    status: 'dismissed',
    anchor: 'stale',
    supersededBy: byId,
    reason: reason.startsWith(SUPERSEDE_PREFIX) ? reason : `${SUPERSEDE_PREFIX}${reason}`
  };
}

/* ------------------------------------------------------------------ */
/* Planning a paragraph edit                                           */
/* ------------------------------------------------------------------ */

/**
 * Tidy what came out of the text box. A paragraph never starts or ends with a
 * line break (the blank line after it belongs to the separator), so newlines the
 * author left at either end are dropped rather than turned into empty
 * paragraphs. Spaces are kept: they may be deliberate indentation.
 */
export function normalizeDraft(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '');
}

export interface BlockEditArgs {
  base: string;
  paragraphs: readonly Paragraph[];
  hunks: readonly Hunk[];
  /** the block being edited, from blockSpanFor */
  span: Span;
  /** what the text box holds */
  text: string;
  /** test seam: ids for the new hunks, used in order */
  ids?: string[];
}

export interface BlockEditPlan {
  kind: 'edit';
  /** new manual hunks, accepted */
  added: Hunk[];
  /** model suggestions the edit swallowed, now superseded */
  superseded: Hunk[];
  /**
   * Suggestions the author's typing decided without any new hunk: accepted when
   * they typed exactly what the suggestion offered, turned down when they typed
   * the file's own words back.
   */
  decided: Hunk[];
  /** the author's own earlier edits the new ones replace, by id */
  removed: string[];
  /** for each removed id, the new hunk that took its place */
  replacedBy: Record<string, string>;
}

export type BlockEditResult = { kind: 'noop' } | BlockEditPlan;

interface Region {
  ls: number;
  le: number;
}

interface EqualRun {
  ls: number;
  le: number;
  es: number;
}

/** Closed-interval contact: overlapping, adjacent, or a zero-width run at an edge. */
function touches(region: Region, run: LiveRun): boolean {
  return run.ls <= region.le && run.le >= region.ls;
}

/**
 * The changed stretches of the page, found by a word diff. Each region is a run
 * of removed and added tokens between two unchanged ones, in page coordinates.
 * The unchanged runs are kept too, because they are what maps a page offset to
 * the matching offset in the author's text.
 */
function diffRegions(live: string, edited: string): { regions: Region[]; equal: EqualRun[] } {
  const regions: Region[] = [];
  const equal: EqualRun[] = [];
  let lp = 0;
  let ep = 0;
  let current: Region | null = null;

  for (const part of diffWordsWithSpace(live, edited)) {
    const length = part.value.length;
    if (!part.added && !part.removed) {
      if (current) regions.push(current);
      current = null;
      equal.push({ ls: lp, le: lp + length, es: ep });
      lp += length;
      ep += length;
    } else if (part.removed) {
      current ??= { ls: lp, le: lp };
      lp += length;
      current.le = lp;
    } else {
      current ??= { ls: lp, le: lp };
      ep += length;
    }
  }
  if (current) regions.push(current);
  return { regions: joinAcrossWhitespace(regions, live), equal };
}

/**
 * A word diff happily matches a lone space in the middle of a rewritten phrase,
 * which splits "Tilting" -> "He tilted" into "Tilting" -> "He" plus an inserted
 * "tilted". Regions with nothing but whitespace between them are one change as
 * far as the author is concerned, so they become one hunk, as the full-text
 * diff already does (plan 4.4).
 */
function joinAcrossWhitespace(regions: readonly Region[], live: string): Region[] {
  const joined: Region[] = [];
  for (const region of regions) {
    const last = joined[joined.length - 1];
    if (last && /^[ \t]*$/.test(live.slice(last.le, region.ls))) last.le = region.le;
    else joined.push({ ...region });
  }
  return joined;
}

/**
 * Grow every region until it takes each suggestion it touches whole, then merge
 * regions that now meet. Growing can bring a further suggestion into reach, so
 * this repeats until nothing moves.
 */
function settleRegions(regions: Region[], runs: readonly LiveRun[]): Region[] {
  const hunkRuns = runs.filter((r) => r.hunk !== null);
  let current = regions.map((r) => ({ ...r }));

  for (;;) {
    let moved = false;
    for (const region of current) {
      for (const run of hunkRuns) {
        if (!touches(region, run)) continue;
        if (run.ls < region.ls) {
          region.ls = run.ls;
          moved = true;
        }
        if (run.le > region.le) {
          region.le = run.le;
          moved = true;
        }
      }
    }

    current.sort((a, b) => a.ls - b.ls || a.le - b.le);
    const merged: Region[] = [];
    for (const region of current) {
      const last = merged[merged.length - 1];
      if (last && region.ls <= last.le) {
        last.le = Math.max(last.le, region.le);
        moved = true;
      } else {
        merged.push({ ...region });
      }
    }
    current = merged;
    if (!moved) return current;
  }
}

/** Page offset to the author's text. `start` picks the leftmost reading, `end` the rightmost. */
function toEdited(
  p: number,
  side: 'start' | 'end',
  equal: readonly EqualRun[],
  live: string,
  edited: string
): number {
  const hits: number[] = [];
  if (p === 0) hits.push(0);
  if (p === live.length) hits.push(edited.length);
  for (const run of equal) {
    if (p >= run.ls && p <= run.le) hits.push(run.es + (p - run.ls));
  }
  if (hits.length === 0) throw new Error(`page offset ${p} is not on an unchanged run`);
  return side === 'start' ? Math.min(...hits) : Math.max(...hits);
}

/**
 * Page offset to base offset, for a region boundary. Only plain runs and the
 * suggestions the region swallowed can sit at a boundary: any other suggestion
 * touching it would have been swallowed too.
 */
function toBase(
  p: number,
  side: 'start' | 'end',
  runs: readonly LiveRun[],
  taken: ReadonlySet<LiveRun>
): number {
  const hits: number[] = [];
  for (const run of runs) {
    if (run.hunk === null) {
      if (p >= run.ls && p <= run.le) hits.push(run.bs + (p - run.ls));
    } else if (taken.has(run)) {
      if (run.ls === p) hits.push(run.bs);
      if (run.le === p) hits.push(run.be);
    }
  }
  if (hits.length === 0) throw new Error(`page offset ${p} does not map to the base text`);
  return side === 'start' ? Math.min(...hits) : Math.max(...hits);
}

function manualHunk(
  id: string,
  span: Span,
  base: string,
  replacement: string,
  paragraphs: readonly Paragraph[]
): Hunk {
  return {
    id,
    start: span.start,
    end: span.end,
    baseSide: 'original',
    original: base.slice(span.start, span.end),
    replacement,
    paragraph: paragraphIndexAt(paragraphs, span.start),
    category: 'other',
    reason: MANUAL_REASON,
    source: 'manual',
    status: 'accepted',
    anchor: 'exact'
  };
}

/**
 * The span that deleting a whole block removes: the block plus one of the blank
 * lines around it, so the chapter is not left with a gap where it was. The
 * separator after is preferred, which is how the full-text diff stores a deleted
 * paragraph (plan 4.4); the last paragraph takes the one before. Frontmatter is
 * never touched, because only body paragraphs are considered.
 */
function deletionSpan(paragraphs: readonly Paragraph[], span: Span): Span {
  const body = bodyParagraphs(paragraphs);
  const after = body.find((p) => p.start >= span.end);
  if (after) return { start: span.start, end: after.start };
  const before = [...body].reverse().find((p) => p.end <= span.start);
  if (before) return { start: before.end, end: span.end };
  return span;
}

/**
 * Narrow a changed region to the words that differ, the way the full-text diff
 * does, without cutting into a suggestion the region swallowed: only the plain
 * text before the first swallowed suggestion and after the last one may be
 * trimmed, because only there does the page match the base character for
 * character.
 */
function trimRegion(
  region: Region,
  taken: readonly LiveRun[],
  live: string,
  replacement: string
): { prefix: number; suffix: number } {
  const first = taken[0];
  const last = taken[taken.length - 1];
  const maxPrefix = first ? first.ls - region.ls : region.le - region.ls;
  const maxSuffix = last ? region.le - last.le : region.le - region.ls;
  const trimmed = trimCommonAffixes(live.slice(region.ls, region.le), replacement);
  return { prefix: Math.min(trimmed.prefix, maxPrefix), suffix: Math.min(trimmed.suffix, maxSuffix) };
}

/**
 * Plan what one paragraph edit does to the hunk list.
 *
 * Every word-level change becomes its own accepted manual hunk, so an edit that
 * fixes two words far apart leaves two small hunks rather than one that owns the
 * whole paragraph. A change that touches a suggestion grows to cover it:
 *
 *   - a model suggestion it swallows is superseded, keeping its reasoning;
 *   - one of the author's own earlier edits is simply replaced, since there is
 *     nothing of the model's to keep;
 *   - if the author typed exactly the fix one suggestion offered, that
 *     suggestion is simply accepted;
 *   - if the author's words put back exactly what the file says, no hunk is
 *     needed at all, and the swallowed suggestions settle on the file's words.
 *
 * Emptying the box deletes the paragraph, together with one blank line beside it.
 */
export function planBlockEdit(args: BlockEditArgs): BlockEditResult {
  const { base, paragraphs, hunks, span } = args;
  const takeId = idTaker(args.ids);
  const edited = normalizeDraft(args.text);
  const layout = liveLayout(base, hunks, span);

  if (edited === layout.text) return { kind: 'noop' };

  if (edited.trim().length === 0) {
    const plan = emptyPlan();
    const gone = deletionSpan(paragraphs, span);
    const id = takeId();
    plan.added.push(manualHunk(id, gone, base, '', paragraphs));
    // Only what sits in the block itself: an insertion at the very end of the
    // neighbouring paragraph touches the separator but belongs to that paragraph.
    swallow(
      plan,
      activeHunks(hunks).filter((h) => h.start >= span.start && h.end <= span.end),
      id
    );
    return plan;
  }

  const { regions, equal } = diffRegions(layout.text, edited);
  return planRegions({ base, paragraphs, layout, edited, regions, equal, takeId });
}

/** Ids for new hunks: the test seam's first, in order, then fresh ones. */
function idTaker(seeded: readonly string[] | undefined): () => string {
  const ids = [...(seeded ?? [])];
  return () => ids.shift() ?? nextId('m');
}

function emptyPlan(): BlockEditPlan {
  return { kind: 'edit', added: [], superseded: [], decided: [], removed: [], replacedBy: {} };
}

/**
 * Settle suggestions an edit took whole. A null superseder means the author
 * typed the file's own words back: each suggestion then shows whichever side
 * the file already holds, its original, usually, but its replacement once a
 * save has written that in.
 */
function swallow(plan: BlockEditPlan, taken: readonly Hunk[], byId: string | null): void {
  for (const hunk of taken) {
    if (hunk.source === 'manual') {
      plan.removed.push(hunk.id);
      if (byId) plan.replacedBy[hunk.id] = byId;
    } else if (byId) {
      plan.superseded.push(supersedeHunk(hunk, byId));
    } else {
      plan.decided.push({ ...hunk, status: hunk.baseSide === 'replacement' ? 'accepted' : 'dismissed' });
    }
  }
}

interface RegionArgs {
  base: string;
  paragraphs: readonly Paragraph[];
  /** the page over the span edited */
  layout: LiveLayout;
  /** what the author's text makes of that span */
  edited: string;
  /** the changed stretches of the page */
  regions: Region[];
  /** the unchanged stretches, which map a page offset to `edited` */
  equal: readonly EqualRun[];
  takeId: () => string;
}

/**
 * The changes an edit makes, from the stretches of the page it changed: each
 * takes whole every suggestion it touches, then becomes the author's own
 * accepted hunk, the acceptance of a suggestion typed exactly, or nothing when
 * the file's own words were typed back (`planBlockEdit`). The paragraph box
 * and Full edit (rr.2) share it.
 */
function planRegions(args: RegionArgs): BlockEditResult {
  const { base, paragraphs, layout, edited, regions, equal, takeId } = args;
  const plan = emptyPlan();
  for (const region of settleRegions(regions, layout.runs)) {
    const takenRuns = layout.runs.filter(
      (run) => run.hunk !== null && run.ls >= region.ls && run.le <= region.le
    );
    const taken = new Set(takenRuns);
    const fullReplacement = edited.slice(
      toEdited(region.ls, 'start', equal, layout.text, edited),
      toEdited(region.le, 'end', equal, layout.text, edited)
    );
    const { prefix, suffix } = trimRegion(region, takenRuns, layout.text, fullReplacement);
    const replacement = fullReplacement.slice(prefix, fullReplacement.length - suffix);
    const baseSpan: Span = {
      start: toBase(region.ls, 'start', layout.runs, taken) + prefix,
      end: toBase(region.le, 'end', layout.runs, taken) - suffix
    };
    const takenHunks = takenRuns.map((run) => run.hunk).filter((h): h is Hunk => h !== null);

    if (replacement === base.slice(baseSpan.start, baseSpan.end)) {
      // The author typed the file's own words back: the suggestions in the way
      // are settled accordingly, and no new hunk is needed to say so.
      swallow(plan, takenHunks, null);
      continue;
    }

    // The author typed exactly the fix a suggestion offered. Accepting it keeps
    // the model's category and reason, where a new hunk would bury them.
    const only = takenHunks.length === 1 ? takenHunks[0] : undefined;
    if (
      only &&
      only.source !== 'manual' &&
      only.start === baseSpan.start &&
      only.end === baseSpan.end &&
      replacement === only.replacement
    ) {
      plan.decided.push({ ...only, status: 'accepted' });
      continue;
    }

    const id = takeId();
    plan.added.push(manualHunk(id, baseSpan, base, replacement, paragraphs));
    swallow(plan, takenHunks, id);
  }

  const changed = plan.added.length + plan.superseded.length + plan.decided.length + plan.removed.length;
  return changed === 0 ? { kind: 'noop' } : plan;
}

/**
 * Fold a planned edit into a hunk list. Superseded and decided suggestions keep
 * their place, the author's replaced edits leave, the new hunks are appended, and
 * any suggestion that pointed at a replaced edit as its superseder now points at
 * the hunk that replaced it, so a rebase still keeps it off the page. Order in
 * the array never matters: everything downstream sorts by offset.
 */
export function applyBlockEdit(hunks: readonly Hunk[], plan: BlockEditPlan): Hunk[] {
  const updated = new Map<string, Hunk>();
  for (const hunk of [...plan.superseded, ...plan.decided]) updated.set(hunk.id, hunk);
  const removed = new Set(plan.removed);

  const kept = hunks
    .filter((h) => !removed.has(h.id))
    .map((h) => {
      const next = updated.get(h.id) ?? h;
      const heir = next.supersededBy ? plan.replacedBy[next.supersededBy] : undefined;
      return heir ? { ...next, supersededBy: heir } : next;
    });
  return [...kept, ...plan.added];
}

/* ------------------------------------------------------------------ */
/* Full edit: the whole chapter in one box (rr.2)                      */
/* ------------------------------------------------------------------ */

/**
 * The chapter as Full edit shows it (rr.2): the text as the page reads it,
 * every decision applied (`composeText`), and where in it the box's words
 * start and end. The box holds the body, from the first paragraph's first
 * character to the last paragraph's last, so the frontmatter, shown above the
 * box and never in it, and the line breaks round the body stay as they are.
 */
export interface ChapterForEdit {
  /** the chapter as the page reads it */
  text: string;
  /** the frontmatter as it reads, or null when the chapter has none */
  frontmatter: string | null;
  /** where the box's words start in `text` */
  start: number;
  /** where they end; in a chapter with no body, `start`, the end of the text, where words typed go */
  end: number;
  /**
   * What goes before the words typed into a chapter with no body: a blank
   * line, unless the text is empty or already ends a line, so they never join
   * the frontmatter's closing line (4.4, `insertionPoint` in wordDiff.ts).
   */
  lead: string;
}

/** Where the box's words are in the chapter's text as the page reads it (`ChapterForEdit`). */
export function chapterBodyOf(text: string): ChapterForEdit {
  const paragraphs = splitParagraphs(text);
  const frontmatter = paragraphs.find((p) => p.isFrontmatter)?.text ?? null;
  const body = bodyParagraphs(paragraphs);
  const first = body[0];
  const last = body[body.length - 1];
  if (!first || !last) {
    const lead = text.length === 0 || text.endsWith('\n') ? '' : '\n\n';
    return { text, frontmatter, start: text.length, end: text.length, lead };
  }
  return { text, frontmatter, start: first.start, end: last.end, lead: '' };
}

/** The chapter as Full edit shows it, from the review's text and decisions. */
export function chapterForEdit(base: string, hunks: readonly Hunk[]): ChapterForEdit {
  return chapterBodyOf(composeText(base, hunks));
}

/** The words Full edit opens on: the chapter's body as the page reads it. */
export function fullEditText(base: string, hunks: readonly Hunk[]): string {
  const chapter = chapterForEdit(base, hunks);
  return chapter.text.slice(chapter.start, chapter.end);
}

/**
 * Tidy what came out of the Full edit box, as `normalizeDraft` does a
 * paragraph's: line breaks at either end dropped, spaces kept. A box holding
 * nothing but spaces is empty, as an emptied paragraph box is.
 */
export function normalizeChapterDraft(text: string): string {
  const typed = normalizeDraft(text);
  return typed.trim().length === 0 ? '' : typed;
}

/** The chapter with the box's words in place of its body: what the page reads once Full edit is applied. */
function withBody(chapter: ChapterForEdit, typed: string): string {
  const lead = typed === '' ? '' : chapter.lead;
  return chapter.text.slice(0, chapter.start) + lead + typed + chapter.text.slice(chapter.end);
}

/**
 * What the page reads once Full edit's box is applied over this review: the
 * frontmatter and the line breaks round the body as they were, and the body
 * exactly as typed (`normalizeChapterDraft`). `planChapterEdit`'s plan always
 * composes to this; the store checks it does before it applies one.
 */
export function fullEditResult(base: string, hunks: readonly Hunk[], text: string): string {
  return withBody(chapterForEdit(base, hunks), normalizeChapterDraft(text));
}

export interface ChapterEditArgs {
  base: string;
  hunks: readonly Hunk[];
  /** what the Full edit box holds */
  text: string;
  /** test seam: ids for the new hunks, used in order */
  ids?: string[];
  /** test seam: the edit distance at which a stretch's word diff gives up, `GAP_EDIT_LIMIT` when absent */
  editLimit?: number;
}

/**
 * Plan what Full edit does to the hunk list (rr.2): the whole chapter is one
 * box, applied in one pass by the paragraph box's rules (`planBlockEdit`,
 * PLAN 7.4) on the paragraphs the full-text diff aligns (4.4).
 *
 * The page and the box are read as paragraphs, and paragraphs that read the
 * same on both sides are matched (`diffArrays`), so an edit in one never
 * reaches into the next. Between two matched paragraphs:
 *
 *   - where both sides hold words, the word diff finds each changed run, as in
 *     a box over those paragraphs, a paragraph break added or taken out
 *     among them, or, where they differ by more than `GAP_EDIT_LIMIT` edits,
 *     their paragraphs are paired by position (4.4 step 2);
 *   - paragraphs taken out are deleted with one blank line beside them, the
 *     one after where a paragraph follows and otherwise the one before (4.4);
 *   - paragraphs put in go after the paragraph before them, behind a blank
 *     line, or at the top of the body before the first one, followed by one;
 *   - a change to the blank lines alone replaces them.
 *
 * Of the two places 4.4 allows for a paragraph taken out or put in, the one
 * that touches no suggestion is taken when the other does, so that a
 * suggestion on the neighbouring paragraph's first or last words is not taken
 * with it; only where both touch one is it taken whole, as the paragraph box
 * takes every suggestion its change touches. Each change then becomes the
 * author's own accepted hunk, supersedes a model suggestion it takes, replaces
 * an earlier edit of the author's, accepts a suggestion typed exactly, or
 * settles one whose file words were typed back, all as the paragraph box does.
 * The frontmatter is never in a change. The plan composes to exactly
 * `fullEditResult`.
 */
export function planChapterEdit(args: ChapterEditArgs): BlockEditResult {
  const { base, hunks } = args;
  const layout = liveLayout(base, hunks, { start: 0, end: base.length });
  const chapter = chapterBodyOf(layout.text);
  const typed = normalizeChapterDraft(args.text);
  if (typed === layout.text.slice(chapter.start, chapter.end)) return { kind: 'noop' };

  const edited = withBody(chapter, typed);
  // An empty chapter has no run to map its one place by.
  const runs: LiveRun[] = layout.runs.length > 0 ? layout.runs : [{ ls: 0, le: 0, bs: 0, be: 0, hunk: null }];
  const { regions, equal } = chapterRegions(
    layout.text,
    edited,
    chapter,
    typed,
    runs,
    args.editLimit ?? GAP_EDIT_LIMIT
  );
  return planRegions({
    base,
    paragraphs: splitParagraphs(base),
    layout: { text: layout.text, runs },
    edited,
    regions,
    equal,
    takeId: idTaker(args.ids)
  });
}

/**
 * The edit distance, in words, spaces and marks, at which Full edit's word
 * diff of one stretch of changed paragraphs gives up (C.112): Myers' diff
 * grows with the square of it, and giving up at 1,000 costs about 70 ms on a
 * chapter of 55,000 characters with every word changed, where the whole diff
 * took 34 s. The stretch's paragraphs are then paired by position, as the
 * full-text diff pairs them (4.4 step 2).
 */
const GAP_EDIT_LIMIT = 1000;

/** A paragraph that reads the same on the page and in the box. */
interface KeptPair {
  live: BodyPiece;
  edited: BodyPiece;
}

/** The paragraphs the page and the box share, matched in order (4.4 step 1). */
function keptPairs(live: readonly BodyPiece[], edited: readonly BodyPiece[]): KeptPair[] {
  const pairs: KeptPair[] = [];
  let i = 0;
  let j = 0;
  for (const part of diffArrays(
    live.map((p) => p.text),
    edited.map((p) => p.text)
  )) {
    const n = part.value.length;
    if (part.added) {
      j += n;
    } else if (part.removed) {
      i += n;
    } else {
      for (let k = 0; k < n; k += 1) {
        const l = live[i + k];
        const e = edited[j + k];
        if (l && e) pairs.push({ live: l, edited: e });
      }
      i += n;
      j += n;
    }
  }
  return pairs;
}

/**
 * The changed stretches of the page and the unchanged ones that map it to the
 * chapter Full edit makes (`edited`), found between the paragraphs the two
 * share (`planChapterEdit`). Page offsets are into `live`, the chapter as the
 * page reads it.
 */
function chapterRegions(
  live: string,
  edited: string,
  chapter: ChapterForEdit,
  typed: string,
  runs: readonly LiveRun[],
  editLimit: number
): { regions: Region[]; equal: EqualRun[] } {
  const regions: Region[] = [];
  const equal: EqualRun[] = [];
  const keep = (ls: number, le: number, es: number): void => {
    if (le > ls) equal.push({ ls, le, es });
  };
  const { start, end } = chapter;
  const typedStart = start + (typed === '' ? 0 : chapter.lead.length);
  const typedEnd = typedStart + typed.length;
  keep(0, start, 0);
  keep(end, live.length, typedEnd);

  if (start === end) {
    // No body yet: what was typed goes at the end of the text (4.4).
    regions.push({ ls: start, le: start });
    return { regions, equal };
  }

  const lp = bodyPieces(live, start, end);
  const ep = bodyPieces(edited, typedStart, typedEnd);
  const pairs = keptPairs(lp, ep);

  /** Hunk runs touching page offset `p` from outside a region on `side` of it. */
  const touchedAt = (p: number, side: 'before' | 'after' | 'both'): boolean =>
    runs.some(
      (run) =>
        run.hunk !== null &&
        run.ls <= p &&
        run.le >= p &&
        (side === 'both' || (side === 'before' ? run.le <= p : run.ls >= p))
    );

  /**
   * The word diff of a stretch, as in a box over those paragraphs; false,
   * having added nothing, when the two differ by more than `editLimit`.
   */
  const wordDiff = (la: number, lb: number, ea: number, eb: number): boolean => {
    const parts = diffWordsWithSpace(live.slice(la, lb), edited.slice(ea, eb), {
      maxEditLength: editLimit
    });
    if (!parts) return false;
    const found: Region[] = [];
    let lpos = la;
    let epos = ea;
    let current: Region | null = null;
    for (const part of parts) {
      const n = part.value.length;
      if (!part.added && !part.removed) {
        if (current) found.push(current);
        current = null;
        keep(lpos, lpos + n, epos);
        lpos += n;
        epos += n;
      } else if (part.removed) {
        current ??= { ls: lpos, le: lpos };
        lpos += n;
        current.le = lpos;
      } else {
        current ??= { ls: lpos, le: lpos };
        epos += n;
      }
    }
    if (current) found.push(current);
    regions.push(...joinAcrossWhitespace(found, live));
    return true;
  };

  /**
   * A stretch too changed for one word diff: its paragraphs paired by
   * position, as 4.4 step 2 pairs them, each pair word-diffed, or replaced
   * whole when even that is too much, and those left on one side taken out
   * or put in as any other.
   */
  const byPosition = (
    la: number,
    lb: number,
    ea: number,
    eb: number,
    before: boolean,
    after: boolean
  ): void => {
    const ls = lp.filter((p) => p.start >= la && p.end <= lb);
    const es = ep.filter((p) => p.start >= ea && p.end <= eb);
    let l = la;
    let e = ea;
    for (let i = 0; i < Math.min(ls.length, es.length); i += 1) {
      const r = ls[i];
      const a = es[i];
      if (!r || !a) break;
      gap(l, r.start, e, a.start, before || i > 0, true, false);
      gap(r.start, r.end, a.start, a.end, true, true, false);
      l = r.end;
      e = a.end;
    }
    gap(l, lb, e, eb, true, after, false);
  };

  const gap = (
    la: number,
    lb: number,
    ea: number,
    eb: number,
    before: boolean,
    after: boolean,
    pairing = true
  ): void => {
    const lt = live.slice(la, lb);
    const et = edited.slice(ea, eb);
    if (lt === et) {
      keep(la, lb, ea);
      return;
    }
    const liveWords = /\S/.test(lt);
    const editedWords = /\S/.test(et);

    if (liveWords && editedWords) {
      // Words on both sides: the word diff, as in a box over these paragraphs.
      if (wordDiff(la, lb, ea, eb)) return;
      if (pairing) byPosition(la, lb, ea, eb, before, after);
      else regions.push({ ls: la, le: lb });
      return;
    }

    if (liveWords) {
      // Paragraphs taken out, with one blank line beside them (4.4).
      const inside = lp.filter((p) => p.start >= la && p.end <= lb);
      const first = inside[0]?.start ?? la;
      const last = inside[inside.length - 1]?.end ?? lb;
      const options: { region: Region; kept: Region; outer: number; side: 'before' | 'after' }[] = [];
      if (after && live.slice(la, first) === et) {
        options.push({
          region: { ls: first, le: lb },
          kept: { ls: la, le: first },
          outer: lb,
          side: 'after'
        });
      }
      if (before && live.slice(last, lb) === et) {
        options.push({ region: { ls: la, le: last }, kept: { ls: last, le: lb }, outer: la, side: 'before' });
      }
      const pick = options.find((o) => !touchedAt(o.outer, o.side)) ?? options[0];
      if (pick) {
        keep(pick.kept.ls, pick.kept.le, ea);
        regions.push(pick.region);
      } else {
        regions.push({ ls: la, le: lb });
      }
      return;
    }

    if (editedWords) {
      // Paragraphs put in, behind a blank line or, at the top, followed by one (4.4).
      const inside = ep.filter((p) => p.start >= ea && p.end <= eb);
      const first = inside[0]?.start ?? ea;
      const last = inside[inside.length - 1]?.end ?? eb;
      const options: { at: number; es: number }[] = [];
      if (before && lt === edited.slice(last, eb)) options.push({ at: la, es: last });
      if (after && lt === edited.slice(ea, first)) options.push({ at: lb, es: ea });
      const pick = options.find((o) => !touchedAt(o.at, 'both')) ?? options[0];
      if (pick) {
        keep(la, lb, pick.es);
        regions.push({ ls: pick.at, le: pick.at });
      } else {
        regions.push({ ls: la, le: lb });
      }
      return;
    }

    // Only the blank lines between two paragraphs changed.
    regions.push({ ls: la, le: lb });
  };

  let la = start;
  let ea = typedStart;
  for (let k = 0; k <= pairs.length; k += 1) {
    const pair = pairs[k];
    gap(la, pair ? pair.live.start : end, ea, pair ? pair.edited.start : typedEnd, k > 0, pair !== undefined);
    if (!pair) break;
    keep(pair.live.start, pair.live.end, pair.edited.start);
    la = pair.live.end;
    ea = pair.edited.end;
  }
  regions.sort((a, b) => a.ls - b.ls || a.le - b.le);
  return { regions, equal };
}

/* ------------------------------------------------------------------ */
/* Rewriting a suggestion                                              */
/* ------------------------------------------------------------------ */

/**
 * The author rewrote a suggestion's replacement text (item 3a). Source,
 * category and reason survive, because the suggestion is still the one the
 * model raised; `edited` records that the words are the author's own. "Accept
 * now" accepts it; unticked, an accepted suggestion goes back to pending, so new
 * words are never written without a decision.
 *
 * The new words are always a change against what the chapter file says over the
 * span, `base` (apply.22, PLAN 7.4). Compose copies the base whenever the side a
 * hunk wants is the side the base holds, so a suggestion already saved into the
 * file (`baseSide: 'replacement'`) cannot simply take new replacement words: the
 * page would show them and Save would write the old ones. Instead the saved words
 * become its `original` and the base side, and the new words the change against
 * them. Ticked, Save writes the new words; unticked, the page keeps the saved
 * words and Save writes nothing for it, rather than putting the model's original
 * back. The model's first words are given up: the file no longer holds them,
 * though the backup made before the save that replaced them does.
 *
 * Words that read exactly as the file does change nothing, so both sides become
 * the file's words and the hunk sits on whichever side its decision asks for.
 * Such a hunk never counts as unsaved and compose always copies the base for
 * it (`changesBase`), whatever the author decides on it afterwards: rewriting a
 * saved suggestion and then back to the saved words leaves nothing unsaved, and
 * neither does turning that back or dismissing it. A stale hunk has no place in
 * the base and only takes the new words.
 */
export function editSuggestion(base: string, hunk: Hunk, replacement: string, accept: boolean): Hunk {
  const rewritten: Hunk = {
    ...hunk,
    replacement,
    edited: true,
    status: accept ? 'accepted' : hunk.status === 'accepted' ? 'pending' : hunk.status
  };
  if (hunk.anchor === 'stale') return rewritten;

  const inFile = base.slice(hunk.start, hunk.end);
  if (hunk.baseSide === 'replacement') {
    // Back to the words the file already has: `original` stays, since it is
    // still what turning the saved change back would restore.
    if (replacement === inFile) return rewritten;
    return { ...rewritten, original: inFile, baseSide: 'original' };
  }
  if (replacement === inFile) {
    return { ...rewritten, original: inFile, baseSide: desiredSide(rewritten) };
  }
  return rewritten;
}

/** True when a hunk's words were written by the author rather than a model. */
export function isAuthored(hunk: Pick<Hunk, 'source' | 'edited'>): boolean {
  return hunk.source === 'manual' || hunk.edited === true;
}
