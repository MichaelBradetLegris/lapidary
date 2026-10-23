/**
 * The category chips (polish.6, polish.10, polish.11, PLAN 7). Since
 * `polish.10` they are in the toolbar's row, where the chapter's name was
 * before it moved to the window's title, each chip a category's name and
 * count. Since `polish.11` each chip is a menu button: a click anywhere on it
 * opens its menu, Hide or Show, Show only, Accept all N and Dismiss all N
 * (`chipMenuLabels`); an eye before the row shows or hides them all
 * (`eyeLabel`); and the author's own edits have a chip of their own, You,
 * last in the row (`chipKeyOf`, `chipCounts`). Since `polish.13` the review's
 * comments have one too, "comments N", before You, whose menu holds Hide or
 * Show and Show only (`COMMENTS_CHIP`, `RowChip`). The chips are drawn at the
 * size they had before `polish.10` and shrink, in steps, only as far as they
 * must to fit (`CHIP_STEPS`, `chipsStep`); only at the smallest step do they
 * overflow, and the row then scrolls sideways and never wraps. Chromium
 * scrolls such a row with a sideways wheel or trackpad and with Shift and the
 * wheel, but an ordinary wheel turned over it did nothing, so
 * `chipsWheelLeft` turns that into a sideways scroll. Tab brought a chip into
 * view only when none of it showed, so a chip half cut off at the row's edge
 * took the focus as it was; `chipsRevealLeft` brings the whole chip in. The
 * row draws no scrollbar: ‹ and › buttons laid over its ends page it
 * (`chipsEnds`, `chipsPageLeft`), and a 2 px line under it shows where it is
 * (`chipsIndicator`), the two together `chipsView`. Pure, so it runs in node.
 */

import type { ChangeCategory, Hunk, ReviewComment } from '../types';
import type { BulkAction } from './bulk';

/**
 * The width of the ‹ and › buttons laid over the row's ends while the chips
 * overflow, in CSS px (app.css, `.chips__arrow`).
 */
export const CHIPS_ARROW_WIDTH = 22;

/** The chip of the author's own edits (polish.11). */
export const YOU_CHIP = 'you';

/**
 * What a chip stands for, and what the filter hides: a category of the
 * model's, or the author's own edits.
 */
export type ChipKey = ChangeCategory | typeof YOU_CHIP;

/** The chip of the review's comments (polish.13). */
export const COMMENTS_CHIP = 'comments';

/**
 * What a chip in the row stands for, and what the filter can hide: a chip of
 * suggestions (`ChipKey`), or the review's comments (polish.13), which have
 * no Accept all or Dismiss all.
 */
export type RowChip = ChipKey | typeof COMMENTS_CHIP;

/** The chip's suggestions, for Accept all and Dismiss all; null for the comments' chip, which has none. */
export function suggestionChip(key: RowChip): ChipKey | null {
  return key === COMMENTS_CHIP ? null : key;
}

/**
 * Whether the filter hides the comments (polish.13): the margin's cards, the
 * side panel's list under its heading, the commented paragraphs' numbers and
 * the `n` key's steps.
 */
export function commentsHidden(hidden: readonly RowChip[]): boolean {
  return hidden.includes(COMMENTS_CHIP);
}

/**
 * The chip a suggestion is counted and filtered under (polish.11): You for an
 * edit the author made (`source: 'manual'`), which carries `other` as its
 * category; otherwise its category, `other` for one that has none, as a
 * manual review's do. A model's suggestion the author reworded (`edited`)
 * keeps its category's chip: the change and its category are the model's.
 */
export function chipKeyOf(hunk: Pick<Hunk, 'source' | 'category'>): ChipKey {
  if (hunk.source === 'manual') return YOU_CHIP;
  return hunk.category ?? 'other';
}

/** Whether the filter hides this suggestion: its chip is hidden. */
export function chipHidden(hunk: Pick<Hunk, 'source' | 'category'>, hidden: readonly RowChip[]): boolean {
  return hidden.length > 0 && hidden.includes(chipKeyOf(hunk));
}

/** The words on a chip before its count: the category's name, "comments", or "You". */
export function chipName(key: RowChip): string {
  return key === YOU_CHIP ? 'You' : key;
}

/**
 * Room kept between a chip brought into view and the edge of the row's
 * scrolling area: the arrow over that end and 6 px beside it, so a chip the
 * keyboard reaches is never left under an arrow. The row's own padding, 3 px
 * at each end since the ▾ went (polish.11), is inside this.
 */
