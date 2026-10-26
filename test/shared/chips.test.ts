import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHANGE_CATEGORIES, type Hunk } from '../../src/shared/types';
import {
  allChipsHidden,
  allChipsShown,
  CHIP_STEPS,
  CHIPS_ARROW_WIDTH,
  CHIPS_FIT,
  CHIPS_REVEAL_MARGIN,
  CHIPS_THUMB_MIN,
  COMMENTS_CHIP,
  commentsHidden,
  chipBulkLabel,
  chipCounts,
  chipHidden,
  chipKeyOf,
  chipMenuLabel,
  chipMenuLabels,
  chipMenuPlacement,
  chipName,
  chipsStep,
  chipsEnds,
  chipsIndicator,
  chipsPageLeft,
  chipsRevealLeft,
  chipsView,
  chipsWheelLeft,
  chipTitle,
  eyeLabel,
  HIDE_ALL_CATEGORIES,
  sameChipsView,
  SHOW_ALL_CATEGORIES,
  showOnlyHidden,
  suggestionChip,
  WHEEL_LINE_PX,
  YOU_CHIP,
  type ChipsRow,
  type ChipsWheel,
  type RowChip
} from '../../src/shared/ui/chips';

/* polish.6: the category chips are one row that scrolls sideways when they do
   not fit. An up-and-down wheel turned over it scrolls it sideways, other
   wheels are left to the browser, and a chip the keyboard reaches comes wholly
   into view. polish.10: the row is in the toolbar, its chips compact, with a
   menu each; it draws no scrollbar, and while the chips overflow, ‹ and › over
   its ends page it and a 2 px line under it shows where it is. polish.11:
   each chip is a menu button (Hide or Show, Show only, Accept all N, Dismiss
   all N), an eye shows or hides them all, the author's own edits have a chip
   of their own, You, and the chips keep the size they had before polish.10
   until they must shrink, in steps, to fit (`chipsStep`). */

const wheel = (over: Partial<ChipsWheel> = {}): ChipsWheel => ({
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  shiftKey: false,
  ctrlKey: false,
  ...over
});

/** Thirteen categories in the smallest window at 100%, as measured: 1794 px of chips in 480. */
const ROW: ChipsRow = { scrollLeft: 0, scrollWidth: 1794, clientWidth: 480 };

describe('an up-and-down wheel over the chips (polish.6)', () => {
  it('scrolls the row sideways, down and right going right', () => {
    expect(chipsWheelLeft(wheel(), ROW)).toBe(100);
    expect(chipsWheelLeft(wheel({ deltaY: -100 }), { ...ROW, scrollLeft: 300 })).toBe(200);
  });

  it('stops at either end, and leaves the wheel alone once there', () => {
    const max = ROW.scrollWidth - ROW.clientWidth;
    expect(chipsWheelLeft(wheel({ deltaY: 500 }), { ...ROW, scrollLeft: max - 50 })).toBe(max);
    expect(chipsWheelLeft(wheel(), { ...ROW, scrollLeft: max })).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaY: -100 }), ROW)).toBeNull();
  });

  it('counts a wheel in lines or pages', () => {
    expect(chipsWheelLeft(wheel({ deltaY: 3, deltaMode: 1 }), ROW)).toBe(3 * WHEEL_LINE_PX);
    expect(chipsWheelLeft(wheel({ deltaY: 1, deltaMode: 2 }), ROW)).toBe(ROW.clientWidth);
  });

  it('leaves the wheel to the browser when the chips fit', () => {
    expect(chipsWheelLeft(wheel(), { scrollLeft: 0, scrollWidth: 874, clientWidth: 874 })).toBeNull();
  });

  it('leaves Ctrl and the wheel to zoom, and Shift and the wheel or a sideways wheel to the browser', () => {
    expect(chipsWheelLeft(wheel({ ctrlKey: true }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ shiftKey: true }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 100, deltaY: 0 }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 60, deltaY: 40 }), ROW)).toBeNull();
    expect(chipsWheelLeft(wheel({ deltaX: 40, deltaY: 60 }), ROW)).toBe(60);
  });

  it('never takes the row past its ends, and moves it only the way the wheel turns', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.constantFrom(0, 1, 2),
        (clientWidth, extra, at, deltaY, deltaMode) => {
          // The bound is the row's own, scrollWidth - clientWidth, as the
          // function computes it: in floating point (clientWidth + extra) -
          // clientWidth can sit a few ulps from `extra`, which once failed this
          // property on about one seed in a hundred (seed 11, pinned below).
          const scrollWidth = clientWidth + extra;
          const max = scrollWidth - clientWidth;
          const row = { clientWidth, scrollWidth, scrollLeft: at * max };
          const left = chipsWheelLeft(wheel({ deltaY, deltaMode }), row);
          if (left === null) return;
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left).toBeLessThanOrEqual(max);
          expect(Math.sign(left - row.scrollLeft)).toBe(Math.sign(deltaY));
        }
      )
    );
  });

  it('holds on the rounding case that once failed the property (fast-check seed 11)', () => {
    const clientWidth = 15.93968089542875;
    const extra = 0.5000000000803535;
    const row = { clientWidth, scrollWidth: clientWidth + extra, scrollLeft: 0 };
    const left = chipsWheelLeft(wheel({ deltaY: 0.01250000000200884, deltaMode: 1 }), row);
    expect(left).not.toBeNull();
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(row.scrollWidth - row.clientWidth);
  });
});

