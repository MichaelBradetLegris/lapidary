/**
 * How the chapter list and the side panel give way to the prose (ui.3, PLAN 7
 * "Narrow windows"). Zooming in makes the window narrower in CSS pixels, and
 * the two side columns used to keep most of it: a 900 by 600 window at 150%
 * left the centre column 179 px and the prose's text 25 px wide, and from 175%
 * no text at all.
 *
 * The centre column is kept at least `PROSE_MIN` wide while the window allows
 * it. First both side columns give some of their width back, down to a floor;
 * then the chapter list folds to a strip at the window's left edge; then the
 * side panel folds to a strip at its right edge. A strip is a button: it opens
 * its column as a drawer over the edge of the prose, at the column's usual
 * width, and the drawer closes again from the strip, with Escape, with a click
 * in the prose, or, for the chapter list, once a chapter opens.
 *
 * Everything here is a function of the window's width in CSS pixels, which
 * zoom changes and nothing on the page does, so the layout cannot feed back on
 * itself, and of the widths the author set by moving the columns' inner edges
 * (polish.5, `columnWidths` in settings), each a share of the window's width,
 * which take the place of the usual widths before anything gives way. They
 * change where the columns are drawn, never where they fold: a column folds
 * at the window width it folded at before, whatever its width was set to.
 * `src/renderer/state/columns.ts` measures the width and applies it; the
 * edges' rules are in `columnHandle.ts`.
 *
 * Pure (CLAUDE.md rule 4).
 */

import type { ColumnShares } from '../types';

/** The width the centre column is kept at while the window allows it, in CSS pixels. */
export const PROSE_MIN = 480;

/** The width of a folded column: one button, the height of the column. */
export const STRIP_WIDTH = 32;

/** What an open drawer leaves of the centre column, at the least, to click back into. */
export const DRAWER_MARGIN = 48;

/**
 * Below `PROSE_MIN` the review pane's own side padding narrows to this, from
 * the 40 px it has otherwise, so the text keeps more of a narrow centre column.
 */
export const NARROW_PANE_PADDING = 16;

/** A side column's widths: what it takes, as a share of the window between two limits, and its floor. */
export interface ColumnWidths {
  /** the least it takes while the window has room */
  min: number;
  /** its share of the window's width */
  share: number;
  /** the most it takes */
  max: number;
  /** how far it shrinks for the prose before it folds to a strip */
  floor: number;
}

/** The chapter list: 18% of the window, 170 to 230 px, as before ui.3; down to 150 px for the prose. */
export const FILES_WIDTHS: ColumnWidths = { min: 170, share: 0.18, max: 230, floor: 150 };

/** The side panel: 24% of the window, 240 to 320 px, as before ui.3; down to 200 px for the prose. */
export const SIDE_WIDTHS: ColumnWidths = { min: 240, share: 0.24, max: 320, floor: 200 };

export type Column = 'files' | 'side';

/** Each column's widths. */
export const COLUMN_WIDTHS: Readonly<Record<Column, ColumnWidths>> = Object.freeze({
  files: FILES_WIDTHS,
  side: SIDE_WIDTHS
});

/** Both columns at their usual widths: the `columnWidths` setting of a first run. */
export const USUAL_COLUMN_WIDTHS: Readonly<ColumnShares> = Object.freeze({ files: null, side: null });

/**
 * A column's width from settings.json: a share of the window's width strictly
 * between 0 and 1, or null, its usual width, for anything else.
 */