export const CHIPS_REVEAL_MARGIN = CHIPS_ARROW_WIDTH + 6;

/** Pixels per line for a wheel that counts in lines (`WheelEvent.DOM_DELTA_LINE`). */
export const WHEEL_LINE_PX = 40;

/** The indicator's thumb is never shorter than this, in CSS px, however many chips there are. */
export const CHIPS_THUMB_MIN = 16;

/** The parts of a `WheelEvent` the row reads. */
export interface ChipsWheel {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages, as `WheelEvent.deltaMode` */
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
}

/** The row's scroll position and sizes, in CSS pixels. */
export interface ChipsRow {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}

/**
 * The chips, one for each category of a suggestion drawn in the text (an
 * unanchored one has no place there), with how many it has: the most first,
 * then by name, and You, the author's own edits, last whatever its count
 * (polish.11). A suggestion with no category counts as other (`chipKeyOf`).
 * The review's comments have a chip after the categories and before You
 * (polish.13), counting the open ones, while the review has any comment at
 * all: one whose comments are all resolved still has their greyed cards to
 * hide, and reads "comments 0".
 */
export function chipCounts(
  hunks: readonly Pick<Hunk, 'anchor' | 'category' | 'source'>[],
  comments: readonly Pick<ReviewComment, 'status'>[] = []
): [RowChip, number][] {
  const counts = new Map<ChipKey, number>();
  for (const hunk of hunks) {
    if (hunk.anchor === 'stale') continue;
    const key = chipKeyOf(hunk);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const you = counts.get(YOU_CHIP);
  counts.delete(YOU_CHIP);
  const chips: [RowChip, number][] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  if (comments.length > 0) chips.push([COMMENTS_CHIP, comments.filter((c) => c.status === 'open').length]);
  if (you !== undefined) chips.push([YOU_CHIP, you]);
  return chips;
}

/**
 * "Accept all punctuation", "Dismiss all your edits": the items Actions lists
 * for the chip last focused (polish.10).
 */
export function chipBulkLabel(action: Exclude<BulkAction, 'reset'>, key: ChipKey): string {
  return `${action === 'accept' ? 'Accept' : 'Dismiss'} all ${key === YOU_CHIP ? 'your edits' : key}`;
}

/** The name of a chip's menu: "punctuation suggestions", "Your edits", "Comments". */
export function chipMenuLabel(key: RowChip): string {
  if (key === YOU_CHIP) return 'Your edits';
  if (key === COMMENTS_CHIP) return 'Comments';
  return `${key} suggestions`;
}

/**
 * The items of a chip's menu (polish.11), in order: Hide, or Show for a
 * hidden chip; Show only, which shows this chip and hides every other; and,
 * under a line, Accept all and Dismiss all with the number of its suggestions
 * still pending, which is how many each would move. The comments' chip has
 * the first two alone (polish.13).
 */
export function chipMenuLabels(
  hidden: boolean,
  pending: number
): { toggle: string; only: string; accept: string; dismiss: string } {
  return {
    toggle: hidden ? 'Show' : 'Hide',
    only: 'Show only',
    accept: `Accept all ${pending}`,
    dismiss: `Dismiss all ${pending}`
  };
}

/**
 * A chip's tooltip, which Chromium also gives screen readers as its
 * description (polish.11): whether its suggestions are shown, which is the
 * chip's state as a menu button has no pressed state, and what a click opens.
 * The You chip says first what it counts, and so does the comments' chip,
 * whose menu has no Accept all or Dismiss all (polish.13).
 */
export function chipTitle(key: RowChip, hidden: boolean): string {
  const state = `${hidden ? 'Hidden' : 'Shown'}. Click for ${hidden ? 'Show' : 'Hide'}`;
  if (key === COMMENTS_CHIP) return `Comments, counting the open ones. ${state} and Show only.`;
  const what = key === YOU_CHIP ? 'Your own edits. ' : '';
  return `${what}${state}, Show only, Accept all and Dismiss all.`;
}

/**
 * What the filter hides after Show only on `key` (polish.11): every other
 * chip in the row, the comments' included (polish.13). A chip that comes
 * later, as You does with the author's first edit, is shown.
 */
export function showOnlyHidden(chips: readonly RowChip[], key: RowChip): RowChip[] {
  return chips.filter((chip) => chip !== key);
}

/** Whether every chip in the row is shown: the eye is open then (polish.11), the comments' chip counted (polish.13). */
export function allChipsShown(chips: readonly RowChip[], hidden: readonly RowChip[]): boolean {
  return chips.every((chip) => !hidden.includes(chip));
}

/** Whether every chip in the row is hidden. */
export function allChipsHidden(chips: readonly RowChip[], hidden: readonly RowChip[]): boolean {
  return chips.every((chip) => hidden.includes(chip));
}

/** The eye's two names, which say what it does, and the items Actions lists beside it (polish.11). */
export const SHOW_ALL_CATEGORIES = 'Show all categories';
export const HIDE_ALL_CATEGORIES = 'Hide all categories';

/**
 * The name of the eye at the left of the toolbar: open while every chip is
 * shown, when a click hides them all, and closed otherwise, when a click
 * shows them all.
 */
export function eyeLabel(allShown: boolean): string {
  return allShown ? HIDE_ALL_CATEGORIES : SHOW_ALL_CATEGORIES;
}

/**
 * The sizes a chip is drawn at (polish.11), largest first: the size it had
 * before `polish.10` (`polish.6`: 13 px type, 2 by 8 px of padding, 6 px
 * between chips), two between, and `polish.10`'s compact size (11.5 px on a
 * 16 px line, 1 by 5 px, 4 px apart). app.css draws each, under
 * `[data-chip-step]`; a test holds the two to each other.
 */
export const CHIP_STEPS: readonly {
  fontSize: number;
  lineHeight: string;
  padding: string;
  gap: number;
}[] = [
  { fontSize: 13, lineHeight: 'normal', padding: '2px 8px', gap: 6 },
  { fontSize: 12.5, lineHeight: 'normal', padding: '2px 7px', gap: 5 },
  { fontSize: 12, lineHeight: '16px', padding: '1px 6px', gap: 5 },
  { fontSize: 11.5, lineHeight: '16px', padding: '1px 5px', gap: 4 }
];

/** The row's padding at its two ends together, in CSS px (app.css, `.chips`). */
export const CHIPS_ROW_PADDING = 6;

/**
 * The step the chips are drawn at (polish.11): the first, the largest, at
 * which they fit the row, and the last, the compact one, when none does, the
 * row then overflowing to its arrows. `width` is the room the row has for its
 * chips, its width less its padding; `natural[step]` is each chip's width as
 * drawn at that step, measured from a copy of the chips out of sight at every
 * step, so the choice never depends on the step drawn and cannot swing
 * between two. The chips at a step take their widths and the step's gap
 * between each two.
 */
export function chipsStep(width: number, natural: readonly (readonly number[])[]): number {
  const last = CHIP_STEPS.length - 1;
  for (let step = 0; step < last; step += 1) {
    const widths = natural[step] ?? [];
    const gap = CHIP_STEPS[step]?.gap ?? 0;
    const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
    if (total <= width) return step;
  }
  return last;
}

/**
 * Where an up-and-down wheel turned over the row takes its scroll position, or
 * null to leave the event to the browser: when the chips fit, when Ctrl is
 * held (Ctrl and the wheel zoom the window, PLAN 7 "Zoom"), when Shift is held
 * or the wheel moves more sideways than up and down (the browser scrolls the
 * row itself then), and when the row is already at the end the wheel turns
 * towards. Down and right go right, as Shift and the wheel do.
 */
export function chipsWheelLeft(wheel: ChipsWheel, row: ChipsRow): number | null {
  if (wheel.ctrlKey || wheel.shiftKey) return null;
  if (wheel.deltaY === 0 || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY)) return null;
  const max = row.scrollWidth - row.clientWidth;
  if (max <= 0) return null;
  const unit = wheel.deltaMode === 1 ? WHEEL_LINE_PX : wheel.deltaMode === 2 ? row.clientWidth : 1;
  const next = Math.min(max, Math.max(0, row.scrollLeft + wheel.deltaY * unit));
  return Math.abs(next - row.scrollLeft) < 0.5 ? null : next;
}

