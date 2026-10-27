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
  columnDragSnaps,
  columnDragWrite,
  columnHandleText,
  columnKeyAction,
  columnKeyPress,
  columnLiveShares,
  columnMovable,
  columnRoom,
  type ColumnKeyRun,
  type ColumnRoom
} from '../../shared/ui/columnHandle';
import { USUAL_COLUMN_WIDTHS, type Column, type ColumnLayout } from '../../shared/ui/columns';
import { call } from './client';
import { drawerId } from './columns';
import { saveColumnHidden, saveColumnSnap, saveColumnWidth, type ColumnIo } from './columnWidths';
import { useApp } from './store';

/*
 * The handles on the side columns' inner edges (polish.5, PLAN 7 "Column
 * widths"), built as the side panel's split is (ui.6, state/splitHandle.ts).
 * The rules are in src/shared/ui/columnHandle.ts, with what a drag draws and
 * what a key writes; this follows the pointer and the keys, and while a drag
 * lasts hands its widths to `useColumns` (its `setLive`, which App passes on),
 * which lays the columns out with them, so the edge follows the pointer and
 * the other column stays put. The width reaches settings when the drag ends, or
 * at once from the keys. A folded column has no handle, nor a hidden one; one
 * that cannot move an arrow step is the border it lies on: disabled, out of
 * the Tab order, and still to the pointer. Each column's button at an end of
 * the toolbar hides it and brings it back (polish.28,
 * components/PanelButton.tsx), through `setColumnHidden` below; polish.26's
 * carets at the top of the handles did until then. A handle dragged to the
 * window's edge, or moved there by the arrow keys, hides its column too
 * (polish.27, `snapColumnClosed`), the column faded while a release would.
 */

const COLUMN_IO: ColumnIo = {
  setSettings: (patch) => call('settings:set', patch)
};

/** The selector of a column's button at an end of the toolbar (polish.28). */
export function panelButtonSelector(column: Column): string {
  return `button.toolbar__panel--${column}`;
}

/**
 * A column's button in the toolbar pressed (polish.28): hide the column, or
 * bring it back at the width it had, and keep the setting for the next start.
 * The page takes it at once, before it is written, and lays the columns out
 * again before this returns, so the focus can follow. A press, by the pointer
 * or the keys, leaves it on the button, which stays where it is; but should it
 * have been inside the column hidden, or on something the layout took away
 * (the column's handle, or its strip in a narrow window), it goes to the
 * column's button rather than being lost to the page's body, as a closing
 * drawer hands it to its strip (`closeDrawer`). The column's wrapper stays,
 * out of sight and inert.
 */
export function setColumnHidden(column: Column, hidden: boolean): void {
  hideColumn(column, hidden, () => {
    void saveColumnHidden(column, hidden, COLUMN_IO);
  });
}

/**
 * Hide `column` or bring it back by `write`, laying the columns out again
 * before this returns, and follow the focus as `setColumnHidden` says: the
 * button's press and a handle's snap share it.
 */
function hideColumn(column: Column, hidden: boolean, write: () => void): void {
  const active = document.activeElement;
  const inColumn = hidden && Boolean(active && document.getElementById(drawerId(column))?.contains(active));
  flushSync(write);
  const takenAway = active !== null && !active.isConnected;
  if (takenAway || inColumn) document.querySelector<HTMLElement>(panelButtonSelector(column))?.focus();
}

/**
 * A handle dragged to the window's edge, or moved there by the arrow keys,
 * snaps its column closed (polish.27): hidden as its button hides it, keeping
 * `share`, the width it had before the drag, null for its usual width, for
 * the next show, in one write. `settle` ends the drag in the same render, so
 * no frame shows the column back at that width before it goes. The handle
 * goes with the column, so a snap from the keys hands the focus to the
 * column's button, where Enter brings the column back.
 */
function snapColumnClosed(column: Column, share: number | null, settle: () => void): void {
  hideColumn(column, true, () => {
    settle();
    void saveColumnSnap(column, share, COLUMN_IO);
  });
}

export type ColumnHandleProps = HTMLAttributes<HTMLDivElement> & { 'aria-orientation': 'vertical' };

interface Drag {
  pointerId: number;
  startX: number;
  room: ColumnRoom;
  /** the handle, which a fold under the drag takes away */
  element: Element;
  /** the column's share in settings as the drag started, which a snap keeps (polish.27) */
  before: number | null;
  /** how far right of where it started the pointer last moved, in CSS px */
  dx: number;
}

/** The column's share in settings now, null for its usual width. */
function savedShare(column: Column): number | null {
  return (useApp.getState().settings?.columnWidths ?? USUAL_COLUMN_WIDTHS)[column];
}

/**
 * The handle on `column`'s inner edge in `layout`, or null while the column
 * is folded to a strip or hidden. `setLive` hands `useColumns` the widths to
 * draw while a drag is under way, null when none is or the drag is back where
 * it started, and the column while a release would snap it closed (polish.27).
 */
export function useColumnHandle(
  column: Column,
  layout: ColumnLayout,
  setLive: (live: ColumnShares | null, snapping?: Column | null) => void
): ColumnHandleProps | null {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  /** the arrow presses toward the window's edge under way (polish.27), null for none */
  const keyRun = useRef<ColumnKeyRun | null>(null);

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

  /* The other column stays as set while this one is dragged, and this one
     fades while a release would snap it closed (polish.27), held at its
     floor until then. */
  const showLive = (d: Drag): void => {
    const saved = useApp.getState().settings?.columnWidths ?? USUAL_COLUMN_WIDTHS;
    const snapping = columnDragSnaps(d.room, d.dx) ? column : null;
    setLive(columnLiveShares(saved, column, columnDragShare(d.room, d.dx)), snapping);
  };

  const finish = (pointerId: number, keep: boolean): void => {
    const d = drag.current;
    if (!d || d.pointerId !== pointerId) return;
    drag.current = null;
    const settle = (): void => {
      setDragging(false);
      setLive(null);
    };
    const write = keep ? columnDragWrite(d.room, d.dx, d.before) : null;
    // Let go past the threshold, the column goes, keeping the width it had.
    if (write?.hide) {
      snapColumnClosed(column, write.share, settle);
      return;
    }
    // The store takes the width at once, so the edge stays where it was let go.
    if (write) void saveColumnWidth(column, write.share, COLUMN_IO);
    settle();
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
      keyRun.current = null;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        room: dragRoom,
        element: event.currentTarget,
        before: savedShare(column),
        dx: 0
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.pointerId !== event.pointerId) return;
      d.dx = event.clientX - d.startX;
      showLive(d);
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
      /* Enter writes the usual width; a key at the limit it moves toward,
         nothing. An arrow toward the window's edge carries on the presses
         before it, past the floor too, and the one that takes the column to
         the threshold snaps it closed, keeping the width it had before the
         first (polish.27). */
      const press = columnKeyPress(action, keyRoom, savedShare(column), keyRun.current);
      keyRun.current = press.run;
      const write = press.write;
      if (write?.hide) snapColumnClosed(column, write.share, () => undefined);
      else if (write) void saveColumnWidth(write.column, write.share, COLUMN_IO);
    },
    // The focus gone from the handle ends a run of arrow presses.
    onBlur: () => {
      keyRun.current = null;
    }
  };
}
