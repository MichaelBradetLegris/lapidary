/**
 * The three views of a chapter and their words (rr.2, PLAN section 7, The
 * Mode select): Main, the review page as it has always been; Full edit, the
 * whole chapter in one box; Preview, the chapter as Royal Road's reader shows
 * it. A Mode select at the left end of the toolbar picks one (since rr.6; it
 * stood at the top right of the prose column from rr.2). The mode
 * belongs to the window, not to the settings: the window starts in Main, and
 * another chapter or review opens in the mode in use (rr.5).
 *
 * Switching mode with something typed and not applied asks first, as leaving
 * the chapter does (PLAN 11.3 i): from Full edit, Apply first, as its Done
 * does, Discard, or Cancel; from paragraph boxes into Full edit, which holds
 * the whole chapter, Apply first or Cancel; from paragraph boxes into Preview,
 * which leaves them where they are, Keep for later, Apply first or Cancel.
 *
 * Pure (CLAUDE.md rule 4).
 */

import type { ConfirmSpec } from './confirm';
import { NOTHING_UNTIL_SAVE } from './saveHint';

/** Main, Full edit or Preview. */
export type Mode = 'main' | 'edit' | 'preview';

/** The views besides Full edit, which the window shows while Full edit is not open. */
export type ViewMode = Exclude<Mode, 'edit'>;

/** The select's options, in its order. */
export const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'main', label: 'Main' },
  { value: 'edit', label: 'Full edit' },
  { value: 'preview', label: 'Preview' }
];

/** The select's label, which is its accessible name. */
export const MODE_LABEL = 'Mode';

/** Its tooltip, which says what each mode is. */
export const MODE_TITLE =
  'Main reviews the suggestions. Full edit edits the whole chapter in one box. Preview shows the chapter as Royal Road will.';

/** A value the select may hold, or null for anything else. */
export function modeOf(value: string): Mode | null {
  return MODES.some((m) => m.value === value) ? (value as Mode) : null;
}

/**
 * Where each mode was scrolled to in the open chapter (`modePlace`): the
 * three modes draw in the one scroller, so Main and Preview each keep their
 * own place; Full edit, whose box opens afresh each time, starts at the top.
 */
export interface ModePlaces {
  /** the chapter the places are of, by its path */
  chapter: string | null;
  /** the mode on screen */
  mode: Mode;
  /** each mode's scroll offset, in CSS pixels, as it was last left */
  tops: Partial<Record<Mode, number>>;
}

/**
 * The places once `mode` of `chapter` is on screen, and where the scroller
 * goes: back to where the author left Main or Preview, or the top of a mode
 * not shown yet in this chapter; the top of Full edit always, as its box
 * opens afresh, its caret at the start (rr.2 review); null, to leave it where
 * it is, when the mode did not change. Another chapter forgets them all, so a
 * mode never opens at a place in another chapter: since the mode stays across
 * chapters (rr.5), Preview and Full edit start another chapter at its top,
 * and Main, which has always left the scroller to itself there, still does.
 */
export function modePlace(
  places: ModePlaces,
  chapter: string | null,
  mode: Mode
): { places: ModePlaces; top: number | null } {
  const sameChapter = places.chapter === chapter;
  const tops = sameChapter ? places.tops : {};
  const stays = places.mode === mode && (sameChapter || mode === 'main');
  const top = stays ? null : mode === 'edit' ? 0 : (tops[mode] ?? 0);
  return { places: { chapter, mode, tops }, top };
}

/* ------------------------------------------------------------------ */
/* Full edit                                                            */
/* ------------------------------------------------------------------ */

/** Under the Full edit box once something is typed, and before. */
export const FULL_EDIT_HINT = 'Ctrl+Enter applies, Esc cancels';
export const FULL_EDIT_HINT_UNCHANGED = 'Nothing changed yet. Esc closes.';

/** The box's accessible name. */
export function fullEditLabel(chapter: string): string {
  return `Full edit of ${chapter}`;
}

/** The frontmatter's, shown above the box and never in it. */
export const FRONTMATTER_LABEL = 'Frontmatter, which Full edit leaves as it is';

/**
 * The keys in Full edit's text area after which the column may go on to an
 * end of the page (rr.7 review): Ctrl+Home and Ctrl+End (Cmd on a Mac), Page
 * Up and Page Down, with or without Shift, which selects; not with Alt. The
 * text area grows with the text and the column scrolls, so the browser, which
 * brings only the caret's line into view, stopped with the sheet's top margin
 * and edge, and the frontmatter above them, out of sight at the start of the
 * text, and the sheet's foot at its end, where Docs and Writer show the top
 * and the end of the page.
 */
export function fullEditEndKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  if (event.altKey) return false;
  if (event.key === 'PageUp' || event.key === 'PageDown') return true;
  return (event.ctrlKey || event.metaKey) && (event.key === 'Home' || event.key === 'End');
}