describe('a chip the keyboard reaches comes wholly into view (polish.6)', () => {
  it('leaves a chip already in view where it is', () => {
    expect(chipsRevealLeft(ROW, { left: 12, right: 120 })).toBeNull();
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 300 }, { left: 400, right: 700 })).toBeNull();
  });

  it('brings in a chip cut off at the right edge, with the row padding beside it', () => {
    // "grammar 3" as measured in the smallest window: 439.6 to 518.5 in a 480 px row.
    expect(chipsRevealLeft(ROW, { left: 439.6, right: 518.5 })).toBeCloseTo(
      518.5 + CHIPS_REVEAL_MARGIN - 480,
      6
    );
  });

  it('brings in a chip cut off at the left edge', () => {
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 500 }, { left: 450, right: 560 })).toBe(
      450 - CHIPS_REVEAL_MARGIN
    );
  });

  it('shows the start of a chip wider than the row, and never goes past either end', () => {
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 900 }, { left: 300, right: 900 })).toBe(
      300 - CHIPS_REVEAL_MARGIN
    );
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 0 }, { left: 1700, right: 1782 })).toBe(1794 - 480);
    expect(chipsRevealLeft({ ...ROW, scrollLeft: 900 }, { left: 5, right: 80 })).toBe(0);
  });

  it('always leaves the chip wholly in view when the row has room for it', () => {
    fc.assert(
      fc.property(
        // Room for the widest chip between the two margins, the arrows' since polish.10.
        fc.double({ min: 2 * CHIPS_REVEAL_MARGIN + 90, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 90, noNaN: true }),
        (clientWidth, extra, at, where, width) => {
          const scrollWidth = clientWidth + extra;
          const row = { clientWidth, scrollWidth, scrollLeft: at * extra };
          const left = CHIPS_REVEAL_MARGIN + where * (scrollWidth - 2 * CHIPS_REVEAL_MARGIN - width);
          const chip = { left, right: left + width };
          const next = chipsRevealLeft(row, chip) ?? row.scrollLeft;
          expect(next).toBeGreaterThanOrEqual(0);
          expect(next).toBeLessThanOrEqual(extra + 1e-9);
          expect(chip.left).toBeGreaterThanOrEqual(next - 1e-6);
          expect(chip.right).toBeLessThanOrEqual(next + clientWidth + 1e-6);
        }
      )
    );
  });

  it('keeps a chip brought in clear of the arrow over that end (polish.10)', () => {
    expect(CHIPS_REVEAL_MARGIN).toBe(CHIPS_ARROW_WIDTH + 6);
    // Cut off under the right arrow of the smallest window's 434 px row: it comes in clear of it.
    const row = { scrollLeft: 0, scrollWidth: 958, clientWidth: 434 };
    const left = chipsRevealLeft(row, { left: 400, right: 482 });
    expect(left).not.toBeNull();
    expect(482 - (left ?? 0)).toBeCloseTo(434 - CHIPS_REVEAL_MARGIN, 9);
  });
});

