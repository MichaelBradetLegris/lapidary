/**
 * The category chips' row (polish.6, PLAN 7): one row at the top of the centre
 * column that scrolls sideways when the chips do not fit. Chromium scrolls such
 * a row with a horizontal wheel or trackpad and with Shift and the wheel, but
 * an ordinary wheel turned over it did nothing, so `chipsWheelLeft` turns that
 * into a sideways scroll. Tab brought a chip into view only when none of it
 * showed, so a chip half cut off at the row's edge took the focus as it was;
 * `chipsRevealLeft` brings the whole chip in. Pure, so it runs in node.
 */

/** Room kept between a chip brought into view and the row's edge: the row's own padding. */
export const CHIPS_REVEAL_MARGIN = 12;

/** Pixels per line for a wheel that counts in lines (`WheelEvent.DOM_DELTA_LINE`). */
export const WHEEL_LINE_PX = 40;

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