/**
 * The end of the page to show once such a key has moved the caret, by where
 * its moving end is (`caret`, of `length` characters): 'top' at the start of
 * the text, 'end' at its end, and null between, where the browser's own
 * scroll stands, as for a page key that stops short of either end.
 */
export function fullEditPageEnd(caret: number, length: number): 'top' | 'end' | null {
  return caret <= 0 ? 'top' : caret >= length ? 'end' : null;
}

/**
 * Where the column goes for the top of the page, in CSS px from the top of
 * what it holds: its top, unless the frontmatter above the sheet would then push the
 * caret's line, the text's first, out of a column only a few lines tall (the
 * smallest window at 200%), when it stops as near the top as keeps that line
 * in view with `room` under it.
 */
export function fullEditTopPlace(firstLineBottom: number, columnHeight: number, room: number): number {
  return Math.max(0, Math.ceil(firstLineBottom + room - columnHeight));
}

/** Ctrl+S from inside the box (PLAN 11.1, Ctrl+S), as `PRESS_DONE_FIRST` is for a paragraph box. */
export const FULL_EDIT_DONE_FIRST =
  'Full edit is still open. Press Done or Ctrl+Enter to apply it, then save.';

/** Review with AI, Submit manual review and the bulk actions, while Full edit is open. */
export const FINISH_FULL_EDIT_FIRST = 'Finish or cancel Full edit first.';

/** The bulk items' tooltip then, which, as the paragraph boxes' does, has no full stop. */
export const FINISH_FULL_EDIT_TITLE = 'Finish or cancel Full edit first';

/** The pencil, or e, on a suggestion while Full edit is open, which freezes them all. */
export const FULL_EDIT_FREEZES = 'Full edit is open. Finish it, or cancel it, to change this suggestion.';

/** A row's tooltip while Full edit is open. */
export const FULL_EDIT_OPEN = 'Full edit is open';

/** A comment's Edit text, or a paragraph's pen, while Full edit is open. */
export const FULL_EDIT_HOLDS_PARAGRAPHS =
  'Full edit is open, and holds every paragraph. Edit the words there, or finish Full edit first.';

/** Why Full edit did not open. */
export const FULL_EDIT_WAIT_FOR_REVIEW = 'Wait for the review to finish, then open Full edit.';
export const FULL_EDIT_WAIT_FOR_SAVE = 'Wait for the save to finish, then open Full edit.';

/**
 * Done when the chapter no longer reads as it did when Full edit opened,
 * because the file changed on disk and the page was reloaded: applying the box
 * would undo that change, so it stays open with the author's text in it, as a
 * paragraph box does.
 */
export const FULL_EDIT_CHANGED =
  'The chapter changed on disk while Full edit was open, so nothing was applied. Your text is still in the box: copy it, press Cancel, then open Full edit again.';

/**
 * Done when the plan did not compose to exactly what was typed. It never
 * should; the store checks every plan before it applies one, and keeps the
 * box rather than change the page to something the author did not type.
 */
export const FULL_EDIT_NOT_EXACT =
  'Full edit could not be applied exactly as typed, so nothing was changed. Your text is still in the box: copy it somewhere safe, then press Cancel.';

