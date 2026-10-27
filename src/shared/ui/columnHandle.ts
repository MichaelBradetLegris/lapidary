/**
 * The handles on the side columns' inner edges (polish.5, PLAN 7 "Column
 * widths"): one between the chapter list and the prose, one between the prose
 * and the side panel. The author drags either, or moves it from the keyboard,
 * to make that column wider or narrower, as the split's handle in the side
 * panel moves the line between its two regions (ui.6, `split.ts`).
 *
 * A width set is kept in settings (`columnWidths`, PLAN 11.3 d) as a share of
 * the window's width, so the column keeps its share of the window as the
 * window or the zoom changes; null is the column's usual width. A column is
 * never narrower than its floor (`FILES_WIDTHS`, `SIDE_WIDTHS`), and never so
 * wide that the prose has less than `PROSE_MIN` beside the other column as it
 * is drawn. In a window too narrow for the widths set, the columns give way
 * and fold as `columnLayout` says (ui.3); a folded column has no handle, and
 * one that could move less than an arrow step is no control, as the split's
 * is not (C.59). A column hidden by its button in the toolbar (polish.28) has
 * no handle either, and the other column has the room it left.
 *
 * A drag that would leave the column `COLUMN_SNAP_PX` wide or less, pressed on
 * past its floor toward the window's edge, snaps it closed when the button
 * comes up (polish.27): the column is hidden as its button hides it, and keeps
 * the width it had before the drag for the next show. Until the release the
 * column stays at its floor, and the page fades it while a release would hide
 * it. The arrow keys snap it at the same width: a run of presses toward the
 * edge goes on past the floor a step a press, as the pointer does, and the
 * press that reaches the threshold hides the column.
 *
 * Pure (CLAUDE.md rule 4). The page draws the handles and follows the pointer
 * and the keys (`src/renderer/state/columnHandles.ts`); what it draws during a
 * drag and what it writes are decided here (`columnDragShare`,
 * `columnDragSnaps`, `columnLiveShares`, `columnDragWrite`, `columnKeyPress`),
 * so that they are tested.
 */

import type { ColumnShares } from '../types';
import { COLUMN_NAMES, COLUMN_WIDTHS, PROSE_MIN, type Column, type ColumnLayout } from './columns';

/** How far an arrow key moves a handle, in CSS px, as for the split (`SPLIT_STEP_PX`). */
export const COLUMN_STEP_PX = 24;

/**
 * How narrow a drag, or a run of arrow presses, has to make a column to snap
 * it closed (polish.27), in CSS px: the column as it would be, at this width
 * or less, is hidden; at a pixel more it stays at its floor. The author's own
 * figure: "if you drag a side panel all the way to the side (like within 50px
 * ish?) it snaps closed".
 */
export const COLUMN_SNAP_PX = 50;

/** Where a handle is and how far it may go, in CSS px. */
export interface ColumnRoom {
  column: Column;
  /** the window's width, which a set width is a share of */
  width: number;
  /** the column's width now */
  current: number;
  /** the least it may have: its floor */
  min: number;
  /** the most it may have: what leaves the prose `PROSE_MIN` beside the other column as drawn */
  max: number;
}

/** The room a column's handle has in a layout, or null when the column is folded and has none. */
export function columnRoom(layout: ColumnLayout, column: Column): ColumnRoom | null {
  if (layout[column] !== 'full') return null;
  const spec = COLUMN_WIDTHS[column];
  const current = column === 'files' ? layout.filesWidth : layout.sideWidth;
  const other = column === 'files' ? layout.sideWidth : layout.filesWidth;
  return {
    column,
    width: layout.width,
    current,
    min: spec.floor,
    max: Math.max(spec.floor, Math.floor(layout.width - PROSE_MIN - other))
  };
}

/**
 * Whether the handle is a control: the column can move at least one arrow
 * step between its limits. Otherwise the handle is drawn as the plain line,
 * out of the Tab order, and a drag, a double-click and the keys leave it alone.
 */
export function columnMovable(room: ColumnRoom): boolean {
  return room.max - room.min >= COLUMN_STEP_PX;
}

/**
 * The column's width for a drag `dx` CSS px to the right of where it started:
 * the chapter list widens as its edge goes right, the side panel as its edge
 * goes left.
 */
export function columnDragTarget(room: ColumnRoom, dx: number): number {
  return room.column === 'files' ? room.current + dx : room.current - dx;
}

