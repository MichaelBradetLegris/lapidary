import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ColumnShares } from '../../src/shared/types';
import {
  bodyClassName,
  columnClassName,
  columnHidden,
  columnInert,
  columnLayout,
  COLUMN_NAMES,
  COLUMN_WIDTHS,
  DRAWER_MARGIN,
  FILES_WIDTHS,
  keptWidth,
  NARROW_PANE_PADDING,
  normalizeColumnShare,
  normalizeColumnWidths,
  nothingOpenLead,
  panelButtonText,
  preferredWidth,
  PROSE_MIN,
  shownDrawer,
  SIDE_WIDTHS,
  STRIP_WIDTH,
  stripText,
  toggledDrawer,
  USUAL_COLUMN_WIDTHS,
  type ColumnLayout
} from '../../src/shared/ui/columns';

/* ui.3 (found by the M5 review): in a 900 by 600 window at 150% the chapter
   list and the side panel kept 410 of the window's 589 CSS px, leaving the
   prose's text 25 px, and from 175% none. `columnLayout` keeps the centre
   column PROSE_MIN wide while it can, by shrinking both side columns, then
   folding the chapter list to a strip, then the side panel. The page applies
   it in src/renderer/state/columns.ts, checked in test/renderer/columns.test.ts;
   the window checks are in PLAN (ui.3). */

/** The page's width in CSS px of a window whose inside is `inner` px wide at `zoom`. */
const at = (inner: number, zoom: number): number => inner / zoom;
/** The smallest window, 900 by 600, is 884 px wide inside (PLAN C.49). */
const SMALL = 884;
const MID = 1084;
const DEFAULT = 1424;

const summary = (l: ColumnLayout): string =>
  `${l.files} ${l.filesWidth} | ${Math.round(l.centre)} | ${l.side} ${l.sideWidth}${l.narrow ? ' narrow' : ''}`;

describe('columnLayout: the windows the plan names (ui.3)', () => {
  it('900 by 600: both columns shrink at 100%, the list folds at 110%, both from 125%', () => {
    expect(summary(columnLayout(at(SMALL, 1)))).toBe('full 168 | 480 | full 236');
    expect(summary(columnLayout(at(SMALL, 1.1)))).toBe('strip 32 | 532 | full 240');
    expect(summary(columnLayout(at(SMALL, 1.25)))).toBe('strip 32 | 643 | strip 32');
    expect(summary(columnLayout(at(SMALL, 1.5)))).toBe('strip 32 | 525 | strip 32');
    expect(summary(columnLayout(at(SMALL, 1.75)))).toBe('strip 32 | 441 | strip 32 narrow');
    expect(summary(columnLayout(at(SMALL, 2)))).toBe('strip 32 | 378 | strip 32 narrow');
  });

  it('1100 by 700: the list folds at 150%, both from 175%', () => {
    expect(summary(columnLayout(at(MID, 1)))).toBe('full 195 | 629 | full 260');
    expect(summary(columnLayout(at(MID, 1.25)))).toBe('full 162 | 481 | full 224');
    expect(summary(columnLayout(at(MID, 1.5)))).toBe('strip 32 | 481 | full 210');
    expect(summary(columnLayout(at(MID, 1.75)))).toBe('strip 32 | 555 | strip 32');
    expect(summary(columnLayout(at(MID, 2)))).toBe('strip 32 | 478 | strip 32 narrow');
  });

  it('1440 by 940, the default: as before up to 150%, the list folds from 175%, the panel never', () => {
    expect(summary(columnLayout(at(DEFAULT, 1)))).toBe('full 230 | 874 | full 320');
    expect(summary(columnLayout(at(DEFAULT, 1.25)))).toBe('full 205 | 661 | full 273');
    expect(summary(columnLayout(at(DEFAULT, 1.5)))).toBe('full 170 | 539 | full 240');
    expect(summary(columnLayout(at(DEFAULT, 1.75)))).toBe('strip 32 | 542 | full 240');
    expect(summary(columnLayout(at(DEFAULT, 2)))).toBe('strip 32 | 480 | full 200');
  });

  it('keeps the widths the columns had before ui.3 wherever they left the prose its 480 px', () => {
    // clamp(170px, 18vw, 230px) and clamp(240px, 24vw, 320px), rounded down.
    for (const width of [2560, 1920, 1780, 1424, 1295, 1139, 1084, 985, 949]) {
      const layout = columnLayout(width);
      expect(layout.filesWidth, `${width}`).toBe(Math.floor(Math.min(230, Math.max(170, 0.18 * width))));
      expect(layout.sideWidth, `${width}`).toBe(Math.floor(Math.min(320, Math.max(240, 0.24 * width))));
    }
  });

  it('gives drawers the columns their usual widths, less what a narrow window cannot spare', () => {
    expect(columnLayout(442)).toMatchObject({ filesDrawer: 170, sideDrawer: 240 });
    // 300 px: 300 - 2 * 32 - 48 = 188 for either.
    expect(columnLayout(300)).toMatchObject({ filesDrawer: 170, sideDrawer: 188 });
    expect(columnLayout(100)).toMatchObject({ filesDrawer: 0, sideDrawer: 0 });
  });

  it('treats a width that is not a number, or below zero, as none', () => {
    for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -50, 0]) {
      const layout = columnLayout(width);
      expect(layout.files).toBe('strip');
      expect(layout.side).toBe('strip');
      expect(layout.narrow).toBe(true);
      expect(Number.isFinite(layout.centre)).toBe(true);
    }
  });
});

