import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent
} from 'react';
import { flushSync } from 'react-dom';
import type { ColumnShares } from '../../shared/types';
import {
  columnAria,
  columnDragShare,
  columnHandleText,
  columnKeyAction,
  columnKeyWrite,
  columnLiveShares,
  columnMovable,
  columnRoom,
  type ColumnRoom
} from '../../shared/ui/columnHandle';
import { USUAL_COLUMN_WIDTHS, type Column, type ColumnLayout } from '../../shared/ui/columns';
import { call } from './client';
import { drawerId } from './columns';
import { saveColumnHidden, saveColumnWidth, type ColumnIo } from './columnWidths';
import { useApp } from './store';

/*
 * The handles on the side columns' inner edges (polish.5, PLAN 7 "Column
 * widths"), built as the side panel's split is (ui.6, state/splitHandle.ts).
 * The rules are in src/shared/ui/columnHandle.ts, with what a drag draws and
 * what a key writes; this follows the pointer and the keys, and while a drag
 * lasts hands its widths to `useColumns` (its `setLive`, which App passes on),
 * which lays the columns out with them, so the edge follows the pointer and
 * the other column stays put. The width reaches settings when the drag ends, or
 * at once from the keys. A folded column has no handle, nor one folded away;
 * one that cannot move an arrow step is the border it lies on: disabled, out
 * of the Tab order, and still to the pointer. At the top of each handle is the
 * caret that folds its column away (polish.26, components/ColumnCaret.tsx),
 * which `setColumnHidden` below presses, as it does the edge strip's that
 * brings the column back; that one stays a control where the handle cannot
 * move.
 */

const COLUMN_IO: ColumnIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/** The selector of a column's caret: on its handle, or, folded away, its edge strip (polish.26). */
export function caretSelector(column: Column, hidden: boolean): string {
  return hidden ? `button.column-edge--${column}` : `button.column-caret--${column}`;
}

/**
 * A column's caret pressed (polish.26): fold the column away to its edge
 * strip, or bring it back at the width it had, and keep the setting for the
 * next start. The page takes it at once, before it is written, and lays the
 * columns out again before this returns, so the focus can follow: when it was
 * on the caret pressed, from the keyboard, it goes to the caret that takes its
 * place, the edge strip's or the handle's; and when it was inside the column
 * folded away or on its handle, which a press by the pointer leaves where it
 * was, to the edge strip, as a drawer closing hands it to its strip
 * (`closeDrawer`), rather than being lost with the column. The handle goes
 * with the column, so the test after the layout is whether the focus was on
 * something the layout took away; the column's wrapper stays, out of sight.
 */
export function setColumnHidden(column: Column, hidden: boolean, pressed: Element): void {
  const active = document.activeElement;
  const inColumn = hidden && Boolean(active && document.getElementById(drawerId(column))?.contains(active));
  flushSync(() => {
    void saveColumnHidden(column, hidden, COLUMN_IO);
  });
  const takenAway = active !== null && !active.isConnected;
  if (active === pressed || takenAway || inColumn) {
    document.querySelector<HTMLElement>(caretSelector(column, hidden))?.focus();
  }
}

export type ColumnHandleProps = HTMLAttributes<HTMLDivElement> & { 'aria-orientation': 'vertical' };

interface Drag {
  pointerId: number;
  startX: number;
  room: ColumnRoom;
  /** the handle, which a fold under the drag takes away */
  element: Element;
}

/**
 * The handle on `column`'s inner edge in `layout`, or null while the column
 * is folded to a strip. `setLive` hands `useColumns` the widths to draw while
 * a drag is under way, null when none is or the drag is back where it started.
 */
export function useColumnHandle(
  column: Column,
  layout: ColumnLayout,
  setLive: (live: ColumnShares | null) => void
): ColumnHandleProps | null {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** the share a drag has reached; null when it is back where it started (`columnDragShare`) */
  const liveShare = useRef<number | null>(null);

  /* While a drag is under way the pointer keeps the col-resize shape wherever
     it goes, and no text is selected (app.css `.column-resizing`). A handle
     taken away under a drag, as when a zoom key folds its column, loses the
     pointer without hearing of it, so the release reaches the window instead,
     which ends the drag there, keeping nothing. */
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    root.classList.add('column-resizing');
    const release = (event: globalThis.PointerEvent): void => {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId || d.element.isConnected) return;
      drag.current = null;
      liveShare.current = null;
      setDragging(false);
      setLive(null);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      root.classList.remove('column-resizing');
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [dragging, setLive]);

  const room = columnRoom(layout, column);
  if (!room) return null;
  const still = !columnMovable(room);
  const aria = columnAria(room);
  const text = columnHandleText(column, still);

  /** The room as the columns are drawn, when the handle can move; null when it cannot. */
  const movableRoom = (): ColumnRoom | null => (columnMovable(room) ? room : null);

  // The other column stays as set while this one is dragged.
  const showLive = (share: number | null): void => {
    liveShare.current = share;
    const saved = useApp.getState().settings?.columnWidths ?? USUAL_COLUMN_WIDTHS;
    setLive(columnLiveShares(saved, column, share));
  };

  const finish = (pointerId: number, keep: boolean): void => {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    drag.current = null;
    setDragging(false);
    const last = liveShare.current;
    liveShare.current = null;
    // The store takes the width at once, so the edge stays where it was let go.
    if (keep && last !== null) void saveColumnWidth(column, last, COLUMN_IO);
    setLive(null);
  };

  return {
    className: `column-handle column-handle--${column}${dragging ? ' column-handle--dragging' : ''}`,
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': text.label,
    'aria-controls': drawerId(column),
    'aria-valuemin': aria.valueMin,
    'aria-valuemax': aria.valueMax,
    'aria-valuenow': aria.valueNow,
    'aria-valuetext': aria.valueText,
    'aria-disabled': still ? true : undefined,
    tabIndex: still ? -1 : 0,
    title: text.title,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary || drag.current) return;
      /* No text selection, and the focus stays where it was, as on the
         split's handle (ui.6): the arrows go on stepping through the
         suggestions after a drag. So too on a handle that cannot move, which
         a press then leaves alone. */
      event.preventDefault();
      const dragRoom = movableRoom();
      if (!dragRoom) return;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        room: dragRoom,
        element: event.currentTarget
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId) return;
      showLive(columnDragShare(d.room, event.clientX - d.startX));
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, false),
    onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => finish(event.pointerId, true),
    onDoubleClick: () => {
      if (movableRoom()) void saveColumnWidth(column, null, COLUMN_IO);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      // A handle that cannot move takes no key.
      const keyRoom = movableRoom();
      if (!keyRoom) return;
      const action = columnKeyAction(event, keyRoom);
      if (!action) return;
      event.preventDefault();
      // Enter writes the usual width; a key at the limit it moves toward, nothing.
      const write = columnKeyWrite(action, keyRoom);
      if (write) void saveColumnWidth(write.column, write.share, COLUMN_IO);
    }
  };
}
