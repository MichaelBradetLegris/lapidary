import { beforeEach, describe, expect, it } from 'vitest';
import { composeText, unsavedDecisionCount } from '../../src/shared/diff/compose';
import { createDiffReview, createReview } from '../../src/shared/review';
import { bulkPlan } from '../../src/shared/ui/bulk';
import { closePrompt, leavePrompt } from '../../src/shared/ui/save';
import { modelOptions } from '../../src/renderer/state/models';
import { isLocked, useApp, type ConfirmSpec } from '../../src/renderer/state/store';
import type { Review } from '../../src/shared/types';

const ORIGINAL = 'The river had began.\n\nShe nodded her head slowly.';
const CORRECTED = 'The river had begun.\n\nShe nodded slowly.';

function fresh(): Review {
  return createDiffReview({ originalRaw: ORIGINAL, correctedRaw: CORRECTED });
}

/** The toolbar's "Accept all", as the confirmation flow applies it. */
function acceptAll(): void {
  const plan = bulkPlan(useApp.getState().review!.hunks, 'accept');
  useApp.getState().applyBulk(plan.ids, plan.status);
}

describe('review store', () => {
  beforeEach(() => {
    useApp.getState().setReview(fresh());
    useApp.getState().clearNotifications();
    useApp.setState({ reviewSavedAt: null, focusScrollToken: 0 });
  });

  it('opens a review focused on its first anchored hunk', () => {
    const state = useApp.getState();
    expect(state.review?.hunks.length).toBe(2);
    expect(state.focusedHunkId).toBe(state.review?.hunks[0]?.id);
    expect(unsavedDecisionCount(state.review!.hunks)).toBe(0);
  });

  it('has no dirty flag: the unsaved count is the one measure (apply.4)', () => {
    expect('dirty' in useApp.getState()).toBe(false);
    const id = useApp.getState().review!.hunks[0]!.id;
    const before = useApp.getState().review;
    useApp.getState().toggleAccepted(id);
    useApp.getState().toggleAccepted(id);
    // Accepted and turned back: the review changed, which the old flag counted
    // as unsaved, but the chapter file already reads like the page.
    expect(useApp.getState().review).not.toBe(before);
    expect(useApp.getState().review!.hunks[0]!.status).toBe('pending');
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(0);
  });

  it('toggles a hunk between accepted and pending', () => {
    const id = useApp.getState().review!.hunks[0]!.id;
    useApp.getState().toggleAccepted(id);
    expect(useApp.getState().review!.hunks[0]!.status).toBe('accepted');
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(1);
    useApp.getState().toggleAccepted(id);
    expect(useApp.getState().review!.hunks[0]!.status).toBe('pending');
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(0);
  });

  it('bulk actions reach hunks that carry no category', () => {
    // Diff-sourced hunks have category undefined but chip as "other".
    expect(useApp.getState().review!.hunks.every((h) => h.category === undefined)).toBe(true);
    const plan = bulkPlan(useApp.getState().review!.hunks, 'accept', 'other');
    expect(plan.count).toBe(2);
    useApp.getState().applyBulk(plan.ids, plan.status);
    expect(useApp.getState().review!.hunks.every((h) => h.status === 'accepted')).toBe(true);
  });

  it('accepting everything composes back to the corrected text', () => {
    acceptAll();
    const review = useApp.getState().review!;
    expect(composeText(review.base.text, review.hunks)).toBe(CORRECTED);
  });

  it('moves focus forward and backward without falling off the ends', () => {
    const ids = useApp.getState().review!.hunks.map((h) => h.id);
    useApp.getState().moveFocus(1);
    expect(useApp.getState().focusedHunkId).toBe(ids[1]);
    useApp.getState().moveFocus(1);
    expect(useApp.getState().focusedHunkId).toBe(ids[1]);
    useApp.getState().moveFocus(-1);
    expect(useApp.getState().focusedHunkId).toBe(ids[0]);
    useApp.getState().moveFocus(-1);
    expect(useApp.getState().focusedHunkId).toBe(ids[0]);
  });

  it('hides and shows a category', () => {
    useApp.getState().toggleCategory('other');
    expect(useApp.getState().hiddenCategories).toEqual(['other']);
    useApp.getState().toggleCategory('other');
    expect(useApp.getState().hiddenCategories).toEqual([]);
  });

  it('markSaved folds decisions into the base, leaving nothing unsaved', () => {
    acceptAll();
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(2);
    useApp.getState().markSaved('newhash');
    const review = useApp.getState().review!;
    expect(review.base.text).toBe(CORRECTED);
    expect(review.base.hash).toBe('newhash');
    expect(unsavedDecisionCount(review.hunks)).toBe(0);
    expect(review.hunks.every((h) => h.baseSide === 'replacement')).toBe(true);
    expect(composeText(review.base.text, review.hunks)).toBe(CORRECTED);
  });

  it('keeps an unlisted model alias in the dropdown', () => {
    // supportedModels() on a Max plan lists "opus[1m]", never plain "opus",
    // but the CLI accepts the alias. The setting must stay visible.
    const listed = [
      { value: 'default', label: 'Default' },
      { value: 'opus[1m]', label: 'Opus (1M context)' }
    ];
    expect(modelOptions(listed, 'opus')[0]).toEqual({ value: 'opus', label: 'opus (current)' });
    expect(modelOptions(listed, 'opus')).toHaveLength(3);
    expect(modelOptions(listed, 'default')).toEqual(listed);
    expect(modelOptions([], 'opus')).toEqual([{ value: 'opus', label: 'opus (current)' }]);
  });

  it('stacks notifications and closes them one at a time', () => {
    const first = useApp.getState().notify('info', 'Saved to the chapter file.');
    const second = useApp.getState().notify('error', 'Could not write the file.');
    expect(useApp.getState().notifications.map((n) => n.text)).toEqual([
      'Saved to the chapter file.',
      'Could not write the file.'
    ]);
    expect(useApp.getState().notifications[1]?.tone).toBe('error');
    useApp.getState().dismissNotification(first);
    expect(useApp.getState().notifications).toHaveLength(1);
    useApp.getState().dismissNotification(second);
    expect(useApp.getState().notifications).toEqual([]);
  });

  it('a keyed card replaces the last one about the same thing', () => {
    // Obsidian saves on a debounce while the author types, so the reload card
    // must not pile up once per keystroke.
    useApp.getState().notify('info', 'Reloaded from disk. 7 re-anchored.', 'file-reload');
    useApp.getState().notify('info', 'Something else entirely.');
    useApp.getState().notify('warn', 'Reloaded from disk. 6 re-anchored.', 'file-reload');
    expect(useApp.getState().notifications.map((n) => n.text)).toEqual([
      'Something else entirely.',
      'Reloaded from disk. 6 re-anchored.'
    ]);
  });

  it('resolves askConfirm with the answer the dialog gives', async () => {
    const spec = { title: 'Dismiss 2 pending suggestions?', body: 'b', confirmLabel: 'Dismiss' };
    const answered = useApp.getState().askConfirm(spec);
    expect(useApp.getState().confirmSpec).toEqual(spec);
    useApp.getState().answerConfirm(true);
    await expect(answered).resolves.toBe(true);
    expect(useApp.getState().confirmSpec).toBeNull();

    const cancelled = useApp.getState().askConfirm(spec);
    useApp.getState().answerConfirm(false);
    await expect(cancelled).resolves.toBe(false);
  });

  it('hovering never asks the pane to scroll, keyboard movement always does', () => {
    const ids = useApp.getState().review!.hunks.map((h) => h.id);
    const before = useApp.getState().focusScrollToken;

    useApp.getState().setHoveredHunk(ids[1]!);
    expect(useApp.getState().hoveredHunkId).toBe(ids[1]);
    expect(useApp.getState().focusedHunkId).toBe(ids[0]);
    expect(useApp.getState().focusScrollToken).toBe(before);

    // A click in the prose focuses without scrolling.
    useApp.getState().focusHunk(ids[1]!);
    expect(useApp.getState().focusScrollToken).toBe(before);

    // The list and the keyboard both ask for a scroll.
    useApp.getState().focusHunk(ids[0]!, { scroll: true });
    expect(useApp.getState().focusScrollToken).toBe(before + 1);
    useApp.getState().moveFocus(1);
    expect(useApp.getState().focusScrollToken).toBe(before + 2);
  });

  it('keyboard focus skips categories the chips have hidden', () => {
    useApp.getState().toggleCategory('other');
    const before = useApp.getState().focusedHunkId;
    useApp.getState().moveFocus(1);
    expect(useApp.getState().focusedHunkId).toBe(before);
  });

  it('steps through find matches and wraps at both ends', () => {
    useApp.getState().openFind();
    useApp.getState().setFindQuery('the');
    useApp.getState().setFindMatches(3);
    expect(useApp.getState().find.index).toBe(0);
    useApp.getState().stepFind(1);
    useApp.getState().stepFind(1);
    expect(useApp.getState().find.index).toBe(2);
    useApp.getState().stepFind(1);
    expect(useApp.getState().find.index).toBe(0);
    useApp.getState().stepFind(-1);
    expect(useApp.getState().find.index).toBe(2);
    useApp.getState().setFindMatches(0);
    expect(useApp.getState().find.index).toBe(-1);
    useApp.getState().closeFind();
    // The seek counter survives a close by design (round 4, item 1).
    expect(useApp.getState().find).toMatchObject({ open: false, query: '', index: -1, count: 0 });
  });

  it('records when the review json was last written', () => {
    expect(useApp.getState().reviewSavedAt).toBeNull();
    useApp.getState().markReviewPersisted('2026-09-09T10:04:33.000Z');
    expect(useApp.getState().reviewSavedAt).toBe('2026-09-09T10:04:33.000Z');
  });

  it('resolves a comment through patchReview', () => {
    useApp.getState().patchReview((r) => ({
      ...r,
      comments: [{ id: 'c1', paragraph: 0, category: 'flow', text: 'x', status: 'open' }]
    }));
    useApp.getState().patchReview((r) => ({
      ...r,
      comments: r.comments.map((c) => ({ ...c, status: 'resolved' as const }))
    }));
    expect(useApp.getState().review!.comments[0]?.status).toBe('resolved');
  });
});