/**
 * The column's new width for a move toward `target`, a width, kept between
 * the limits. Null when the handle would not move, by less than half a pixel,
 * or would move the other way.
 */
export function columnMove(room: ColumnRoom, target: number): number | null {
  const next = Math.max(room.min, Math.min(target, room.max));
  const moved = next - room.current;
  if (Math.abs(moved) < 0.5) return null;
  if (Math.sign(moved) !== Math.sign(target - room.current)) return null;
  return next;
}

/**
 * The share a width is of the window's width, to six places, which is within
 * a hundredth of a pixel in any window, and never 0 or 1.
 */
export function columnShare(width: number, windowWidth: number): number {
  if (!(windowWidth > 0)) return 0.5;
  const share = Math.round((width / windowWidth) * 1e6) / 1e6;
  return Math.min(0.999999, Math.max(0.000001, share));
}

/**
 * The share a drag `dx` CSS px to the right of where it started gives the
 * column, or null while the handle would not move from where the drag found
 * it: back where it started, or pressed on past a limit it was already at.
 * This is what the page draws during the drag, a drag past the threshold
 * included, which leaves the column at its floor until the release.
 */
export function columnDragShare(room: ColumnRoom, dx: number): number | null {
  const next = columnMove(room, columnDragTarget(room, dx));
  return next === null ? null : columnShare(next, room.width);
}

/**
 * Whether a column `width` CSS px wide, as a drag or a run of arrow presses
 * would make it, past its floor or not, snaps closed (polish.27): at
 * `COLUMN_SNAP_PX` or less.
 */
export function columnSnaps(width: number): boolean {
  return width <= COLUMN_SNAP_PX;
}

/**
 * Whether a release now, the drag `dx` CSS px to the right of where it
 * started, would snap the column closed (polish.27): what the page shows by
 * fading the column while the pointer is there.
 */
export function columnDragSnaps(room: ColumnRoom, dx: number): boolean {
  return columnSnaps(columnDragTarget(room, dx));
}

/**
 * A width to keep: the column, and its share of the window's width, null for
 * its usual width; or, with `hide`, the column snapped closed (polish.27),
 * hidden as its button hides it, with `share` the width it keeps for the next
 * show, the one it had before the drag.
 */
export interface ColumnWrite {
  column: Column;
  share: number | null;
  hide?: true;
}

/**
 * What a drag or a run of arrow presses that would make the column `target`
 * CSS px wide writes: the column snapped closed, keeping `before`, its share
 * in settings before the drag, at `COLUMN_SNAP_PX` or less (polish.27);
 * otherwise its new share, kept between its limits, or nothing where the
 * handle would not move (`columnMove`).
 */
function columnTargetWrite(room: ColumnRoom, target: number, before: number | null): ColumnWrite | null {
  if (columnSnaps(target)) return { column: room.column, share: before, hide: true };
  const next = columnMove(room, target);
  return next === null ? null : { column: room.column, share: columnShare(next, room.width) };
}

/**
 * What a drag's release writes, the button coming up `dx` CSS px to the right
 * of where it went down: the column snapped closed where the drag would leave
 * it `COLUMN_SNAP_PX` wide or less, keeping `before`, its share in settings as
 * the drag started (polish.27); otherwise the share the drag reached
 * (`columnDragShare`), or nothing back where it started.
 */
export function columnDragWrite(room: ColumnRoom, dx: number, before: number | null): ColumnWrite | null {
  return columnTargetWrite(room, columnDragTarget(room, dx), before);
}

/**
 * The widths to lay the columns out with while a drag is under way: those in
 * settings with the dragged column's share in place of its own, so the other
 * column stays where it is. Null, which lays them out from settings, when the
 * drag has no share (`columnDragShare`).
 */
export function columnLiveShares(
  saved: ColumnShares,
  column: Column,
  share: number | null
): ColumnShares | null {
  return share === null ? null : { ...saved, [column]: share };
}

/**
 * A key the handle takes: an arrow's step, `by` CSS px on the column's width
 * (narrower where negative); Home's or End's move to a limit; or Enter's
 * usual width.
 */
export type ColumnKeyAction =
  { kind: 'step'; by: number } | { kind: 'move'; target: number } | { kind: 'reset' };