describe('the chips, one per category in the text, and You (polish.10, polish.11)', () => {
  const hunk = (
    category: Hunk['category'],
    anchor: Hunk['anchor'] = 'exact',
    source: Hunk['source'] = 'claude'
  ): Pick<Hunk, 'anchor' | 'category' | 'source'> =>
    category === undefined ? { anchor, source } : { anchor, category, source };

  it('counts each category of a suggestion in the text, the most first, then by name', () => {
    expect(
      chipCounts([
        hunk('typo'),
        hunk('grammar'),
        hunk('typo'),
        hunk('awkward'),
        hunk('grammar'),
        hunk('spelling', 'stale'),
        hunk(undefined, 'exact', 'diff'),
        hunk('punctuation', 'fuzzy'),
        hunk('tense', 'ambiguous')
      ])
    ).toEqual([
      ['grammar', 2],
      ['typo', 2],
      ['awkward', 1],
      ['other', 1],
      ['punctuation', 1],
      ['tense', 1]
    ]);
    expect(chipCounts([])).toEqual([]);
    expect(chipCounts([hunk('spelling', 'stale')])).toEqual([]);
  });

  it("counts the author's own edits under You, last whatever its count, and never under other", () => {
    // An edit of the author's carries `other` as its category (manualHunk in src/shared/edit.ts).
    expect(
      chipCounts([
        hunk('other', 'exact', 'manual'),
        hunk('other', 'exact', 'manual'),
        hunk('other', 'exact', 'manual'),
        hunk('other'),
        hunk('typo'),
        hunk('other', 'stale', 'manual')
      ])
    ).toEqual([
      ['other', 1],
      ['typo', 1],
      [YOU_CHIP, 3]
    ]);
    expect(chipCounts([hunk('other', 'exact', 'manual')])).toEqual([[YOU_CHIP, 1]]);
  });

  it('puts each suggestion under one chip: You for an edit of the author, else its category, other for none', () => {
    expect(chipKeyOf(hunk('other', 'exact', 'manual'))).toBe(YOU_CHIP);
    expect(chipKeyOf(hunk('other'))).toBe('other');
    // A manual review's suggestions carry no category.
    expect(chipKeyOf(hunk(undefined, 'exact', 'diff'))).toBe('other');
    expect(chipKeyOf(hunk('grammar', 'exact', 'diff'))).toBe('grammar');
    // A model's suggestion the author reworded keeps its category's chip.
    expect(chipKeyOf({ ...hunk('punctuation'), edited: true } as Pick<Hunk, 'source' | 'category'>)).toBe(
      'punctuation'
    );
    expect(chipHidden(hunk('other', 'exact', 'manual'), [YOU_CHIP])).toBe(true);
    expect(chipHidden(hunk('other', 'exact', 'manual'), ['other'])).toBe(false);
    expect(chipHidden(hunk('other'), [YOU_CHIP])).toBe(false);
    expect(chipHidden(hunk(undefined, 'exact', 'diff'), ['other'])).toBe(true);
    expect(chipHidden(hunk('typo'), [])).toBe(false);
  });

  it('counts every suggestion in the text once, so You and other never share one', () => {
    const anyHunk = fc.record({
      category: fc.option(fc.constantFrom(...CHANGE_CATEGORIES), { nil: undefined }),
      anchor: fc.constantFrom<Hunk['anchor']>('exact', 'fuzzy', 'ambiguous', 'stale'),
      source: fc.constantFrom<Hunk['source']>('claude', 'diff', 'manual')
    });
    fc.assert(
      fc.property(fc.array(anyHunk, { maxLength: 60 }), (raw) => {
        const hunks = raw.map((h) => hunk(h.category, h.anchor, h.source));
        const chips = chipCounts(hunks);
        const placed = hunks.filter((h) => h.anchor !== 'stale');
        expect(chips.reduce((sum, [, n]) => sum + n, 0)).toBe(placed.length);
        expect(new Set(chips.map(([key]) => key)).size).toBe(chips.length);
        for (const [key, n] of chips) {
          expect(placed.filter((h) => chipKeyOf(h) === key)).toHaveLength(n);
        }
        const you = chips.findIndex(([key]) => key === YOU_CHIP);
        expect(you === -1 || you === chips.length - 1).toBe(true);
        expect(you !== -1).toBe(placed.some((h) => h.source === 'manual'));
        // Hiding a chip hides exactly the suggestions it counts.
        for (const [key, n] of chips) {
          expect(placed.filter((h) => chipHidden(h, [key]))).toHaveLength(n);
        }
      })
    );
  });

  it('names a chip, its menu, its items and what a click opens', () => {
    expect(chipName('punctuation')).toBe('punctuation');
    expect(chipName(YOU_CHIP)).toBe('You');
    expect(chipBulkLabel('accept', 'punctuation')).toBe('Accept all punctuation');
    expect(chipBulkLabel('dismiss', 'word-choice')).toBe('Dismiss all word-choice');
    expect(chipBulkLabel('accept', YOU_CHIP)).toBe('Accept all your edits');
    expect(chipBulkLabel('dismiss', YOU_CHIP)).toBe('Dismiss all your edits');
    expect(chipMenuLabel('typo')).toBe('typo suggestions');
    expect(chipMenuLabel(YOU_CHIP)).toBe('Your edits');
    expect(chipMenuLabels(false, 3)).toEqual({
      toggle: 'Hide',
      only: 'Show only',
      accept: 'Accept all 3',
      dismiss: 'Dismiss all 3'
    });
    expect(chipMenuLabels(true, 0)).toEqual({
      toggle: 'Show',
      only: 'Show only',
      accept: 'Accept all 0',
      dismiss: 'Dismiss all 0'
    });
    expect(chipTitle('grammar', false)).toBe('Shown. Click for Hide, Show only, Accept all and Dismiss all.');
    expect(chipTitle('grammar', true)).toBe('Hidden. Click for Show, Show only, Accept all and Dismiss all.');
    expect(chipTitle(YOU_CHIP, false)).toBe(
      'Your own edits. Shown. Click for Hide, Show only, Accept all and Dismiss all.'
    );
  });

  it('opens the menu under the chip, and keeps it in the window', () => {
    expect(chipMenuPlacement({ left: 321, bottom: 31 }, 160, 1424)).toEqual({ left: 321, top: 35 });
    // Near the right edge it moves left, to 4 px from the edge.
    expect(chipMenuPlacement({ left: 800, bottom: 31 }, 160, 884)).toEqual({ left: 720, top: 35 });
    // Never past the left edge.
    expect(chipMenuPlacement({ left: -30, bottom: 31 }, 160, 884)).toEqual({ left: 4, top: 35 });
    expect(chipMenuPlacement({ left: 10, bottom: 31 }, 900, 884)).toEqual({ left: 4, top: 35 });
  });
});

