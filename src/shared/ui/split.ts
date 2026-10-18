/**
 * The split between the side panel's two regions (ui.6, PLAN 7 "The split"):
 * the suggestions list above, the comments, Unanchored and History below, and
 * a handle between them that the author drags, or moves from the keyboard, to
 * give either more room.
 *
 * The split is kept in settings (`sideSplit`, PLAN 11.3 d) as the list's share
 * of the height the two regions and the handle share, which is the panel under
 * the focused suggestion's box; null is the usual split, where the list takes
 * what it needs up to 55% of that height. A share rather than pixels, so the
 * line keeps its place as the window, the zoom or the filter chips change that
 * height. app.css draws a share with `clamp()`, with the least and the most
 * the list may have measured by the page; `splitHeight` here is the same sum.
 *
 * Three rows each side need about 196 CSS px under the box at 100%. In a
 * shorter panel the two limits cross, and the list has its heading and three
 * rows or 55% of the height, whichever is less, so a split set never leaves
 * the region below less than the usual split leaves it under a full list. A
 * handle that could move less than an arrow step is no control (PLAN C.59).
 *
 * Pure (CLAUDE.md rule 4). The page measures (`SplitMeasure`) and draws.
 */

/** How far an arrow key moves the handle, in CSS px. */
export const SPLIT_STEP_PX = 24;

/** The rows each region keeps in view, where the panel has room for both. */
export const SPLIT_MIN_ROWS = 3;

/** The most the list takes under the usual split, as a share of the height (`.side__list` max-height in app.css). */
export const SPLIT_USUAL_SHARE = 0.55;

/** A row of the suggestions list, for when the list has none to measure (CSS px, at 100% on Windows). */
export const SPLIT_ROW_PX = 22;

/** The handle's spoken name. */
export const SPLIT_LABEL = 'Split between suggestions and comments';

/** The handle's tooltip. */
export const SPLIT_TITLE =
  'Drag to give the suggestions or the comments more room. Double-click it, or press Enter, for the usual split.';

/** The handle's tooltip when the panel is too short for it to move (`splitMovable`). */
export const SPLIT_TITLE_STILL =
  'The panel is too short to move this line. Make the window taller, or zoom out, to give it room.';

/** The keys the handle takes when it has the focus; ArrowUp and ArrowDown are review keys elsewhere. */
export const SPLIT_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'];

/**
 * A `sideSplit` setting from whatever settings.json holds: a share strictly
 * between 0 and 1, or null for the usual split.
 */
export function normalizeSplit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

/** What the page measures of the two regions, in CSS px. */
export interface SplitMeasure {
  /** the height the list, the handle and the region below share: the panel under the box */
  total: number;
  /** the list region's height as drawn */
  list: number;
  /** one row of the list, or `SPLIT_ROW_PX` when it has none */
  row: number;
  /** the list region's height besides its rows: its padding, its heading and the space under it */
  listChrome: number;
  /** the region below's height besides what it scrolls: its padding and border */
  lowerChrome: number;
  /** the handle's height */
  handle: number;
}

/** Where the handle is and how far it may go, in CSS px. */
export interface SplitRoom {
  /** the height the list, the handle and the region below share */
  total: number;
  /** the list region's height now */
  current: number;
  /** the list's heading and three rows: the least it may have where the panel has room for both (`splitMin`) */
  min: number;
  /** what the list must leave under it: the handle and three rows of the region below */
  gap: number;
}

export function splitRoom(measure: SplitMeasure): SplitRoom {
  const rows = SPLIT_MIN_ROWS * measure.row;
  return {
    total: measure.total,
    current: measure.list,
    min: measure.listChrome + rows,
    gap: measure.handle + measure.lowerChrome + rows
  };
}

/**
 * The least the list may have: its heading and three rows, but never more
 * than the usual split gives a full list, 55% of the height. Where the panel
 * is too short for three rows each side, a split set then leaves the region
 * below no less than the usual split does under a full list.
 */
export function splitMin(room: SplitRoom): number {
  return Math.min(room.min, SPLIT_USUAL_SHARE * room.total);
}

/** The most the list may have. In a panel too short for both minimums, it is the least. */
export function splitMax(room: SplitRoom): number {
  return Math.max(splitMin(room), room.total - room.gap);
}

