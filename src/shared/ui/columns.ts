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
 * itself. `src/renderer/state/columns.ts` measures the width and applies it.
 *
 * Pure (CLAUDE.md rule 4).
 */

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

/** A side column drawn in place, or folded to a strip. */
export type ColumnMode = 'full' | 'strip';

export interface ColumnLayout {
  files: ColumnMode;
  side: ColumnMode;
  /** the chapter list's grid column, in CSS pixels: its width, or the strip's */
  filesWidth: number;
  /** the side panel's grid column */
  sideWidth: number;
  /** what the two leave the centre column */
  centre: number;
  /** a folded chapter list's drawer width, its usual width less what the window cannot spare */
  filesDrawer: number;
  /** a folded side panel's drawer width */
  sideDrawer: number;
  /** the centre column is narrower than `PROSE_MIN` even with both columns folded */
  narrow: boolean;
}

/** The width a column takes when nothing has to give: its share of the window, between its limits. */
export function preferredWidth(spec: ColumnWidths, width: number): number {
  return Math.floor(Math.min(spec.max, Math.max(spec.min, spec.share * width)));
}

/**
 * The layout for a window `width` CSS pixels wide (the page's own width, which
 * zoom changes), in four steps, the first that leaves the centre column
 * `PROSE_MIN`:
 *
 * 1. both columns at their preferred widths;
 * 2. both columns given back toward their floors, each in proportion to what
 *    it can give, so neither reaches its floor before the other;
 * 3. the chapter list folded to a strip, the side panel at its preferred width
 *    or less, down to its floor;
 * 4. both folded, and the centre column takes the rest, `narrow` when that is
 *    still less than `PROSE_MIN`.
 *
 * Column widths are whole pixels, rounded down, so the centre column gets the
 * fractions and never ends up a pixel short.
 */
export function columnLayout(width: number): ColumnLayout {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const files = preferredWidth(FILES_WIDTHS, w);
  const side = preferredWidth(SIDE_WIDTHS, w);
  const drawers = {
    filesDrawer: drawerWidth(files, w),
    sideDrawer: drawerWidth(side, w)
  };
  const make = (f: ColumnMode, fw: number, s: ColumnMode, sw: number): ColumnLayout => {
    const centre = w - fw - sw;
    return {
      files: f,
      side: s,
      filesWidth: fw,
      sideWidth: sw,
      centre,
      ...drawers,
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
 * An open drawer is the column's preferred width, but leaves both strips and
 * `DRAWER_MARGIN` of the centre column uncovered, so there is always some
 * prose to click to close it.
 */
function drawerWidth(preferred: number, width: number): number {
  return Math.max(0, Math.min(preferred, Math.floor(width - 2 * STRIP_WIDTH - DRAWER_MARGIN)));
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
