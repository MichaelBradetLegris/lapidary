import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { unsavedDecisionCount } from '../../src/shared/diff/compose';
import type { FileContent, SaveRequest, SaveResponse } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { SHOW_BACKUPS_CARD, noBackupsYet } from '../../src/shared/ui/backups';
import {
  CHAPTER_MATCHES_PAGE,
  PRESS_DONE_FIRST,
  PRESS_EDITOR_SAVE_FIRST,
  saveShortcutAction
} from '../../src/shared/ui/save';

import {
  pendingSave,
  RELOADED_WHILE_SAVING,
  SAVE_CARD,
  SAVED_CARD,
  saveChapter,
  type SaveDeps
} from '../../src/renderer/state/saveChapter';
import {
  changedParagraphCount,
  isModalOpen,
  isWrittenReview,
  savedReview,
  saveShortcutContext,
  useApp
} from '../../src/renderer/state/store';

/* apply.3: Save to chapter as one awaitable path, and Ctrl+S. */

const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';
const SOURCE = 'C:/vault/Chapter 01.md';
const REVIEW_PATH = 'C:/reviews/chapter-01/2026-10-16.review.json';

function chapterReview(sourcePath = SOURCE): Review {
  return createReview({
    sourcePath,
    base: { text: CHAPTER, hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
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
    comments: [{ id: 'c1', paragraph: 0, category: 'flow', text: 'Reads long.', status: 'open' }],
    generator: { kind: 'claude' }
  });
}

type Reply = SaveResponse | Error | Promise<SaveResponse>;

function harness(...replies: Reply[]) {
  const requests: SaveRequest[] = [];
  const reviewWrites: { review: Review; path: string | null }[] = [];
  const saved: { sourcePath: string; onScreen: boolean }[] = [];
  const deps: SaveDeps = {
    saveFile: (request) => {
      requests.push(request);
      const next = replies.shift();
      if (next === undefined) return Promise.reject(new Error('no reply left'));
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next);
    },
    writeReview: (review, file) => {
      reviewWrites.push({ review, path: file });
      return Promise.resolve(file);
    },
    onSaved: (review, onScreen) => void saved.push({ sourcePath: review.sourcePath, onScreen })
  };
  return { deps, requests, reviewWrites, saved };
}

/** A reply the test sends when it chooses. */
function deferred(): { promise: Promise<SaveResponse>; resolve: (r: SaveResponse) => void } {
  let resolve: (r: SaveResponse) => void = () => undefined;
  const promise = new Promise<SaveResponse>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const state = () => useApp.getState();
const cards = (): string[] => state().notifications.map((n) => n.text);
const lastCard = (): string | undefined => state().notifications.at(-1)?.text;

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    settingsOpen: false,
    setupOpen: false,
    newChapterOpen: false,
    manualReviewOpen: false,
    reviewDialogOpen: false
  });
  state().setReview(chapterReview(), REVIEW_PATH);
  state().clearNotifications();
});