/**
 * Where the row's scroll position goes so that a chip the keyboard has reached
 * is wholly in view, with `CHIPS_REVEAL_MARGIN` beside it, or null when it is
 * already. `chip` is the chip's left and right edges in the row's scrolled
 * content, as `scrollLeft` counts. A chip wider than the row shows its start.
 */
export function chipsRevealLeft(row: ChipsRow, chip: { left: number; right: number }): number | null {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const viewLeft = row.scrollLeft + CHIPS_REVEAL_MARGIN;
  const viewRight = row.scrollLeft + row.clientWidth - CHIPS_REVEAL_MARGIN;
  let next = row.scrollLeft;
  if (chip.left < viewLeft || chip.right - chip.left > viewRight - viewLeft) {
    next = chip.left - CHIPS_REVEAL_MARGIN;
  } else if (chip.right > viewRight) {
    next = chip.right + CHIPS_REVEAL_MARGIN - row.clientWidth;
  }
  next = Math.min(max, Math.max(0, next));
  return Math.abs(next - row.scrollLeft) < 0.5 ? null : next;
}

/**
 * Which ends of the row have chips out of sight, and so show their arrow: ‹ at
 * the start once the row has scrolled, › at the end until it reaches it. Both
 * false when the chips fit. A pixel is allowed either way, as zoom leaves
 * `scrollLeft` fractional.
 */