describe('Show only and the eye (polish.11)', () => {
  const ROW: RowChip[] = ['grammar', 'typo', 'other', COMMENTS_CHIP, YOU_CHIP];

  it('hides every other chip in the row for Show only, and nothing that is not in it', () => {
    expect(showOnlyHidden(ROW, 'typo')).toEqual(['grammar', 'other', COMMENTS_CHIP, YOU_CHIP]);
    expect(showOnlyHidden(ROW, YOU_CHIP)).toEqual(['grammar', 'typo', 'other', COMMENTS_CHIP]);
    // The comments' chip too (polish.13): Show only on it hides every suggestion.
    expect(showOnlyHidden(ROW, COMMENTS_CHIP)).toEqual(['grammar', 'typo', 'other', YOU_CHIP]);
    expect(showOnlyHidden(['grammar'], 'grammar')).toEqual([]);
  });

  it('opens the eye only while every chip in the row is shown, and names what it does', () => {
    expect(allChipsShown(ROW, [])).toBe(true);
    // A hidden category with no chip in the row leaves the eye open.
    expect(allChipsShown(ROW, ['spelling'])).toBe(true);
    expect(allChipsShown(ROW, [YOU_CHIP])).toBe(false);
    // The comments' chip counts as any other (polish.13).
    expect(allChipsShown(ROW, [COMMENTS_CHIP])).toBe(false);
    expect(allChipsHidden(ROW, ROW)).toBe(true);
    expect(allChipsHidden(ROW, ['grammar', 'typo', 'other', YOU_CHIP])).toBe(false);
    expect(eyeLabel(true)).toBe(HIDE_ALL_CATEGORIES);
    expect(eyeLabel(false)).toBe(SHOW_ALL_CATEGORIES);
    expect([HIDE_ALL_CATEGORIES, SHOW_ALL_CATEGORIES]).toEqual([
      'Hide all categories',
      'Show all categories'
    ]);
  });

  it('closes the eye after Show only on any chip of a row of two or more, and opens it after Show all', () => {
    const row = fc
      .uniqueArray(fc.constantFrom<RowChip>(...CHANGE_CATEGORIES, COMMENTS_CHIP, YOU_CHIP), {
        minLength: 1,
        maxLength: 15
      })
      .chain((keys) => fc.tuple(fc.constant(keys), fc.constantFrom(...keys)));
    fc.assert(
      fc.property(row, ([keys, key]) => {
        const hidden = showOnlyHidden(keys, key);
        expect(hidden).not.toContain(key);
        expect(keys.filter((k) => !hidden.includes(k))).toEqual([key]);
        expect(allChipsShown(keys, hidden)).toBe(keys.length === 1);
        // The eye then shows them all, and Hide all hides them all.
        expect(allChipsShown(keys, [])).toBe(true);
        expect(allChipsHidden(keys, keys)).toBe(true);
        expect(allChipsShown(keys, keys)).toBe(false);
      })
    );
  });
});

/* polish.13: the review's comments have a chip, "comments N", after the
   categories and before You, counting the open comments; its menu has Hide
   or Show and Show only, and no Accept all or Dismiss all; Show only on any
   other chip hides it, and the eye counts it. What hiding it does to the
   page is in test/renderer/commentsChip.render.test.ts. */
