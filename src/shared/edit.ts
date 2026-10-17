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
 * no-overlap invariant.
 *
 * Everything here is pure (CLAUDE.md rule 4).
 */

import { diffWordsWithSpace } from 'diff';
import { activeHunks, desiredSide } from './diff/compose';
import { trimCommonAffixes } from './diff/trim';
import { nextId } from './ids';
import { buildRenderBlocks } from './render';
import { bodyParagraphs, paragraphIndexAt, type Paragraph } from './text/paragraphs';
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
    const want = desiredSide(hunk);
    const shown =
      want === hunk.baseSide
        ? base.slice(hunk.start, hunk.end)
        : want === 'replacement'
          ? hunk.replacement
          : hunk.original;
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
  const ids = [...(args.ids ?? [])];
  const takeId = (): string => ids.shift() ?? nextId('m');
  const edited = normalizeDraft(args.text);
  const layout = liveLayout(base, hunks, span);

  if (edited === layout.text) return { kind: 'noop' };

  const plan: BlockEditPlan = {
    kind: 'edit',
    added: [],
    superseded: [],
    decided: [],
    removed: [],
    replacedBy: {}
  };

  /* A null superseder means the author typed the file's own words back. Each
     suggestion then shows whichever side the file already holds: its original,
     usually, but its replacement once a save has written that in. */
  const swallow = (taken: readonly Hunk[], byId: string | null): void => {
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
  };

  if (edited.trim().length === 0) {
    const gone = deletionSpan(paragraphs, span);
    const id = takeId();
    plan.added.push(manualHunk(id, gone, base, '', paragraphs));
    // Only what sits in the block itself: an insertion at the very end of the
    // neighbouring paragraph touches the separator but belongs to that paragraph.
    swallow(
      activeHunks(hunks).filter((h) => h.start >= span.start && h.end <= span.end),
      id
    );
    return plan;
  }

  const { regions, equal } = diffRegions(layout.text, edited);
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
      swallow(takenHunks, null);
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
    swallow(takenHunks, id);
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
 * the file's words and the hunk sits on whichever side its decision asks for:
 * rewriting a saved suggestion and then back to the saved words leaves nothing
 * unsaved. A stale hunk has no place in the base and only takes the new words.
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