describe('Save to chapter (apply.3)', () => {
  it('says the chapter already matches the page, and touches nothing, when nothing is unsaved', async () => {
    const h = harness();
    const before = state().review;
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(h.requests).toEqual([]);
    expect(h.reviewWrites).toEqual([]);
    expect(h.saved).toEqual([]);
    expect(lastCard()).toBe(CHAPTER_MATCHES_PAGE);
    expect(state().review).toBe(before);
  });

  it('writes the page against the hash it was based on, folds the decisions in and writes the review', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h2' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(h.requests).toEqual([
      {
        path: SOURCE,
        text: 'As he tilted his head aside, the man watched.\n\nShe said nothing at all.',
        eol: 'lf',
        bom: false,
        trailingNewline: true,
        expectedHash: 'h1'
      }
    ]);
    const review = state().review!;
    expect(review.base.text).toBe(
      'As he tilted his head aside, the man watched.\n\nShe said nothing at all.'
    );
    expect(review.base.hash).toBe('h2');
    expect(unsavedDecisionCount(review.hunks)).toBe(0);
    expect(h.reviewWrites).toEqual([{ review, path: REVIEW_PATH }]);
    expect(h.saved).toEqual([{ sourcePath: SOURCE, onScreen: true }]);
    expect(lastCard()).toBe('Saved to the chapter file.');
    expect(state().chapterSaving).toBe(false);
  });

  it('says the chapter already matches the page when main wrote nothing because the bytes were there', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h1', unchanged: true });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(lastCard()).toBe(CHAPTER_MATCHES_PAGE);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    expect(h.saved).toHaveLength(1);
  });

  it('holds decisions back while the file is being written, and lets them through after', async () => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    expect(state().chapterSaving).toBe(true);
    expect(pendingSave()).toBe(run);

    const during = state().review;
    state().toggleDismissed('h1');
    state().applyBulk(['h1'], 'pending');
    state().setCommentStatus('c1', 'resolved');
    expect(state().editHunkText('h1', 'He tilted', true).status).toBe('blocked');
    expect(state().openDraft(1)).toBe(false);
    expect(state().review).toBe(during);

    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    expect(state().chapterSaving).toBe(false);
    expect(pendingSave()).toBeNull();
    expect(state().review!.base.hash).toBe('h2');
    state().toggleDismissed('h1');
    expect(state().review!.hunks[0]!.status).toBe('dismissed');
  });

  it('asks before applying a changed paragraph box, and Cancel writes nothing and keeps the box', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const h = harness();
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    expect(state().confirmSpec).toMatchObject({
      title: 'Apply paragraph edits first?',
      body: '1 paragraph is still open for editing. Apply its changes as accepted suggestions, then save the chapter?',
      confirmLabel: 'Apply and save'
    });
    state().answerChoice('cancel');
    expect(await run).toBe('cancelled');
    expect(h.requests).toEqual([]);
    expect(state().drafts[1]?.text).toBe('She said nothing.');
  });

  it('applies the changed box and writes it when the author agrees', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const h = harness({ status: 'written', hash: 'h2' });
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    state().answerChoice('confirm');
    expect(await run).toBe('saved');
    expect(h.requests[0]?.text).toBe('Tilting his head aside, the man watched.\n\nShe said nothing.');
    expect(state().drafts).toEqual({});
  });

  it("applies the box without a question when the caller already asked ('apply')", async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const h = harness({ status: 'written', hash: 'h2' });
    expect(await saveChapter({ applyDrafts: 'apply' }, h.deps)).toBe('saved');
    expect(state().confirmSpec).toBeNull();
    expect(h.requests[0]?.text).toBe('Tilting his head aside, the man watched.\n\nShe said nothing.');
  });

  it('leaves a box that was not changed open, and asks nothing, when there is nothing to save', async () => {
    state().openDraft(1);
    const h = harness();
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(state().confirmSpec).toBeNull();
    expect(Object.keys(state().drafts)).toEqual(['1']);
    expect(h.requests).toEqual([]);
  });

  it('closes a box that was not changed, without a question, when there is something to write', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    const h = harness({ status: 'written', hash: 'h2' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(state().confirmSpec).toBeNull();
    expect(state().drafts).toEqual({});
  });

  it('writes nothing when a changed box cannot be applied', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    // The chapter changed on disk under the box: the watcher reloaded the same review.
    const r = state().review!;
    state().setReview(
      { ...r, base: { ...r.base, text: CHAPTER.replace('nothing at all', 'little'), hash: 'h9' } },
      REVIEW_PATH
    );
    const h = harness();
    expect(await saveChapter({ applyDrafts: 'apply' }, h.deps)).toBe('blocked');
    expect(h.requests).toEqual([]);
    expect(cards().some((t) => t.startsWith('Paragraph 2 changed while you were editing it'))).toBe(true);
    expect(lastCard()).toBe('Nothing was saved. Resolve the paragraphs above, then save again.');
    expect(state().drafts[1]?.text).toBe('She said nothing.');
  });

  it('is blocked while a review of the chapter runs, and with no chapter open', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    const h = harness();
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('blocked');
    expect(lastCard()).toBe('Wait for the review to finish, then save.');
    state().setAiBusy(null);
    state().setReview(null);
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('blocked');
    expect(h.requests).toEqual([]);
  });

  it('rebases onto the copy on disk and tries again when the chapter changed underneath', async () => {
    state().toggleAccepted('h1');
    const disk: FileContent = {
      path: SOURCE,
      text: `${CHAPTER} Then she left.`,
      hash: 'h3',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    };
    const h = harness({ status: 'stale', disk }, { status: 'written', hash: 'h4' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(h.requests[1]).toMatchObject({
      expectedHash: 'h3',
      text: 'As he tilted his head aside, the man watched.\n\nShe said nothing at all. Then she left.'
    });
    expect(cards().some((t) => t.startsWith('The chapter changed on disk before saving. Rebased'))).toBe(
      true
    );
    expect(state().review!.base.hash).toBe('h4');
  });

  it('counts on the rebase card the decisions that changed to match the file (apply.23)', async () => {
    // A second suggestion, to cut " at all", which the author then made by hand in Obsidian.
    const review = chapterReview();
    const cut = CHAPTER.indexOf(' at all');
    state().setReview(
      {
        ...review,
        hunks: [
          ...review.hunks,
          {
            id: 'h2',
            start: cut,
            end: cut + ' at all'.length,
            baseSide: 'original',
            original: ' at all',
            replacement: '',
            paragraph: 1,
            source: 'diff',
            status: 'pending',
            anchor: 'exact'
          }
        ]
      },
      REVIEW_PATH
    );
    state().toggleAccepted('h1');
    const disk: FileContent = {
      path: SOURCE,
      text: CHAPTER.replace('nothing at all.', 'nothing.'),
      hash: 'h3',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    };
    const h = harness({ status: 'stale', disk }, { status: 'written', hash: 'h4' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(cards()).toContain(
      'The chapter changed on disk before saving. Rebased: 2 re-anchored, 0 lost. 1 decision changed to match the file. Retrying.'
    );
    expect(h.requests[1]?.text).toBe('As he tilted his head aside, the man watched.\n\nShe said nothing.');
    expect(state().review!.hunks.find((x) => x.id === 'h2')).toMatchObject({
      status: 'accepted',
      baseSide: 'replacement'
    });
  });

  it('gives up when the chapter keeps changing on disk', async () => {
    state().toggleAccepted('h1');
    const disk = (hash: string): FileContent => ({
      path: SOURCE,
      text: CHAPTER,
      hash,
      eol: 'lf',
      bom: false,
      trailingNewline: true
    });
    const h = harness({ status: 'stale', disk: disk('h3') }, { status: 'stale', disk: disk('h4') });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(lastCard()).toBe('The chapter keeps changing on disk. Close it in Obsidian and save again.');
    expect(state().chapterSaving).toBe(false);
  });

  it('fails with the reason on a card when the file cannot be written, and keeps the decisions unsaved', async () => {
    state().toggleAccepted('h1');
    const h = harness(new Error('There is no space left on the disk.'));
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(lastCard()).toBe('There is no space left on the disk.');
    expect(state().notifications.at(-1)?.tone).toBe('error');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
    expect(h.reviewWrites).toEqual([]);
    expect(state().chapterSaving).toBe(false);
  });

  it('keeps one card for a save refused twice, and a save that then works replaces it (apply.10)', async () => {
    // What main sends when the backup cannot be made; it does not change between tries.
    const refused =
      'Could not back up the chapter before saving, so nothing was written: D:/data/backups/chapter-01-1a2b3c4d cannot be made, because a file stands where a folder should be.';
    state().toggleAccepted('h1');
    const h = harness(new Error(refused), new Error(refused), { status: 'written', hash: 'h2' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(state().notifications.map((n) => [n.tone, n.text])).toEqual([['error', refused]]);
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(state().notifications.map((n) => [n.tone, n.text])).toEqual([
      ['info', 'Saved to the chapter file.']
    ]);
  });

  it('replaces the card for a chapter that kept changing with the next outcome, and keeps the rebase cards', async () => {
    state().toggleAccepted('h1');
    const disk = (hash: string): FileContent => ({
      path: SOURCE,
      text: CHAPTER,
      hash,
      eol: 'lf',
      bom: false,
      trailingNewline: true
    });
    const h = harness(
      { status: 'stale', disk: disk('h3') },
      { status: 'stale', disk: disk('h4') },
      new Error('There is no space left on the disk.'),
      { status: 'written', hash: 'h5' }
    );
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('failed');
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    const left = cards();
    expect(left).toHaveLength(3);
    expect(
      left.slice(0, 2).every((t) => t.startsWith('The chapter changed on disk before saving. Rebased'))
    ).toBe(true);
    expect(left[2]).toBe('Saved to the chapter file.');
  });

  it('records the save in its own review, off screen, when another chapter opened during the write', async () => {
    state().toggleAccepted('h1');
    const written = state().review!;
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    const other = chapterReview('C:/vault/Chapter 02.md');
    state().setReview(other, 'C:/reviews/chapter-02/x.review.json');
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    expect(state().review).toBe(other);
    expect(h.reviewWrites).toHaveLength(1);
    const off = h.reviewWrites[0]!;
    expect(off.path).toBe(REVIEW_PATH);
    expect(off.review.id).toBe(written.id);
    expect(off.review.base.hash).toBe('h2');
    expect(unsavedDecisionCount(off.review.hunks)).toBe(0);
    // History lists the chapter on screen, so the save does not refresh it for Chapter 01.
    expect(h.saved).toEqual([{ sourcePath: SOURCE, onScreen: false }]);
    expect(lastCard()).toBe('Saved to the chapter file.');
  });

  it('stops on a stale answer when another chapter is on screen, and leaves that one alone', async () => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    const other = chapterReview('C:/vault/Chapter 02.md');
    state().setReview(other, 'C:/reviews/chapter-02/x.review.json');
    reply.resolve({
      status: 'stale',
      disk: {
        path: SOURCE,
        text: `${CHAPTER} Then she left.`,
        hash: 'h3',
        eol: 'lf',
        bom: false,
        trailingNewline: true
      }
    });
    expect(await run).toBe('failed');
    expect(lastCard()).toBe(
      'The chapter changed on disk before saving, and another review is open now, so nothing was saved.'
    );
    expect(state().notifications.at(-1)?.key).toBe(SAVE_CARD);
    expect(state().review).toBe(other);
    expect(h.requests).toHaveLength(1);
    expect(h.reviewWrites).toEqual([]);
    expect(h.saved).toEqual([]);
    expect(state().chapterSaving).toBe(false);
  });

  it('folds a copy of the review read back during the write, as a click on the open chapter gives', async () => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    const copy = structuredClone(state().review!);
    state().setReview(copy, REVIEW_PATH);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    const review = state().review!;
    expect(review.id).toBe(copy.id);
    expect(review.base.hash).toBe('h2');
    expect(review.base.text).toBe(
      'As he tilted his head aside, the man watched.\n\nShe said nothing at all.'
    );
    expect(unsavedDecisionCount(review.hunks)).toBe(0);
    expect(h.reviewWrites).toEqual([{ review, path: REVIEW_PATH }]);
    expect(h.saved).toEqual([{ sourcePath: SOURCE, onScreen: true }]);
    expect(lastCard()).toBe('Saved to the chapter file.');
  });

  it('records the save when the author left the chapter and came back during the write', async () => {
    state().toggleAccepted('h1');
    // The review as its json holds it: opening a chapter writes what is waiting first.
    const asStored = JSON.parse(JSON.stringify(state().review)) as Review;
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    state().setReview(chapterReview('C:/vault/Chapter 02.md'), 'C:/reviews/chapter-02/x.review.json');
    state().setReview(asStored, REVIEW_PATH);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    const review = state().review!;
    expect(review.base.hash).toBe('h2');
    expect(unsavedDecisionCount(review.hunks)).toBe(0);
    expect(h.reviewWrites).toEqual([{ review, path: REVIEW_PATH }]);
    expect(h.saved).toEqual([{ sourcePath: SOURCE, onScreen: true }]);
    expect(lastCard()).toBe('Saved to the chapter file.');
  });

  it.each([
    [
      'on another base, as the watcher rebases it',
      (r: Review): Review => ({ ...r, base: { ...r.base, text: `${CHAPTER} Then she left.`, hash: 'h9' } })
    ],
    [
      'with other decisions',
      (r: Review): Review => ({ ...r, hunks: r.hunks.map((x) => ({ ...x, status: 'pending' as const })) })
    ]
  ])('says the review was reloaded while saving, and leaves it, for a copy %s', async (_name, reload) => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    const copy = reload(state().review!);
    state().setReview(copy, REVIEW_PATH);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    expect(state().review).toBe(copy);
    expect(h.reviewWrites).toEqual([]);
    expect(lastCard()).toBe(RELOADED_WHILE_SAVING);
    expect(state().notifications.at(-1)?.tone).toBe('warn');
    expect(h.saved).toEqual([{ sourcePath: SOURCE, onScreen: true }]);
  });

  it('takes a copy read back after the write, already on the written bytes, as up to date', async () => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    const reread = savedReview(state().review!, 'h2');
    state().setReview(reread, REVIEW_PATH);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await run).toBe('saved');
    expect(state().review).toBe(reread);
    expect(h.reviewWrites).toEqual([]);
    expect(lastCard()).toBe('Saved to the chapter file.');
  });

  it('runs one save at a time: a second waits for the first and then finds nothing to save', async () => {
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const first = saveChapter({ applyDrafts: 'ask' }, h.deps);
    const second = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    expect(h.requests).toHaveLength(1);
    expect(pendingSave()).toBe(second);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await first).toBe('saved');
    expect(await second).toBe('nothing-to-save');
    expect(h.requests).toHaveLength(1);
  });
});