describe('the comments chip (polish.13)', () => {
  const hunk = (
    category: Hunk['category'],
    anchor: Hunk['anchor'] = 'exact',
    source: Hunk['source'] = 'claude'
  ): Pick<Hunk, 'anchor' | 'category' | 'source'> =>
    category === undefined ? { anchor, source } : { anchor, category, source };
  const open = { status: 'open' } as const;
  const resolved = { status: 'resolved' } as const;

  it('comes after the categories and before You, and counts the open comments', () => {
    expect(
      chipCounts(
        [hunk('typo'), hunk('grammar'), hunk('typo'), hunk('other', 'exact', 'manual')],
        [open, resolved, open, open]
      )
    ).toEqual([
      ['typo', 2],
      ['grammar', 1],
      [COMMENTS_CHIP, 3],
      [YOU_CHIP, 1]
    ]);
    // Last with no edit of the author's, and alone with no suggestion in the text.
    expect(chipCounts([hunk('typo')], [open])).toEqual([
      ['typo', 1],
      [COMMENTS_CHIP, 1]
    ]);
    expect(chipCounts([hunk('spelling', 'stale')], [open, open])).toEqual([[COMMENTS_CHIP, 2]]);
    // Every comment resolved: the chip stays, at 0, as their greyed cards are still there to hide.
    expect(chipCounts([], [resolved, resolved])).toEqual([[COMMENTS_CHIP, 0]]);
    // No comment, no chip.
    expect(chipCounts([hunk('typo')], [])).toEqual([['typo', 1]]);
    expect(chipCounts([hunk('typo')])).toEqual([['typo', 1]]);
  });

  it('is named, titled and given a menu of its own, with nothing to accept or dismiss', () => {
    expect(COMMENTS_CHIP).toBe('comments');
    expect(chipName(COMMENTS_CHIP)).toBe('comments');
    expect(chipMenuLabel(COMMENTS_CHIP)).toBe('Comments');
    expect(chipTitle(COMMENTS_CHIP, false)).toBe(
      'Comments, counting the open ones. Shown. Click for Hide and Show only.'
    );
    expect(chipTitle(COMMENTS_CHIP, true)).toBe(
      'Comments, counting the open ones. Hidden. Click for Show and Show only.'
    );
    expect(suggestionChip(COMMENTS_CHIP)).toBeNull();
    for (const key of [...CHANGE_CATEGORIES, YOU_CHIP] as const) expect(suggestionChip(key)).toBe(key);
  });

  it('hides the comments only when it is hidden itself, and hides no suggestion', () => {
    expect(commentsHidden([])).toBe(false);
    expect(commentsHidden(['grammar', YOU_CHIP])).toBe(false);
    expect(commentsHidden([COMMENTS_CHIP])).toBe(true);
    expect(chipHidden(hunk('other'), [COMMENTS_CHIP])).toBe(false);
    expect(chipHidden(hunk('other', 'exact', 'manual'), [COMMENTS_CHIP])).toBe(false);
  });

  it('leaves the suggestions chips as they were, whatever the comments, and stands between them and You', () => {
    const anyHunk = fc.record({
      category: fc.option(fc.constantFrom(...CHANGE_CATEGORIES), { nil: undefined }),
      anchor: fc.constantFrom<Hunk['anchor']>('exact', 'fuzzy', 'ambiguous', 'stale'),
      source: fc.constantFrom<Hunk['source']>('claude', 'diff', 'manual')
    });
    const anyComment = fc.constantFrom(open, resolved);
    fc.assert(
      fc.property(
        fc.array(anyHunk, { maxLength: 40 }),
        fc.array(anyComment, { maxLength: 12 }),
        (raw, comments) => {
          const hunks = raw.map((h) => hunk(h.category, h.anchor, h.source));
          const chips = chipCounts(hunks, comments);
          const keys = chips.map(([key]) => key);
          expect(chips.filter(([key]) => key !== COMMENTS_CHIP)).toEqual(chipCounts(hunks));
          const at = keys.indexOf(COMMENTS_CHIP);
          expect(at !== -1).toBe(comments.length > 0);
          if (at !== -1) {
            expect(chips[at]?.[1]).toBe(comments.filter((x) => x.status === 'open').length);
            // Only You after it, and every category before it.
            expect(keys.slice(at + 1).every((key) => key === YOU_CHIP)).toBe(true);
            expect(keys.slice(0, at)).not.toContain(YOU_CHIP);
          }
          // Hiding it hides no suggestion; hiding every other chip leaves the comments shown.
          const placed = hunks.filter((h) => h.anchor !== 'stale');
          expect(placed.filter((h) => chipHidden(h, [COMMENTS_CHIP]))).toEqual([]);
          expect(commentsHidden(keys.filter((key) => key !== COMMENTS_CHIP))).toBe(false);
          // Show only on another chip hides the comments; on the comments, every suggestion.
          for (const key of keys) {
            const hidden = showOnlyHidden(keys, key);
            expect(commentsHidden(hidden)).toBe(key !== COMMENTS_CHIP && at !== -1);
            if (key === COMMENTS_CHIP) {
              expect(placed.filter((h) => !chipHidden(h, hidden))).toEqual([]);
            }
          }
          // The eye's Hide all hides the comments too, and Show all shows them.
          expect(commentsHidden(keys)).toBe(at !== -1);
          expect(allChipsShown(keys, [])).toBe(true);
        }
      )
    );
  });
});

