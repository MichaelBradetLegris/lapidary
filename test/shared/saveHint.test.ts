import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NOTHING_UNTIL_SAVE,
  SAVE_HINT_ARROW_CLEAR,
  SAVE_HINT_ARROW_INSET,
  SAVE_HINT_GOT_IT,
  SAVE_HINT_ID,
  SAVE_HINT_MARGIN,
  SAVE_HINT_OBSIDIAN_NOTE,
  SAVE_HINT_WIDTH,
  chapterFileName,
  saveHintPlacement,
  saveHintText,
  saveHintVisible,
  withHint,
  type SaveHintInput
} from '../../src/shared/ui/saveHint';
import { PRO_PRESELECT_HINT } from '../../src/shared/ai/claudeModels';

/* apply.12: the first-use hint beside Save to chapter (PLAN 7). Its wiring is
   checked in test/renderer/saveHint.test.ts, the setting it writes in
   test/renderer/hints.test.ts. */

const PATH = 'D:\\Novel\\Chapter 01 - The Flood.md';

describe('the words (apply.12)', () => {
  it('says the task text word for word, with the chapter file name', () => {
    expect(saveHintText(PATH)).toBe(
      'Your decisions are kept in this review, not in your chapter yet. Press Save to chapter (Ctrl+S) to write them into Chapter 01 - The Flood.md. The version it replaces is backed up first.'
    );
    expect(SAVE_HINT_GOT_IT).toBe('Got it');
  });

  it('names the file with its extension, whichever separator the path uses', () => {
    expect(chapterFileName('C:\\Novel\\Part 2\\Chapter 12.txt')).toBe('Chapter 12.txt');
    expect(chapterFileName('/srv/novel/ch 3.md')).toBe('ch 3.md');
    expect(chapterFileName('C:/Novel/Chapter 01.md')).toBe('Chapter 01.md');
    expect(chapterFileName('Chapter 01.md')).toBe('Chapter 01.md');
    expect(saveHintText('D:/Book/Prologue.txt')).toContain('to write them into Prologue.txt.');
  });

  it('adds the apply.21 sentence after the others when there is one, and none until then', () => {
    expect(SAVE_HINT_OBSIDIAN_NOTE).toBeNull();
    expect(saveHintText(PATH, null)).toBe(saveHintText(PATH));
    const note = 'Leave the chapter closed in Obsidian while you save.';
    expect(saveHintText(PATH, note)).toBe(`${saveHintText(PATH, null)} ${note}`);
    expect(saveHintText(PATH, '')).toBe(saveHintText(PATH, null));
  });

  it('never says "accepted changes", and the empty page and Accept all share one sentence', () => {
    for (const text of [saveHintText(PATH), NOTHING_UNTIL_SAVE, SAVE_HINT_GOT_IT]) {
      expect(text).not.toMatch(/accepted changes?/i);
    }
    expect(NOTHING_UNTIL_SAVE).toBe('Nothing reaches the chapter until you press Save to chapter.');
  });

  it('has an id of its own, apart from the Pro preselection', () => {
    expect(SAVE_HINT_ID).toBe('save-to-chapter');
    expect(SAVE_HINT_ID).not.toBe(PRO_PRESELECT_HINT);
  });
});

