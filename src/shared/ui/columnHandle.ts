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
 * is not (C.59). A column folded away by the caret at the top of its handle
 * (polish.26) has no handle either, and the other column has the room it
 * left; what the carets say and which way they point are here too
 * (`columnCaretText`, `columnCaretPoints`).
 *
 * Pure (CLAUDE.md rule 4). The page draws the handles and follows the pointer
 * and the keys (`src/renderer/state/columnHandles.ts`); what it draws during a
 * drag and what it writes are decided here (`columnDragShare`,
 * `columnLiveShares`, `columnKeyWrite`), so that they are tested.
 */

import type { ColumnShares } from '../types';
import { COLUMN_WIDTHS, PROSE_MIN, type Column, type ColumnLayout } from './columns';

/** How far an arrow key moves a handle, in CSS px, as for the split (`SPLIT_STEP_PX`). */
export const COLUMN_STEP_PX = 24;

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
 */
export function columnDragShare(room: ColumnRoom, dx: number): number | null {
  const next = columnMove(room, columnDragTarget(room, dx));
  return next === null ? null : columnShare(next, room.width);
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

export type ColumnKeyAction = { kind: 'move'; target: number } | { kind: 'reset' };

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
      return { kind: 'move', target: columnDragTarget(room, -COLUMN_STEP_PX) };
    case 'ArrowRight':
      return { kind: 'move', target: columnDragTarget(room, COLUMN_STEP_PX) };
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

/** A width to keep: the column, and its share of the window's width, null for its usual width. */
export interface ColumnWrite {
  column: Column;
  share: number | null;
}

/**
 * What a key the handle takes (`columnKeyAction`) writes: the column's new
 * share for a move, and its usual width for Enter. Null when there is nothing
 * to write, the column being at the limit the key moves it toward already.
 */
export function columnKeyWrite(action: ColumnKeyAction, room: ColumnRoom): ColumnWrite | null {
  if (action.kind === 'reset') return { column: room.column, share: null };
  const next = columnMove(room, action.target);
  return next === null ? null : { column: room.column, share: columnShare(next, room.width) };
}

/** The column's name in a handle's words. */
const COLUMN_NAMES: Readonly<Record<Column, string>> = Object.freeze({
  files: 'chapter list',
  side: 'side panel'
});

/** What a handle says: its spoken name and its tooltip. */
export interface ColumnHandleText {
  label: string;
  title: string;
}

/** The tooltip of a handle that cannot move an arrow step (`columnMovable`). */
export const COLUMN_TITLE_STILL =
  'The window is too narrow to move this line. Make the window wider, or zoom out, to give it room.';

/**
 * What a column's caret says (polish.26), as its accessible name and its
 * tooltip: on the handle, which folds the column away, "Hide the chapter
 * list"; on the edge strip, which brings it back, "Show the chapter list"
 * ("the side panel" for the other).
 */
export function columnCaretText(column: Column, hidden: boolean): string {
  return `${hidden ? 'Show' : 'Hide'} the ${COLUMN_NAMES[column]}`;
}

/**
 * Which way a column's caret points: at the window's edge on the handle,
 * where it folds the column away, and in from it on the edge strip, where it
 * brings the column back.
 */
export function columnCaretPoints(column: Column, hidden: boolean): 'left' | 'right' {
  const outward = column === 'files' ? 'left' : 'right';
  if (!hidden) return outward;
  return outward === 'left' ? 'right' : 'left';
}

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