describe('preferredWidth (ui.3)', () => {
  it('is the share of the window between the limits, rounded down', () => {
    expect(preferredWidth(FILES_WIDTHS, 1000)).toBe(180);
    expect(preferredWidth(FILES_WIDTHS, 500)).toBe(170);
    expect(preferredWidth(FILES_WIDTHS, 5000)).toBe(230);
    expect(preferredWidth(SIDE_WIDTHS, 1139)).toBe(273);
  });

  it('has floors below the limits, so both columns can give something before either folds', () => {
    expect(FILES_WIDTHS.floor).toBeLessThan(FILES_WIDTHS.min);
    expect(SIDE_WIDTHS.floor).toBeLessThan(SIDE_WIDTHS.min);
    expect(STRIP_WIDTH).toBeLessThan(FILES_WIDTHS.floor);
    expect(PROSE_MIN).toBe(480);
    expect(NARROW_PANE_PADDING).toBe(16);
  });
});

describe('columnLayout properties (ui.3)', () => {
  const width = fc.double({ min: 0, max: 4000, noNaN: true });

  it('splits the whole width, in whole pixels for the side columns', () => {
    fc.assert(
      fc.property(width, (w) => {
        const l = columnLayout(w);
        expect(l.filesWidth + l.centre + l.sideWidth).toBeCloseTo(w, 6);
        expect(Number.isInteger(l.filesWidth)).toBe(true);
        expect(Number.isInteger(l.sideWidth)).toBe(true);
      })
    );
  });

  it('leaves the centre PROSE_MIN unless both columns are folded, and says narrow exactly when it does not', () => {
    fc.assert(
      fc.property(width, (w) => {
        const l = columnLayout(w);
        if (l.files === 'full' || l.side === 'full') expect(l.centre).toBeGreaterThanOrEqual(PROSE_MIN);
        expect(l.narrow).toBe(l.centre < PROSE_MIN);
      })
    );
  });

  it('draws a column in place between its floor and its limit, and a folded one as a strip', () => {
    fc.assert(
      fc.property(width, (w) => {
        const l = columnLayout(w);
        for (const [mode, size, spec] of [
          [l.files, l.filesWidth, FILES_WIDTHS],
          [l.side, l.sideWidth, SIDE_WIDTHS]
        ] as const) {
          if (mode === 'strip') expect(size).toBe(STRIP_WIDTH);
          else {
            expect(size).toBeGreaterThanOrEqual(spec.floor);
            expect(size).toBeLessThanOrEqual(spec.max);
          }
        }
      })
    );
  });

  it('folds a column only when nothing less would leave the prose its width, the list before the panel', () => {
    fc.assert(
      fc.property(width, (w) => {
        const l = columnLayout(w);
        if (l.side === 'strip') {
          expect(l.files).toBe('strip');
          expect(w - STRIP_WIDTH - SIDE_WIDTHS.floor).toBeLessThan(PROSE_MIN);
        }
        if (l.files === 'strip') expect(w - FILES_WIDTHS.floor - SIDE_WIDTHS.floor).toBeLessThan(PROSE_MIN);
        // Shrinking is shared: neither column is at its floor while the other has more to give.
        if (l.files === 'full' && l.side === 'full' && l.centre < w) {
          const shrunk =
            l.filesWidth < preferredWidth(FILES_WIDTHS, w) || l.sideWidth < preferredWidth(SIDE_WIDTHS, w);
          if (shrunk) expect(l.centre).toBeLessThan(PROSE_MIN + 2);
        }
      })
    );
  });

  it('never folds a column as the window widens', () => {
    fc.assert(
      fc.property(width, width, (a, b) => {
        const [narrow, wide] =
          a <= b ? [columnLayout(a), columnLayout(b)] : [columnLayout(b), columnLayout(a)];
        if (wide.files === 'strip') expect(narrow.files).toBe('strip');
        if (wide.side === 'strip') expect(narrow.side).toBe('strip');
      })
    );
  });

  it('opens a drawer no wider than its column likes, leaving both strips and some prose uncovered', () => {
    fc.assert(
      fc.property(width, (w) => {
        const l = columnLayout(w);
        expect(l.filesDrawer).toBeLessThanOrEqual(preferredWidth(FILES_WIDTHS, w));
        expect(l.sideDrawer).toBeLessThanOrEqual(preferredWidth(SIDE_WIDTHS, w));
        for (const drawer of [l.filesDrawer, l.sideDrawer]) {
          expect(drawer).toBeGreaterThanOrEqual(0);
          if (drawer > 0) expect(drawer + 2 * STRIP_WIDTH + DRAWER_MARGIN).toBeLessThanOrEqual(w + 1e-9);
        }
      })
    );
  });
});