describe('the size the chips are drawn at (polish.11)', () => {
  /** What the steps' chips take in all: their widths and the step's gap between each two. */
  const total = (step: number, widths: readonly number[]): number =>
    widths.reduce((sum, w) => sum + w, 0) + (CHIP_STEPS[step]?.gap ?? 0) * Math.max(0, widths.length - 1);

  /**
   * A chip's width at each step from the width of its words at 13 px, as
   * Chromium draws it near enough: the words scaled with the type, the
   * padding at both ends and the 1 px border.
   */
  const widthsAt = (words: readonly number[]): number[][] =>
    CHIP_STEPS.map((step) => {
      const pad = parseFloat(step.padding.split(' ')[1] ?? '0');
      return words.map((w) => (w * step.fontSize) / 13 + 2 * pad + 2);
    });

  it('goes from the size before polish.10 down to its compact size', () => {
    expect(CHIP_STEPS[0]).toEqual({ fontSize: 13, lineHeight: 'normal', padding: '2px 8px', gap: 6 });
    expect(CHIP_STEPS[CHIP_STEPS.length - 1]).toEqual({
      fontSize: 11.5,
      lineHeight: '16px',
      padding: '1px 5px',
      gap: 4
    });
    for (let i = 1; i < CHIP_STEPS.length; i += 1) {
      expect(CHIP_STEPS[i]?.fontSize ?? 0).toBeLessThan(CHIP_STEPS[i - 1]?.fontSize ?? 0);
      expect(CHIP_STEPS[i]?.gap ?? 0).toBeLessThanOrEqual(CHIP_STEPS[i - 1]?.gap ?? 0);
    }
  });

  it('keeps the largest size that fits, and shrinks a step at a time as the row narrows', () => {
    // Thirteen chips of about 60 px of words at 13 px.
    const natural = widthsAt(Array.from({ length: 13 }, (_, i) => 50 + i * 2));
    const at = natural.map((widths, step) => total(step, widths));
    expect(at[0]).toBeGreaterThan(at[1] ?? 0);
    expect(at[1]).toBeGreaterThan(at[2] ?? 0);
    expect(at[2]).toBeGreaterThan(at[3] ?? 0);
    expect(chipsStep(2000, natural)).toBe(0);
    expect(chipsStep(at[0] ?? 0, natural)).toBe(0);
    expect(chipsStep((at[0] ?? 0) - 0.01, natural)).toBe(1);
    expect(chipsStep(at[1] ?? 0, natural)).toBe(1);
    expect(chipsStep(at[2] ?? 0, natural)).toBe(2);
    expect(chipsStep((at[2] ?? 0) - 0.01, natural)).toBe(3);
    // Short even of the compact size: that, and the row overflows to its arrows.
    expect(chipsStep((at[3] ?? 0) - 1, natural)).toBe(3);
    expect(chipsStep(0, natural)).toBe(3);
    // One chip, and none.
    expect(chipsStep(80, widthsAt([60]))).toBe(0);
    expect(chipsStep(0, [[], [], [], []])).toBe(0);
  });

  it('picks the first step that fits for any widths, else the last, and never a larger one for less room', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 10, max: 160, noNaN: true }), { minLength: 1, maxLength: 15 }),
        fc.double({ min: 0, max: 2600, noNaN: true }),
        fc.double({ min: 0, max: 2600, noNaN: true }),
        (words, a, b) => {
          const natural = widthsAt(words);
          const last = CHIP_STEPS.length - 1;
          const narrow = Math.min(a, b);
          const wide = Math.max(a, b);
          const step = chipsStep(narrow, natural);
          expect(step).toBeGreaterThanOrEqual(0);
          expect(step).toBeLessThanOrEqual(last);
          for (let larger = 0; larger < step; larger += 1) {
            expect(total(larger, natural[larger] ?? [])).toBeGreaterThan(narrow);
          }
          if (step < last) expect(total(step, natural[step] ?? [])).toBeLessThanOrEqual(narrow);
          // Only once the compact size does not fit either does the row overflow.
          if (total(last, natural[last] ?? []) > narrow) expect(step).toBe(last);
          // More room never draws them smaller.
          expect(chipsStep(wide, natural)).toBeLessThanOrEqual(step);
        }
      )
    );
  });

  it('reads only the widths it is given, whatever they are', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.double({ min: 0, max: 200, noNaN: true }), { minLength: 1, maxLength: 15 }), {
          minLength: CHIP_STEPS.length,
          maxLength: CHIP_STEPS.length
        }),
        fc.double({ min: 0, max: 3000, noNaN: true }),
        (natural, width) => {
          const step = chipsStep(width, natural);
          const first = natural.findIndex(
            (widths, at) => at < CHIP_STEPS.length - 1 && total(at, widths) <= width
          );
          expect(step).toBe(first === -1 ? CHIP_STEPS.length - 1 : first);
        }
      )
    );
  });
});

/* rr.6: the Mode select stands before the eye and is drawn at the chips'
   step, so its width at a step comes out of their room at that step. The row
   and the select together are what no step changes; the decision must not
   depend on the step the select happens to be drawn at, or the two would
   swing between steps. */