/**
 * What a key does with the focus on a handle: the left and right arrows move
 * the edge a step that way, which widens the chapter list on the right arrow
 * and the side panel on the left; Home gives the column its least width and
 * End its most, as the value a screen reader reads is the column's share of
 * the window; Enter puts back the usual width. Null for any other key, the up
 * and down arrows among them, which go on stepping through the suggestions,
 * or one pressed with Ctrl, Alt or Cmd.
 */
export function columnKeyAction(
  event: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean },
  room: ColumnRoom
): ColumnKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  switch (event.key) {
    case 'ArrowLeft':
      return { kind: 'step', by: columnDragTarget(room, -COLUMN_STEP_PX) - room.current };
    case 'ArrowRight':
      return { kind: 'step', by: columnDragTarget(room, COLUMN_STEP_PX) - room.current };
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
 * A run of arrow presses that narrow the column, the keyboard's drag toward
 * the window's edge (polish.27): the column's share in settings before the
 * run's first press, which a snap keeps, and the width the run has reached,
 * which goes on past the floor a step a press, as a pointer goes on past it,
 * while the column stays drawn at its floor.
 */
export interface ColumnKeyRun {
  column: Column;
  before: number | null;
  reach: number;
}

/** What a key the handle takes writes, and the run of narrowing presses after it. */
export interface ColumnKeyPress {
  write: ColumnWrite | null;
  /** the run this press leaves under way, null once it has ended */
  run: ColumnKeyRun | null;
}

/**
 * What a key the handle takes (`columnKeyAction`) writes, with `before` the
 * column's share in settings now and `run` the narrowing presses just before
 * it: the column's new share for an arrow, Home or End, and its usual width
 * for Enter; nothing when the column is at the limit the key moves it toward
 * already.
 *
 * An arrow toward the window's edge carries on the run before it (polish.27):
 * while the column is drawn at its floor, from the width the run has reached,
 * so that presses past the floor go on toward the edge, the column held at
 * its floor, as a pointer does; otherwise from the width drawn. The press
 * that reaches `COLUMN_SNAP_PX` or less snaps the column closed, keeping its
 * share from before the run's first press, as a drag's release does. Any
 * other key ends the run, and so does the page when the focus leaves the
 * handle or the pointer takes it.
 */
export function columnKeyPress(
  action: ColumnKeyAction,
  room: ColumnRoom,
  before: number | null,
  run: ColumnKeyRun | null
): ColumnKeyPress {
  const column = room.column;
  if (action.kind === 'reset') return { write: { column, share: null }, run: null };
  if (action.kind === 'move') {
    const next = columnMove(room, action.target);
    return { write: next === null ? null : { column, share: columnShare(next, room.width) }, run: null };
  }
  if (action.by >= 0) return { write: columnTargetWrite(room, room.current + action.by, before), run: null };
  const going = run !== null && run.column === column ? run : null;
  const from =
    going !== null && room.current <= room.min ? Math.min(going.reach, room.current) : room.current;
  const reach = from + action.by;
  const kept = going !== null ? going.before : before;
  const write = columnTargetWrite(room, reach, kept);
  return { write, run: write?.hide ? null : { column, before: kept, reach } };
}

/** What a handle says: its spoken name and its tooltip. */
export interface ColumnHandleText {
  label: string;
  title: string;
}

/** The tooltip of a handle that cannot move an arrow step (`columnMovable`). */
export const COLUMN_TITLE_STILL =
  'The window is too narrow to move this line. Make the window wider, or zoom out, to give it room.';

/** A handle's name and tooltip, by column and whether it can move. */
export function columnHandleText(column: Column, still: boolean): ColumnHandleText {
  const name = COLUMN_NAMES[column];
  return {
    label: `Width of the ${name}`,
    title: still
      ? COLUMN_TITLE_STILL
      : `Drag to make the ${name} wider or narrower. Double-click it, or press Enter, for the usual width.`
  };
}

/** A handle's value for a screen reader: the column's share of the window as a percentage, and its limits. */
export function columnAria(room: ColumnRoom): {
  valueMin: number;
  valueMax: number;
  valueNow: number;
  valueText: string;
} {
  const percent = (width: number): number =>
    room.width > 0 ? Math.round((Math.max(0, width) / room.width) * 100) : 0;
  const valueNow = percent(room.current);
  const name = COLUMN_NAMES[room.column];
  return {
    valueMin: Math.min(percent(room.min), valueNow),
    valueMax: Math.max(percent(room.max), valueNow),
    valueNow,
    valueText: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${valueNow}% of the window's width`
  };
}