describe('the drawer shown (ui.3)', () => {
  const folded = { files: 'strip', side: 'strip' } as const;
  const inPlace = { files: 'full', side: 'full' } as const;

  it('shows the one opened while its column is folded', () => {
    expect(shownDrawer('files', folded, true)).toBe('files');
    expect(shownDrawer('side', folded, true)).toBe('side');
    expect(shownDrawer(null, folded, true)).toBeNull();
  });

  it('shows none once its column is drawn in place again', () => {
    expect(shownDrawer('files', inPlace, true)).toBeNull();
    expect(shownDrawer('side', { files: 'strip', side: 'full' }, true)).toBeNull();
    expect(shownDrawer('files', { files: 'strip', side: 'full' }, true)).toBe('files');
  });

  it('shows no side panel while no chapter is open, since it has nothing in it', () => {
    expect(shownDrawer('side', folded, false)).toBeNull();
    expect(shownDrawer('files', folded, false)).toBe('files');
  });

  it("opens a strip's drawer, closes it when open, and keeps one open at a time", () => {
    expect(toggledDrawer(null, 'files')).toBe('files');
    expect(toggledDrawer('files', 'files')).toBeNull();
    expect(toggledDrawer('files', 'side')).toBe('side');
    expect(toggledDrawer('side', 'files')).toBe('files');
  });
});

describe('class names (ui.3)', () => {
  it('names on .body the folded columns and a centre narrow even so', () => {
    expect(bodyClassName(columnLayout(at(DEFAULT, 1)))).toBe('body');
    expect(bodyClassName(columnLayout(at(DEFAULT, 2)))).toBe('body body--files-strip');
    expect(bodyClassName(columnLayout(at(SMALL, 1.5)))).toBe('body body--files-strip body--side-strip');
    expect(bodyClassName(columnLayout(at(SMALL, 2)))).toBe(
      'body body--files-strip body--side-strip body--narrow'
    );
  });

  it('makes a folded column a drawer, open only when it is the one shown', () => {
    const layout = columnLayout(at(SMALL, 1.1)); // the list folded, the panel in place
    expect(columnClassName('files', layout, null)).toBe('column column--files column--drawer');
    expect(columnClassName('files', layout, 'files')).toBe(
      'column column--files column--drawer column--open'
    );
    expect(columnClassName('side', layout, null)).toBe('column column--side');
    // A column in place is never "open", whatever was asked.
    expect(columnClassName('side', layout, 'side')).toBe('column column--side');
  });

  it('fades a column in place while a release of its handle would snap it closed (polish.27)', () => {
    const wide = columnLayout(at(DEFAULT, 1));
    expect(columnClassName('files', wide, null, 'files')).toBe('column column--files column--snapping');
    expect(columnClassName('side', wide, null, 'files')).toBe('column column--side');
    expect(columnClassName('side', wide, null, 'side')).toBe('column column--side column--snapping');
    expect(columnClassName('side', wide, null, null)).toBe('column column--side');
    // A strip or a hidden column has no handle to drag, and so never fades.
    const folded = columnLayout(at(SMALL, 1.1));
    expect(columnClassName('files', folded, null, 'files')).toBe('column column--files column--drawer');
    const hidden = columnLayout(at(DEFAULT, 1), set({ sideHidden: true }));
    expect(columnClassName('side', hidden, null, 'side')).toBe(
      'column column--side column--drawer column--hidden'
    );
  });
});

