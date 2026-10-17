import { describe, expect, it } from 'vitest';
import { decisionCounts } from '../../src/shared/diff/compose';
import type { ReviewSummary } from '../../src/shared/ipc';
import { createDiffReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import { chapterListMarks } from '../../src/shared/ui/chapterList';
import { historyCounts, historyWhen } from '../../src/shared/ui/history';

/* apply.5: the numbers History and the Review with AI dialog's "Last reviewed"
   line give a review, live for the review on screen. */

const CHAPTER = 'D:\\Writing\\Novel\\Chapter 3.md';
const ON_SCREEN = 'D:\\Reviews\\chapter-3\\2026-10-17T09-00-00-000Z.review.json';
const OLDER = 'D:\\Reviews\\chapter-3\\2026-10-16T08-30-00-000Z.review.json';

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

/** History's entry for a review, as main last read it. */
function entry(
  path: string,
  hunkCount: number,
  pendingCount: number
): Pick<ReviewSummary, 'path' | 'hunkCount' | 'pendingCount'> {
  return { path, hunkCount, pendingCount };
}

describe('historyCounts (apply.5)', () => {
  it('starts from three pending suggestions', () => {
    expect(review().hunks.map((h) => h.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('counts a review that is not on screen as it was last written', () => {
    expect(historyCounts(entry(OLDER, 5, 4), ON_SCREEN, decided({ 0: 'accepted' }))).toEqual({
      onScreen: false,
      hunkCount: 5,
      pendingCount: 4
    });
    expect(historyCounts(entry(OLDER, 5, 0), ON_SCREEN, review())).toEqual({
      onScreen: false,
      hunkCount: 5,
      pendingCount: 0
    });
  });

  it('counts nothing from the page while the review on screen has never been written', () => {
    // A new review is written at once; until then no History row is it.
    expect(historyCounts(entry(OLDER, 5, 4), null, review())).toEqual({
      onScreen: false,
      hunkCount: 5,
      pendingCount: 4
    });
  });

  it('counts the review on screen from the page, whatever History last read', () => {
    // History was read when all three were pending; one is accepted since.
    expect(historyCounts(entry(ON_SCREEN, 3, 3), ON_SCREEN, decided({ 0: 'accepted' }))).toEqual({
      onScreen: true,
      hunkCount: 3,
      pendingCount: 2
    });
    // And the other way: History counted decisions the page has since turned back.
    expect(historyCounts(entry(ON_SCREEN, 3, 0), ON_SCREEN, review())).toEqual({
      onScreen: true,
      hunkCount: 3,
      pendingCount: 3
    });
    // Everything decided: no pending badge.
    expect(
      historyCounts(
        entry(ON_SCREEN, 3, 3),
        ON_SCREEN,
        decided({ 0: 'accepted', 1: 'dismissed', 2: 'accepted' })
      ).pendingCount
    ).toBe(0);
  });

  it("counts the author's own edits and a lost suggestion in the total, and the lost one not as pending", () => {
    const own: Hunk = { ...review().hunks[0]!, id: 'own', source: 'manual', status: 'accepted' };
    const lost: Review = {
      ...review(),
      hunks: [...review().hunks.map((h, i) => (i === 0 ? { ...h, anchor: 'stale' as const } : h)), own]
    };
    expect(historyCounts(entry(ON_SCREEN, 3, 3), ON_SCREEN, lost)).toEqual({
      onScreen: true,
      hunkCount: 4,
      pendingCount: 2
    });
  });

  it('gives the review on screen the number the chapter list and the status bar give it', () => {
    const states = [
      review(),
      decided({ 0: 'accepted' }),
      decided({ 1: 'dismissed', 2: 'accepted' }),
      decided({ 0: 'accepted', 1: 'accepted', 2: 'accepted' })
    ];
    for (const open of states) {
      const history = historyCounts(entry(ON_SCREEN, 9, 9), ON_SCREEN, open).pendingCount;
      const list = chapterListMarks({ unsavedCount: 9, pendingCount: 9 }, open).pending;
      expect(history).toBe(list);
      expect(history).toBe(decisionCounts(open.hunks).pending);
    }
  });
});

describe('historyWhen (apply.7)', () => {
  it("reads a stored time in the computer's own format, as History and the leave prompt show it", () => {
    const iso = '2026-10-14T16:04:33.000Z';
    expect(historyWhen(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('keeps text that is not a readable time as it is', () => {
    expect(historyWhen('not a time')).toBe('not a time');
    expect(historyWhen('')).toBe('');
  });
});
