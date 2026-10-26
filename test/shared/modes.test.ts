import { describe, expect, it } from 'vitest';
import { confirmButtons, focusedChoice } from '../../src/shared/ui/confirm';
import {
  FINISH_FULL_EDIT_FIRST,
  FINISH_FULL_EDIT_TITLE,
  FRONTMATTER_LABEL,
  FULL_EDIT_CHANGED,
  FULL_EDIT_DONE_FIRST,
  FULL_EDIT_FREEZES,
  FULL_EDIT_HINT,
  FULL_EDIT_HINT_UNCHANGED,
  FULL_EDIT_HOLDS_PARAGRAPHS,
  FULL_EDIT_NOT_EXACT,
  FULL_EDIT_OPEN,
  FULL_EDIT_WAIT_FOR_REVIEW,
  FULL_EDIT_WAIT_FOR_SAVE,
  MODES,
  MODE_LABEL,
  MODE_TITLE,
  PREVIEW_EMPTY,
  applyFullEditBeforeSavePrompt,
  boxesBeforeFullEditPrompt,
  boxesBeforePreviewPrompt,
  discardFullEditPrompt,
  editSummary,
  fullEditAppliedText,
  fullEditEndKey,
  fullEditLabel,
  fullEditOtherReviewPrompt,
  fullEditPageEnd,
  fullEditTopPlace,
  leaveFullEditPrompt,
  modeOf,
  modePlace,
  previewImageText,
  previewLabel,
  type ModePlaces
} from '../../src/shared/ui/modes';
import { NOTHING_UNTIL_SAVE } from '../../src/shared/ui/saveHint';

/* rr.2: the Mode select's words, Full edit's and Preview's, and the questions
   a switch asks when something typed would be left behind. */

const lines = (body: string): string[] => body.split('\n');

describe('the Mode select', () => {
  it('offers Main, Full edit and Preview in that order, under the name Mode', () => {
    expect(MODES).toEqual([
      { value: 'main', label: 'Main' },
      { value: 'edit', label: 'Full edit' },
      { value: 'preview', label: 'Preview' }
    ]);
    expect(MODE_LABEL).toBe('Mode');
    expect(MODE_TITLE).toBe(
      'Main reviews the suggestions. Full edit edits the whole chapter in one box. Preview shows the chapter as Royal Road will.'
    );
  });

  it('reads back only the values it offers', () => {
    expect(modeOf('main')).toBe('main');
    expect(modeOf('edit')).toBe('edit');
    expect(modeOf('preview')).toBe('preview');
    expect(modeOf('Full edit')).toBeNull();
    expect(modeOf('')).toBeNull();
  });
});