/* ------------------------------------------------------------------ */
/* Phase 5b: editing through the hunk model, and comment status         */
/* ------------------------------------------------------------------ */

const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';

function chapterReview(): Review {
  return createReview({
    sourcePath: 'C:/vault/Chapter 01.md',
    base: { text: CHAPTER, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    hunks: [
      {
        id: 'h1',
        start: 0,
        end: 7,
        baseSide: 'original',
        original: 'Tilting',
        replacement: 'As he tilted',
        paragraph: 0,
        category: 'awkward',
        reason: 'Participial opener.',
        source: 'claude',
        status: 'pending',
        anchor: 'exact'
      }
    ],
    comments: [
      { id: 'c1', paragraph: 0, category: 'flow', text: 'Reads long.', status: 'open' },
      { id: 'c2', paragraph: 1, category: 'plot', text: 'She knows already.', status: 'open' }
    ],
    generator: { kind: 'claude' }
  });
}

describe('editing', () => {
  beforeEach(() => {
    useApp.getState().setReview(chapterReview());
    useApp.getState().clearNotifications();
  });

  it('rewrites a suggestion and marks the words as the author s', () => {
    const outcome = useApp.getState().editHunkText('h1', 'He tilted', true);
    expect(outcome).toEqual({ status: 'applied', hunkId: 'h1' });
    const hunk = useApp.getState().review!.hunks[0]!;
    expect(hunk).toMatchObject({
      replacement: 'He tilted',
      edited: true,
      status: 'accepted',
      source: 'claude',
      category: 'awkward',
      reason: 'Participial opener.'
    });
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(1);
    expect(composeText(CHAPTER, useApp.getState().review!.hunks)).toBe(
      'He tilted his head aside, the man watched.\n\nShe said nothing at all.'
    );
  });

  it('says nothing happened when a rewrite changes nothing', () => {
    useApp.getState().toggleAccepted('h1');
    expect(useApp.getState().editHunkText('h1', 'As he tilted', true)).toEqual({ status: 'noop' });
  });

  it('counts a rewrite of a saved suggestion as unsaved, against the saved words (apply.22)', () => {
    useApp.getState().toggleAccepted('h1');
    useApp.getState().markSaved('h2');
    const saved = useApp.getState().review!;
    expect(unsavedDecisionCount(saved.hunks)).toBe(0);

    useApp.getState().editHunkText('h1', 'He tilted', true);
    const review = useApp.getState().review!;
    expect(review.hunks[0]).toMatchObject({
      baseSide: 'original',
      original: 'As he tilted',
      replacement: 'He tilted',
      status: 'accepted'
    });
    expect(unsavedDecisionCount(review.hunks)).toBe(1);
    expect(composeText(review.base.text, review.hunks)).toBe(
      'He tilted his head aside, the man watched.\n\nShe said nothing at all.'
    );
  });

  it('opens and closes the editor on one thing at a time', () => {
    const request = { kind: 'suggestion' as const, hunkId: 'h1', initial: 'As he tilted', anchor: null };
    useApp.getState().openEditor(request);
    expect(useApp.getState().editor).toEqual(request);
    useApp.getState().closeEditor();
    expect(useApp.getState().editor).toBeNull();
  });
});

describe('editing a paragraph in place (Phase 5d)', () => {
  beforeEach(() => {
    useApp.setState({ review: null, drafts: {}, aiBusyPath: null });
    useApp.getState().setReview(chapterReview());
    useApp.getState().clearNotifications();
  });

  it('opens on what the page says, not on the base text', () => {
    useApp.getState().toggleAccepted('h1');
    expect(useApp.getState().openDraft(0)).toBe(true);
    expect(useApp.getState().drafts[0]).toMatchObject({
      key: 0,
      paragraphs: [0],
      initial: 'As he tilted his head aside, the man watched.',
      text: 'As he tilted his head aside, the man watched.'
    });
  });

  it('keeps several paragraphs open at once and commits them independently', () => {
    const state = useApp.getState();
    state.openDraft(0);
    state.openDraft(1);
    expect(Object.keys(useApp.getState().drafts)).toEqual(['0', '1']);

    useApp.getState().setDraftText(1, 'She said nothing.');
    const outcome = useApp.getState().commitDraft(1);
    expect(outcome).toMatchObject({ status: 'applied', added: 1, superseded: 0 });
    expect(Object.keys(useApp.getState().drafts)).toEqual(['0']);
    expect(composeText(CHAPTER, useApp.getState().review!.hunks)).toBe(
      'Tilting his head aside, the man watched.\n\nShe said nothing.'
    );
    expect(unsavedDecisionCount(useApp.getState().review!.hunks)).toBe(1);
  });

  it('supersedes the suggestion a changed word swallows, keeping its reason', () => {
    useApp.getState().openDraft(0);
    useApp.getState().setDraftText(0, 'He tilted, his head aside, and the man watched.');
    const outcome = useApp.getState().commitDraft(0);
    expect(outcome).toMatchObject({ status: 'applied', superseded: 1 });

    const hunks = useApp.getState().review!.hunks;
    const superseded = hunks.find((h) => h.id === 'h1');
    expect(superseded).toMatchObject({ status: 'dismissed', anchor: 'stale' });
    expect(superseded?.reason).toContain('Participial opener.');
    expect(composeText(CHAPTER, hunks)).toBe(
      'He tilted, his head aside, and the man watched.\n\nShe said nothing at all.'
    );
  });

  it('freezes the suggestions of an open paragraph, and only those', () => {
    useApp.getState().openDraft(0);
    useApp.getState().toggleAccepted('h1');
    expect(useApp.getState().review!.hunks[0]?.status).toBe('pending');
    expect(useApp.getState().editHunkText('h1', 'x', true).status).toBe('blocked');

    useApp.getState().cancelDraft(0);
    useApp.getState().toggleAccepted('h1');
    expect(useApp.getState().review!.hunks[0]?.status).toBe('accepted');
  });

  it('closes without a change when nothing was typed', () => {
    useApp.getState().openDraft(1);
    expect(useApp.getState().commitDraft(1)).toEqual({ status: 'noop' });
    expect(useApp.getState().drafts).toEqual({});
    expect(useApp.getState().review!.hunks).toHaveLength(1);
  });

  it('refuses to commit over an outside change, and keeps the author s text', () => {
    useApp.getState().openDraft(1);
    useApp.getState().setDraftText(1, 'She said something.');
    // The watcher reloads the same review after the file changed on disk.
    const current = useApp.getState().review!;
    const changed = 'Tilting his head aside, the man watched.\n\nShe said nothing, not once.';
    useApp.getState().setReview({ ...current, base: { ...current.base, text: changed } });

    const outcome = useApp.getState().commitDraft(1);
    expect(outcome.status).toBe('blocked');
    if (outcome.status === 'blocked') expect(outcome.message).toMatch(/Paragraph 2 changed/);
    expect(useApp.getState().drafts[1]?.text).toBe('She said something.');
  });

  it('drops open paragraphs when a different review replaces this one', () => {
    useApp.getState().openDraft(0);
    useApp.getState().setReview({ ...chapterReview(), id: 'another-review' });
    expect(useApp.getState().drafts).toEqual({});
  });

  it('commits every open paragraph for Save, first to last', () => {
    useApp.getState().openDraft(0);
    useApp.getState().openDraft(1);
    useApp.getState().setDraftText(0, 'Tilting his head aside, the boy watched.');
    useApp.getState().setDraftText(1, 'She said nothing.');
    expect(useApp.getState().commitAllDrafts()).toEqual({ applied: 2, blocked: [] });
    expect(composeText(CHAPTER, useApp.getState().review!.hunks)).toBe(
      'Tilting his head aside, the boy watched.\n\nShe said nothing.'
    );
  });
});

describe('read-only while a review runs (round 3, item 3)', () => {
  beforeEach(() => {
    useApp.setState({ review: null, drafts: {}, aiBusyPath: null });
    useApp.getState().setReview(chapterReview());
  });

  it('locks the chapter under review and nothing else', () => {
    useApp.getState().setAiBusy('C:/vault/Chapter 01.md');
    expect(isLocked(useApp.getState())).toBe(true);
    useApp.getState().setAiBusy('C:/vault/Chapter 02.md');
    expect(isLocked(useApp.getState())).toBe(false);
  });

  it('ignores every decision and edit while locked', () => {
    useApp.getState().setAiBusy('C:/vault/Chapter 01.md');
    const before = useApp.getState().review;

    useApp.getState().toggleAccepted('h1');
    useApp.getState().applyBulk(['h1'], 'dismissed');
    useApp.getState().setCommentStatus('c1', 'resolved');
    expect(useApp.getState().editHunkText('h1', 'x', true).status).toBe('blocked');
    expect(useApp.getState().openDraft(0)).toBe(false);

    expect(useApp.getState().review).toBe(before);
    expect(useApp.getState().drafts).toEqual({});

    useApp.getState().setAiBusy(null);
    useApp.getState().toggleAccepted('h1');
    expect(useApp.getState().review!.hunks[0]?.status).toBe('accepted');
  });
});

describe('find scrolls only when asked (round 4, item 1)', () => {
  beforeEach(() => {
    useApp.setState({ review: null, drafts: {}, aiBusyPath: null });
    useApp.getState().setReview(chapterReview());
  });

  it('asks for a scroll on typing and on every step, even with one match', () => {
    const state = useApp.getState();
    state.openFind();
    const start = useApp.getState().find.seek;
    state.setFindQuery('man');
    expect(useApp.getState().find.seek).toBe(start + 1);
    state.setFindMatches(1);
    state.stepFind(1);
    expect(useApp.getState().find).toMatchObject({ index: 0, seek: start + 2 });
  });

  it('does not ask for one when the page is redrawn or a suggestion changes', () => {
    const state = useApp.getState();
    state.openFind();
    state.setFindQuery('man');
    state.setFindMatches(2);
    const seek = useApp.getState().find.seek;
    state.toggleAccepted('h1');
    state.setFindMatches(2);
    expect(useApp.getState().find.seek).toBe(seek);
  });

  it('never winds the counter back, so a reopened bar scrolls on its first request', () => {
    const state = useApp.getState();
    state.openFind();
    state.setFindQuery('man');
    const seek = useApp.getState().find.seek;
    state.closeFind();
    expect(useApp.getState().find).toMatchObject({ open: false, query: '', seek });
    state.setReview(chapterReview());
    expect(useApp.getState().find.seek).toBe(seek);
    state.openFind();
    state.setFindQuery('she');
    expect(useApp.getState().find.seek).toBe(seek + 1);
  });
});

describe('comment status', () => {
  beforeEach(() => {
    useApp.setState({ aiBusyPath: null, drafts: {} });
    useApp.getState().setReview(chapterReview());
  });

  it('resolves and unresolves without losing the comment', () => {
    useApp.getState().setCommentStatus('c1', 'resolved');
    expect(useApp.getState().review!.comments.map((c) => c.status)).toEqual(['resolved', 'open']);
    expect(useApp.getState().review!.comments).toHaveLength(2);

    useApp.getState().setCommentStatus('c1', 'open');
    expect(useApp.getState().review!.comments[0]!.status).toBe('open');
    expect(useApp.getState().review!.comments[0]!.text).toBe('Reads long.');
  });
});

describe('decidedAt marks the review last worked in (files.1)', () => {
  beforeEach(() => {
    useApp.setState({ aiBusyPath: null, drafts: {} });
  });

  it('is not set by opening a review, only by deciding something in it', () => {
    useApp.getState().setReview(fresh());
    expect(useApp.getState().review!.decidedAt).toBeUndefined();
    useApp.getState().toggleAccepted(useApp.getState().review!.hunks[0]!.id);
    expect(useApp.getState().review!.decidedAt).toEqual(expect.any(String));
  });

  it('is set by a comment decision and by a save', () => {
    useApp.getState().setReview(chapterReview());
    useApp.getState().setCommentStatus('c1', 'resolved');
    expect(useApp.getState().review!.decidedAt).toEqual(expect.any(String));

    useApp.getState().setReview(fresh());
    useApp.getState().markSaved('newhash');
    expect(useApp.getState().review!.decidedAt).toEqual(expect.any(String));
  });

  it('is kept when a review that has one is opened again', () => {
    const decided = { ...fresh(), decidedAt: '2026-10-01T00:00:00.000Z' };
    useApp.getState().setReview(decided);
    expect(useApp.getState().review!.decidedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('three-way confirm (apply.6)', () => {
  const THREE: ConfirmSpec = {
    title: 'Leave Chapter 3?',
    body: '2 changes are not saved to the chapter yet.\nThey are kept in the review.',
    confirmLabel: 'Save 2 changes first',
    altLabel: 'Keep for later',
    cancelLabel: 'Cancel',
    defaultButton: 'alt'
  };

  beforeEach(() => {
    // Close anything an earlier test left open, so no stale resolver answers here.
    useApp.getState().answerChoice('cancel');
    useApp.setState({ aiBusyPath: null, drafts: {} });
    useApp.getState().setReview(fresh());
  });

  it('resolves askChoice with the button that answered', async () => {
    for (const choice of ['confirm', 'alt', 'cancel'] as const) {
      const asked = useApp.getState().askChoice(THREE);
      expect(useApp.getState().confirmSpec).toEqual(THREE);
      useApp.getState().answerChoice(choice);
      await expect(asked).resolves.toBe(choice);
      expect(useApp.getState().confirmSpec).toBeNull();
    }
  });

  it('answers a replaced question with cancel, and the new one with its own answer', async () => {
    const first = useApp.getState().askChoice(THREE);
    const second = useApp.getState().askChoice({ ...THREE, title: 'Close Lapidary?' });
    await expect(first).resolves.toBe('cancel');
    expect(useApp.getState().confirmSpec?.title).toBe('Close Lapidary?');
    useApp.getState().answerChoice('alt');
    await expect(second).resolves.toBe('alt');
  });

  it('answers a replaced yes-or-no question with no, as before', async () => {
    const bulk = useApp.getState().askConfirm({ title: 'Accept 2?', body: 'b', confirmLabel: 'Accept' });
    const leave = useApp.getState().askChoice(THREE);
    await expect(bulk).resolves.toBe(false);
    useApp.getState().answerChoice('confirm');
    await expect(leave).resolves.toBe('confirm');

    const choice = useApp.getState().askChoice(THREE);
    const confirm = useApp.getState().askConfirm({ title: 'Reset?', body: 'b', confirmLabel: 'Reset' });
    await expect(choice).resolves.toBe('cancel');
    useApp.getState().answerConfirm(true);
    await expect(confirm).resolves.toBe(true);
  });

  it('askConfirm is true for confirm only', async () => {
    const results: boolean[] = [];
    for (const choice of ['confirm', 'alt', 'cancel'] as const) {
      const asked = useApp.getState().askConfirm(THREE);
      useApp.getState().answerChoice(choice);
      results.push(await asked);
    }
    expect(results).toEqual([true, false, false]);
  });

  it('answerConfirm still answers a three-way question: true is confirm, false cancel', async () => {
    const yes = useApp.getState().askChoice(THREE);
    useApp.getState().answerConfirm(true);
    await expect(yes).resolves.toBe('confirm');
    const no = useApp.getState().askChoice(THREE);
    useApp.getState().answerConfirm(false);
    await expect(no).resolves.toBe('cancel');
  });

  it('turns an answer the question does not show into cancel', async () => {
    const noSave = useApp.getState().askChoice({ ...THREE, confirmLabel: '' });
    useApp.getState().answerChoice('confirm');
    await expect(noSave).resolves.toBe('cancel');

    const twoWay = useApp.getState().askChoice({ title: 'Replace?', body: 'b', confirmLabel: 'Replace' });
    useApp.getState().answerChoice('alt');
    await expect(twoWay).resolves.toBe('cancel');
  });

  it('takes the leave and close prompts as they are', async () => {
    const chapter = 'D:\\Writing\\Novel\\Chapter 3.md';
    const leave = leavePrompt(
      { chapter, unsavedDecisions: 1, changedParagraphs: 0, locked: false, reviewId: 'r1' },
      { kind: 'chapter', path: 'D:\\Writing\\Novel\\Chapter 4.md' }
    )!;
    const asked = useApp.getState().askChoice(leave);
    expect(useApp.getState().confirmSpec).toEqual(leave);
    useApp.getState().answerChoice('alt');
    await expect(asked).resolves.toBe('alt');

    const close = closePrompt({
      chapter,
      unsavedDecisions: 0,
      changedParagraphs: 0,
      locked: false,
      reviewRunning: false,
      writesPending: false,
      dialogText: true
    })!;
    const closing = useApp.getState().askChoice(close);
    useApp.getState().answerChoice('confirm');
    await expect(closing).resolves.toBe('cancel');
  });

  it('a Bulk question answered through askConfirm applies only on confirm', async () => {
    // The flow in state/bulk.ts: askConfirm, then applyBulk when it says yes.
    const ask = async (answer: 'confirm' | 'cancel' | 'replaced'): Promise<void> => {
      const plan = bulkPlan(useApp.getState().review!.hunks, 'accept');
      const done = useApp
        .getState()
        .askConfirm({ title: plan.title, body: plan.body, confirmLabel: plan.confirmLabel })
        .then((ok) => {
          if (ok) useApp.getState().applyBulk(plan.ids, plan.status);
        });
      if (answer === 'replaced') void useApp.getState().askChoice(THREE);
      else useApp.getState().answerChoice(answer);
      await done;
      useApp.getState().answerChoice('cancel');
    };
    const statuses = (): string[] => useApp.getState().review!.hunks.map((h) => h.status);

    await ask('cancel');
    expect(statuses()).toEqual(['pending', 'pending']);
    await ask('replaced');
    expect(statuses()).toEqual(['pending', 'pending']);
    await ask('confirm');
    expect(statuses()).toEqual(['accepted', 'accepted']);
  });

  it('does nothing when answered with no question open', () => {
    expect(useApp.getState().confirmSpec).toBeNull();
    expect(() => useApp.getState().answerChoice('confirm')).not.toThrow();
    expect(useApp.getState().confirmSpec).toBeNull();
  });
});