/** What a Done added, accepted and superseded, as the paragraph box's card counts them. */
export interface EditCounts {
  added: number;
  accepted: number;
  superseded: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * "3 changes added, already accepted; 1 suggestion accepted, since you typed
 * exactly that", the words of the card a paragraph box's Done shows after
 * "Paragraph 12: ", and Full edit's after "Full edit: ".
 */
export function editSummary(counts: EditCounts): string {
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${plural(counts.added, 'change')} added, already accepted`);
  if (counts.accepted > 0) {
    parts.push(`${plural(counts.accepted, 'suggestion')} accepted, since you typed exactly that`);
  }
  if (counts.superseded > 0) {
    parts.push(`${plural(counts.superseded, 'suggestion')} your edit replaced moved to Unanchored`);
  }
  return parts.length > 0 ? parts.join('; ') : 'suggestions updated';
}

/** The card after Full edit's Done applied something. */
export function fullEditAppliedText(counts: EditCounts): string {
  return `Full edit: ${editSummary(counts)}.`;
}

/**
 * Save to chapter with Full edit's box changed, as it asks "Apply paragraph
 * edits first?" of paragraph boxes (6.3): the box is applied, as Done applies
 * it, before anything is written.
 */
export function applyFullEditBeforeSavePrompt(): ConfirmSpec {
  return {
    title: 'Apply Full edit first?',
    body: 'Full edit is still open. Apply its changes as accepted suggestions, then save the chapter?',
    confirmLabel: 'Apply and save'
  };
}

/** Escape or Cancel in a Full edit whose text changed, as `discardDraftPrompt` asks for a paragraph box. */
export function discardFullEditPrompt(): ConfirmSpec {
  return {
    title: 'Discard your changes in Full edit?',
    body: 'What you typed in Full edit will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    defaultButton: 'cancel'
  };
}

/* ------------------------------------------------------------------ */
/* Switching mode with something typed                                   */
/* ------------------------------------------------------------------ */

const MODE_NAMES: Record<Mode, string> = { main: 'Main', edit: 'Full edit', preview: 'Preview' };

/**
 * Leaving a Full edit whose text changed for Main or Preview. Apply first
 * does what Done does and goes on, and has the focus: what was typed becomes
 * changes of the author's own, which can still be turned back one by one.
 * Discard throws the text away; Cancel stays.
 */
export function leaveFullEditPrompt(target: Mode): ConfirmSpec {
  return {
    title: `Leave Full edit for ${MODE_NAMES[target]}?`,
    body: [
      'What you typed in Full edit is not applied yet.',
      `Apply first makes it changes of your own, already accepted, as Done does. ${NOTHING_UNTIL_SAVE}`
    ].join('\n'),
    confirmLabel: 'Apply first',
    altLabel: 'Discard',
    cancelLabel: 'Cancel',
    defaultButton: 'confirm'
  };
}

/**
 * Another review of the chapter, from History or the review selector, while
 * Full edit holds typed text (rr.5). The mode stays, so the other review
 * opens in Full edit too, but afresh: the box holds the body as this review
 * composes it, and could not go back over another. So it asks as leaving
 * Full edit for another mode does: Apply first, focused, does what Done does
 * in this review, where the changes stay; Discard throws the text away;
 * Cancel stays.
 */
export function fullEditOtherReviewPrompt(): ConfirmSpec {
  return {
    title: 'Open another review in Full edit?',
    body: [
      'What you typed in Full edit is not applied yet. Full edit opens afresh on the other review.',
      `Apply first makes it changes of your own in this review, already accepted, as Done does, and they stay in this review. ${NOTHING_UNTIL_SAVE}`
    ].join('\n'),
    confirmLabel: 'Apply first',
    altLabel: 'Discard',
    cancelLabel: 'Cancel',
    defaultButton: 'confirm'
  };
}

/** "the paragraph you are editing", "the 3 paragraphs you are editing". */
function boxesPhrase(p: number): string {
  return p === 1 ? 'the paragraph you are editing' : `the ${p} paragraphs you are editing`;
}

/**
 * Opening Full edit with `p` paragraph boxes whose text changed. Full edit
 * holds the whole chapter, the boxes' paragraphs among them, so they are
 * applied first, as their Done does, or the switch is cancelled. Boxes left as
 * they opened just close.
 */
export function boxesBeforeFullEditPrompt(p: number): ConfirmSpec {
  return {
    title: `Apply ${boxesPhrase(p)} first?`,
    body: [
      `Full edit holds the whole chapter, so ${boxesPhrase(p)} ${p === 1 ? 'is' : 'are'} applied first, as Done does.`,
      NOTHING_UNTIL_SAVE
    ].join('\n'),
    confirmLabel: 'Apply first',
    cancelLabel: 'Cancel',
    defaultButton: 'confirm'
  };
}

/**
 * Leaving Main for Preview with `p` paragraph boxes whose text changed, as
 * leaving the chapter asks (PLAN 11.3 i): Keep for later, which has the
 * focus, leaves them open in Main as they are, and Preview shows the chapter
 * without them; Apply first applies them, so Preview shows them; Cancel stays.
 */
export function boxesBeforePreviewPrompt(p: number): ConfirmSpec {
  const them = p === 1 ? 'it' : 'them';
  return {
    title: 'Leave Main for Preview?',
    body: [
      `${p === 1 ? 'The paragraph you are editing is' : `The ${p} paragraphs you are editing are`} not applied yet.`,
      `Keep for later leaves ${them} open in Main as you left ${them}, and Preview shows the chapter without ${them}. Apply first applies ${them}, as Done does. ${NOTHING_UNTIL_SAVE}`
    ].join('\n'),
    confirmLabel: 'Apply first',
    altLabel: 'Keep for later',
    cancelLabel: 'Cancel',
    defaultButton: 'alt'
  };
}

/* ------------------------------------------------------------------ */
/* Preview                                                              */
/* ------------------------------------------------------------------ */

/** The preview page's accessible name. */
export function previewLabel(chapter: string): string {
  return `Preview of ${chapter}, as Royal Road will show it`;
}

/** Preview of a chapter with no words yet. */
export const PREVIEW_EMPTY = 'Nothing to preview yet: the chapter has no words.';

/** A web image in the preview, which shows its words rather than fetch it. */
export function previewImageText(alt: string): string {
  return alt.trim() ? `Image: ${alt.trim()}` : 'Image';
}