describe("each mode's place in the chapter", () => {
  const ONE = 'C:/vault/Chapter 01.md';
  const TWO = 'C:/vault/Chapter 02.md';

  it('puts a mode back where it was left, and starts one not shown yet at its top', () => {
    let places: ModePlaces = { chapter: ONE, mode: 'main', tops: {} };
    places.tops.main = 2400;
    let next = modePlace(places, ONE, 'preview');
    expect(next.top).toBe(0);
    places = next.places;
    places.tops.preview = 900;
    next = modePlace(places, ONE, 'main');
    expect(next.top).toBe(2400);
    next = modePlace(next.places, ONE, 'preview');
    expect(next.top).toBe(900);
    expect(modePlace(next.places, ONE, 'edit').top).toBe(0);
  });

  it('leaves the scroller where it is when the mode did not change, in this chapter or another', () => {
    const places: ModePlaces = { chapter: ONE, mode: 'main', tops: { main: 2400, preview: 900 } };
    expect(modePlace(places, ONE, 'main')).toEqual({ places, top: null });
    expect(modePlace(places, TWO, 'main')).toEqual({
      places: { chapter: TWO, mode: 'main', tops: {} },
      top: null
    });
  });

  /* rr.2 review: Full edit's box opens afresh each time, its caret and its
     own scroll at the top, so the column under it starts at the top too. */
  it('starts Full edit at its top every time, whatever offset it was left at', () => {
    const places: ModePlaces = { chapter: ONE, mode: 'main', tops: { main: 2400, edit: 700 } };
    expect(modePlace(places, ONE, 'edit').top).toBe(0);
    expect(modePlace({ ...places, mode: 'preview' }, ONE, 'edit').top).toBe(0);
  });

  it('forgets every place in another chapter, so a mode opens there at its top', () => {
    const places: ModePlaces = { chapter: ONE, mode: 'preview', tops: { main: 2400, preview: 900 } };
    expect(modePlace(places, TWO, 'main')).toEqual({
      places: { chapter: TWO, mode: 'main', tops: {} },
      top: 0
    });
  });

  /* rr.5: the mode stays across chapters, so Preview and Full edit, which
     used to start another chapter from Main, start it at their top; Main,
     which always left the scroller to itself there, still does. */
  it('starts Preview and Full edit at the top of another chapter in the same mode', () => {
    const preview: ModePlaces = { chapter: ONE, mode: 'preview', tops: { main: 2400, preview: 900 } };
    expect(modePlace(preview, TWO, 'preview')).toEqual({
      places: { chapter: TWO, mode: 'preview', tops: {} },
      top: 0
    });
    expect(modePlace({ ...preview, mode: 'edit' }, TWO, 'edit').top).toBe(0);
    expect(modePlace({ ...preview, mode: 'main' }, TWO, 'main').top).toBeNull();
    // Back in the same chapter, the same mode stays where it is.
    expect(modePlace(preview, ONE, 'preview').top).toBeNull();
    expect(modePlace({ ...preview, mode: 'edit' }, ONE, 'edit').top).toBeNull();
  });
});

describe("Full edit's words", () => {
  it('names the box by its chapter and keeps the paragraph box s hints', () => {
    expect(fullEditLabel('Chapter 01 - The Flood')).toBe('Full edit of Chapter 01 - The Flood');
    expect(FULL_EDIT_HINT).toBe('Ctrl+Enter applies, Esc cancels');
    expect(FULL_EDIT_HINT_UNCHANGED).toBe('Nothing changed yet. Esc closes.');
    expect(FRONTMATTER_LABEL).toBe('Frontmatter, which Full edit leaves as it is');
  });

  it('says what stands in the way, as the paragraph box s cards do', () => {
    expect(FULL_EDIT_DONE_FIRST).toBe(
      'Full edit is still open. Press Done or Ctrl+Enter to apply it, then save.'
    );
    expect(FINISH_FULL_EDIT_FIRST).toBe('Finish or cancel Full edit first.');
    expect(FINISH_FULL_EDIT_TITLE).toBe('Finish or cancel Full edit first');
    expect(FULL_EDIT_FREEZES).toBe('Full edit is open. Finish it, or cancel it, to change this suggestion.');
    expect(FULL_EDIT_OPEN).toBe('Full edit is open');
    expect(FULL_EDIT_HOLDS_PARAGRAPHS).toBe(
      'Full edit is open, and holds every paragraph. Edit the words there, or finish Full edit first.'
    );
    expect(FULL_EDIT_WAIT_FOR_REVIEW).toBe('Wait for the review to finish, then open Full edit.');
    expect(FULL_EDIT_WAIT_FOR_SAVE).toBe('Wait for the save to finish, then open Full edit.');
    expect(FULL_EDIT_CHANGED).toBe(
      'The chapter changed on disk while Full edit was open, so nothing was applied. Your text is still in the box: copy it, press Cancel, then open Full edit again.'
    );
    expect(FULL_EDIT_NOT_EXACT).toBe(
      'Full edit could not be applied exactly as typed, so nothing was changed. Your text is still in the box: copy it somewhere safe, then press Cancel.'
    );
  });

  it('counts what Done did in the paragraph box s words', () => {
    expect(editSummary({ added: 3, accepted: 0, superseded: 0 })).toBe('3 changes added, already accepted');
    expect(editSummary({ added: 1, accepted: 1, superseded: 2 })).toBe(
      '1 change added, already accepted; 1 suggestion accepted, since you typed exactly that; 2 suggestions your edit replaced moved to Unanchored'
    );
    expect(editSummary({ added: 0, accepted: 0, superseded: 0 })).toBe('suggestions updated');
    expect(fullEditAppliedText({ added: 4, accepted: 0, superseded: 1 })).toBe(
      'Full edit: 4 changes added, already accepted; 1 suggestion your edit replaced moved to Unanchored.'
    );
  });

  it('asks before Escape or Cancel throws typed text away, Keep editing focused', () => {
    const spec = discardFullEditPrompt();
    expect(spec.title).toBe('Discard your changes in Full edit?');
    expect(spec.body).toBe('What you typed in Full edit will be lost.');
    expect(confirmButtons(spec).map((b) => b.label)).toEqual(['Keep editing', 'Discard']);
    expect(focusedChoice(spec)).toBe('cancel');
  });

  it('asks before Save to chapter writes, as for paragraph boxes', () => {
    const spec = applyFullEditBeforeSavePrompt();
    expect(spec).toEqual({
      title: 'Apply Full edit first?',
      body: 'Full edit is still open. Apply its changes as accepted suggestions, then save the chapter?',
      confirmLabel: 'Apply and save'
    });
    expect(focusedChoice(spec)).toBe('confirm');
  });
});