describe('stripText (ui.3)', () => {
  it('names each strip after its column and says in the tooltip what a click does', () => {
    expect(stripText('files', false)).toEqual({ label: 'Chapters', title: 'Open the chapter list' });
    expect(stripText('files', true)).toEqual({ label: 'Chapters', title: 'Close the chapter list' });
    expect(stripText('side', false)).toEqual({
      label: 'Suggestions',
      title: 'Open suggestions, comments and history'
    });
    expect(stripText('side', true).title).toBe('Close suggestions, comments and history');
  });

  it("never says what the column's button in the toolbar says (the polish.28 review)", () => {
    // In a narrow window the strip and the button are on screen together, and
    // do different things: the strip opens or closes its drawer, the button
    // hides the column, strip and all, or shows it.
    const verb = (text: string): string => text.split(' ')[0] ?? '';
    for (const column of ['files', 'side'] as const) {
      for (const open of [false, true]) {
        const strip = stripText(column, open).title;
        expect(['Open', 'Close']).toContain(verb(strip));
        for (const other of ['files', 'side'] as const) {
          for (const hidden of [false, true]) {
            const button = panelButtonText(other, hidden);
            expect(strip).not.toBe(button);
            expect(verb(strip)).not.toBe(verb(button));
          }
        }
      }
    }
  });
});

/* polish.5: the widths the author sets by moving the columns' inner edges,
   each a share of the window's width, take the place of the usual widths
   before anything gives way. The handles' rules are in
   test/shared/columnHandle.test.ts. */

/** The `columnWidths` setting with these widths, neither column hidden unless named. */
const set = (patch: Partial<ColumnShares>): ColumnShares => ({ ...USUAL_COLUMN_WIDTHS, ...patch });

/** The shares the handles write for the default window's limits (1424 px, PLAN 7 "Column widths"). */
const FILES_LEAST = 0.105337; // 150 px
const FILES_MOST = 0.438202; // 624 px, beside the side panel's usual 320
const SIDE_MOST = 0.501404; // 714 px, beside the chapter list's usual 230

describe('the widths set (polish.5)', () => {
  it('reads a share strictly between 0 and 1, and anything else as the usual width', () => {
    expect(normalizeColumnShare(0.2)).toBe(0.2);
    for (const bad of [0, 1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0.2', null, undefined, {}]) {
      expect(normalizeColumnShare(bad)).toBeNull();
    }
    expect(normalizeColumnWidths({ files: 0.2, side: 2 })).toEqual(set({ files: 0.2 }));
    expect(normalizeColumnWidths(undefined)).toEqual(USUAL_COLUMN_WIDTHS);
    expect(COLUMN_WIDTHS).toEqual({ files: FILES_WIDTHS, side: SIDE_WIDTHS });
  });

  it('takes a share of the window to the nearest pixel, never under the floor, and the usual width for none', () => {
    expect(keptWidth(FILES_WIDTHS, null, 1424)).toBe(preferredWidth(FILES_WIDTHS, 1424));
    expect(keptWidth(FILES_WIDTHS, FILES_LEAST, 1424)).toBe(150);
    expect(keptWidth(FILES_WIDTHS, FILES_MOST, 1424)).toBe(624);
    expect(keptWidth(SIDE_WIDTHS, SIDE_MOST, 1424)).toBe(714);
    // A share keeps its share of a wider window, beyond the usual limit.
    expect(keptWidth(SIDE_WIDTHS, SIDE_MOST, 2560)).toBe(1284);
    // And never goes under the floor in a narrow one.
    expect(keptWidth(FILES_WIDTHS, FILES_LEAST, 884)).toBe(150);
    expect(keptWidth(SIDE_WIDTHS, 0.1, 884)).toBe(200);
  });

  it('draws the widths set where they leave the prose its 480 px', () => {
    expect(summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_LEAST, side: SIDE_MOST })))).toBe(
      'full 150 | 560 | full 714'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_MOST, side: null })))).toBe(
      'full 624 | 480 | full 320'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ files: null, side: SIDE_MOST })))).toBe(
      'full 230 | 480 | full 714'
    );
    expect(summary(columnLayout(2560, set({ files: FILES_LEAST, side: SIDE_MOST })))).toBe(
      'full 270 | 1006 | full 1284'
    );
    // Both null is the layout of ui.3.
    expect(columnLayout(at(DEFAULT, 1), USUAL_COLUMN_WIDTHS)).toEqual(columnLayout(at(DEFAULT, 1)));
  });

  it('gives way as ui.3 does where they do not, and folds at the same widths', () => {
    // The smallest window: the panel set at half the default window shrinks with the list.
    expect(summary(columnLayout(at(SMALL, 1), set({ files: null, side: SIDE_MOST })))).toBe(
      'full 154 | 481 | full 249'
    );
    // At 110% the list folds as before, and the panel keeps what the prose leaves it.
    expect(summary(columnLayout(at(SMALL, 1.1), set({ files: null, side: SIDE_MOST })))).toBe(
      'strip 32 | 481 | full 291'
    );
    // The default window at 200%: the list folds as before; the panel at its floor.
    expect(summary(columnLayout(at(DEFAULT, 2), set({ files: FILES_MOST, side: null })))).toBe(
      'strip 32 | 480 | full 200'
    );
  });

  it('opens a drawer at the width set, leaving its strip, the other column and some prose', () => {
    // The default window at 175%: the list folded, the panel in place at 301 px.
    const layout = columnLayout(at(DEFAULT, 1.75), set({ files: FILES_MOST, side: SIDE_MOST }));
    expect(summary(layout)).toBe('strip 32 | 481 | full 301');
    expect(layout.filesDrawer).toBe(keptWidth(FILES_WIDTHS, FILES_MOST, at(DEFAULT, 1.75)));
    // A list set wider than the prose can spare stops short of the side panel.
    const wide = columnLayout(750, set({ files: 0.66, side: null }));
    expect(wide.files).toBe('strip');
    expect(wide.filesDrawer).toBe(Math.floor(750 - STRIP_WIDTH - wide.sideWidth - DRAWER_MARGIN));
  });
});

