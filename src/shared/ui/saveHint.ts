/**
 * The first-use hint beside Save to chapter (apply.12, PLAN 7): the first
 * time the page holds a change the chapter file does not, a note under the
 * toolbar says where decisions are kept and what Save to chapter does. Got it
 * or the first Save to chapter that reaches the file puts it away for good, by
 * adding its id to the `dismissedHints` setting (PLAN 11.3 d). Until then it
 * shows whenever a change is not saved to the chapter; nothing else dismisses
 * it, though in a narrow window, with the side panel folded, it gives way to
 * the prose (ui.3, `saveHintVisible`).
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
  /**
   * The side panel is folded to a strip (ui.3), so the hint hangs over the
   * prose rather than over the panel.
   */
  sideFolded: boolean;
  /** a paragraph is open for editing in place (PLAN 7.4) */
  editingParagraph: boolean;
  /**
   * The author went on after the hint had shown over the prose: pressed
   * somewhere else, used a review key or opened a drawer (`saveHintGivesWay`
   * in `src/renderer/state/hints.ts`). It holds for the rest of the session.
   */
  setAside: boolean;
}

/**
 * Whether the hint shows now. Only with a change not saved to the chapter, and
 * only until it is dismissed. While a review of the chapter runs or a save is
 * under way, Save to chapter cannot be pressed, so the hint waits; it shows
 * again afterwards unless that save put it away.
 *
 * With the side panel folded it hangs over the prose, so there it gives way to
 * the prose (ui.3 review): it waits while a paragraph is open for editing, whose
 * text and Done it would cover, and once the author has gone on after seeing it,
 * it stays away while the panel is folded. Drawn in place, the panel is where
 * the hint hangs, and it shows there as before.
 */
export function saveHintVisible(input: SaveHintInput): boolean {
  if (input.dismissedHints === null) return false;
  if (input.dismissedThisSession || input.dismissedHints.includes(SAVE_HINT_ID)) return false;
  if (input.sideFolded && (input.editingParagraph || input.setAside)) return false;
  return input.hasChapter && input.unsavedDecisions > 0 && !input.locked && !input.saving;
}

/** `hints` with `id` added once at the end; a new array, the old one untouched. */
export function withHint(hints: readonly string[], id: string): string[] {
  return hints.includes(id) ? [...hints] : [...hints, id];
}

/** A stretch across the toolbar, in CSS pixels from its left edge. */
export interface Span {
  left: number;
  right: number;
}

/** What the hint's placement is worked out from, in CSS pixels, relative to the toolbar. */
export interface SaveHintMeasure {
  /** the toolbar's width */
  barWidth: number;
  /** the Save button's left edge, from the toolbar's left edge */
  buttonLeft: number;
  buttonWidth: number;
  /**
   * The side panel's column, which the hint stays inside, so it never meets the
   * notification cards, the find bar or the chapter's text in the column beside
   * it. Null when the page has no side panel (the Setup screen), and then the
   * hint may use the toolbar's whole width.
   */
  column: Span | null;
  /** the toolbar's items on rows below Save to chapter's, which the arrow must not point at */
  below: readonly Span[];
}

export interface SaveHintPlacement {
  /** the hint's left edge, from the toolbar's left edge */
  left: number;
  width: number;
  /**
   * Where its arrow points, from the hint's left edge. Null when every part of
   * Save to chapter the hint can reach has a toolbar item under it: an arrow
   * there would point at that item, so the hint has none and its words name the
   * button.
   */
  arrow: number | null;
}

/** The hint's width when its column has room for it. */
export const SAVE_HINT_WIDTH = 300;
/** Room kept between the hint and the sides of the column it hangs in. */
export const SAVE_HINT_MARGIN = 8;
/** The arrow keeps this far from either end of the hint, clear of its rounded corners. */
export const SAVE_HINT_ARROW_INSET = 16;
/**
 * The arrow's tip keeps this far inside Save to chapter's ends and from the
 * sides of every toolbar item under the button. The arrow is about 14 px wide,
 * so a few pixels stay clear either side of it, and it never sits in the gap
 * between two buttons.
 */
export const SAVE_HINT_ARROW_CLEAR = 12;

/**
 * `span` less the inside of every stretch in `cuts`, as the pieces left over;
 * none when `span` is empty. A cut's own ends stay allowed, so a piece can be a
 * single point: exactly the clearance away from an item is far enough.
 */
function subtract(span: Span, cuts: readonly Span[]): Span[] {
  let pieces: Span[] = span.left <= span.right ? [span] : [];
  for (const cut of cuts) {
    pieces = pieces.flatMap((piece) => {
      if (cut.right <= piece.left || cut.left >= piece.right) return [piece];
      const rest: Span[] = [];
      if (cut.left >= piece.left) rest.push({ left: piece.left, right: cut.left });
      if (cut.right <= piece.right) rest.push({ left: cut.right, right: piece.right });
      return rest;
    });
  }
  return pieces;
}

/**
 * Where the hint sits under the toolbar. It hangs below the whole toolbar, so
 * it never covers a button of it, whichever row Save to chapter is on, and it
 * stays inside the side panel's column, 300 px wide or the column less its
 * margins, so it never meets the notification cards, the find bar or the
 * chapter's text. It lines up with the column's right edge and moves left,
 * within the column, to bring its arrow over Save to chapter: to the button's
 * middle when it can, else to the nearest point of the button it can reach.
 * The arrow points only at a part of the button that has no toolbar item under
 * it, since the hint hangs below the last row and an arrow under Copy result
 * would point at Copy result; when no such part is in reach, the hint has no
 * arrow.
 */
export function saveHintPlacement(m: SaveHintMeasure): SaveHintPlacement {
  const area = m.column ?? { left: 0, right: m.barWidth };
  const lo = area.left + SAVE_HINT_MARGIN;
  const hi = Math.max(lo, area.right - SAVE_HINT_MARGIN);
  const width = Math.min(SAVE_HINT_WIDTH, hi - lo);
  const rightmost = hi - width;
  if (width < 2 * SAVE_HINT_ARROW_INSET) return { left: rightmost, width, arrow: null };

  // Where the tip may go: on the button, clear of its ends and of everything
  // under it, and where the hint can bring its arrow without leaving the column.
  const onButton: Span = {
    left: Math.max(m.buttonLeft + SAVE_HINT_ARROW_CLEAR, lo + SAVE_HINT_ARROW_INSET),
    right: Math.min(m.buttonLeft + m.buttonWidth - SAVE_HINT_ARROW_CLEAR, hi - SAVE_HINT_ARROW_INSET)
  };
  const cuts = m.below.map((item) => ({
    left: item.left - SAVE_HINT_ARROW_CLEAR,
    right: item.right + SAVE_HINT_ARROW_CLEAR
  }));
  const centre = m.buttonLeft + m.buttonWidth / 2;
  let tip: number | null = null;
  for (const piece of subtract(onButton, cuts)) {
    const nearest = Math.min(piece.right, Math.max(piece.left, centre));
    if (tip === null || Math.abs(nearest - centre) < Math.abs(tip - centre)) tip = nearest;
  }
  if (tip === null) return { left: rightmost, width, arrow: null };

  const left = Math.max(lo, Math.min(rightmost, tip - SAVE_HINT_ARROW_INSET));
  return { left, width, arrow: tip - left };
}