/* rr.7 review: the text area grows and the column scrolls, so the browser's
   own scroll stopped short of the page's top and end; these decide when the
   column goes the rest of the way (`showPageEnd` in FullEdit.tsx). */
describe("Full edit's page ends", () => {
  const key = (k: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
    key: k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...mods
  });

  it('follows Ctrl+Home and Ctrl+End (Cmd on a Mac), and Page Up and Page Down, never with Alt', () => {
    for (const k of ['Home', 'End']) {
      expect(fullEditEndKey(key(k, { ctrlKey: true })), k).toBe(true);
      expect(fullEditEndKey(key(k, { metaKey: true })), k).toBe(true);
      // Home and End alone move within the line, which the browser keeps in view.
      expect(fullEditEndKey(key(k)), k).toBe(false);
      expect(fullEditEndKey(key(k, { ctrlKey: true, altKey: true })), k).toBe(false);
    }
    for (const k of ['PageUp', 'PageDown']) {
      expect(fullEditEndKey(key(k)), k).toBe(true);
      expect(fullEditEndKey(key(k, { altKey: true })), k).toBe(false);
    }
    for (const k of ['ArrowUp', 'ArrowDown', 'a', 'Enter']) {
      expect(fullEditEndKey(key(k, { ctrlKey: true })), k).toBe(false);
    }
  });

  it('shows the top with the caret at the start of the text, the end at its end, and neither between', () => {
    expect(fullEditPageEnd(0, 1363)).toBe('top');
    expect(fullEditPageEnd(1363, 1363)).toBe('end');
    expect(fullEditPageEnd(1, 1363)).toBeNull();
    expect(fullEditPageEnd(1362, 1363)).toBeNull();
    // An empty text area is at its start.
    expect(fullEditPageEnd(0, 0)).toBe('top');
  });

  it('goes to the column s top unless the first line would leave a short column', () => {
    // At 1424 by 900 Chapter 01's first line, under its frontmatter, ends 178.2 px down a column of 779.
    expect(fullEditTopPlace(178.2, 779, 16)).toBe(0);
    expect(fullEditTopPlace(763, 779, 16)).toBe(0);
    expect(fullEditTopPlace(763.5, 779, 16)).toBe(1);
    // In the smallest window at 200% the column is 87 px: the line ends 16 px above its foot.
    expect(fullEditTopPlace(178.2, 87, 16)).toBe(108);
  });
});