/**
 * How far the handle can move: the height less both minimums, and none in a
 * panel shorter than them (196 CSS px at 100%).
 */
export function splitTravel(room: SplitRoom): number {
  return splitMax(room) - splitMin(room);
}

/**
 * Whether the handle is a control: it can move at least one arrow step.
 * Otherwise it is drawn as the plain line, out of the Tab order, and a drag,
 * a double-click and the keys leave it alone.
 */
export function splitMovable(room: SplitRoom): boolean {
  return splitTravel(room) >= SPLIT_STEP_PX;
}

/**
 * The list's height for a share of the height, as app.css draws it:
 * `clamp(min(min, 55%), share * 100%, 100% - gap)`, where the least wins should
 * the two limits cross.
 */
export function splitHeight(share: number, room: SplitRoom): number {
  return Math.max(splitMin(room), Math.min(share * room.total, room.total - room.gap));
}

/**
 * The share a list height is of the height, to six places, which is within a
 * hundredth of a pixel in any window, and never 0 or 1.
 */
export function splitShare(height: number, room: SplitRoom): number {
  if (!(room.total > 0)) return 0.5;
  const share = Math.round((height / room.total) * 1e6) / 1e6;
  return Math.min(0.999999, Math.max(0.000001, share));
}

/**
 * The list's new height for a move of the handle toward `target`, a list
 * height, kept between the limits. Null when the handle would not move, by
 * less than half a pixel, or would move the other way: a list shorter than
 * its least, as the usual split leaves a list of one or two suggestions,
 * grows to it only on a move down, and a move up leaves it where it is.
 */
export function splitMove(room: SplitRoom, target: number): number | null {
  const next = Math.max(splitMin(room), Math.min(target, splitMax(room)));
  const moved = next - room.current;
  if (Math.abs(moved) < 0.5) return null;
  if (Math.sign(moved) !== Math.sign(target - room.current)) return null;
  return next;
}

export type SplitKeyAction = { kind: 'move'; target: number } | { kind: 'reset' };

/**
 * What a key does with the focus on the handle: the arrows move it a step up
 * or down, Home and End to the limits, and Enter puts back the usual split.
 * Null for any other key, or one pressed with Ctrl, Alt or Cmd.
 */
export function splitKeyAction(
  event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  current: number
): SplitKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  switch (event.key) {
    case 'ArrowUp':
      return { kind: 'move', target: current - SPLIT_STEP_PX };
    case 'ArrowDown':
      return { kind: 'move', target: current + SPLIT_STEP_PX };
    case 'Home':
      return { kind: 'move', target: Number.NEGATIVE_INFINITY };
    case 'End':
      return { kind: 'move', target: Number.POSITIVE_INFINITY };
    case 'Enter':
      return { kind: 'reset' };
    default:
      return null;
  }
}

/**
 * Whether the review keys leave a key to the handle, which has the focus: the
 * arrows step through the list everywhere else (keyboard.ts). j and k still
 * step from the handle, and a handle that cannot move (`aria-disabled`) takes
 * no key, as when the window shrinks while it has the focus.
 */
export function splitTakesKey(
  key: string,
  target: {
    classList: { contains(token: string): boolean };
    getAttribute(name: string): string | null;
  } | null
): boolean {
  return (
    target !== null &&
    target.classList.contains('side__split') &&
    target.getAttribute('aria-disabled') !== 'true' &&
    SPLIT_KEYS.includes(key)
  );
}

/** The handle's value for a screen reader: the list's share as a percentage, and its limits. */
export function splitAria(room: SplitRoom): {
  valueMin: number;
  valueMax: number;
  valueNow: number;
  valueText: string;
} {
  const percent = (height: number): number =>
    room.total > 0 ? Math.round((Math.max(0, height) / room.total) * 100) : 0;
  const valueNow = percent(room.current);
  // A list under its least, as the usual split leaves a short one, is still in range.
  return {
    valueMin: Math.min(percent(splitMin(room)), valueNow),
    valueMax: Math.max(percent(splitMax(room)), valueNow),
    valueNow,
    valueText: `Suggestions ${valueNow}% of the height`
  };
}