/* apply.11: the card after a save points at the copy of what it replaced. */
describe('the save card and its backup (apply.11)', () => {
  const card = () => state().notifications.at(-1);
  const BACKUP = { name: '2026-10-17 10.00.00 Chapter 01.md', created: true };

  it('carries Show backups for the chapter it saved when main made a backup', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h2', backup: BACKUP });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(card()).toMatchObject({
      tone: 'info',
      text: SAVED_CARD,
      key: SAVE_CARD,
      action: 'reveal-backups',
      actionArg: SOURCE
    });
  });

  it('carries it too when the newest backup already held the bytes and stands for this save', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h2', backup: { ...BACKUP, created: false } });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(card()).toMatchObject({ action: 'reveal-backups', actionArg: SOURCE });
  });

  it('names the chapter saved, after a rebase and with another chapter on screen by the end', async () => {
    state().toggleAccepted('h1');
    const disk: FileContent = {
      path: SOURCE,
      text: `${CHAPTER} Then she left.`,
      hash: 'h3',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    };
    const reply = deferred();
    const h = harness({ status: 'stale', disk }, reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    await tick();
    expect(h.requests).toHaveLength(2);
    state().setReview(chapterReview('C:/vault/Chapter 02.md'), null);
    reply.resolve({ status: 'written', hash: 'h4', backup: BACKUP });
    expect(await run).toBe('saved');
    expect(card()).toMatchObject({ text: SAVED_CARD, action: 'reveal-backups', actionArg: SOURCE });
  });

  it('has no button when the answer names no backup', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h2' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(card()?.text).toBe(SAVED_CARD);
    expect(card()?.action).toBeUndefined();
    expect(card()?.actionArg).toBeUndefined();
  });

  /* Show backups on a chapter never saved puts up a card saying there are no
     backups; cards close only on their X, so a save that makes one must take
     it down, or it stays above "Saved to the chapter file." untrue. */
  it('takes down the no-backups card once a save makes or finds a backup', async () => {
    for (const backup of [BACKUP, { ...BACKUP, created: false }]) {
      state().clearNotifications();
      state().setReview(chapterReview(), REVIEW_PATH);
      state().notify('info', noBackupsYet('Chapter 01'), SHOW_BACKUPS_CARD, 'reveal-all-backups');
      state().toggleAccepted('h1');
      const h = harness({ status: 'written', hash: 'h2', backup });
      expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
      expect(cards()).toEqual([SAVED_CARD]);
    }
  });

  it('takes it down too when the review was reloaded while saving, since the backup was still made', async () => {
    state().notify('info', noBackupsYet('Chapter 01'), SHOW_BACKUPS_CARD, 'reveal-all-backups');
    state().toggleAccepted('h1');
    const reply = deferred();
    const h = harness(reply.promise);
    const run = saveChapter({ applyDrafts: 'ask' }, h.deps);
    await tick();
    // The same review, rebased by the watcher onto other bytes during the write.
    const r = state().review!;
    state().setReview(
      { ...r, base: { ...r.base, text: `${CHAPTER} Then she left.`, hash: 'h9' } },
      REVIEW_PATH
    );
    reply.resolve({ status: 'written', hash: 'h2', backup: BACKUP });
    expect(await run).toBe('saved');
    expect(cards()).toEqual([RELOADED_WHILE_SAVING]);
  });

  it('leaves it when no backup was made: nothing written, or the write refused', async () => {
    const none = noBackupsYet('Chapter 01');
    state().notify('info', none, SHOW_BACKUPS_CARD, 'reveal-all-backups');
    state().toggleAccepted('h1');
    const unchanged = harness({ status: 'written', hash: 'h1', unchanged: true });
    expect(await saveChapter({ applyDrafts: 'ask' }, unchanged.deps)).toBe('nothing-to-save');
    expect(cards()).toEqual([none, CHAPTER_MATCHES_PAGE]);
    state().setReview(chapterReview(), REVIEW_PATH);
    state().toggleAccepted('h1');
    const refused = harness(
      new Error('Could not back up the chapter before saving, so nothing was written: no space left.')
    );
    expect(await saveChapter({ applyDrafts: 'ask' }, refused.deps)).toBe('failed');
    expect(cards()[0]).toBe(none);
    expect(cards()).toHaveLength(2);
  });

  it('has no button on the cards that say nothing new was written', async () => {
    state().toggleAccepted('h1');
    const h = harness({ status: 'written', hash: 'h1', unchanged: true });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(card()).toMatchObject({ text: CHAPTER_MATCHES_PAGE });
    expect(card()?.action).toBeUndefined();
  });
});

