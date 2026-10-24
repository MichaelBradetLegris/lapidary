import { describe, expect, it } from 'vitest';
import { decisionCounts } from '../../src/shared/diff/compose';
import type { ReviewSummary } from '../../src/shared/ipc';
import { createDiffReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import { chapterListMarks } from '../../src/shared/ui/chapterList';
import {
  historyCounts,
  historyWhen,
  NO_REVIEWS_YET,
  notNewestText,
  pickerHoldsKey,
  reviewChoiceLabel,
  reviewPicker
} from '../../src/shared/ui/history';
import { unsavedPhrase } from '../../src/shared/ui/save';

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

/* apply.26: the selector at the top of the side panel, with a mark when the
   review on screen is not the newest. */
describe('reviewPicker (apply.26)', () => {
  const NEWEST = 'D:\\Reviews\\chapter-3\\2026-10-17T12-00-00-000Z.review.json';
  const T_OLDER = '2026-10-16T08:30:00.000Z';
  const T_ON_SCREEN = '2026-10-17T09:00:00.000Z';
  const T_NEWEST = '2026-10-17T12:00:00.000Z';

  function summary(path: string, createdAt: string, patch: Partial<ReviewSummary> = {}): ReviewSummary {
    return {
      path,
      id: path,
      createdAt,
      updatedAt: createdAt,
      generatorKind: 'claude',
      provider: 'claude',
      model: 'claude-haiku-4-5',
      hunkCount: 3,
      pendingCount: 3,
      sourcePath: CHAPTER,
      unsavedCount: 0,
      ...patch
    };
  }

  /** History as main lists it: newest first. */
  const history = (): ReviewSummary[] => [
    summary(NEWEST, T_NEWEST, { pendingCount: 0 }),
    summary(ON_SCREEN, T_ON_SCREEN),
    summary(OLDER, T_OLDER, {
      generatorKind: 'manual',
      provider: undefined,
      model: undefined,
      pendingCount: 1
    })
  ];

  const onScreen = (): Review => ({ ...decided({ 0: 'accepted' }), createdAt: T_ON_SCREEN });

  it('labels each review as History shows it: date, provider or kind, model, and pending count', () => {
    const picker = reviewPicker(history(), ON_SCREEN, onScreen());
    expect(picker.choices.map((c) => c.label)).toEqual([
      `${historyWhen(T_NEWEST)} · Claude · claude-haiku-4-5`,
      // The review on screen is counted from the page, as its History row is;
      // its accepted suggestion is not in the chapter file yet.
      `${historyWhen(T_ON_SCREEN)} · Claude · claude-haiku-4-5 · 2 pending · 1 not saved to chapter`,
      `${historyWhen(T_OLDER)} · manual · 1 pending`
    ]);
    expect(picker.choices.map((c) => c.value)).toEqual([NEWEST, ON_SCREEN, OLDER]);
    expect(
      reviewChoiceLabel({
        createdAt: T_OLDER,
        generatorKind: 'openai',
        provider: 'openai',
        model: 'gpt-5-mini',
        pendingCount: 12,
        unsavedCount: 0
      })
    ).toBe(`${historyWhen(T_OLDER)} · OpenAI (API key) · gpt-5-mini · 12 pending`);
    // A review saved on an OpenAI API key before codex.6 is named so, never as ChatGPT's.
    expect(
      reviewChoiceLabel({
        createdAt: T_OLDER,
        generatorKind: 'chatgpt',
        provider: 'chatgpt',
        model: 'gpt-5.5',
        pendingCount: 0,
        unsavedCount: 0
      })
    ).toBe(`${historyWhen(T_OLDER)} · ChatGPT · gpt-5.5`);
    expect(
      reviewChoiceLabel({
        createdAt: T_OLDER,
        generatorKind: 'manual',
        pendingCount: 0,
        unsavedCount: 3
      })
    ).toBe(`${historyWhen(T_OLDER)} · manual · 3 not saved to chapter`);
  });

  /* apply.26 review: the chapter list's dot, Save and the leave and close
     questions go by the review on screen, so changes left in another review of
     the chapter are shown only on its entry here. */
  it('counts the changes not saved to the chapter, the review on screen from the page and the others as last written', () => {
    const written = [
      summary(NEWEST, T_NEWEST, { pendingCount: 0, unsavedCount: 0 }),
      // Last written with five; the page has one since.
      summary(ON_SCREEN, T_ON_SCREEN, { unsavedCount: 5 }),
      summary(OLDER, T_OLDER, {
        generatorKind: 'manual',
        provider: undefined,
        model: undefined,
        pendingCount: 1,
        unsavedCount: 2
      })
    ];
    expect(reviewPicker(written, ON_SCREEN, onScreen()).choices.map((c) => c.label)).toEqual([
      `${historyWhen(T_NEWEST)} · Claude · claude-haiku-4-5`,
      `${historyWhen(T_ON_SCREEN)} · Claude · claude-haiku-4-5 · 2 pending · ${unsavedPhrase(1)}`,
      `${historyWhen(T_OLDER)} · manual · 1 pending · ${unsavedPhrase(2)}`
    ]);
    // The decision turned back on the page: nothing unsaved, whatever was written.
    const back = { ...review(), createdAt: T_ON_SCREEN };
    expect(reviewPicker(written, ON_SCREEN, back).choices[1]!.label).toBe(
      `${historyWhen(T_ON_SCREEN)} · Claude · claude-haiku-4-5 · 3 pending`
    );
    // Another review on screen: this one is counted as last written.
    const newest = { ...review(), createdAt: T_NEWEST };
    expect(reviewPicker(written, NEWEST, newest).choices[1]!.label).toBe(
      `${historyWhen(T_ON_SCREEN)} · Claude · claude-haiku-4-5 · 3 pending · ${unsavedPhrase(5)}`
    );
    // A review on screen that History does not have yet is counted from the page too.
    const fresh: Review = {
      ...decided({ 1: 'accepted', 2: 'accepted' }),
      createdAt: '2026-10-17T18:00:00.000Z'
    };
    expect(reviewPicker(written, null, fresh).choices[0]!.label).toBe(
      `${historyWhen('2026-10-17T18:00:00.000Z')} · manual · 1 pending · ${unsavedPhrase(2)}`
    );
  });

  it('holds back the keys that would change the closed selector, and lets the ones that open it through', () => {
    const press = (key: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) =>
      pickerHoldsKey({ key, altKey: false, ctrlKey: false, metaKey: false, ...mods });
    // Each of these opens another review at once on Windows.
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End'
    ]) {
      expect(press(key)).toBe(true);
    }
    // Alt+Down, Alt+Up, F4 and Space open the list; Enter, Escape and Tab do their own work.
    expect(press('ArrowDown', { altKey: true })).toBe(false);
    expect(press('ArrowUp', { altKey: true })).toBe(false);
    for (const key of ['F4', ' ', 'Enter', 'Escape', 'Tab']) expect(press(key)).toBe(false);
    // Nothing else is touched: Ctrl and Cmd shortcuts, and the letter keys.
    expect(press('Home', { ctrlKey: true })).toBe(false);
    expect(press('ArrowDown', { metaKey: true })).toBe(false);
    for (const key of ['j', 'k', 'a', 'u', 'd', 'e', 'n', '1']) expect(press(key)).toBe(false);
  });

  it('selects the review on screen and marks it when another was made later', () => {
    const picker = reviewPicker(history(), ON_SCREEN, onScreen());
    expect(picker.selected).toBe(ON_SCREEN);
    expect(picker.notNewest).toBe(`Not the newest review. The newest is from ${historyWhen(T_NEWEST)}.`);
    expect(picker.notNewest).toBe(notNewestText(T_NEWEST));
  });

  it('has no mark on the newest review, whatever was decided where', () => {
    const newest = { ...review(), createdAt: T_NEWEST, decidedAt: T_NEWEST };
    expect(reviewPicker(history(), NEWEST, newest)).toMatchObject({ selected: NEWEST, notNewest: null });
    // Decided in after the newest was made, an older review is still not the newest.
    const revisited = { ...onScreen(), decidedAt: '2026-10-17T15:00:00.000Z' };
    expect(reviewPicker(history(), ON_SCREEN, revisited).notNewest).not.toBeNull();
  });

  it('goes by History order, newest first, even when History came in another order', () => {
    const shuffled = [history()[2]!, history()[0]!, history()[1]!];
    expect(reviewPicker(shuffled, ON_SCREEN, onScreen()).choices.map((c) => c.value)).toEqual([
      NEWEST,
      ON_SCREEN,
      OLDER
    ]);
  });

  it('lists the review on screen before History has it, as a new review just arrived', () => {
    const fresh: Review = {
      ...review(),
      createdAt: '2026-10-17T18:00:00.000Z',
      generator: { kind: 'openai', provider: 'openai', model: 'gpt-5-mini' }
    };
    const unwritten = reviewPicker(history(), null, fresh);
    expect(unwritten.selected).toBe('');
    expect(unwritten.choices[0]).toEqual({
      value: '',
      label: `${historyWhen('2026-10-17T18:00:00.000Z')} · OpenAI (API key) · gpt-5-mini · 3 pending`,
      createdAt: '2026-10-17T18:00:00.000Z'
    });
    expect(unwritten.notNewest).toBeNull();
    const written = 'D:\\Reviews\\chapter-3\\2026-10-17T18-00-00-000Z.review.json';
    expect(reviewPicker(history(), written, fresh)).toMatchObject({ selected: written, notNewest: null });
  });

  it("leaves out another chapter's History, still listed a moment after a chapter opens", () => {
    const elsewhere = history().map((e) => ({ ...e, sourcePath: 'D:\\Writing\\Novel\\Chapter 4.md' }));
    const picker = reviewPicker(elsewhere, ON_SCREEN, onScreen());
    expect(picker.choices.map((c) => c.value)).toEqual([ON_SCREEN]);
    expect(picker.notNewest).toBeNull();
    // The same chapter spelled in another case is the same chapter.
    const sameFile = history().map((e) => ({ ...e, sourcePath: CHAPTER.toLowerCase() }));
    expect(reviewPicker(sameFile, ON_SCREEN, onScreen()).choices).toHaveLength(3);
  });

  it('has no choices for a chapter with no review, only the empty page it opened on', () => {
    const blank: Review = { ...review(), hunks: [], generator: { kind: 'file' } };
    expect(reviewPicker([], null, blank)).toEqual({ choices: [], selected: '', notNewest: null });
    expect(NO_REVIEWS_YET).toBe('No reviews yet');
    // Once the author edits a paragraph there, it is a review of its own.
    const edited: Review = { ...review(), generator: { kind: 'file' } };
    expect(reviewPicker([], null, edited).choices).toHaveLength(1);
  });
});