export function normalizeColumnShare(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

/** The `columnWidths` setting (PLAN 11.3 d) from whatever settings.json holds. */
export function normalizeColumnWidths(value: unknown): ColumnShares {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return { files: normalizeColumnShare(raw['files']), side: normalizeColumnShare(raw['side']) };
}

/** A side column drawn in place, or folded to a strip. */
export type ColumnMode = 'full' | 'strip';

export interface ColumnLayout {
  /** the window's width the layout is for, in CSS pixels, which a column's set width is a share of */
  width: number;
  files: ColumnMode;
  side: ColumnMode;
  /** the chapter list's grid column, in CSS pixels: its width, or the strip's */
  filesWidth: number;
  /** the side panel's grid column */
  sideWidth: number;
  /** what the two leave the centre column */
  centre: number;
  /** a folded chapter list's drawer width, its usual or set width less what the window cannot spare */
  filesDrawer: number;
  /** a folded side panel's drawer width */
  sideDrawer: number;
  /** the centre column is narrower than `PROSE_MIN` even with both columns folded */
  narrow: boolean;
}

/** The usual width of a column when nothing has to give: its share of the window, between its limits. */
export function preferredWidth(spec: ColumnWidths, width: number): number {
  return Math.floor(Math.min(spec.max, Math.max(spec.min, spec.share * width)));
}

/**
 * The width a column takes when nothing has to give (polish.5): the share of
 * the window the author set, to the nearest pixel and never under the
 * column's floor, or its usual width when they set none. Rounded to the
 * nearest pixel, not down, so a share written for a width gives that width
 * back in the same window.
 */
export function keptWidth(spec: ColumnWidths, share: number | null, width: number): number {
  if (share === null) return preferredWidth(spec, width);
  return Math.max(spec.floor, Math.round(share * width));
}

/**
 * The layout for a window `width` CSS pixels wide (the page's own width, which
 * zoom changes), with the widths the author set (`kept`, the usual widths
 * where null), in four steps, the first that leaves the centre column
 * `PROSE_MIN`:
 *
 * 1. both columns at their set or usual widths (`keptWidth`);
 * 2. both columns given back toward their floors, each in proportion to what
 *    it can give, so neither reaches its floor before the other;
 * 3. the chapter list folded to a strip, the side panel at its set or usual
 *    width or less, down to its floor;
 * 4. both folded, and the centre column takes the rest, `narrow` when that is
 *    still less than `PROSE_MIN`.
 *
 * The step depends on the window's width alone from step 3 on: the list folds
 * below the width that leaves its floor, the panel's and `PROSE_MIN`, and the
 * panel below the strip's, its floor and `PROSE_MIN`, whatever was set.
 *
 * Column widths are whole pixels, rounded down where a column gives way, so
 * the centre column gets the fractions and never ends up a pixel short.
 */
export function columnLayout(width: number, kept: ColumnShares = USUAL_COLUMN_WIDTHS): ColumnLayout {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const files = keptWidth(FILES_WIDTHS, kept.files, w);
  const side = keptWidth(SIDE_WIDTHS, kept.side, w);
  const make = (f: ColumnMode, fw: number, s: ColumnMode, sw: number): ColumnLayout => {
    const centre = w - fw - sw;
    return {
      width: w,
      files: f,
      side: s,
      filesWidth: fw,
      sideWidth: sw,
      centre,
      // A drawer leaves its own strip, the other column as drawn, and some prose.
      filesDrawer: drawerWidth(files, w - STRIP_WIDTH - sw),
      sideDrawer: drawerWidth(side, w - STRIP_WIDTH - fw),
      narrow: centre < PROSE_MIN
    };
  };

  if (w - files - side >= PROSE_MIN) return make('full', files, 'full', side);

  const need = PROSE_MIN - (w - files - side);
  const filesGives = files - FILES_WIDTHS.floor;
  const sideGives = side - SIDE_WIDTHS.floor;
  if (need <= filesGives + sideGives) {
    const share = need / (filesGives + sideGives);
    return make('full', Math.floor(files - filesGives * share), 'full', Math.floor(side - sideGives * share));
  }

  const room = w - STRIP_WIDTH - PROSE_MIN;
  if (room >= SIDE_WIDTHS.floor) return make('strip', STRIP_WIDTH, 'full', Math.min(side, Math.floor(room)));

  return make('strip', STRIP_WIDTH, 'strip', STRIP_WIDTH);
}

/**
 * An open drawer is the column's set or usual width, but leaves its own strip,
 * the other column as drawn and `DRAWER_MARGIN` of the centre column
 * uncovered, so there is always some prose to click to close it. `beside` is
 * the window less the drawer's strip and the other column: with both folded,
 * the window less both strips. A drawer opened beside the side panel in place
 * never covers it (polish.5), however wide the list was set.
 */
function drawerWidth(kept: number, beside: number): number {
  return Math.max(0, Math.min(kept, Math.floor(beside - DRAWER_MARGIN)));
}

/**
 * The drawer shown, of the one the author opened: none when that column is
 * drawn in place, as after the window widened or the zoom went down, and none
 * for the side panel while no chapter is open, since it has nothing to show.
 */
export function shownDrawer(
  open: Column | null,
  layout: Pick<ColumnLayout, 'files' | 'side'>,
  hasReview: boolean
): Column | null {
  if (open === null || layout[open] !== 'strip') return null;
  if (open === 'side' && !hasReview) return null;
  return open;
}

/**
 * `.body`'s classes: which columns are folded, and `body--narrow` when the
 * centre column is narrower than `PROSE_MIN` even so, which narrows the review
 * pane's side padding to `NARROW_PANE_PADDING` (app.css).
 */
export function bodyClassName(layout: Pick<ColumnLayout, 'files' | 'side' | 'narrow'>): string {
  const names = ['body'];
  if (layout.files === 'strip') names.push('body--files-strip');
  if (layout.side === 'strip') names.push('body--side-strip');
  if (layout.narrow) names.push('body--narrow');
  return names.join(' ');
}

/**
 * A column's wrapper: `column`, which lays out nothing while the column is
 * drawn in place; `column--drawer` while it is folded, when the wrapper is the
 * drawer; and `column--open` while that drawer is on screen.
 */
export function columnClassName(
  column: Column,
  layout: Pick<ColumnLayout, 'files' | 'side'>,
  shown: Column | null
): string {
  const names = ['column', `column--${column}`];
  if (layout[column] === 'strip') {
    names.push('column--drawer');
    if (shown === column) names.push('column--open');
  }
  return names.join(' ');
}

/** A strip's button: the drawer it opens, or closes when that one is open; one drawer at a time. */
export function toggledDrawer(open: Column | null, column: Column): Column | null {
  return open === column ? null : column;
}

/** What a strip says: its name, read by a screen reader with the open or closed state, and its tooltip. */
export interface StripText {
  label: string;
  title: string;
}

/** The strip's name and tooltip, by column and whether its drawer is open. */
export function stripText(column: Column, open: boolean): StripText {
  if (column === 'files') {
    return { label: 'Chapters', title: open ? 'Hide the chapter list' : 'Show the chapter list' };
  }
  return {
    label: 'Suggestions',
    title: open ? 'Hide suggestions, comments and history' : 'Show suggestions, comments and history'
  };
}
