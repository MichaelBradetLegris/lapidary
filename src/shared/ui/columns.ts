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
 *
 * The author can also hide either column with its button at an end of the
 * toolbar (polish.28; the `filesHidden` and `sideHidden` flags of
 * `columnWidths`, which polish.26 added for the carets the buttons replaced).
 * A hidden column is drawn as nothing, in place or where a narrow window
 * would fold it to a strip, and the prose takes its room; its button brings
 * it back at the width it had. Hiding one never moves the window widths at
 * which either column folds.
 *
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

/** Both columns at their usual widths, and neither folded away: the `columnWidths` setting of a first run. */
export const USUAL_COLUMN_WIDTHS: Readonly<ColumnShares> = Object.freeze({
  files: null,
  side: null,
  filesHidden: false,
  sideHidden: false
});

/**
 * A column's width from settings.json: a share of the window's width strictly
 * between 0 and 1, or null, its usual width, for anything else.
 */
export function normalizeColumnShare(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1 ? value : null;
}

/**
 * The `columnWidths` setting (PLAN 11.3 d) from whatever settings.json holds:
 * each width read on its own, and a column folded away only for a JSON `true`.
 */
export function normalizeColumnWidths(value: unknown): ColumnShares {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    files: normalizeColumnShare(raw['files']),
    side: normalizeColumnShare(raw['side']),
    filesHidden: raw['filesHidden'] === true,
    sideHidden: raw['sideHidden'] === true
  };
}

/** Whether `column` is hidden by its button in the toolbar (polish.28), as `columnWidths` keeps it. */
export function columnHidden(kept: ColumnShares, column: Column): boolean {
  return column === 'files' ? kept.filesHidden : kept.sideHidden;
}

/** A column's name in the words of its handle and its button. */
export const COLUMN_NAMES: Readonly<Record<Column, string>> = Object.freeze({
  files: 'chapter list',
  side: 'side panel'
});

/**
 * What a column's button at an end of the toolbar says (polish.28), as its
 * accessible name and its tooltip: "Hide the chapter list" while the column
 * shows, "Show the chapter list" while it is hidden ("the side panel" for
 * the other), what a press does.
 */
export function panelButtonText(column: Column, hidden: boolean): string {
  return `${hidden ? 'Show' : 'Hide'} the ${COLUMN_NAMES[column]}`;
}

/**
 * The first sentence of the page shown while nothing is open, "Nothing open":
 * where to find a chapter. A hidden chapter list leaves nothing at the
 * window's left, and the flag outlives a restart, which always starts with
 * nothing open, so with the list hidden the sentence starts with the button
 * that shows it, in that button's own words (the polish.28 review).
 */
export function nothingOpenLead(listHidden: boolean): string {
  if (!listHidden) return 'Pick a chapter on the left, or start one with the + beside Chapters.';
  return `${panelButtonText('files', true)} with the button at the left end of the toolbar, then pick a chapter, or start one with the + beside Chapters.`;
}

/**
 * A side column drawn in place, folded to a strip and a drawer by a narrow
 * window (ui.3), or hidden by the author with its button in the toolbar,
 * drawn as nothing (polish.28; folded away to a 7 px edge strip by a caret
 * on its handle from polish.26).
 */
export type ColumnMode = 'full' | 'strip' | 'hidden';

export interface ColumnLayout {
  /** the window's width the layout is for, in CSS pixels, which a column's set width is a share of */
  width: number;
  files: ColumnMode;
  side: ColumnMode;
  /** the chapter list's grid column, in CSS pixels: its width, the strip's, or 0 while it is hidden */
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
 * A column the author hid (`filesHidden`, `sideHidden`, polish.28) is drawn
 * as nothing, 0 px wide, at every step, in place of the column or its strip,
 * and the prose takes its room; in steps 1 and 2 only the columns shown give
 * way, the side panel in step 3 too. The steps are chosen as for the columns
 * shown, so hiding one never moves the window widths at which either folds.
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

