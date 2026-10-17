/**
 * The first-use hint beside Save to chapter (apply.12, PLAN 7): the first
 * time the page holds a change the chapter file does not, a note under the
 * toolbar says where decisions are kept and what Save to chapter does. Got it
 * or the first Save to chapter that reaches the file puts it away for good, by
 * adding its id to the `dismissedHints` setting (PLAN 11.3 d). Until then it
 * shows whenever a change is not saved to the chapter; nothing else dismisses
 * it.
 *
 * The words, when it shows and where it sits are decided here, so each has a
 * test; `SaveHint.tsx` draws it and `state/hints.ts` writes the setting.
 *
 * Pure (CLAUDE.md rule 4).
 */

/** The id recorded in `dismissedHints` once the hint is done with. */
export const SAVE_HINT_ID = 'save-to-chapter';

/**
 * The sentence `apply.21` may add, once sitting C has shown what Obsidian does
 * when Save to chapter writes a chapter it has open (PLAN 11.2, M7). Null until
 * then, and the hint says its three sentences only. Set it here and nowhere
 * else; the hint and its test pick it up.
 */
export const SAVE_HINT_OBSIDIAN_NOTE: string | null = null;

/**
 * The sentence the empty page and the Accept all question end with (apply.12):
 * deciding on a suggestion changes only the review.
 */
export const NOTHING_UNTIL_SAVE = 'Nothing reaches the chapter until you press Save to chapter.';

/** The hint's button. */
export const SAVE_HINT_GOT_IT = 'Got it';

/** The file name a path ends in, extension included, whichever separator it uses. */
export function chapterFileName(sourcePath: string): string {
  const segments = sourcePath.split(/[\\/]/);
  return segments[segments.length - 1] || sourcePath;
}

/**
 * The hint's words for the chapter at `sourcePath`, named by its file name, so
 * the author sees which file Save to chapter writes. `note` is the `apply.21`
 * sentence, added after the others when there is one.
 */
export function saveHintText(sourcePath: string, note: string | null = SAVE_HINT_OBSIDIAN_NOTE): string {
  const text =
    'Your decisions are kept in this review, not in your chapter yet. ' +
    `Press Save to chapter (Ctrl+S) to write them into ${chapterFileName(sourcePath)}. ` +
    'The version it replaces is backed up first.';
  return note ? `${text} ${note}` : text;
}

export interface SaveHintInput {
  /** the `dismissedHints` setting; null before the settings have loaded */
  dismissedHints: readonly string[] | null;
  /** Got it was pressed this session, though writing the setting may have failed */
  dismissedThisSession: boolean;
  /** a chapter file is open: the review on screen names one */
  hasChapter: boolean;
  /** `unsavedDecisionCount` of the review on screen */
  unsavedDecisions: number;
  /** a review of this chapter is running, so Save to chapter is disabled */
  locked: boolean;
  /** a Save to chapter is under way */
  saving: boolean;
}

/**
 * Whether the hint shows now. Only with a change not saved to the chapter, and
 * only until it is dismissed. While a review of the chapter runs or a save is
 * under way, Save to chapter cannot be pressed, so the hint waits; it shows
 * again afterwards unless that save put it away.
 */
export function saveHintVisible(input: SaveHintInput): boolean {
  if (input.dismissedHints === null) return false;
  if (input.dismissedThisSession || input.dismissedHints.includes(SAVE_HINT_ID)) return false;
  return input.hasChapter && input.unsavedDecisions > 0 && !input.locked && !input.saving;
}

/** `hints` with `id` added once at the end; a new array, the old one untouched. */
export function withHint(hints: readonly string[], id: string): string[] {
  return hints.includes(id) ? [...hints] : [...hints, id];
}

/** What the hint's placement is worked out from, in CSS pixels, relative to the toolbar. */
export interface SaveHintMeasure {
  /** the toolbar's width */
  barWidth: number;
  /** the Save button's left edge, from the toolbar's left edge */
  buttonLeft: number;
  buttonWidth: number;
  /** the hint's own width */
  hintWidth: number;
}

export interface SaveHintPlacement {
  /** the hint's left edge, from the toolbar's left edge */
  left: number;
  /** where its arrow points, from the hint's left edge */
  arrow: number;
}

/** Room kept between the hint and the window's edges. */
export const SAVE_HINT_MARGIN = 8;
/** The arrow keeps this far from either end of the hint, clear of its rounded corners. */
export const SAVE_HINT_ARROW_INSET = 16;

/**
 * Where the hint sits under the toolbar. It hangs below the whole toolbar, so
 * it never covers a button of it, whichever row Save to chapter is on. It
 * lines up with the toolbar's right edge, where the side panel is, so at
 * normal sizes it leaves the chapter's text alone; when Save to chapter is
 * further left than the arrow can reach, it moves left to keep the arrow on
 * the button's middle. It never runs out of the toolbar at either end.
 */
export function saveHintPlacement(m: SaveHintMeasure): SaveHintPlacement {
  const centre = m.buttonLeft + m.buttonWidth / 2;
  const maxLeft = Math.max(SAVE_HINT_MARGIN, m.barWidth - SAVE_HINT_MARGIN - m.hintWidth);
  const reach = centre - SAVE_HINT_ARROW_INSET;
  const left = Math.max(SAVE_HINT_MARGIN, Math.min(maxLeft, reach));
  const arrow = Math.max(SAVE_HINT_ARROW_INSET, Math.min(m.hintWidth - SAVE_HINT_ARROW_INSET, centre - left));
  return { left, arrow };
}