/* apply.22: the window steps. Accept, Save to chapter, rewrite the suggestion
   with the editor, Save to chapter again. */
describe('rewriting a suggestion after Save to chapter (apply.22)', () => {
  const SAVED = 'As he tilted his head aside, the man watched.\n\nShe said nothing at all.';
  const REWRITTEN = 'He tilted his head aside, the man watched.\n\nShe said nothing at all.';

  async function acceptAndSave(h: ReturnType<typeof harness>): Promise<void> {
    state().toggleAccepted('h1');
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(state().review!.base.text).toBe(SAVED);
    expect(state().review!.hunks[0]).toMatchObject({ baseSide: 'replacement', status: 'accepted' });
    state().clearNotifications();
  }

  it('the second Save writes the new words', async () => {
    const h = harness({ status: 'written', hash: 'h2' }, { status: 'written', hash: 'h3' });
    await acceptAndSave(h);

    expect(state().editHunkText('h1', 'He tilted', true)).toEqual({ status: 'applied', hunkId: 'h1' });
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
    expect(saveShortcutContext(state(), false).unsavedDecisions).toBe(1);

    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('saved');
    expect(h.requests[1]).toMatchObject({ path: SOURCE, text: REWRITTEN, expectedHash: 'h2' });
    expect(state().review!.base.text).toBe(REWRITTEN);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    expect(lastCard()).toBe('Saved to the chapter file.');
  });

  it('unticked, the saved words stay and there is nothing to save', async () => {
    const h = harness({ status: 'written', hash: 'h2' });
    await acceptAndSave(h);

    expect(state().editHunkText('h1', 'He tilted', false).status).toBe('applied');
    expect(state().review!.hunks[0]).toMatchObject({ status: 'pending', original: 'As he tilted' });
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(h.requests).toHaveLength(1);
    expect(lastCard()).toBe(CHAPTER_MATCHES_PAGE);
  });

  it('rewritten and then back to the saved words, there is nothing to save', async () => {
    const h = harness({ status: 'written', hash: 'h2' });
    await acceptAndSave(h);

    state().editHunkText('h1', 'He tilted', true);
    expect(state().editHunkText('h1', 'As he tilted', true).status).toBe('applied');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    expect(await saveChapter({ applyDrafts: 'ask' }, h.deps)).toBe('nothing-to-save');
    expect(h.requests).toHaveLength(1);
  });
});

