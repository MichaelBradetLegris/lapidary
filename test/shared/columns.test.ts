import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ColumnShares } from '../../src/shared/types';
import {
  bodyClassName,
  columnClassName,
  columnInert,
  columnLayout,
  COLUMN_WIDTHS,
  DRAWER_MARGIN,
  EDGE_STRIP_WIDTH,
  FILES_WIDTHS,
  keptWidth,
  NARROW_PANE_PADDING,
  normalizeColumnShare,
  normalizeColumnWidths,
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
});

describe('stripText (ui.3)', () => {
  it('names each strip after its column and says in the tooltip what a click does', () => {
    expect(stripText('files', false)).toEqual({ label: 'Chapters', title: 'Show the chapter list' });
    expect(stripText('files', true)).toEqual({ label: 'Chapters', title: 'Hide the chapter list' });
    expect(stripText('side', false)).toEqual({
      label: 'Suggestions',
      title: 'Show suggestions, comments and history'
    });
    expect(stripText('side', true).title).toBe('Hide suggestions, comments and history');
  });
});

/* polish.5: the widths the author sets by moving the columns' inner edges,
   each a share of the window's width, take the place of the usual widths
   before anything gives way. The handles' rules are in
   test/shared/columnHandle.test.ts. */

/** The `columnWidths` setting with these widths, neither column folded away unless named. */
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
  // Folded away or not (polish.26): none of these properties may depend on it.
  const shares: fc.Arbitrary<ColumnShares> = fc.record({
    files: share,
    side: share,
    filesHidden: fc.boolean(),
    sideHidden: fc.boolean()
  });

  it('splits the whole width, and leaves the centre PROSE_MIN unless both columns are folded', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        expect(l.width).toBe(w);
        expect(l.filesWidth + l.centre + l.sideWidth).toBeCloseTo(w, 6);
        expect(Number.isInteger(l.filesWidth) && Number.isInteger(l.sideWidth)).toBe(true);
        if (l.files !== 'strip' || l.side !== 'strip') expect(l.centre).toBeGreaterThanOrEqual(PROSE_MIN);
        expect(l.narrow).toBe(l.centre < PROSE_MIN);
      })
    );
  });

  it('folds a column at the window width it folds at with the usual widths, whatever was set or folded away', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const set = columnLayout(w, kept);
        const usual = columnLayout(w);
        expect(set.files === 'strip').toBe(usual.files === 'strip');
        expect(set.side === 'strip').toBe(usual.side === 'strip');
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
          // Each at the width set, or at the edge where folded away (polish.26).
          expect([l.files, l.filesWidth, l.side, l.sideWidth]).toEqual([
            kept.filesHidden ? 'hidden' : 'full',
            kept.filesHidden ? EDGE_STRIP_WIDTH : files,
            kept.sideHidden ? 'hidden' : 'full',
            kept.sideHidden ? EDGE_STRIP_WIDTH : side
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

/* polish.26: a column folded away by the caret at the top of its edge is
   drawn as the edge strip, as wide as the handle, and the prose takes its
   room; only where the column would be drawn in place, so the narrow
   window's strips and drawers fold as before. The caret's words are in
   test/shared/columnHandle.test.ts, the page's in
   test/renderer/columnCarets.test.ts. */

describe('a column folded away (polish.26)', () => {
  it('is the edge strip, as wide as the handle, and the prose takes its room', () => {
    expect(EDGE_STRIP_WIDTH).toBe(7);
    expect(EDGE_STRIP_WIDTH).toBeLessThan(STRIP_WIDTH);
    expect(summary(columnLayout(at(DEFAULT, 1), set({ filesHidden: true })))).toBe(
      'hidden 7 | 1097 | full 320'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ sideHidden: true })))).toBe(
      'full 230 | 1187 | hidden 7'
    );
    expect(summary(columnLayout(at(DEFAULT, 1), set({ filesHidden: true, sideHidden: true })))).toBe(
      'hidden 7 | 1410 | hidden 7'
    );
    // The other column has the width set, which both shown had to give up some of.
    expect(
      summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_MOST, side: SIDE_MOST, filesHidden: true })))
    ).toBe('hidden 7 | 703 | full 714');
    expect(summary(columnLayout(at(DEFAULT, 1), set({ files: FILES_MOST, side: SIDE_MOST })))).toBe(
      'full 434 | 481 | full 509'
    );
  });

  it('lets the column shown keep the width the two had to give up in a small window', () => {
    // 900 by 600 at 100%: both shrink a little, but with either folded away the other has room.
    expect(summary(columnLayout(at(SMALL, 1)))).toBe('full 168 | 480 | full 236');
    expect(summary(columnLayout(at(SMALL, 1), set({ filesHidden: true })))).toBe('hidden 7 | 637 | full 240');
    expect(summary(columnLayout(at(SMALL, 1), set({ sideHidden: true })))).toBe('full 170 | 707 | hidden 7');
    // A column set wider than the window allows still gives way, alone.
    expect(summary(columnLayout(at(DEFAULT, 1), set({ side: 0.8, filesHidden: true })))).toBe(
      'hidden 7 | 480 | full 937'
    );
  });

  it('folds to the strip and the drawer as before where a narrow window folds it, so the two never meet', () => {
    const both = set({ filesHidden: true, sideHidden: true });
    // The default window at 175%: the list folds to its strip whether folded away or not.
    expect(summary(columnLayout(at(DEFAULT, 1.75), set({ filesHidden: true })))).toBe(
      'strip 32 | 542 | full 240'
    );
    expect(summary(columnLayout(at(DEFAULT, 1.75), both))).toBe('strip 32 | 775 | hidden 7');
    // 900 by 600 at 110%: the list folded, the panel folded away beside it.
    expect(summary(columnLayout(at(SMALL, 1.1), both))).toBe('strip 32 | 765 | hidden 7');
    // From 125% both fold to strips, folded away or not.
    expect(columnLayout(at(SMALL, 1.25), both)).toEqual(columnLayout(at(SMALL, 1.25)));
    expect(columnLayout(at(SMALL, 2), both)).toEqual(columnLayout(at(SMALL, 2)));
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
    // A drawer folded by a narrow window is inert only while closed, as before.
    const narrow = columnLayout(at(SMALL, 1.1));
    expect(columnInert('files', narrow, null)).toBe(true);
    expect(columnInert('files', narrow, shownDrawer('files', narrow, true))).toBe(false);
    expect(bodyClassName(layout)).toBe('body');
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

  it('draws a column at the edge exactly where it is folded away and would otherwise be in place', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        const open = columnLayout(w, shown(kept));
        expect(l.files === 'hidden').toBe(kept.filesHidden && open.files === 'full');
        expect(l.side === 'hidden').toBe(kept.sideHidden && open.side === 'full');
        if (l.files === 'hidden') expect(l.filesWidth).toBe(EDGE_STRIP_WIDTH);
        if (l.side === 'hidden') expect(l.sideWidth).toBe(EDGE_STRIP_WIDTH);
        // Where neither is at the edge, the flags change nothing.
        if (l.files !== 'hidden' && l.side !== 'hidden') expect(l).toEqual(open);
      })
    );
  });

  it('never narrows the prose or the other column by folding one away', () => {
    fc.assert(
      fc.property(width, shares, (w, kept) => {
        const l = columnLayout(w, kept);
        const open = columnLayout(w, shown(kept));
        expect(l.centre).toBeGreaterThanOrEqual(open.centre);
        if (l.files === open.files) expect(l.filesWidth).toBeGreaterThanOrEqual(open.filesWidth);
        if (l.side === open.side) expect(l.sideWidth).toBeGreaterThanOrEqual(open.sideWidth);
      })
    );
  });
});
