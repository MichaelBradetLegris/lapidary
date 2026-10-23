import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import type { ColumnShares } from '../../shared/types';
import {
  columnLayout,
  shownDrawer,
  toggledDrawer,
  USUAL_COLUMN_WIDTHS,
  type Column,
  type ColumnLayout
} from '../../shared/ui/columns';
import { saveHintGivesWay } from './hints';
import { useApp } from './store';

/**
 * The side columns at narrow widths (ui.3, PLAN 7 "Narrow windows"): the page's
 * width measured, the layout `columnLayout` gives for it with the widths the
 * author set (polish.5, PLAN 7 "Column widths"), and the one drawer the author
 * has open. The rules are in `src/shared/ui/columns.ts`; the handles that set
 * the widths are `useColumnHandle` (state/columnHandles.ts).
 */

interface DrawerState {
  /** the drawer the author opened from its strip, if any */
  open: Column | null;
  setOpen: (open: Column | null) => void;
}

/** Which drawer is open. Its own store, so the keyboard bindings can close it on Escape. */
export const useDrawer = create<DrawerState>((set) => ({
  open: null,
  setOpen: (open) => set({ open })
}));

/** The id of a column's wrapper, which its strip's `aria-controls` names. */
export function drawerId(column: Column): string {
  return `drawer-${column}`;
}

/**
 * What closes on Escape in a window listener of its own, added after the
 * keyboard bindings' and so run after them: the toolbar's menus, Review and
 * Actions (an Escape pressed in a menu's list never reaches the window,
 * `ToolbarMenu`, polish.7), and the status bar's legend. While one of them is
 * open, an Escape is theirs, and the drawer waits for the next press
 * (keyboard.ts).
 */
const CLOSES_ON_ESCAPE = '.menu__list, .legend';

/** Whether a toolbar menu or the legend is open, which an Escape closes first. */
export function popupTakesEscape(): boolean {
  return document.querySelector(CLOSES_ON_ESCAPE) !== null;
}

/** Whether `target` is inside the open drawer or on its strip. */
export function inOpenDrawer(target: EventTarget | null): boolean {
  const open = useDrawer.getState().open;
  if (open === null || !(target instanceof Node)) return false;
  const drawer = document.getElementById(drawerId(open));
  const strip = document.querySelector(`button.strip--${open}`);
  return Boolean(drawer?.contains(target) || strip?.contains(target));
}

/**
 * Close the open drawer, or only `column`'s when one is named. When the focus
 * was inside it, it goes to the drawer's strip, which is still on screen, rather
 * than being lost with the drawer.
 */
export function closeDrawer(column?: Column): void {
  const { open, setOpen } = useDrawer.getState();
  if (open === null || (column !== undefined && open !== column)) return;
  const drawer = document.getElementById(drawerId(open));
  const focusInside = drawer !== null && drawer.contains(document.activeElement);
  setOpen(null);
  if (focusInside) document.querySelector<HTMLElement>(`button.strip--${open}`)?.focus();
}

export interface Columns {
  layout: ColumnLayout;
  /**
   * for the handles (`useColumnHandle`): the widths to lay the columns out
   * with while a drag is under way, in place of those in settings; null when
   * none is
   */
  setLive: (live: ColumnShares | null) => void;
  /** the drawer on screen: the one opened, while its column is folded */
  shown: Column | null;
  /** the ref callback for `.body`, measured as the window, and so the zoom, changes */
  measure: (element: HTMLDivElement | null) => (() => void) | undefined;
  /** the widths, as custom properties for `.body` (app.css) */
  style: CSSProperties;
  /** a strip's click: open its drawer, or close it when open */
  toggle: (column: Column) => void;
}

/**
 * Measure `.body`, which spans the window, and lay the columns out for its
 * width, with the widths kept in settings (`columnWidths`), or those of a drag
 * under way. The first layout is worked out from the window's own width, so
 * the first paint already has it. A drawer the author opened is forgotten once
 * its column is drawn in place again, so it does not come back by itself when
 * the window next narrows.
 */
export function useColumns(hasReview: boolean): Columns {
  const [width, setWidth] = useState(() => window.innerWidth);
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return undefined;
    setWidth(element.clientWidth);
    // Rendered at once, before the frame is painted, so a zoom step never
    // shows a frame of the old layout at the new width.
    const observer = new ResizeObserver(() => flushSync(() => setWidth(element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const saved = useApp((s) => s.settings?.columnWidths ?? USUAL_COLUMN_WIDTHS);
  const [live, setLive] = useState<ColumnShares | null>(null);
  const kept = live ?? saved;
  const layout = useMemo(() => columnLayout(width, kept), [width, kept]);
  const open = useDrawer((s) => s.open);
  const shown = shownDrawer(open, layout, hasReview);

  useEffect(() => {
    if (open !== null && shown === null) useDrawer.getState().setOpen(null);
  }, [open, shown]);

  const toggle = useCallback((column: Column) => {
    const { open: now, setOpen } = useDrawer.getState();
    const next = toggledDrawer(now, column);
    // A drawer opened, from the keyboard too: a first-use hint over the prose
    // gives way, rather than lying over the drawer's top (state/hints.ts).
    if (next !== null) saveHintGivesWay();
    setOpen(next);
  }, []);

  const style = useMemo(
    () =>
      ({
        '--files-col': `${layout.filesWidth}px`,
        '--side-col': `${layout.sideWidth}px`,
        '--files-drawer': `${layout.filesDrawer}px`,
        '--side-drawer': `${layout.sideDrawer}px`
      }) as CSSProperties,
    [layout]
  );

  return { layout, setLive, shown, measure, style, toggle };
}