describe('columnLayout properties with the widths set (polish.5)', () => {
  const width = fc.double({ min: 0, max: 4000, noNaN: true });
  const share = fc.option(fc.double({ min: 0.000001, max: 0.999999, noNaN: true }), { nil: null });
  // Hidden or not (polish.28): none of these properties may depend on it.
  const shares: fc.Arbitrary<ColumnShares> = fc.record({
    files: share,
    side: share,
    filesHidden: fc.boolean(),
    sideHidden: fc.boolean()
  });

  it('splits the whole width, and leaves the centre PROSE_MIN unless the window is too narrow for the strips', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        expect(l.width).toBe(w);
        expect(l.filesWidth + l.centre + l.sideWidth).toBeCloseTo(w, 6);
        expect(Number.isInteger(l.filesWidth) && Number.isInteger(l.sideWidth)).toBe(true);
        // Below both strips and the prose's width, with neither column in
        // place, the centre has what is left; above it, at least PROSE_MIN.
        if (w >= 2 * STRIP_WIDTH + PROSE_MIN || l.files === 'full' || l.side === 'full') {
          expect(l.centre).toBeGreaterThanOrEqual(PROSE_MIN);
        }
        expect(l.narrow).toBe(l.centre < PROSE_MIN);
      })
    );
  });

  it('folds a column at the window width it folds at with the usual widths, whatever was set or hidden', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const set = columnLayout(w, kept);
        const usual = columnLayout(w);
        // In place or a strip exactly as with the usual widths, unless hidden (polish.28).
        expect(set.files).toBe(kept.filesHidden ? 'hidden' : usual.files);
        expect(set.side).toBe(kept.sideHidden ? 'hidden' : usual.side);
      })
    );
  });

  it('draws both widths set exactly when they leave the prose its width, and never a column under its floor', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        const files = keptWidth(FILES_WIDTHS, kept.files, w);
        const side = keptWidth(SIDE_WIDTHS, kept.side, w);
        if (w - files - side >= PROSE_MIN) {
          // Each at the width set, or nothing where hidden (polish.28).
          expect([l.files, l.filesWidth, l.side, l.sideWidth]).toEqual([
            kept.filesHidden ? 'hidden' : 'full',
            kept.filesHidden ? 0 : files,
            kept.sideHidden ? 'hidden' : 'full',
            kept.sideHidden ? 0 : side
          ]);
        }
        // A column in place is between its floor and the width set.
        if (l.files === 'full') {
          expect(l.filesWidth).toBeGreaterThanOrEqual(FILES_WIDTHS.floor);
          expect(l.filesWidth).toBeLessThanOrEqual(files);
        }
        if (l.side === 'full') {
          expect(l.sideWidth).toBeGreaterThanOrEqual(SIDE_WIDTHS.floor);
          expect(l.sideWidth).toBeLessThanOrEqual(side);
        }
      })
    );
  });

  it('opens a drawer no wider than its column was set, never over the other column or all the prose', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        expect(l.filesDrawer).toBeLessThanOrEqual(keptWidth(FILES_WIDTHS, kept.files, w));
        expect(l.sideDrawer).toBeLessThanOrEqual(keptWidth(SIDE_WIDTHS, kept.side, w));
        if (l.files === 'strip' && l.filesDrawer > 0) {
          expect(STRIP_WIDTH + l.filesDrawer + DRAWER_MARGIN + l.sideWidth).toBeLessThanOrEqual(w + 1e-9);
        }
        if (l.side === 'strip' && l.sideDrawer > 0) {
          expect(l.filesWidth + DRAWER_MARGIN + l.sideDrawer + STRIP_WIDTH).toBeLessThanOrEqual(w + 1e-9);
        }
      })
    );
  });
});

