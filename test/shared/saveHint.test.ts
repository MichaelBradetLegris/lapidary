import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  NOTHING_UNTIL_SAVE,
  SAVE_HINT_ARROW_INSET,
  SAVE_HINT_GOT_IT,
  SAVE_HINT_ID,
  SAVE_HINT_MARGIN,
  SAVE_HINT_OBSIDIAN_NOTE,
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
    saving: false
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

  it('shows exactly when every condition holds', () => {
    fc.assert(
      fc.property(
        fc.record({
          dismissedHints: fc.option(fc.subarray([SAVE_HINT_ID, PRO_PRESELECT_HINT, 'other'])),
          dismissedThisSession: fc.boolean(),
          hasChapter: fc.boolean(),
          unsavedDecisions: fc.nat(30),
          locked: fc.boolean(),
          saving: fc.boolean()
        }),
        (input) => {
          const expected =
            input.dismissedHints !== null &&
            !input.dismissedHints.includes(SAVE_HINT_ID) &&
            !input.dismissedThisSession &&
            input.hasChapter &&
            input.unsavedDecisions > 0 &&
            !input.locked &&
            !input.saving;
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
  it('lines up with the toolbar right edge, the arrow on the Save button middle', () => {
    // 1424 CSS px, the default window at 100%: Save to chapter from 1068 to 1238.
    const placed = saveHintPlacement({ barWidth: 1424, buttonLeft: 1068, buttonWidth: 170, hintWidth: 300 });
    expect(placed.left).toBe(1424 - SAVE_HINT_MARGIN - 300);
    expect(placed.left + placed.arrow).toBe(1068 + 85);
  });

  it('moves left when Save to chapter is further left than the arrow reaches', () => {
    const placed = saveHintPlacement({ barWidth: 1424, buttonLeft: 600, buttonWidth: 170, hintWidth: 300 });
    expect(placed.arrow).toBe(SAVE_HINT_ARROW_INSET);
    expect(placed.left + placed.arrow).toBe(685);
  });

  it('never runs out of a toolbar narrower than itself', () => {
    const placed = saveHintPlacement({ barWidth: 280, buttonLeft: 10, buttonWidth: 170, hintWidth: 264 });
    expect(placed.left).toBe(SAVE_HINT_MARGIN);
    expect(placed.left + placed.arrow).toBe(95);
  });

  it('keeps the hint inside the toolbar and the arrow on the button whenever the button lets it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 2600 }),
        fc.integer({ min: 120, max: 340 }),
        fc.integer({ min: 60, max: 260 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (barWidth, hintWidth, buttonWidth, at) => {
          fc.pre(hintWidth + 2 * SAVE_HINT_MARGIN <= barWidth && buttonWidth <= barWidth);
          const buttonLeft = Math.round(at * (barWidth - buttonWidth));
          const placed = saveHintPlacement({ barWidth, buttonLeft, buttonWidth, hintWidth });
          // Inside the toolbar, with the margin at both ends.
          expect(placed.left).toBeGreaterThanOrEqual(SAVE_HINT_MARGIN);
          expect(placed.left + hintWidth).toBeLessThanOrEqual(barWidth - SAVE_HINT_MARGIN + 1e-9);
          // The arrow clear of the rounded corners.
          expect(placed.arrow).toBeGreaterThanOrEqual(SAVE_HINT_ARROW_INSET);
          expect(placed.arrow).toBeLessThanOrEqual(hintWidth - SAVE_HINT_ARROW_INSET);
          // And on the button, which the toolbar keeps to its right in practice.
          const tip = placed.left + placed.arrow;
          const centre = buttonLeft + buttonWidth / 2;
          if (centre >= SAVE_HINT_MARGIN + SAVE_HINT_ARROW_INSET) {
            expect(tip).toBeGreaterThanOrEqual(buttonLeft);
          }
          if (centre <= barWidth - SAVE_HINT_MARGIN - SAVE_HINT_ARROW_INSET) {
            expect(tip).toBeLessThanOrEqual(buttonLeft + buttonWidth);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