describe('the Mode select beside the chips (rr.6)', () => {
  const total = (step: number, widths: readonly number[]): number =>
    widths.reduce((sum, w) => sum + w, 0) + (CHIP_STEPS[step]?.gap ?? 0) * Math.max(0, widths.length - 1);
  const widthsAt = (words: readonly number[]): number[][] =>
    CHIP_STEPS.map((step) => {
      const pad = parseFloat(step.padding.split(' ')[1] ?? '0');
      return words.map((w) => (w * step.fontSize) / 13 + 2 * pad + 2);
    });
  /** The select's widths at each step as measured in the window (rr.6, at 100%). */
  const SELECT = [123.75, 117.45, 113.16, 106.86];

  it('takes the select at each step out of the room the row and the select have together', () => {
    // Four chips, as Chapter 02 of the samples had in the window.
    const natural = widthsAt([64, 84, 58, 80]);
    const together = natural.map((widths, step) => total(step, widths) + (SELECT[step] ?? 0));
    // Drawn at the largest step, the row has its room less the select's width there.
    const drawn = SELECT[0] ?? 0;
    const at = (both: number): number => chipsStep(both - drawn, natural, { drawn, steps: SELECT });
    expect(at(2000)).toBe(0);
    expect(at(together[0] ?? 0)).toBe(0);
    expect(at((together[0] ?? 0) - 0.01)).toBe(1);
    expect(at(together[1] ?? 0)).toBe(1);
    expect(at((together[1] ?? 0) - 0.01)).toBe(2);
    expect(at((together[2] ?? 0) - 0.01)).toBe(3);
    expect(at(0)).toBe(3);
    // Without it the row's own width decides, as before rr.6.
    expect(chipsStep(total(0, natural[0] ?? []), natural)).toBe(0);
    expect(chipsStep(total(0, natural[0] ?? []), natural, { drawn, steps: SELECT })).toBe(0);
    expect(chipsStep(total(0, natural[0] ?? []), natural, { drawn: SELECT[3] ?? 0, steps: SELECT })).toBe(1);
  });

  it('decides the same whatever step the select is drawn at, and as without it when it is as wide at every step', () => {
    /* Whole pixels at the widths the window has, so that (both - drawn) +
       drawn is both exactly. Doubles drew mostly values near 0, which never put
       the room near a step's threshold, and the property passed with the
       select ignored (the review of rr.6). Half the runs put the room within
       3 px of the point at which a step's chips and select just fit. */
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 10, max: 160, noNaN: true }), { minLength: 1, maxLength: 15 }),
        fc.array(fc.integer({ min: 80, max: 200 }), {
          minLength: CHIP_STEPS.length,
          maxLength: CHIP_STEPS.length
        }),
        fc.integer({ min: 0, max: 3000 }),
        fc.option(
          fc.record({
            step: fc.integer({ min: 0, max: CHIP_STEPS.length - 2 }),
            by: fc.integer({ min: -3, max: 3 })
          }),
          { freq: 2 }
        ),
        (words, select, anywhere, near) => {
          const natural = widthsAt(words);
          const steps = [...select].sort((a, b) => b - a);
          const both = near
            ? Math.max(
                0,
                Math.floor(total(near.step, natural[near.step] ?? []) + (steps[near.step] ?? 0)) + near.by
              )
            : anywhere;
          const decided = steps.map((drawn) => chipsStep(both - drawn, natural, { drawn, steps }));
          expect(new Set(decided).size).toBe(1);
          // The first step at which the chips and the select fit together, else the last.
          const first = natural.findIndex(
            (widths, at) => at < CHIP_STEPS.length - 1 && total(at, widths) <= both - (steps[at] ?? 0)
          );
          expect(decided[0]).toBe(first === -1 ? CHIP_STEPS.length - 1 : first);
          // A select as wide at every step changes nothing.
          const same = steps[0] ?? 0;
          expect(chipsStep(both - same, natural, { drawn: same, steps: steps.map(() => same) })).toBe(
            chipsStep(both - same, natural)
          );
        }
      )
    );
  });
});