/* polish.28: a column hidden by its button at an end of the toolbar is drawn
   as nothing, 0 px wide, at every width: in place of the column, and in place
   of its strip where a narrow window folds it (polish.26 drew a 7 px edge
   strip, and only where the column would be in place). The prose takes its
   room, and the steps are chosen as for the columns shown, so the window
   widths at which either folds never move. The button's words are below, the
   page's in test/renderer/panelButtons.test.ts. */

describe('a hidden column (polish.28)', () => {
  it('is nothing, and the prose takes its room', () => {
    expect(summary(columnLayout(at(DEFAULT, 1), set({ filesHidden: true })))).toBe(
      'hidden 0 | 1104 | full 320'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ sideHidden: true })))).toBe(
      'full 230 | 1194 | hidden 0'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ filesHidden: true, sideHidden: true })))).toBe(
      'hidden 0 | 1424 | hidden 0'
    );
    // The other column has the width set, which both shown had to give up some of.
    expect(
      summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_MOST, side: SIDE_MOST, filesHidden: true })))
    ).toBe('hidden 0 | 710 | full 714');
    expect(summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_MOST, side: SIDE_MOST })))).toBe(
      'full 434 | 481 | full 509'
    );
  });

  it('lets the column shown keep the width the two had to give up in a small window', () => {
    // 900 by 600 at 100%: both shrink a little, but with either hidden the other has room.
    expect(summary(columnLayout(at(SMALL, 1)))).toBe('full 168 | 480 | full 236');
    expect(summary(columnLayout(at(SMALL, 1), set({ filesHidden: true })))).toBe('hidden 0 | 644 | full 240');
    expect(summary(columnLayout(at(SMALL, 1), set({ sideHidden: true })))).toBe('full 170 | 714 | hidden 0');
    // A column set wider than the window allows still gives way, alone.
    expect(summary(columnLayout(at(DEFAULT, 1), set({ side: 0.8, filesHidden: true })))).toBe(
      'hidden 0 | 480 | full 944'
    );
  });

  it('is nothing where a narrow window folds it, too, and the other column folds where it did', () => {
    // The default window at 175%: the list, a strip when shown, is nothing hidden.
    expect(summary(columnLayout(at(DEFAULT, 1.75)))).toBe('strip 32 | 542 | full 240');
    expect(summary(columnLayout(at(DEFAULT, 1.75), set({ filesHidden: true })))).toBe(
      'hidden 0 | 574 | full 240'
    );
    expect(summary(columnLayout(at(DEFAULT, 1.75), set({ sideHidden: true })))).toBe(
      'strip 32 | 782 | hidden 0'
    );
    // 900 by 600 at 110%: the list folded, the panel in place, or nothing.
    expect(summary(columnLayout(at(SMALL, 1.1), set({ sideHidden: true })))).toBe(
      'strip 32 | 772 | hidden 0'
    );
    expect(summary(columnLayout(at(SMALL, 1.1), set({ filesHidden: true, sideHidden: true })))).toBe(
      'hidden 0 | 804 | hidden 0'
    );
    // From 125% both fold to strips; either hidden is nothing beside the other's strip.
    expect(summary(columnLayout(at(SMALL, 1.25), set({ filesHidden: true })))).toBe(
      'hidden 0 | 675 | strip 32'
    );
    expect(summary(columnLayout(at(SMALL, 1.25), set({ sideHidden: true })))).toBe(
      'strip 32 | 675 | hidden 0'
    );
    // At 200% even both hidden leave the prose under its 480 px.
    expect(summary(columnLayout(at(SMALL, 2), set({ filesHidden: true, sideHidden: true })))).toBe(
      'hidden 0 | 442 | hidden 0 narrow'
    );
  });

  it('gives the side panel the strip it no longer stands beside, as far as its width goes', () => {
    // 900 by 600 at 110% with the panel set to half the default window: 291
    // px beside the list's strip, 323 beside nothing.
    expect(summary(columnLayout(at(SMALL, 1.1), set({ side: SIDE_MOST })))).toBe('strip 32 | 481 | full 291');
    expect(summary(columnLayout(at(SMALL, 1.1), set({ side: SIDE_MOST, filesHidden: true })))).toBe(
      'hidden 0 | 481 | full 323'
    );
  });

  it('is no drawer: none shows, and its wrapper is laid out out of sight, inert', () => {
    const layout = columnLayout(at(DEFAULT, 1), set({ filesHidden: true }));
    expect(shownDrawer('files', layout, true)).toBeNull();
    expect(columnClassName('files', layout, 'files')).toBe(
      'column column--files column--drawer column--hidden'
    );
    expect(columnClassName('side', layout, null)).toBe('column column--side');
    expect(columnInert('files', layout, null)).toBe(true);
    expect(columnInert('files', layout, 'files')).toBe(true);
    expect(columnInert('side', layout, null)).toBe(false);
    expect(bodyClassName(layout)).toBe('body');
    // Where a narrow window would fold it to a strip, it has no strip and no drawer.
    const narrow = columnLayout(at(SMALL, 1.25), set({ filesHidden: true }));
    expect(shownDrawer('files', narrow, true)).toBeNull();
    expect(shownDrawer('side', narrow, true)).toBe('side');
    expect(columnClassName('files', narrow, 'files')).toBe(
      'column column--files column--drawer column--hidden'
    );
    expect(columnInert('files', narrow, 'files')).toBe(true);
    expect(bodyClassName(narrow)).toBe('body body--side-strip');
    // A drawer folded by a narrow window is inert only while closed, as before.
    const shown = columnLayout(at(SMALL, 1.1));
    expect(columnInert('files', shown, null)).toBe(true);
    expect(columnInert('files', shown, shownDrawer('files', shown, true))).toBe(false);
  });

  it('reads the two flags from settings.json as true only for a JSON true', () => {
    expect(USUAL_COLUMN_WIDTHS).toEqual({ files: null, side: null, filesHidden: false, sideHidden: false });
    expect(normalizeColumnWidths({ files: 0.2, filesHidden: true })).toEqual(
      set({ files: 0.2, filesHidden: true })
    );
    expect(normalizeColumnWidths({ sideHidden: true, filesHidden: false })).toEqual(
      set({ sideHidden: true })
    );
    for (const bad of ['true', 1, null, {}, [true]]) {
      expect(normalizeColumnWidths({ filesHidden: bad, sideHidden: bad })).toEqual(USUAL_COLUMN_WIDTHS);
    }
    expect(columnHidden(set({ filesHidden: true }), 'files')).toBe(true);
    expect(columnHidden(set({ filesHidden: true }), 'side')).toBe(false);
    expect(columnHidden(set({ sideHidden: true }), 'side')).toBe(true);
    expect(columnHidden(USUAL_COLUMN_WIDTHS, 'files')).toBe(false);
  });

  it("names each column's button for what a press does, in the plan's words", () => {
    expect(panelButtonText('files', false)).toBe('Hide the chapter list');
    expect(panelButtonText('side', false)).toBe('Hide the side panel');
    expect(panelButtonText('files', true)).toBe('Show the chapter list');
    expect(panelButtonText('side', true)).toBe('Show the side panel');
    // The handles' names use the same words.
    expect(COLUMN_NAMES).toEqual({ files: 'chapter list', side: 'side panel' });
  });

  it("starts the empty page with the chapter list's button while the list is hidden (the review)", () => {
    // The flag outlives a restart, which starts with nothing open, and a
    // hidden list leaves nothing at the left to pick a chapter from.
    expect(nothingOpenLead(false)).toBe(
      'Pick a chapter on the left, or start one with the + beside Chapters.'
    );
    expect(nothingOpenLead(true)).toBe(
      'Show the chapter list with the button at the left end of the toolbar, then pick a chapter, or start one with the + beside Chapters.'
    );
    // In the button's own words, its name and tooltip while the list is hidden.
    expect(nothingOpenLead(true).startsWith(`${panelButtonText('files', true)} `)).toBe(true);
    expect(nothingOpenLead(true)).not.toContain('on the left');
  });

  // Any width, and as often one about the steps' own, where the list folds
  // below 830 px and the panel below 712, which a draw from 0 to 4000 seldom hits.
  const width = fc.oneof(
    fc.double({ min: 0, max: 4000, noNaN: true }),
    fc.double({ min: 650, max: 1200, noNaN: true })
  );
  const share = fc.option(fc.double({ min: 0.000001, max: 0.999999, noNaN: true }), { nil: null });
  const shares: fc.Arbitrary<ColumnShares> = fc.record({
    files: share,
    side: share,
    filesHidden: fc.boolean(),
    sideHidden: fc.boolean()
  });
  const shown = (kept: ColumnShares): ColumnShares => ({ ...kept, filesHidden: false, sideHidden: false });

  it('draws a column as nothing exactly where it is hidden, and the other as it would be drawn', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        const open = columnLayout(w, shown(kept));
        expect(l.files === 'hidden').toBe(kept.filesHidden);
        expect(l.side === 'hidden').toBe(kept.sideHidden);
        // Nothing at the edge, at every width.
        if (kept.filesHidden) expect(l.filesWidth).toBe(0);
        else expect(l.files).toBe(open.files);
        if (kept.sideHidden) expect(l.sideWidth).toBe(0);
        else expect(l.side).toBe(open.side);
        // Where neither is hidden, the flags change nothing.
        if (!kept.filesHidden && !kept.sideHidden) expect(l).toEqual(open);
        // No drawer for a hidden column, whichever the author had open.
        if (kept.filesHidden) expect(shownDrawer('files', l, true)).toBeNull();
        if (kept.sideHidden) expect(shownDrawer('side', l, true)).toBeNull();
      })
    );
  });

  it('never narrows the other column by hiding one, nor the prose under PROSE_MIN or by more than a pixel', () => {
    // Step 2 rounds both columns down, which can leave the prose a pixel more
    // than its 480 with both shown; with one hidden, the other gives way to
    // exactly what the prose leaves it, and the prose has the window's
    // fraction. That pixel is the most a hide takes from it.
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        const open = columnLayout(w, shown(kept));
        expect(l.centre).toBeGreaterThanOrEqual(Math.min(open.centre, PROSE_MIN));
        expect(l.centre).toBeGreaterThanOrEqual(open.centre - 1);
        if (l.files === open.files) expect(l.filesWidth).toBeGreaterThanOrEqual(open.filesWidth);
        if (l.side === open.side) expect(l.sideWidth).toBeGreaterThanOrEqual(open.sideWidth);
      }),
      {
        // Found by earlier runs against polish.26's edge strip: the rounding
        // pixel step 2 gave the prose, which a fold took back.
        examples: [
          [891, set({ side: 0.45286195286195285, filesHidden: true })],
          [831, set({ files: 0.41335740072202165, sideHidden: true })],
          [943, set({ side: 0.48303287380699894, filesHidden: true })]
        ]
      }
    );
  });

  it('gives the prose what the hidden column had, where the other has its width set', () => {
    // 891 px: the list 170 and the panel set to 404 give way to 155 and 255,
    // floored, leaving the prose 481; with the list hidden the panel has its
    // 404 again and the prose the rest, 487 (480 beside polish.26's 7 px strip).
    const side = set({ side: 0.45286195286195285 });
    expect(summary(columnLayout(891, side))).toBe('full 155 | 481 | full 255');
    expect(summary(columnLayout(891, { ...side, filesHidden: true }))).toBe('hidden 0 | 487 | full 404');
    // 831 px: the list set to 344 gives way to its floor beside the panel's, the same way.
    const files = set({ files: 0.41335740072202165 });
    expect(summary(columnLayout(831, files))).toBe('full 150 | 481 | full 200');
    expect(summary(columnLayout(831, { ...files, sideHidden: true }))).toBe('full 344 | 487 | hidden 0');
  });
});