describe('when it shows (apply.12)', () => {
  const base: SaveHintInput = {
    dismissedHints: [],
    dismissedThisSession: false,
    hasChapter: true,
    unsavedDecisions: 1,
    locked: false,
    saving: false,
    sideFolded: false,
    editingParagraph: false,
    setAside: false
  };

  it('shows the first time a change is not saved to the chapter', () => {
    expect(saveHintVisible(base)).toBe(true);
    expect(saveHintVisible({ ...base, unsavedDecisions: 12 })).toBe(true);
    expect(saveHintVisible({ ...base, dismissedHints: [PRO_PRESELECT_HINT] })).toBe(true);
  });

  it('never once it is dismissed, in the settings or this session', () => {
    expect(saveHintVisible({ ...base, dismissedHints: [SAVE_HINT_ID] })).toBe(false);
    expect(saveHintVisible({ ...base, dismissedHints: [PRO_PRESELECT_HINT, SAVE_HINT_ID] })).toBe(false);
    expect(saveHintVisible({ ...base, dismissedThisSession: true })).toBe(false);
  });

  it('not with nothing to save, no chapter, or before the settings have loaded', () => {
    expect(saveHintVisible({ ...base, unsavedDecisions: 0 })).toBe(false);
    expect(saveHintVisible({ ...base, hasChapter: false })).toBe(false);
    expect(saveHintVisible({ ...base, dismissedHints: null })).toBe(false);
  });

  it('waits while Save to chapter cannot be pressed: a review running, or a save under way', () => {
    expect(saveHintVisible({ ...base, locked: true })).toBe(false);
    expect(saveHintVisible({ ...base, saving: true })).toBe(false);
  });

  /* ui.3 review: with the side panel folded the hint hangs over the prose, and
     at 200% in a 900 by 600 window over most of it, the paragraph editor's
     text and Done included. */
  it('with the side panel folded, waits while a paragraph is open for editing', () => {
    const folded = { ...base, sideFolded: true };
    expect(saveHintVisible(folded)).toBe(true);
    expect(saveHintVisible({ ...folded, editingParagraph: true })).toBe(false);
    // Over the panel drawn in place it meets no paragraph, and shows as before.
    expect(saveHintVisible({ ...base, editingParagraph: true })).toBe(true);
  });

  it('with the side panel folded, stays away once set aside, and shows over the panel in place again', () => {
    expect(saveHintVisible({ ...base, sideFolded: true, setAside: true })).toBe(false);
    expect(saveHintVisible({ ...base, setAside: true })).toBe(true);
  });

  it('shows exactly when every condition holds', () => {
    fc.assert(
      fc.property(
        fc.record({
          dismissedHints: fc.option(fc.subarray([SAVE_HINT_ID, PRO_PRESELECT_HINT, 'other'])),
          dismissedThisSession: fc.boolean(),
          hasChapter: fc.boolean(),
          unsavedDecisions: fc.nat(30),
          locked: fc.boolean(),
          saving: fc.boolean(),
          sideFolded: fc.boolean(),
          editingParagraph: fc.boolean(),
          setAside: fc.boolean()
        }),
        (input) => {
          const expected =
            input.dismissedHints !== null &&
            !input.dismissedHints.includes(SAVE_HINT_ID) &&
            !input.dismissedThisSession &&
            input.hasChapter &&
            input.unsavedDecisions > 0 &&
            !input.locked &&
            !input.saving &&
            !(input.sideFolded && (input.editingParagraph || input.setAside));
          expect(saveHintVisible(input)).toBe(expected);
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('withHint', () => {
  it('adds the id once, at the end, and leaves the old array alone', () => {
    const before = [PRO_PRESELECT_HINT];
    const after = withHint(before, SAVE_HINT_ID);
    expect(after).toEqual([PRO_PRESELECT_HINT, SAVE_HINT_ID]);
    expect(before).toEqual([PRO_PRESELECT_HINT]);
    expect(withHint(after, SAVE_HINT_ID)).toEqual(after);
    expect(withHint(after, SAVE_HINT_ID)).not.toBe(after);
    expect(withHint([], SAVE_HINT_ID)).toEqual([SAVE_HINT_ID]);
  });
});

describe('where it sits (apply.12)', () => {
  // Measured in a dev:clean window (CSS pixels, from the toolbar's left edge).
  const DEFAULT = {
    barWidth: 1424,
    buttonLeft: 1080,
    buttonWidth: 165,
    column: { left: 1104, right: 1424 },
    below: []
  };

  it('lines up with the side panel column right edge, the arrow on the Save button middle', () => {
    // 1424 by 901 at 100%: Save to chapter from 1080 to 1245, the side panel from 1104.
    const placed = saveHintPlacement(DEFAULT);
    expect(placed.width).toBe(SAVE_HINT_WIDTH);
    expect(placed.left).toBe(1424 - SAVE_HINT_MARGIN - SAVE_HINT_WIDTH);
    expect(placed.left + (placed.arrow ?? NaN)).toBe(1080 + 165 / 2);
  });

  it('keeps to a column narrower than itself, clear of the cards and the find bar beside it', () => {
    // A 1100 px window at 125% (880 CSS px): Save to chapter from 537 to 702, the
    // side panel from 640, so the cards, 16 px in from the centre column's right
    // edge, end at 624. The hint had spanned 572 to 872, over their close button.
    const placed = saveHintPlacement({
      barWidth: 880,
      buttonLeft: 537,
      buttonWidth: 165,
      column: { left: 640, right: 880 },
      below: []
    });
    expect(placed.width).toBe(240 - 2 * SAVE_HINT_MARGIN);
    expect(placed.left).toBe(640 + SAVE_HINT_MARGIN);
    expect(placed.left).toBeGreaterThan(640 - 16);
    // Save's middle (619.5) is out of reach, so the arrow takes the nearest point of the button it can.
    expect(placed.arrow).toBe(SAVE_HINT_ARROW_INSET);
    const tip = placed.left + (placed.arrow ?? NaN);
    expect(tip).toBeGreaterThanOrEqual(537 + SAVE_HINT_ARROW_CLEAR);
    expect(tip).toBeLessThanOrEqual(702 - SAVE_HINT_ARROW_CLEAR);
  });

  it('has no arrow when every part of Save to chapter has a button under it', () => {
    // 900 by 600 at 125% (720 CSS px): Save to chapter on the first row, from 543
    // to 708, Copy result (550 to 634) and Settings (642 to 708) under it. The
    // arrow had pointed between the two.
    const placed = saveHintPlacement({
      barWidth: 720,
      buttonLeft: 543,
      buttonWidth: 165,
      column: { left: 480, right: 720 },
      below: [
        { left: 550, right: 634 },
        { left: 642, right: 708 }
      ]
    });
    expect(placed.arrow).toBeNull();
    expect(placed.left).toBe(720 - SAVE_HINT_MARGIN - placed.width);
    // The same in the default window at 200% (712 CSS px).
    expect(
      saveHintPlacement({
        barWidth: 712,
        buttonLeft: 535,
        buttonWidth: 165,
        column: { left: 472, right: 712 },
        below: [
          { left: 541, right: 626 },
          { left: 634, right: 700 }
        ]
      }).arrow
    ).toBeNull();
    // Nor in the few pixels between the button's end and the item under it.
    expect(
      saveHintPlacement({
        barWidth: 1000,
        buttonLeft: 400,
        buttonWidth: 200,
        column: null,
        below: [{ left: 418, right: 700 }]
      }).arrow
    ).toBeNull();
  });

  it('points past the buttons under Save to chapter when part of it is clear', () => {
    // 1280 by 800 at 175% (731 CSS px): Settings alone on the second row, right
    // of Save to chapter, so the button's middle has nothing under it.
    const placed = saveHintPlacement({
      barWidth: 731,
      buttonLeft: 463,
      buttonWidth: 164,
      column: { left: 491, right: 731 },
      below: [{ left: 654, right: 719 }]
    });
    expect(placed.left + (placed.arrow ?? NaN)).toBe(463 + 164 / 2);
    // A gap between two buttons under it, wide enough for the arrow and some room either side.
    const gap = saveHintPlacement({
      barWidth: 1000,
      buttonLeft: 700,
      buttonWidth: 200,
      column: null,
      below: [
        { left: 680, right: 760 },
        { left: 860, right: 990 }
      ]
    });
    expect(gap.left + (gap.arrow ?? NaN)).toBe(800);
    // With the middle taken, the clear point nearest it, on whichever side.
    const tip = (below: { left: number; right: number }[]): number => {
      const placed = saveHintPlacement({
        barWidth: 1200,
        buttonLeft: 400,
        buttonWidth: 400,
        column: null,
        below
      });
      return placed.left + (placed.arrow ?? NaN);
    };
    expect(tip([{ left: 430, right: 470 }])).toBe(600);
    expect(tip([{ left: 540, right: 620 }])).toBe(620 + SAVE_HINT_ARROW_CLEAR);
    expect(tip([{ left: 580, right: 660 }])).toBe(580 - SAVE_HINT_ARROW_CLEAR);
  });

  it('uses the toolbar width where there is no side panel, as on the Setup screen', () => {
    const left = saveHintPlacement({
      barWidth: 1424,
      buttonLeft: 600,
      buttonWidth: 170,
      column: null,
      below: []
    });
    expect(left.width).toBe(SAVE_HINT_WIDTH);
    expect(left.arrow).toBe(SAVE_HINT_ARROW_INSET);
    expect(left.left + (left.arrow ?? NaN)).toBe(685);
    const narrow = saveHintPlacement({
      barWidth: 280,
      buttonLeft: 10,
      buttonWidth: 170,
      column: null,
      below: []
    });
    expect(narrow.width).toBe(280 - 2 * SAVE_HINT_MARGIN);
    expect(narrow.left).toBe(SAVE_HINT_MARGIN);
    expect(narrow.left + (narrow.arrow ?? NaN)).toBe(95);
  });

  it('stays in its column, and points only at a part of the button with nothing under it, whenever there is one', () => {
    const span = (max: number) =>
      fc
        .tuple(fc.integer({ min: 0, max }), fc.integer({ min: 20, max: 200 }))
        .map(([left, width]) => ({ left, right: Math.min(max + 20, left + width) }));
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 2600 }),
        fc.option(fc.integer({ min: 40, max: 400 })),
        fc.integer({ min: 60, max: 260 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(span(2600), { maxLength: 4 }),
        (barWidth, columnWidth, buttonWidth, at, below) => {
          fc.pre(buttonWidth <= barWidth && (columnWidth ?? 0) <= barWidth);
          const buttonLeft = Math.round(at * (barWidth - buttonWidth));
          const column = columnWidth === null ? null : { left: barWidth - columnWidth, right: barWidth };
          const placed = saveHintPlacement({ barWidth, buttonLeft, buttonWidth, column, below });
          const area = column ?? { left: 0, right: barWidth };
          // Inside its column, with the margin at both ends, and 300 px when there is room.
          expect(placed.width).toBe(Math.min(SAVE_HINT_WIDTH, area.right - area.left - 2 * SAVE_HINT_MARGIN));
          expect(placed.left).toBeGreaterThanOrEqual(area.left + SAVE_HINT_MARGIN);
          expect(placed.left + placed.width).toBeLessThanOrEqual(area.right - SAVE_HINT_MARGIN);

          const lo = Math.max(
            buttonLeft + SAVE_HINT_ARROW_CLEAR,
            area.left + SAVE_HINT_MARGIN + SAVE_HINT_ARROW_INSET
          );
          const hi = Math.min(
            buttonLeft + buttonWidth - SAVE_HINT_ARROW_CLEAR,
            area.right - SAVE_HINT_MARGIN - SAVE_HINT_ARROW_INSET
          );
          const clear = (x: number): boolean =>
            below.every((b) => x <= b.left - SAVE_HINT_ARROW_CLEAR || x >= b.right + SAVE_HINT_ARROW_CLEAR);
          if (placed.arrow === null) {
            // Only when no point of the button in reach is clear of everything under it.
            for (let x = Math.ceil(lo); x <= hi; x += 1) expect(clear(x)).toBe(false);
            return;
          }
          // The arrow clear of the rounded corners, on the button, clear of its ends and of everything under it.
          expect(placed.arrow).toBeGreaterThanOrEqual(SAVE_HINT_ARROW_INSET);
          expect(placed.arrow).toBeLessThanOrEqual(placed.width - SAVE_HINT_ARROW_INSET);
          const tip = placed.left + placed.arrow;
          expect(tip).toBeGreaterThanOrEqual(lo);
          expect(tip).toBeLessThanOrEqual(hi);
          expect(clear(tip)).toBe(true);
          // And on the middle of the button whenever the middle is allowed.
          const centre = buttonLeft + buttonWidth / 2;
          if (centre >= lo && centre <= hi && clear(centre)) expect(tip).toBe(centre);
        }
      ),
      {
        numRuns: 1000,
        // Points exactly the clearance away from an item, which earlier runs found refused.
        examples: [
          [300, null, 60, 0, [{ left: 36, right: 56 }]],
          [300, null, 232, 0, [{ left: 10, right: 208 }]],
          [300, null, 178, 0, [{ left: 9, right: 154 }]],
          [2555, null, 60, 0.9997995991983968, [{ left: 2519, right: 2539 }]]
        ]
      }
    );
  });
});