export function chipsEnds(row: ChipsRow): { start: boolean; end: boolean } {
  const max = row.scrollWidth - row.clientWidth;
  if (max < 1) return { start: false, end: false };
  return { start: row.scrollLeft >= 1, end: row.scrollLeft <= max - 1 };
}

/**
 * Where ‹ (-1) or › (1) takes the row, or null when it is already at that end:
 * on by the row's width less the room kept at each end, so a chip that was
 * half under the far arrow comes in clear of the near one.
 */
export function chipsPageLeft(row: ChipsRow, direction: 1 | -1): number | null {
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const step = Math.max(CHIPS_REVEAL_MARGIN, row.clientWidth - 2 * CHIPS_REVEAL_MARGIN);
  const next = Math.min(max, Math.max(0, row.scrollLeft + direction * step));
  return Math.abs(next - row.scrollLeft) < 0.5 ? null : next;
}

/**
 * The 2 px line under the row while the chips overflow, in place of a
 * scrollbar: its thumb's left edge and length within a line `width` px long,
 * the length the share of the chips in view (at least `CHIPS_THUMB_MIN`) and
 * the edge where the row stands between its ends. Null when the chips fit, as
 * the line is then not drawn.
 */
export function chipsIndicator(row: ChipsRow, width: number): { left: number; width: number } | null {
  const max = row.scrollWidth - row.clientWidth;
  if (max < 1 || width <= 0) return null;
  const length = Math.min(width, Math.max(CHIPS_THUMB_MIN, (width * row.clientWidth) / row.scrollWidth));
  const at = Math.min(1, Math.max(0, row.scrollLeft / max));
  return { left: (width - length) * at, width: length };
}

/** What the row shows besides its chips: the arrows at the ends with chips out of sight, and the line's thumb. */
export interface ChipsView {
  start: boolean;
  end: boolean;
  thumb: { left: number; width: number } | null;
}

/** The chips fit: no arrow and no line. */
export const CHIPS_FIT: ChipsView = { start: false, end: false, thumb: null };

/** What the row shows as it stands: its arrows (`chipsEnds`) and a line as wide as the row (`chipsIndicator`). */
export function chipsView(row: ChipsRow): ChipsView {
  return { ...chipsEnds(row), thumb: chipsIndicator(row, row.clientWidth) };
}

/**
 * Whether two views draw the same, the thumb to the nearest pixel, so that
 * FilterChips keeps the view it has, and is not drawn again, for a scroll or a
 * resize that changes nothing it shows.
 */
export function sameChipsView(a: ChipsView, b: ChipsView): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    Math.round(a.thumb?.left ?? -1) === Math.round(b.thumb?.left ?? -1) &&
    Math.round(a.thumb?.width ?? -1) === Math.round(b.thumb?.width ?? -1)
  );
}

/**
 * Where a chip's menu opens, in the window's CSS px: 4 px under the chip, its
 * left edge under the chip's, moved left as far as it must to keep 4 px from
 * the window's right edge, and never past its left.
 */
export function chipMenuPlacement(
  chip: { left: number; bottom: number },
  menuWidth: number,
  windowWidth: number
): { left: number; top: number } {
  const left = Math.max(4, Math.min(chip.left, windowWidth - 4 - menuWidth));
  return { left, top: chip.bottom + 4 };
}
