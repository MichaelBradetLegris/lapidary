import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import type { CloseGuardState } from '../../src/shared/ipc';
import { createDiffReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import {
  CHAPTER_MATCHES_PAGE,
  changeCount,
  closePrompt,
  currentReviewId,
  isOpenTarget,
  KEPT_TOOLTIP,
  keptPhrase,
  leavePrompt,
  needsAttention,
  PRESS_DONE_FIRST,
  PRESS_EDITOR_SAVE_FIRST,
  saveButtonInput,
  saveButtonState,
  saveShortcutAction,
  unresponsiveDetail,
  unsavedDotLabel,
  unsavedPhrase,
  type LeaveState,
  type SaveButtonInput,
  type SaveShortcutContext,
  type ShortcutKey,
  type ToolbarSaveContext
} from '../../src/shared/ui/save';

/* apply.2: the words and rules of Save to chapter, Ctrl+S, leaving and closing (PLAN 11.3 i). */

const CHAPTER = 'D:\\Writing\\Novel\\Chapter 3.md';
const OTHER = 'D:\\Writing\\Novel\\Chapter 4.md';

const KEPT =
  'Your decisions are kept in this review. The chapter file changes only when you press Save to chapter.';

/* Boxes belong to the chapter (C.53), so they come back with it, whichever review is on screen then (apply.7). */
const BOX_KEPT =
  'The paragraph you are editing is kept as you left it and opens for editing again when you come back to this chapter.';

function guard(patch: Partial<CloseGuardState> = {}): CloseGuardState {
  return {
    chapter: CHAPTER,
    unsavedDecisions: 0,
    changedParagraphs: 0,
    locked: false,
    reviewRunning: false,
    writesPending: false,
    dialogText: false,
    ...patch
  };
}

function button(patch: Partial<SaveButtonInput> = {}): SaveButtonInput {
  return {
    hasChapter: true,
    unsavedDecisions: 0,
    changedParagraphs: 0,
    saving: false,
    locked: false,
    ...patch
  };
}

function leaving(patch: Partial<LeaveState> = {}): LeaveState {
  return {
    chapter: CHAPTER,
    unsavedDecisions: 0,
    changedParagraphs: 0,
    locked: false,
    reviewId: 'chapter-3--2026-10-14T16:04:33.000Z',
    ...patch
  };
}

describe('changeCount', () => {
  it('is singular for one and plural otherwise', () => {
    expect(changeCount(1)).toBe('1 change');
    expect(changeCount(3)).toBe('3 changes');
    expect(changeCount(0)).toBe('0 changes');
  });
});

describe('saveButtonState', () => {
  it('names the count, singular at one', () => {
    expect(saveButtonState(button({ unsavedDecisions: 1 }))).toEqual({
      label: 'Save 1 change to chapter',
      disabled: false,
      title: 'Write this change into the chapter file (Ctrl+S).',
      dot: true
    });
    expect(saveButtonState(button({ unsavedDecisions: 12 }))).toEqual({
      label: 'Save 12 changes to chapter',
      disabled: false,
      title: 'Write these 12 changes into the chapter file (Ctrl+S).',
      dot: true
    });
  });

  it('stays enabled with nothing to save, and says the chapter already matches', () => {
    expect(saveButtonState(button())).toEqual({
      label: 'Save to chapter',
      disabled: false,
      title: CHAPTER_MATCHES_PAGE,
      dot: false
    });
    expect(CHAPTER_MATCHES_PAGE).toBe('The chapter already matches the page.');
  });

  it('mentions open paragraph boxes, singular and plural, without a dot of their own', () => {
    expect(saveButtonState(button({ changedParagraphs: 1 }))).toEqual({
      label: 'Save to chapter',
      disabled: false,
      title:
        'Write your decisions into the chapter file (Ctrl+S). You are asked first about the paragraph you are editing.',
      dot: false
    });
    const two = saveButtonState(button({ changedParagraphs: 2, unsavedDecisions: 3 }));
    expect(two.label).toBe('Save 3 changes to chapter');
    expect(two.title).toBe(
      'Write your decisions into the chapter file (Ctrl+S). You are asked first about the 2 paragraphs you are editing.'
    );
    expect(two.dot).toBe(true);
  });

  it('is disabled while saving, while locked and with no chapter', () => {
    expect(saveButtonState(button({ saving: true, unsavedDecisions: 2 }))).toEqual({
      label: 'Saving…',
      disabled: true,
      title: 'Writing the chapter file.',
      dot: true
    });
    expect(saveButtonState(button({ locked: true, unsavedDecisions: 2 }))).toEqual({
      label: 'Save 2 changes to chapter',
      disabled: true,
      title: 'Wait for the review to finish, then save.',
      dot: true
    });
    expect(saveButtonState(button({ hasChapter: false, unsavedDecisions: 2 }))).toEqual({
      label: 'Save to chapter',
      disabled: true,
      title: 'Open a chapter to save to it.',
      dot: false
    });
  });
});

describe('saveButtonInput (apply.4)', () => {
  /** The review on screen with its first `accepted` hunks accepted: two hunks in all. */
  function onScreen(accepted: number): Pick<Review, 'sourcePath' | 'hunks'> {
    const review = createDiffReview({
      originalRaw: 'The river had began.\n\nShe nodded her head slowly.',
      correctedRaw: 'The river had begun.\n\nShe nodded slowly.'
    });
    return {
      sourcePath: CHAPTER,
      hunks: review.hunks.map((h, i) => (i < accepted ? { ...h, status: 'accepted' as const } : h))
    };
  }

  function toolbar(patch: Partial<ToolbarSaveContext> = {}): ToolbarSaveContext {
    return { review: onScreen(0), changedParagraphs: 0, saving: false, locked: false, ...patch };
  }

  it('fills every field from what the toolbar holds', () => {
    expect(onScreen(2).hunks).toHaveLength(2);
    expect(saveButtonInput(toolbar({ review: onScreen(2), changedParagraphs: 3 }))).toEqual({
      hasChapter: true,
      unsavedDecisions: 2,
      changedParagraphs: 3,
      saving: false,
      locked: false
    });
    expect(saveButtonInput(toolbar({ review: onScreen(1) })).unsavedDecisions).toBe(1);
  });

  it('passes a save under way and a running review through to the button', () => {
    expect(saveButtonInput(toolbar({ saving: true }))).toMatchObject({ saving: true, locked: false });
    expect(saveButtonInput(toolbar({ locked: true }))).toMatchObject({ saving: false, locked: true });

    const review = onScreen(2);
    expect(saveButtonState(saveButtonInput(toolbar({ review, saving: true })))).toEqual({
      label: 'Saving…',
      disabled: true,
      title: 'Writing the chapter file.',
      dot: true
    });
    expect(saveButtonState(saveButtonInput(toolbar({ review, locked: true })))).toEqual({
      label: 'Save 2 changes to chapter',
      disabled: true,
      title: 'Wait for the review to finish, then save.',
      dot: true
    });
    expect(saveButtonState(saveButtonInput(toolbar({ review }))).disabled).toBe(false);
  });

  it('has no chapter when no review is open, or for pasted text', () => {
    expect(saveButtonInput(toolbar({ review: null }))).toEqual({
      hasChapter: false,
      unsavedDecisions: 0,
      changedParagraphs: 0,
      saving: false,
      locked: false
    });
    expect(saveButtonInput(toolbar({ review: { ...onScreen(1), sourcePath: '' } }))).toMatchObject({
      hasChapter: false,
      unsavedDecisions: 1
    });
  });
});

describe('unsavedPhrase', () => {
  it('counts what the chapter file does not have yet, and is empty at zero', () => {
    expect(unsavedPhrase(1)).toBe('1 not saved to chapter');
    expect(unsavedPhrase(12)).toBe('12 not saved to chapter');
    expect(unsavedPhrase(0)).toBe('');
  });
});

describe('unsavedDotLabel (apply.4)', () => {
  it('says what the dot before the chapter name means, singular and plural, and nothing at zero', () => {
    expect(unsavedDotLabel(1)).toBe('1 change is not saved to the chapter yet.');
    expect(unsavedDotLabel(12)).toBe('12 changes are not saved to the chapter yet.');
    expect(unsavedDotLabel(0)).toBe('');
  });

  it('goes with the dot: a label exactly when saveButtonState puts the dot up', () => {
    for (const n of [0, 1, 12]) {
      expect(Boolean(unsavedDotLabel(n))).toBe(saveButtonState(button({ unsavedDecisions: n })).dot);
    }
  });
});

describe('keptPhrase and KEPT_TOOLTIP (apply.4)', () => {
  it('gives the local time on the 24-hour clock, hours and minutes, two digits each', () => {
    // Built from local fields, so the test reads the same in any time zone.
    expect(keptPhrase(new Date(2026, 9, 17, 9, 5, 59).toISOString())).toBe('Decisions kept 09:05');
    expect(keptPhrase(new Date(2026, 9, 17, 14, 2, 0).toISOString())).toBe('Decisions kept 14:02');
    expect(keptPhrase(new Date(2026, 9, 17, 0, 0, 0).toISOString())).toBe('Decisions kept 00:00');
    expect(keptPhrase(new Date(2026, 9, 17, 23, 59, 30).toISOString())).toBe('Decisions kept 23:59');
  });

  it('says only "Decisions kept" without a readable time', () => {
    expect(keptPhrase('not a time')).toBe('Decisions kept');
    expect(keptPhrase('')).toBe('Decisions kept');
  });

  it('never says "saved", which read as the chapter', () => {
    expect(keptPhrase(new Date().toISOString())).not.toMatch(/saved/i);
  });

  it('says where decisions are kept and what changes the chapter file', () => {
    expect(KEPT_TOOLTIP).toBe(
      'Your decisions are kept automatically in the review. The chapter file changes only when you press Save to chapter.'
    );
  });
});

describe('needsAttention', () => {
  it('is false before any state and when nothing is at risk', () => {
    expect(needsAttention(null)).toBe(false);
    expect(needsAttention(guard())).toBe(false);
    expect(needsAttention(guard({ chapter: null }))).toBe(false);
  });

  it.each<[string, Partial<CloseGuardState>]>([
    ['an unsaved decision', { unsavedDecisions: 1 }],
    ['a changed paragraph box', { changedParagraphs: 1 }],
    ['a review of the open chapter running', { locked: true }],
    ['a review of another chapter running', { reviewRunning: true }],
    ['a write still waiting', { writesPending: true }],
    ['typed dialog text', { dialogText: true, chapter: null }]
  ])('is true for %s', (_name, patch) => {
    expect(needsAttention(guard(patch))).toBe(true);
  });
});

describe('currentReviewId', () => {
  const older = { id: 'a', createdAt: '2026-10-01T09:00:00.000Z' };
  const newer = { id: 'b', createdAt: '2026-10-10T09:00:00.000Z' };

  it('is null with no reviews and the newest review otherwise', () => {
    expect(currentReviewId([])).toBeNull();
    expect(currentReviewId([older, newer])).toBe('b');
    expect(currentReviewId([newer, older])).toBe('b');
  });

  it('prefers the review last decided in over a newer one', () => {
    const revisited = { ...older, decidedAt: '2026-10-12T09:00:00.000Z' };
    expect(currentReviewId([revisited, newer])).toBe('a');
  });

  it('breaks a tie on the decision time by creation time', () => {
    const at = '2026-10-12T09:00:00.000Z';
    expect(
      currentReviewId([
        { ...older, decidedAt: at },
        { ...newer, decidedAt: at }
      ])
    ).toBe('b');
    expect(
      currentReviewId([
        { ...newer, decidedAt: at },
        { ...older, decidedAt: at }
      ])
    ).toBe('b');
  });

  it('takes the times of the review on screen over a stale History entry', () => {
    const live = { ...older, decidedAt: '2026-10-16T09:00:00.000Z' };
    expect(currentReviewId([older, newer], live)).toBe('a');
    expect(currentReviewId([older, newer], null)).toBe('b');
  });

  it('counts the review on screen when History does not list it yet', () => {
    const fresh = { id: 'c', createdAt: '2026-10-16T09:00:00.000Z' };
    expect(currentReviewId([older, newer], fresh)).toBe('c');
    expect(currentReviewId([], fresh)).toBe('c');
  });
});

describe('closePrompt', () => {
  it('asks nothing when nothing is at risk, or only writes are waiting', () => {
    expect(closePrompt(guard())).toBeNull();
    expect(closePrompt(guard({ writesPending: true }))).toBeNull();
  });

  it('offers Save, Keep for later and Cancel for one change, Keep for later focused', () => {
    expect(closePrompt(guard({ unsavedDecisions: 1 }))).toEqual({
      title: `Close ${APP_NAME}?`,
      body: ['1 change is not saved to the chapter yet.', KEPT].join('\n'),
      confirmLabel: 'Save 1 change and close',
      altLabel: 'Close, keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
  });

  it('counts in the plural', () => {
    const prompt = closePrompt(guard({ unsavedDecisions: 3 }));
    expect(prompt?.confirmLabel).toBe('Save 3 changes and close');
    expect(prompt?.body.split('\n')[0]).toBe('3 changes are not saved to the chapter yet.');
  });

  it('applies open paragraph boxes before saving, and says they come back with the chapter', () => {
    const one = closePrompt(guard({ changedParagraphs: 1 }));
    expect(one).toEqual({
      title: `Close ${APP_NAME}?`,
      body: BOX_KEPT,
      confirmLabel: 'Apply, save and close',
      altLabel: 'Close, keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
    const both = closePrompt(guard({ unsavedDecisions: 2, changedParagraphs: 3 }));
    expect(both?.confirmLabel).toBe('Apply, save and close');
    expect(both?.body.split('\n')).toEqual([
      '2 changes are not saved to the chapter yet.',
      KEPT,
      'The 3 paragraphs you are editing are kept as you left them and open for editing again when you come back to this chapter.'
    ]);
  });

  it('says a running review stops, and offers no Save while it runs on this chapter', () => {
    const locked = closePrompt(guard({ unsavedDecisions: 2, locked: true, reviewRunning: true }));
    expect(locked?.confirmLabel).toBe('');
    expect(locked?.altLabel).toBe('Close, keep for later');
    // Something is kept, so Keep for later stays focused although it also stops the review.
    expect(locked?.defaultButton).toBe('alt');
    expect(locked?.body.split('\n')).toEqual([
      '2 changes are not saved to the chapter yet.',
      KEPT,
      'The review that is running will stop, and its result will be lost.'
    ]);
    // A review of another chapter does not stop this one being saved.
    expect(closePrompt(guard({ unsavedDecisions: 2, reviewRunning: true }))?.confirmLabel).toBe(
      'Save 2 changes and close'
    );
  });

  it('says Close anyway, with Cancel focused, when only a review or typed text would be lost', () => {
    expect(closePrompt(guard({ reviewRunning: true }))).toEqual({
      title: `Close ${APP_NAME}?`,
      body: 'The review that is running will stop, and its result will be lost.',
      confirmLabel: '',
      altLabel: 'Close anyway',
      cancelLabel: 'Cancel',
      defaultButton: 'cancel'
    });
    const typed = closePrompt(guard({ chapter: null, dialogText: true }));
    expect(typed?.body).toBe('The text you typed in the open dialog will be lost.');
    expect(typed?.altLabel).toBe('Close anyway');
    expect(typed?.defaultButton).toBe('cancel');
  });

  it('lists every point in a fixed order', () => {
    const prompt = closePrompt(
      guard({ unsavedDecisions: 1, changedParagraphs: 1, reviewRunning: true, dialogText: true })
    );
    expect(prompt?.body.split('\n')).toEqual([
      '1 change is not saved to the chapter yet.',
      KEPT,
      BOX_KEPT,
      'The review that is running will stop, and its result will be lost.',
      'The text you typed in the open dialog will be lost.'
    ]);
    // With everything at once Keep for later is still the focused choice.
    expect(prompt?.confirmLabel).toBe('Apply, save and close');
    expect(prompt?.altLabel).toBe('Close, keep for later');
    expect(prompt?.defaultButton).toBe('alt');
  });

  it('says where to find decisions kept in an older review', () => {
    const prompt = closePrompt(guard({ unsavedDecisions: 1 }), { olderReviewFrom: '14/10/2026, 16:04:33' });
    expect(prompt?.body.split('\n')[1]).toBe(
      'Your decisions are kept in the review from 14/10/2026, 16:04:33. The chapter opens with another review, so reopen this one from History. The chapter file changes only when you press Save to chapter.'
    );
    expect(closePrompt(guard({ unsavedDecisions: 1 }), { olderReviewFrom: null })?.body).toContain(KEPT);
  });

  it('does not call the review the chapter opens with newer when History dates it earlier', () => {
    // R1 was created first but last decided in after R2, so the chapter opens
    // with R1, which History dates 01/10/2026; R2, from 10/10/2026, is on screen.
    const r1 = { id: 'r1', createdAt: '2026-10-01T09:00:00.000Z', decidedAt: '2026-10-12T09:00:00.000Z' };
    const r2 = { id: 'r2', createdAt: '2026-10-10T09:00:00.000Z', decidedAt: '2026-10-11T09:00:00.000Z' };
    expect(currentReviewId([r1, r2], r2)).toBe('r1');
    const prompt = closePrompt(guard({ unsavedDecisions: 2 }), { olderReviewFrom: '10/10/2026, 10:00:00' });
    expect(prompt?.body).toContain(
      'Your decisions are kept in the review from 10/10/2026, 10:00:00. The chapter opens with another review, so reopen this one from History.'
    );
    expect(prompt?.body).not.toMatch(/newer|older/i);
  });

  it('offers no Save without a chapter file', () => {
    expect(closePrompt(guard({ chapter: null, unsavedDecisions: 1 }))?.confirmLabel).toBe('');
  });
});

describe('leavePrompt', () => {
  const toOther = { kind: 'chapter', path: OTHER } as const;

  it('asks nothing when nothing is unsaved, while locked, or for what is already open', () => {
    expect(leavePrompt(leaving(), toOther)).toBeNull();
    expect(leavePrompt(leaving({ unsavedDecisions: 2, locked: true }), toOther)).toBeNull();
    expect(leavePrompt(leaving({ unsavedDecisions: 2 }), { kind: 'chapter', path: CHAPTER })).toBeNull();
    expect(
      leavePrompt(leaving({ unsavedDecisions: 2 }), {
        kind: 'chapter',
        path: 'D:/Writing/Novel/Chapter 3.md'
      })
    ).toBeNull();
    expect(
      leavePrompt(leaving({ unsavedDecisions: 2 }), {
        kind: 'review',
        id: 'chapter-3--2026-10-14T16:04:33.000Z',
        when: '14/10/2026, 16:04:33'
      })
    ).toBeNull();
  });

  it('asks again for a path that differs only in case, which costs a click and loses nothing', () => {
    expect(
      leavePrompt(leaving({ unsavedDecisions: 1 }), { kind: 'chapter', path: CHAPTER.toLowerCase() })
    ).not.toBeNull();
  });

  it('offers Save first, Keep for later and Cancel, Keep for later focused', () => {
    expect(leavePrompt(leaving({ unsavedDecisions: 1 }), toOther)).toEqual({
      title: 'Leave Chapter 3?',
      body: ['1 change is not saved to the chapter yet.', KEPT].join('\n'),
      confirmLabel: 'Save 1 change first',
      altLabel: 'Keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
    const three = leavePrompt(leaving({ unsavedDecisions: 3 }), toOther);
    expect(three?.confirmLabel).toBe('Save 3 changes first');
    expect(three?.body.split('\n')[0]).toBe('3 changes are not saved to the chapter yet.');
  });

  it('applies open paragraph boxes first, singular and plural', () => {
    expect(leavePrompt(leaving({ changedParagraphs: 1 }), toOther)).toEqual({
      title: 'Leave Chapter 3?',
      body: BOX_KEPT,
      confirmLabel: 'Apply and save first',
      altLabel: 'Keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
    expect(
      leavePrompt(leaving({ changedParagraphs: 2, unsavedDecisions: 1 }), toOther)?.body.split('\n')
    ).toEqual([
      '1 change is not saved to the chapter yet.',
      KEPT,
      'The 2 paragraphs you are editing are kept as you left them and open for editing again when you come back to this chapter.'
    ]);
  });

  it('names the History review being opened', () => {
    const prompt = leavePrompt(leaving({ unsavedDecisions: 2 }), {
      kind: 'review',
      id: 'chapter-3--2026-10-01T09:00:00.000Z',
      when: '01/10/2026, 10:00:00'
    });
    expect(prompt?.title).toBe('Open the review from 01/10/2026, 10:00:00?');
    expect(prompt?.confirmLabel).toBe('Save 2 changes first');
  });

  it('says open boxes go with the author to a History review where their paragraph reads the same', () => {
    // Boxes belong to the chapter (C.53): the review opened from History is
    // where they are put back at once, or set aside when they cannot be.
    const toReview = {
      kind: 'review',
      id: 'chapter-3--2026-10-01T09:00:00.000Z',
      when: '01/10/2026'
    } as const;
    const one = leavePrompt(leaving({ changedParagraphs: 1 }), toReview);
    expect(one?.body).toBe(
      'The paragraph you are editing is kept as you left it. It opens for editing again in the review you are opening if the paragraph reads the same there; if not, what you typed is set aside in a text file you can open.'
    );
    expect(one?.confirmLabel).toBe('Apply and save first');
    expect(
      leavePrompt(leaving({ changedParagraphs: 3, unsavedDecisions: 1 }), toReview)?.body.split('\n')
    ).toEqual([
      '1 change is not saved to the chapter yet.',
      KEPT,
      'The 3 paragraphs you are editing are kept as you left them. Each opens for editing again in the review you are opening if its paragraph reads the same there; if not, what you typed in it is set aside in a text file you can open.'
    ]);
  });

  it('says where to find decisions kept in an older review', () => {
    const prompt = leavePrompt(leaving({ unsavedDecisions: 1 }), toOther, {
      olderReviewFrom: '01/10/2026, 10:00:00'
    });
    expect(prompt?.body).toContain(
      'Your decisions are kept in the review from 01/10/2026, 10:00:00. The chapter opens with another review, so reopen this one from History.'
    );
    expect(prompt?.body).not.toMatch(/newer/i);
  });

  it('offers no Save without a chapter file', () => {
    const prompt = leavePrompt(leaving({ chapter: null, unsavedDecisions: 1 }), toOther);
    expect(prompt?.title).toBe('Leave this chapter?');
    expect(prompt?.confirmLabel).toBe('');
  });
});

describe('isOpenTarget (apply.7)', () => {
  const on = leaving({ unsavedDecisions: 2 });

  it('is the open chapter, spelled with either separator, or the review on screen', () => {
    expect(isOpenTarget(on, { kind: 'chapter', path: CHAPTER })).toBe(true);
    expect(isOpenTarget(on, { kind: 'chapter', path: 'D:/Writing/Novel/Chapter 3.md' })).toBe(true);
    expect(isOpenTarget(on, { kind: 'review', id: 'chapter-3--2026-10-14T16:04:33.000Z', when: 'x' })).toBe(
      true
    );
  });

  it('is not another chapter, another review, a path that differs in case, or anything with nothing open', () => {
    expect(isOpenTarget(on, { kind: 'chapter', path: OTHER })).toBe(false);
    expect(isOpenTarget(on, { kind: 'chapter', path: CHAPTER.toLowerCase() })).toBe(false);
    expect(isOpenTarget(on, { kind: 'review', id: 'chapter-3--2026-10-01T09:00:00.000Z', when: 'x' })).toBe(
      false
    );
    const nothing = leaving({ chapter: null, reviewId: null });
    expect(isOpenTarget(nothing, { kind: 'chapter', path: CHAPTER })).toBe(false);
    expect(isOpenTarget(nothing, { kind: 'review', id: '', when: 'x' })).toBe(false);
  });

  it('is exactly where leavePrompt asks nothing whatever is unsaved', () => {
    const targets = [
      { kind: 'chapter', path: CHAPTER },
      { kind: 'chapter', path: OTHER },
      { kind: 'chapter', path: CHAPTER.toLowerCase() },
      { kind: 'review', id: 'chapter-3--2026-10-14T16:04:33.000Z', when: 'x' },
      { kind: 'review', id: 'chapter-3--2026-10-01T09:00:00.000Z', when: 'x' }
    ] as const;
    for (const target of targets) {
      const asked = leavePrompt(leaving({ unsavedDecisions: 1, changedParagraphs: 1 }), target) !== null;
      expect(asked).toBe(!isOpenTarget(on, target));
    }
  });
});

describe('unresponsiveDetail', () => {
  it('names the app and what may be lost when the page does not answer', () => {
    expect(
      unresponsiveDetail(
        'no-answer',
        guard({ unsavedDecisions: 1, changedParagraphs: 1, reviewRunning: true, dialogText: true })
      )
    ).toEqual({
      title: APP_NAME,
      message: `${APP_NAME} is not responding`,
      detail: [
        '1 change is not saved to the chapter yet. They are kept in the review, but decisions made just before it stopped responding may not have reached it.',
        'Paragraph text typed just before it stopped responding may be lost.',
        'The review that is running will stop, and its result will be lost.',
        'The text you typed in the open dialog will be lost.',
        'Wait gives it more time. Close anyway closes the window now.'
      ].join('\n'),
      waitLabel: 'Wait',
      closeLabel: 'Close anyway'
    });
    expect(unresponsiveDetail('no-answer', guard({ unsavedDecisions: 4 })).detail.split('\n')[0]).toBe(
      '4 changes are not saved to the chapter yet. They are kept in the review, but decisions made just before it stopped responding may not have reached it.'
    );
  });

  it('says the page is still writing when it answered but never asked', () => {
    expect(unresponsiveDetail('finishing', guard({ unsavedDecisions: 2, locked: true }))).toEqual({
      title: APP_NAME,
      message: `${APP_NAME} is still finishing`,
      detail: [
        'It is still writing your decisions.',
        '2 changes are not saved to the chapter yet. They are kept in the review, apart from decisions it is still writing.',
        'The review that is running will stop, and its result will be lost.',
        'Wait gives it more time. Close anyway closes the window now, and anything not yet written is lost.'
      ].join('\n'),
      waitLabel: 'Wait',
      closeLabel: 'Close anyway'
    });
    expect(unresponsiveDetail('finishing', guard({ unsavedDecisions: 1 })).detail.split('\n')[1]).toBe(
      '1 change is not saved to the chapter yet. They are kept in the review, apart from decisions it is still writing.'
    );
  });

  it('always says where the unsaved changes are kept, so Close anyway does not read as losing them', () => {
    for (const stage of ['no-answer', 'finishing'] as const) {
      for (const n of [1, 3]) {
        const countLine = unresponsiveDetail(stage, guard({ unsavedDecisions: n }))
          .detail.split('\n')
          .find((line) => line.includes('not saved to the chapter'));
        expect(countLine).toContain('They are kept in the review');
      }
    }
  });

  it('names nothing at risk before the page has pushed any state', () => {
    expect(unresponsiveDetail('no-answer', null).detail).toBe(
      'Wait gives it more time. Close anyway closes the window now.'
    );
    expect(unresponsiveDetail('finishing', null).detail).toBe(
      'It is still writing your decisions.\nWait gives it more time. Close anyway closes the window now, and anything not yet written is lost.'
    );
  });
});

describe('saveShortcutAction', () => {
  const ctrlS: ShortcutKey = {
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false
  };
  const ready: SaveShortcutContext = {
    hasChapter: true,
    modalOpen: false,
    inParagraphBox: false,
    suggestionEditorOpen: false,
    locked: false,
    saving: false,
    unsavedDecisions: 2,
    changedParagraphs: 0
  };

  it('saves on Ctrl+S and Cmd+S, whatever the case of the letter', () => {
    expect(saveShortcutAction(ctrlS, ready)).toEqual({ kind: 'save' });
    expect(saveShortcutAction({ ...ctrlS, ctrlKey: false, metaKey: true }, ready)).toEqual({ kind: 'save' });
    expect(saveShortcutAction({ ...ctrlS, key: 'S' }, ready)).toEqual({ kind: 'save' });
    expect(saveShortcutAction(ctrlS, { ...ready, unsavedDecisions: 0, changedParagraphs: 1 })).toEqual({
      kind: 'save'
    });
  });

  it('finds the S key on a layout that types another script, but not a Latin letter moved there', () => {
    expect(saveShortcutAction({ ...ctrlS, key: 'ы' }, ready)).toEqual({ kind: 'save' });
    // Dvorak puts O where QWERTY has S; Ctrl+O is not Save.
    expect(saveShortcutAction({ ...ctrlS, key: 'o' }, ready)).toEqual({ kind: 'pass' });
  });

  it.each<[string, Partial<ShortcutKey>]>([
    ['another letter', { key: 'f', code: 'KeyF' }],
    ['no modifier', { ctrlKey: false }],
    ['Alt held as well', { altKey: true }],
    ['Shift held as well', { shiftKey: true }]
  ])('leaves %s alone', (_name, patch) => {
    expect(saveShortcutAction({ ...ctrlS, ...patch }, ready)).toEqual({ kind: 'pass' });
  });

  it.each<[string, Partial<ShortcutKey>, Partial<SaveShortcutContext>]>([
    ['a held key repeating', { repeat: true }, {}],
    ['a modal over the page', {}, { modalOpen: true }],
    ['a review of the chapter running', {}, { locked: true }],
    ['a save already under way', {}, { saving: true }],
    ['no chapter open', {}, { hasChapter: false }],
    ['nothing to save', {}, { unsavedDecisions: 0, changedParagraphs: 0 }],
    ['a modal over a paragraph box', {}, { modalOpen: true, inParagraphBox: true }],
    ['a modal over the suggestion editor', {}, { modalOpen: true, suggestionEditorOpen: true }],
    [
      'the suggestion editor open while the chapter is locked',
      {},
      { locked: true, suggestionEditorOpen: true }
    ]
  ])('swallows it and does nothing with %s', (_name, key, context) => {
    expect(saveShortcutAction({ ...ctrlS, ...key }, { ...ready, ...context })).toEqual({ kind: 'ignore' });
  });

  it('says to press Done first from inside a paragraph box', () => {
    expect(saveShortcutAction(ctrlS, { ...ready, inParagraphBox: true })).toEqual({
      kind: 'card',
      message: PRESS_DONE_FIRST
    });
    expect(PRESS_DONE_FIRST).toBe(
      'This paragraph is still open. Press Done or Ctrl+Enter to apply it, then save.'
    );
  });

  it('says to press Save in the suggestion editor first while it is open, wherever the focus is', () => {
    const card = { kind: 'card', message: PRESS_EDITOR_SAVE_FIRST };
    expect(saveShortcutAction(ctrlS, { ...ready, suggestionEditorOpen: true })).toEqual(card);
    // The words typed there are not counted anywhere yet, so it asks even with nothing unsaved.
    expect(
      saveShortcutAction(ctrlS, {
        ...ready,
        suggestionEditorOpen: true,
        unsavedDecisions: 0,
        changedParagraphs: 0
      })
    ).toEqual(card);
    expect(
      saveShortcutAction(
        { ...ctrlS, ctrlKey: false, metaKey: true },
        { ...ready, suggestionEditorOpen: true }
      )
    ).toEqual(card);
    expect(PRESS_EDITOR_SAVE_FIRST).toBe(
      'The suggestion you are editing is still open. Press its Save button or Ctrl+Enter first, then save to the chapter.'
    );
  });

  it('names the paragraph box when the key comes from one while the suggestion editor is also open', () => {
    expect(saveShortcutAction(ctrlS, { ...ready, inParagraphBox: true, suggestionEditorOpen: true })).toEqual(
      { kind: 'card', message: PRESS_DONE_FIRST }
    );
  });
});

describe('wording rules', () => {
  /** Every string the module can produce, over a grid of states. */
  function everyString(): string[] {
    const out: string[] = [
      CHAPTER_MATCHES_PAGE,
      PRESS_DONE_FIRST,
      PRESS_EDITOR_SAVE_FIRST,
      KEPT_TOOLTIP,
      keptPhrase(new Date(2026, 9, 17, 14, 2).toISOString()),
      keptPhrase('')
    ];
    const add = (prompt: object | null): void => {
      if (!prompt) return;
      for (const value of Object.values(prompt)) if (typeof value === 'string') out.push(value);
    };
    for (const n of [0, 1, 4]) {
      out.push(changeCount(n), unsavedPhrase(n), unsavedDotLabel(n));
      for (const p of [0, 1, 2]) {
        for (const flag of [false, true]) {
          const state = guard({
            unsavedDecisions: n,
            changedParagraphs: p,
            locked: flag,
            reviewRunning: flag,
            dialogText: flag
          });
          add(saveButtonState(button({ unsavedDecisions: n, changedParagraphs: p, locked: flag })));
          add(saveButtonState(button({ unsavedDecisions: n, saving: flag, hasChapter: !flag })));
          add(closePrompt(state));
          add(closePrompt(state, { olderReviewFrom: '14/10/2026' }));
          add(
            leavePrompt(leaving({ unsavedDecisions: n, changedParagraphs: p }), {
              kind: 'chapter',
              path: OTHER
            })
          );
          add(
            leavePrompt(
              leaving({ unsavedDecisions: n, changedParagraphs: p }),
              { kind: 'review', id: 'other', when: '14/10/2026' },
              { olderReviewFrom: '01/10/2026' }
            )
          );
          add(unresponsiveDetail('no-answer', state));
          add(unresponsiveDetail('finishing', state));
        }
      }
    }
    return out;
  }

  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'ui', 'save.ts'),
    'utf8'
  );

  it('never calls unsaved decisions "accepted changes"', () => {
    const strings = everyString();
    expect(strings.length).toBeGreaterThan(100);
    for (const text of strings) expect(text).not.toMatch(/accepted changes?/i);
    // Only the comment that explains the rule may name it.
    expect(source.match(/accepted changes/gi)).toHaveLength(1);
  });

  it('takes the app name from APP_NAME and never spells it out', () => {
    expect(closePrompt(guard({ unsavedDecisions: 1 }))?.title).toBe(`Close ${APP_NAME}?`);
    expect(unresponsiveDetail('no-answer', null).message).toBe(`${APP_NAME} is not responding`);
    expect(unresponsiveDetail('finishing', null).title).toBe(APP_NAME);
    expect(source).toContain("import { APP_NAME } from '../branding';");
    expect(source.toLowerCase()).not.toContain(APP_NAME.toLowerCase());
  });
});
