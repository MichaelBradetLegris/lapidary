/**
 * The category chips (polish.6, polish.10, PLAN 7). Since `polish.10` they are
 * in the toolbar's row, where the chapter's name was before it moved to the
 * window's title: compact, each chip a category's name and count, the whole
 * chip one toggle of its filter, with Accept all and Dismiss all for its
 * category in a small menu on it. They fit the default window beside the
 * toolbar's four buttons; when they do not, as in a narrow window or zoomed
 * in, the row scrolls sideways and never wraps. Chromium scrolls such a row
 * with a sideways wheel or trackpad and with Shift and the wheel, but an
 * ordinary wheel turned over it did nothing, so `chipsWheelLeft` turns that
 * into a sideways scroll. Tab brought a chip into view only when none of it
 * showed, so a chip half cut off at the row's edge took the focus as it was;
 * `chipsRevealLeft` brings the whole chip in. The row draws no scrollbar: ‹ and
 * › buttons laid over its ends page it (`chipsEnds`, `chipsPageLeft`), and a
 * 2 px line under it shows where it is (`chipsIndicator`), the two together
 * `chipsView`. Pure, so it runs in node.
 */

import type { ChangeCategory, Hunk } from '../types';
import type { BulkAction } from './bulk';

/**
 * The width of the ‹ and › buttons laid over the row's ends while the chips
 * overflow, in CSS px (app.css, `.chips__arrow`).
 */
export const CHIPS_ARROW_WIDTH = 22;

/**
 * Room kept between a chip brought into view and the edge of the row's
 * scrolling area: the arrow over that end and 6 px beside it, so a chip the
 * keyboard reaches is never left under an arrow. The row's own padding, 3 px
 * at the start and 10 at the end, is inside this.
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
 * then by name. A suggestion with no category counts as other.
 */
export function chipCategories(
  hunks: readonly Pick<Hunk, 'anchor' | 'category'>[]
): [ChangeCategory, number][] {
  const counts = new Map<ChangeCategory, number>();
  for (const hunk of hunks) {
    if (hunk.anchor === 'stale') continue;
    const key: ChangeCategory = hunk.category ?? 'other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Accept all punctuation", "Dismiss all punctuation": the items of a chip's menu, and of Actions for the chip last focused. */
export function chipBulkLabel(action: Exclude<BulkAction, 'reset'>, category: ChangeCategory): string {
  return `${action === 'accept' ? 'Accept' : 'Dismiss'} all ${category}`;
}

/** The name of a chip's ▾ and of the menu it opens. */
export function chipMenuLabel(category: ChangeCategory): string {
  return `Accept or dismiss all ${category}`;
}

/**
 * A chip's tooltip, which Chromium also gives screen readers as its
 * description: what a click does, and where its menu is.
 */
export function chipTitle(hidden: boolean): string {
  return `${hidden ? 'Show' : 'Hide'} these. Right-click, or press the menu key, for Accept all and Dismiss all.`;
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