describe('isWrittenReview (apply.3)', () => {
  it('is the review written, or a copy of it on the same base that composes the same text', () => {
    const written = chapterReview();
    const withStatus = (status: 'accepted' | 'dismissed'): Review => ({
      ...written,
      hunks: written.hunks.map((x) => ({ ...x, status }))
    });
    expect(isWrittenReview(written, written)).toBe(true);
    expect(isWrittenReview(structuredClone(written), written)).toBe(true);
    // Dismissed reads like pending, so the file is the same either way.
    expect(isWrittenReview(withStatus('dismissed'), written)).toBe(true);
    expect(isWrittenReview(withStatus('accepted'), written)).toBe(false);
    expect(isWrittenReview({ ...written, id: 'another' }, written)).toBe(false);
    expect(isWrittenReview({ ...written, sourcePath: 'C:/vault/Chapter 02.md' }, written)).toBe(false);
    expect(isWrittenReview({ ...written, base: { ...written.base, hash: 'h9' } }, written)).toBe(false);
  });
});

describe('Ctrl+S (apply.3)', () => {
  const ctrlS = {
    key: 's',
    code: 'KeyS',
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false
  };
  const action = (inParagraphBox = false) =>
    saveShortcutAction(ctrlS, saveShortcutContext(state(), inParagraphBox));

  it('reads the page into the shortcut context', () => {
    state().toggleAccepted('h1');
    expect(saveShortcutContext(state(), false)).toEqual({
      hasChapter: true,
      modalOpen: false,
      inParagraphBox: false,
      suggestionEditorOpen: false,
      locked: false,
      saving: false,
      unsavedDecisions: 1,
      changedParagraphs: 0
    });
    expect(action()).toEqual({ kind: 'save' });
  });

  it('does nothing with nothing to save', () => {
    expect(action()).toEqual({ kind: 'ignore' });
  });

  it.each([
    ['Settings', { settingsOpen: true }],
    ['the Setup screen', { setupOpen: true }],
    ['New chapter', { newChapterOpen: true }],
    ['Submit manual review', { manualReviewOpen: true }],
    ['Review with AI', { reviewDialogOpen: true }],
    [
      'a question',
      { confirmSpec: { title: 'Leave Chapter 01?', body: '', confirmLabel: 'Save 1 change first' } }
    ]
  ])('does nothing behind %s', (_name, patch) => {
    state().toggleAccepted('h1');
    useApp.setState(patch);
    expect(isModalOpen(state())).toBe(true);
    expect(action()).toEqual({ kind: 'ignore' });
  });

  it('says to press Done first from inside a paragraph box', () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    expect(action(true)).toEqual({ kind: 'card', message: PRESS_DONE_FIRST });
  });

  it('says to press the editor s Save first while the suggestion editor is open, wherever the focus is', () => {
    state().toggleAccepted('h1');
    state().openEditor({ kind: 'suggestion', hunkId: 'h1', initial: 'As he tilted', anchor: null });
    expect(isModalOpen(state())).toBe(false);
    expect(action()).toEqual({ kind: 'card', message: PRESS_EDITOR_SAVE_FIRST });
  });

  it('does nothing while a save is under way', () => {
    state().toggleAccepted('h1');
    useApp.setState({ chapterSaving: true });
    expect(action()).toEqual({ kind: 'ignore' });
  });

  it('counts only paragraph boxes whose text changed', () => {
    state().openDraft(0);
    state().openDraft(1);
    expect(changedParagraphCount(state().drafts)).toBe(0);
    state().setDraftText(1, 'She said nothing.');
    expect(changedParagraphCount(state().drafts)).toBe(1);
    expect(action()).toEqual({ kind: 'save' });
  });

  it('is handled before the early return for modified keys, for keys typed in a text field too', () => {
    const source = readFileSync(path.join(__dirname, '../../src/renderer/state/keyboard.ts'), 'utf8');
    const shortcut = source.indexOf('saveShortcutAction(');
    const modifiers = source.indexOf('if (event.ctrlKey || event.metaKey || event.altKey) return;');
    const typing = source.indexOf('if (isTypingTarget(event.target)) return;');
    expect(shortcut).toBeGreaterThan(0);
    expect(shortcut).toBeLessThan(modifiers);
    expect(shortcut).toBeLessThan(typing);
  });
});