describe('the arrows and the line, while the chips overflow (polish.10)', () => {
  /** The smallest window at 100% with thirteen categories, as measured: 958 px of chips in 434. */
  const SMALL: ChipsRow = { scrollLeft: 0, scrollWidth: 958, clientWidth: 434 };
  const max = SMALL.scrollWidth - SMALL.clientWidth;
  const FITS: ChipsRow = { scrollLeft: 0, scrollWidth: 974, clientWidth: 974 };

  it('shows no arrow and no line while the chips fit', () => {
    expect(chipsEnds(FITS)).toEqual({ start: false, end: false });
    expect(chipsIndicator(FITS, 974)).toBeNull();
    expect(chipsPageLeft(FITS, 1)).toBeNull();
    // Less than a pixel over, as zoom can leave, counts as fitting.
    expect(chipsEnds({ ...FITS, scrollWidth: 974.6 })).toEqual({ start: false, end: false });
    expect(chipsIndicator({ ...FITS, scrollWidth: 974.6 }, 974)).toBeNull();
  });

  it('shows › at the start, both between, and ‹ at the end', () => {
    expect(chipsEnds(SMALL)).toEqual({ start: false, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: 200 })).toEqual({ start: true, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: max })).toEqual({ start: true, end: false });
    // A fractional position within a pixel of an end is at it.
    expect(chipsEnds({ ...SMALL, scrollLeft: 0.4 })).toEqual({ start: false, end: true });
    expect(chipsEnds({ ...SMALL, scrollLeft: max - 0.4 })).toEqual({ start: true, end: false });
  });

  it('pages by the row less the room kept at each end, and stops at the ends', () => {
    const step = SMALL.clientWidth - 2 * CHIPS_REVEAL_MARGIN;
    expect(chipsPageLeft(SMALL, 1)).toBe(step);
    expect(chipsPageLeft({ ...SMALL, scrollLeft: step }, 1)).toBe(max);
    expect(chipsPageLeft({ ...SMALL, scrollLeft: max }, 1)).toBeNull();
    expect(chipsPageLeft({ ...SMALL, scrollLeft: max }, -1)).toBe(max - step);
    expect(chipsPageLeft(SMALL, -1)).toBeNull();
    // A row narrower than both margins still moves.
    expect(chipsPageLeft({ scrollLeft: 0, scrollWidth: 958, clientWidth: 40 }, 1)).toBe(CHIPS_REVEAL_MARGIN);
  });

  it('draws the thumb as the share in view, where the row stands', () => {
    const share = (434 * 434) / 958;
    expect(chipsIndicator(SMALL, 434)).toEqual({ left: 0, width: share });
    const end = chipsIndicator({ ...SMALL, scrollLeft: max }, 434);
    expect((end?.left ?? 0) + (end?.width ?? 0)).toBeCloseTo(434, 9);
    expect(chipsIndicator({ ...SMALL, scrollLeft: max / 2 }, 434)?.left).toBeCloseTo((434 - share) / 2, 9);
    // Never shorter than its least, however many chips.
    expect(chipsIndicator({ scrollLeft: 0, scrollWidth: 50_000, clientWidth: 100 }, 100)?.width).toBe(
      CHIPS_THUMB_MIN
    );
  });

  it('gives the view as the row stands: the arrows and the thumb on a line as wide as the row', () => {
    expect(chipsView(FITS)).toEqual(CHIPS_FIT);
    expect(chipsView(SMALL)).toEqual({ start: false, end: true, thumb: chipsIndicator(SMALL, 434) });
    expect(chipsView({ ...SMALL, scrollLeft: 200 })).toEqual({
      start: true,
      end: true,
      thumb: chipsIndicator({ ...SMALL, scrollLeft: 200 }, 434)
    });
    expect(chipsView({ ...SMALL, scrollLeft: max })).toMatchObject({ start: true, end: false });
  });

  it('keeps the view it has only for one that draws the same (polish.10 review)', () => {
    const at = (scrollLeft: number) => chipsView({ ...SMALL, scrollLeft });
    expect(sameChipsView(CHIPS_FIT, chipsView(FITS))).toBe(true);
    expect(sameChipsView(at(200), at(200))).toBe(true);
    // Within half a pixel of the thumb's place it draws the same.
    expect(sameChipsView(at(200), at(200.3))).toBe(true);
    // The row overflowing, either arrow, or the thumb a pixel on: drawn again.
    expect(sameChipsView(CHIPS_FIT, at(0))).toBe(false);
    expect(sameChipsView(at(0), at(200))).toBe(false);
    expect(sameChipsView(at(200), at(max))).toBe(false);
    const view = at(200);
    const thumb = view.thumb ?? { left: 0, width: 0 };
    expect(sameChipsView(view, { ...view, thumb: { ...thumb, left: thumb.left + 1 } })).toBe(false);
    expect(sameChipsView(view, { ...view, thumb: { ...thumb, width: thumb.width + 1 } })).toBe(false);
    expect(sameChipsView(view, { ...view, thumb: null })).toBe(false);
    expect(sameChipsView(view, { ...view, start: false })).toBe(false);
    expect(sameChipsView(view, { ...view, end: false })).toBe(false);
  });

  it('keeps the thumb on the line, and moves it the way the row scrolls', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3000, noNaN: true }),
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 3000, noNaN: true }),
        (clientWidth, extra, a, b, width) => {
          const scrollWidth = clientWidth + extra;
          const max = scrollWidth - clientWidth;
          const at = (t: number): ChipsRow => ({ clientWidth, scrollWidth, scrollLeft: t * max });
          const one = chipsIndicator(at(Math.min(a, b)), width);
          const two = chipsIndicator(at(Math.max(a, b)), width);
          if (max < 1) {
            expect(one).toBeNull();
            expect(chipsEnds(at(a))).toEqual({ start: false, end: false });
            return;
          }
          for (const thumb of [one, two]) {
            expect(thumb).not.toBeNull();
            expect(thumb?.left ?? -1).toBeGreaterThanOrEqual(0);
            expect((thumb?.left ?? 0) + (thumb?.width ?? 0)).toBeLessThanOrEqual(width + 1e-6);
            expect(thumb?.width ?? 0).toBeGreaterThan(0);
          }
          expect(two?.left ?? 0).toBeGreaterThanOrEqual((one?.left ?? 0) - 1e-9);
          // An arrow shows at each end with chips out of sight that way.
          const ends = chipsEnds(at(a));
          expect(ends.start || ends.end).toBe(true);
        }
      )
    );
  });
});
