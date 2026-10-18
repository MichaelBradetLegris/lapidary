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
 * Pure (CLAUDE.md rule 4). The page measures (`SplitMeasure`) and draws.
 */

/** How far an arrow key moves the handle, in CSS px. */
export const SPLIT_STEP_PX = 24;

/** The rows each region keeps in view, whatever the split. */
export const SPLIT_MIN_ROWS = 3;

/** A row of the suggestions list, for when the list has none to measure (CSS px, at 100% on Windows). */
export const SPLIT_ROW_PX = 22;

/** The handle's spoken name. */
export const SPLIT_LABEL = 'Split between suggestions and comments';

/** The handle's tooltip. */
export const SPLIT_TITLE =
  'Drag to give the suggestions or the comments more room. Double-click it, or press Enter, for the usual split.';

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
  /** the least the list may have: its heading and three rows */
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

/** The most the list may have. In a panel too short for both minimums, the list keeps its own. */
export function splitMax(room: SplitRoom): number {
  return Math.max(room.min, room.total - room.gap);
}

/**
 * The list's height for a share of the height, as app.css draws it:
 * `clamp(min, share * 100%, 100% - gap)`, where the least wins should the two
 * limits cross.
 */
export function splitHeight(share: number, room: SplitRoom): number {
  return Math.max(room.min, Math.min(share * room.total, room.total - room.gap));
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
  const next = Math.max(room.min, Math.min(target, splitMax(room)));
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
 * step from the handle.
 */
export function splitTakesKey(
  key: string,
  target: { classList: { contains(token: string): boolean } } | null
): boolean {
  return target !== null && target.classList.contains('side__split') && SPLIT_KEYS.includes(key);
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
    valueMin: Math.min(percent(room.min), valueNow),
    valueMax: Math.max(percent(splitMax(room)), valueNow),
    valueNow,
    valueText: `Suggestions ${valueNow}% of the height`
  };
}
