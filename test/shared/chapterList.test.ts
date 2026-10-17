import { describe, expect, it } from 'vitest';
import { commitDecisions } from '../../src/shared/diff/compose';
import { createDiffReview } from '../../src/shared/review';
import type { Hunk, Review, ReviewComment } from '../../src/shared/types';
import { chapterListMarks } from '../../src/shared/ui/chapterList';
import { saveButtonInput, saveButtonState, unsavedDotLabel } from '../../src/shared/ui/save';

/* apply.5: the dot and the badge beside a chapter in the chapter list. */

const CHAPTER = 'D:\\Writing\\Novel\\Chapter 3.md';

/** Three suggestions on one chapter, all pending. */
function review(): Review {
  return createDiffReview({
    sourcePath: CHAPTER,
    originalRaw: 'The river had began.\n\nShe nodded her head slowly.\n\nIts late.',
    correctedRaw: 'The river had begun.\n\nShe nodded slowly.\n\nIt is late.'
  });
}

/** `review` with the hunks at these positions given these decisions. */
function decided(statuses: Partial<Record<number, Hunk['status']>>, from: Review = review()): Review {
  return { ...from, hunks: from.hunks.map((h, i) => ({ ...h, status: statuses[i] ?? h.status })) };
}

const COMMENT: ReviewComment = {
  id: 'c1',
  paragraph: 0,
  category: 'style',
  text: 'A note.',
  status: 'open'
};

describe('chapterListMarks (apply.5)', () => {
  it('starts from three pending suggestions', () => {
    expect(review().hunks.map((h) => h.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('marks nothing on a chapter with no review that is not open', () => {
    expect(chapterListMarks(undefined, null)).toEqual({ unsaved: 0, dotLabel: '', pending: null });
  });

  it('marks a chapter that is not open from its current review as written', () => {
    expect(chapterListMarks({ unsavedCount: 3, pendingCount: 2 }, null)).toEqual({
      unsaved: 3,
      dotLabel: '3 changes are not saved to the chapter yet.',
      pending: 2
    });
    expect(chapterListMarks({ unsavedCount: 1, pendingCount: 0 }, null)).toEqual({
      unsaved: 1,
      dotLabel: '1 change is not saved to the chapter yet.',
      pending: 0
    });
    // Reviewed, nothing pending, everything saved: the tick and no dot.
    expect(chapterListMarks({ unsavedCount: 0, pendingCount: 0 }, null)).toEqual({
      unsaved: 0,
      dotLabel: '',
      pending: 0
    });
  });

  it('marks the open chapter from the review on screen, whatever the list last read', () => {
    // The list was read when all three were pending; one is accepted since.
    const stale = { unsavedCount: 0, pendingCount: 3 };
    expect(chapterListMarks(stale, decided({ 0: 'accepted' }))).toEqual({
      unsaved: 1,
      dotLabel: '1 change is not saved to the chapter yet.',
      pending: 2
    });
    // And the other way: the list counted changes that the page has since turned back.
    expect(chapterListMarks({ unsavedCount: 2, pendingCount: 1 }, review())).toEqual({
      unsaved: 0,
      dotLabel: '',
      pending: 3
    });
    expect(chapterListMarks(stale, decided({ 0: 'accepted', 1: 'dismissed', 2: 'accepted' }))).toEqual({
      unsaved: 2,
      dotLabel: '2 changes are not saved to the chapter yet.',
      pending: 0
    });
  });

  it('drops the dot once Save to chapter has written the changes, and counts a saved change turned back', () => {
    const accepted = decided({ 0: 'accepted', 2: 'accepted' });
    const written = commitDecisions(accepted.base.text, accepted.hunks);
    const saved: Review = {
      ...accepted,
      base: { ...accepted.base, text: written.text },
      hunks: written.hunks
    };
    expect(chapterListMarks(undefined, saved)).toMatchObject({ unsaved: 0, dotLabel: '', pending: 1 });

    const turnedBack = decided({ 0: 'pending' }, saved);
    expect(chapterListMarks(undefined, turnedBack)).toMatchObject({ unsaved: 1, pending: 2 });
  });

  it('does not count a suggestion that lost its place as pending', () => {
    const lost: Review = {
      ...review(),
      hunks: review().hunks.map((h, i) => (i === 0 ? { ...h, anchor: 'stale' as const } : h))
    };
    expect(chapterListMarks(undefined, lost).pending).toBe(2);
  });

  it('gives an open chapter a badge only once it has a review', () => {
    const empty: Review = { ...review(), hunks: [] };
    // Opened for the first time: nothing to mark, as before it opened.
    expect(chapterListMarks(undefined, empty)).toEqual({ unsaved: 0, dotLabel: '', pending: null });
    // A review with nothing pending, written earlier, keeps its tick while open.
    expect(chapterListMarks({ unsavedCount: 0, pendingCount: 0 }, empty).pending).toBe(0);
    // A review of comments only is a review.
    expect(chapterListMarks(undefined, { ...empty, comments: [COMMENT] }).pending).toBe(0);
    expect(chapterListMarks(undefined, review()).pending).toBe(3);
  });

  it("shows the open chapter's dot exactly when the toolbar does, with the same words", () => {
    const states = [
      review(),
      decided({ 0: 'accepted' }),
      decided({ 0: 'accepted', 1: 'accepted', 2: 'accepted' }),
      decided({ 1: 'dismissed' })
    ];
    for (const open of states) {
      const marks = chapterListMarks({ unsavedCount: 9, pendingCount: 9 }, open);
      const toolbar = saveButtonState(
        saveButtonInput({ review: open, changedParagraphs: 0, saving: false, locked: false })
      );
      expect(marks.unsaved > 0).toBe(toolbar.dot);
      expect(marks.dotLabel).toBe(unsavedDotLabel(marks.unsaved));
    }
  });
});