  // Steps 1 and 2: both columns in place, or nothing where hidden.
  if (w - FILES_WIDTHS.floor - SIDE_WIDTHS.floor >= PROSE_MIN) {
    const filesMode: ColumnMode = kept.filesHidden ? 'hidden' : 'full';
    const sideMode: ColumnMode = kept.sideHidden ? 'hidden' : 'full';
    const fw = kept.filesHidden ? 0 : files;
    const sw = kept.sideHidden ? 0 : side;
    if (w - fw - sw >= PROSE_MIN) return make(filesMode, fw, sideMode, sw);

    // Each column shown gives in proportion to what it can, so neither reaches
    // its floor first. They can always give enough: the steps' own width
    // leaves the prose its 480 px with both at their floors. The share is held
    // to 1 so that rounding at that width never takes a column a pixel under
    // its floor.
    const need = PROSE_MIN - (w - fw - sw);
    const filesGives = kept.filesHidden ? 0 : files - FILES_WIDTHS.floor;
    const sideGives = kept.sideHidden ? 0 : side - SIDE_WIDTHS.floor;
    const share = Math.min(1, need / (filesGives + sideGives));
    return make(
      filesMode,
      kept.filesHidden ? 0 : Math.floor(files - filesGives * share),
      sideMode,
      kept.sideHidden ? 0 : Math.floor(side - sideGives * share)
    );
  }

  // Steps 3 and 4 fold a column to its strip; a hidden one is nothing there too.
  const folded = (hidden: boolean): [ColumnMode, number] => (hidden ? ['hidden', 0] : ['strip', STRIP_WIDTH]);
  const [filesMode, fw] = folded(kept.filesHidden);

  // Step 3: the list folded to its strip; the panel in place. Whether it
  // is is the strip's room alone, so hiding the list never keeps the panel in
  // place longer; but beside a hidden list the panel may take the strip's
  // 32 px too, as far as its width goes, as its handle allows (`columnRoom`).
  if (w - STRIP_WIDTH - PROSE_MIN >= SIDE_WIDTHS.floor) {
    if (kept.sideHidden) return make(filesMode, fw, 'hidden', 0);
    return make(filesMode, fw, 'full', Math.min(side, Math.floor(w - fw - PROSE_MIN)));
  }

  // Step 4.
  const [sideMode, sw] = folded(kept.sideHidden);
  return make(filesMode, fw, sideMode, sw);
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
 * drawn in place, as after the window widened or the zoom went down, or
 * hidden (polish.28), and none for the side panel while no chapter is open,
 * since it has nothing to show.
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
 * drawer; and `column--open` while that drawer is on screen. A hidden column
 * (polish.28) is a drawer that never opens, `column--hidden`: laid out out of
 * sight, so it keeps its state, such as where its lists are scrolled, for
 * when its button brings it back.
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
  } else if (layout[column] === 'hidden') {
    names.push('column--drawer', 'column--hidden');
  }
  return names.join(' ');
}

/**
 * Whether a column's wrapper is out of sight and out of reach, `inert`:
 * folded to a strip with its drawer closed (ui.3), or hidden (polish.28),
 * which never opens as a drawer.
 */
export function columnInert(
  column: Column,
  layout: Pick<ColumnLayout, 'files' | 'side'>,
  shown: Column | null
): boolean {
  if (layout[column] === 'hidden') return true;
  return layout[column] === 'strip' && shown !== column;
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

/**
 * The strip's name and tooltip, by column and whether its drawer is open. The
 * tooltip says Open or Close, for the drawer, where the column's button at an
 * end of the toolbar says Show or Hide, for the column (`panelButtonText`; the
 * polish.28 review): in a narrow window the two are on screen together and do
 * different things, the strip opening the column over the prose for a while
 * and the button hiding it, strip and all, until it is shown again.
 */
export function stripText(column: Column, open: boolean): StripText {
  const verb = open ? 'Close' : 'Open';
  if (column === 'files') return { label: 'Chapters', title: `${verb} the chapter list` };
  return { label: 'Suggestions', title: `${verb} suggestions, comments and history` };
}