describe('the questions a switch asks (as leaving the chapter does)', () => {
  it('leaving a changed Full edit: Apply first, focused, Discard or Cancel', () => {
    const spec = leaveFullEditPrompt('preview');
    expect(spec.title).toBe('Leave Full edit for Preview?');
    expect(lines(spec.body)).toEqual([
      'What you typed in Full edit is not applied yet.',
      `Apply first makes it changes of your own, already accepted, as Done does. ${NOTHING_UNTIL_SAVE}`
    ]);
    expect(confirmButtons(spec).map((b) => [b.label, b.primary])).toEqual([
      ['Cancel', false],
      ['Discard', false],
      ['Apply first', true]
    ]);
    expect(focusedChoice(spec)).toBe('confirm');
    expect(leaveFullEditPrompt('main').title).toBe('Leave Full edit for Main?');
  });

  /* rr.5: another review from History or the selector keeps Full edit, afresh
     on that review, so what was typed is settled first, as a switch out of
     Full edit settles it, and the body says where applied changes stay. */
  it('another review in Full edit with typed text: Apply first, focused, Discard or Cancel', () => {
    const spec = fullEditOtherReviewPrompt();
    expect(spec.title).toBe('Open another review in Full edit?');
    expect(lines(spec.body)).toEqual([
      'What you typed in Full edit is not applied yet. Full edit opens afresh on the other review.',
      `Apply first makes it changes of your own in this review, already accepted, as Done does, and they stay in this review. ${NOTHING_UNTIL_SAVE}`
    ]);
    expect(confirmButtons(spec).map((b) => [b.label, b.primary])).toEqual([
      ['Cancel', false],
      ['Discard', false],
      ['Apply first', true]
    ]);
    expect(focusedChoice(spec)).toBe('confirm');
  });

  it('opening Full edit over changed paragraph boxes: Apply first, focused, or Cancel', () => {
    const one = boxesBeforeFullEditPrompt(1);
    expect(one.title).toBe('Apply the paragraph you are editing first?');
    expect(lines(one.body)).toEqual([
      'Full edit holds the whole chapter, so the paragraph you are editing is applied first, as Done does.',
      NOTHING_UNTIL_SAVE
    ]);
    expect(confirmButtons(one).map((b) => b.label)).toEqual(['Cancel', 'Apply first']);
    expect(focusedChoice(one)).toBe('confirm');
    const three = boxesBeforeFullEditPrompt(3);
    expect(three.title).toBe('Apply the 3 paragraphs you are editing first?');
    expect(lines(three.body)[0]).toBe(
      'Full edit holds the whole chapter, so the 3 paragraphs you are editing are applied first, as Done does.'
    );
  });

  it('leaving Main for Preview with changed boxes: Keep for later, focused, Apply first or Cancel', () => {
    const one = boxesBeforePreviewPrompt(1);
    expect(one.title).toBe('Leave Main for Preview?');
    expect(lines(one.body)).toEqual([
      'The paragraph you are editing is not applied yet.',
      `Keep for later leaves it open in Main as you left it, and Preview shows the chapter without it. Apply first applies it, as Done does. ${NOTHING_UNTIL_SAVE}`
    ]);
    expect(confirmButtons(one).map((b) => b.label)).toEqual(['Cancel', 'Keep for later', 'Apply first']);
    expect(focusedChoice(one)).toBe('alt');
    expect(lines(boxesBeforePreviewPrompt(2).body)[0]).toBe(
      'The 2 paragraphs you are editing are not applied yet.'
    );
    expect(lines(boxesBeforePreviewPrompt(2).body)[1]).toMatch(
      /^Keep for later leaves them open in Main as you left them/
    );
  });

  it('never says "accepted changes"', () => {
    for (const spec of [
      leaveFullEditPrompt('main'),
      boxesBeforeFullEditPrompt(2),
      boxesBeforePreviewPrompt(1),
      discardFullEditPrompt(),
      applyFullEditBeforeSavePrompt()
    ]) {
      expect(`${spec.title} ${spec.body}`).not.toMatch(/accepted changes?/i);
    }
  });
});

describe("Preview's words", () => {
  it('names the page and an image it does not fetch', () => {
    expect(previewLabel('Chapter 04')).toBe('Preview of Chapter 04, as Royal Road will show it');
    expect(previewImageText('the mill at dawn')).toBe('Image: the mill at dawn');
    expect(previewImageText('  ')).toBe('Image');
    expect(PREVIEW_EMPTY).toBe('Nothing to preview yet: the chapter has no words.');
  });
});
