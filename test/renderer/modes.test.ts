import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeReview } from '../../src/shared/diff/compose';
import { fullEditText } from '../../src/shared/edit';
import { createReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';
import {
  FULL_EDIT_CHANGED,
  FULL_EDIT_HOLDS_PARAGRAPHS,
  FULL_EDIT_WAIT_FOR_REVIEW,
  FULL_EDIT_WAIT_FOR_SAVE,
  boxesBeforeFullEditPrompt,
  boxesBeforePreviewPrompt,
  discardFullEditPrompt,
  fullEditOtherReviewPrompt,
  leaveFullEditPrompt,
  type Mode
} from '../../src/shared/ui/modes';
import { closeGuardStateOf } from '../../src/renderer/state/closeGuard';
import { beforeLeaving, leaveStateOf } from '../../src/renderer/state/leave';
import { cancelFullEdit, chooseMode, finishFullEdit } from '../../src/renderer/state/modes';
import {
  changedParagraphCount,
  currentMode,
  fullEditChanged,
  fullEditDraft,
  inDraft,
  reviewKeysActive,
  saveShortcutContext,
  useApp,
  type ConfirmChoice
} from '../../src/renderer/state/store';

/* rr.2: the Mode select. Main, Full edit and Preview are the window's own;
   Full edit is open while its box is, under WHOLE_DRAFT_KEY; a switch with
   something typed and not applied asks as leaving the chapter does. The
   words are tested in test/shared/modes.test.ts; these check what each
   answer does to the store. */

const FRONT = '---\ntitle: T\n---';
const TEXT = `${FRONT}\nIt was the third night of rain.\n\nShe should of known.\n\nThe lamp guttered.`;
const SOURCE = 'C:/vault/Chapter 01.md';
const TWO = 'C:/vault/Chapter 02.md';
const THREE = 'C:/vault/Chapter 03.md';

function hunk(original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = TEXT.indexOf(original);
  return {
    id: `h-${original}`,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 1,
    category: 'grammar',
    reason: 'Reason.',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

function chapter(id = 'review-1', sourcePath = SOURCE): Review {
  return {
    ...createReview({
      sourcePath,
      base: { text: TEXT, hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [hunk('of', 'have')],
      generator: { kind: 'manual' }
    }),
    id
  };
}

const state = () => useApp.getState();
const mode = (): Mode => currentMode(state());
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Run a switch, answer the question it asks with `choice`, and give back the question and the result. */
async function switchAnswering(target: Mode, choice: ConfirmChoice | null) {
  const run = chooseMode(target);
  await tick();
  const asked = state().confirmSpec;
  if (choice) state().answerChoice(choice);
  return { asked, done: await run };
}

/** Type into Full edit's box, as its onChange does. */
function typeInFullEdit(transform: (text: string) => string): void {
  const draft = fullEditDraft(state().drafts);
  if (!draft) throw new Error('Full edit is not open');
  state().setDraftText(WHOLE_DRAFT_KEY, transform(draft.text));
}

beforeEach(() => {
  useApp.setState({
    review: null,
    drafts: {},
    viewMode: 'main',
    fullEditPending: null,
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    confirmSpec: null,
    notifications: []
  });
  state().setReview(chapter(), 'C:/reviews/r1.json');
});

describe('the mode of the window', () => {
  it('opens a chapter in Main, and Main and Preview switch with no question when nothing is typed', async () => {
    expect(mode()).toBe('main');
    expect(await chooseMode('preview')).toBe(true);
    expect(mode()).toBe('preview');
    expect(state().confirmSpec).toBeNull();
    expect(await chooseMode('main')).toBe(true);
    expect(mode()).toBe('main');
  });

  /* rr.5: the mode is the window's. The window starts in Main; another
     review of the chapter or another chapter keeps Main or Preview, and the
     mode a caller passes, the one in use when the author chose, wins. */
  it('starts in Main, and keeps Main or Preview for another review and another chapter', async () => {
    expect(useApp.getInitialState().viewMode).toBe('main');
    expect(useApp.getInitialState().fullEditPending).toBeNull();
    await chooseMode('preview');
    state().setReview(chapter('review-2'), null);
    expect(mode()).toBe('preview');
    state().setReview(chapter('review-3', TWO), null);
    expect(mode()).toBe('preview');
    state().setReview(chapter('review-4', THREE), null, 'preview');
    expect(mode()).toBe('preview');
    state().setReview(chapter('review-5', SOURCE), null, 'main');
    expect(mode()).toBe('main');
    state().setReview(chapter('review-6', TWO), null);
    expect(mode()).toBe('main');
    state().setReview(chapter('review-7', THREE), null, 'preview');
    expect(mode()).toBe('preview');
    expect(state().fullEditPending).toBeNull();
  });

  it("closes the find bar and the hover card, which are Main's, on the way out of Main", async () => {
    useApp.setState({
      find: { open: true, query: 'rain', index: 0, count: 1, seek: 4 },
      hoveredHunkId: 'h-of'
    });
    await chooseMode('preview');
    expect(state().find).toEqual({ open: false, query: '', index: -1, count: 0, seek: 4 });
    expect(state().hoveredHunkId).toBeNull();
  });
});

describe('Full edit', () => {
  it('opens on the body as the page reads it, freezes every suggestion and closes into Main', async () => {
    await chooseMode('preview');
    expect(await chooseMode('edit')).toBe(true);
    expect(mode()).toBe('edit');
    const draft = fullEditDraft(state().drafts);
    expect(draft).toEqual({
      key: WHOLE_DRAFT_KEY,
      paragraphs: [],
      initial: fullEditText(TEXT, state().review!.hunks),
      text: fullEditText(TEXT, state().review!.hunks),
      whole: true
    });
    expect(inDraft(state().drafts, 0)).toBe(true);
    expect(inDraft(state().drafts, 99)).toBe(true);
    // Frozen: no decision reaches the suggestion while Full edit is open.
    state().setHunkStatus('h-of', 'accepted');
    expect(state().review!.hunks[0]!.status).toBe('pending');
    // Nothing typed: Cancel closes it with no question, into Main.
    expect(await cancelFullEdit()).toBe(true);
    expect(mode()).toBe('main');
  });

  it('Done applies what was typed as the author s own hunks and says so', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth').replace('known.', 'known.\n\nShe had.'));
    expect(fullEditChanged(state().drafts)).toBe(true);
    expect(finishFullEdit()).toBe(true);
    expect(mode()).toBe('main');
    expect(composeReview(state().review!)).toBe(
      `${FRONT}\nIt was the fourth night of rain.\n\nShe should of known.\n\nShe had.\n\nThe lamp guttered.`
    );
    expect(state().notifications.map((n) => n.text)).toEqual([
      'Full edit: 2 changes added, already accepted.'
    ]);
    expect(
      state()
        .review!.hunks.filter((h) => h.source === 'manual')
        .map((h) => h.status)
    ).toEqual(['accepted', 'accepted']);
  });

  it('Done refuses, keeping the text, when the chapter changed on disk meanwhile', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    // The watcher reloads the same review onto a changed file: the box stays.
    const changed = {
      ...state().review!,
      base: { ...state().review!.base, text: TEXT.replace('lamp', 'candle') }
    };
    state().setReview(changed, null);
    expect(mode()).toBe('edit');
    expect(finishFullEdit()).toBe(false);
    expect(mode()).toBe('edit');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_CHANGED]);
    expect(fullEditDraft(state().drafts)?.text).toContain('fourth');
  });

  it('Cancel with typed text asks, Keep editing focused: Keep editing stays, Discard closes', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    let run = cancelFullEdit();
    await tick();
    expect(state().confirmSpec).toEqual(discardFullEditPrompt());
    state().answerChoice('cancel');
    expect(await run).toBe(false);
    expect(mode()).toBe('edit');
    run = cancelFullEdit();
    await tick();
    state().answerChoice('confirm');
    expect(await run).toBe(true);
    expect(mode()).toBe('main');
    expect(state().review!.hunks).toEqual(chapter().hunks);
  });

  it('does not open while a review of the chapter runs or a save is under way, and says why', async () => {
    useApp.setState({ aiBusyPath: SOURCE });
    expect(await chooseMode('edit')).toBe(false);
    expect(mode()).toBe('main');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_REVIEW]);
    useApp.setState({ aiBusyPath: null, chapterSaving: true });
    expect(await chooseMode('edit')).toBe(false);
    // One card under one key: the newer reason replaces the older.
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_SAVE]);
    useApp.setState({ chapterSaving: false });
    expect(state().openFullEdit()).toBeNull();
  });

  it('opens no paragraph box beside it, and says so', async () => {
    await chooseMode('edit');
    expect(state().openDraft(1)).toBe(false);
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_HOLDS_PARAGRAPHS]);
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });

  /* rr.2 review: the store's parts of opening and reopening Full edit, which
     no test held: each could be undone and the suite still passed. */
  it('closes an open suggestion editor as it opens, as its box takes the keys', () => {
    state().openEditor({ kind: 'suggestion', hunkId: 'h-of', initial: 'have', anchor: null });
    expect(state().editor).not.toBeNull();
    expect(state().openFullEdit()).toBeNull();
    expect(state().editor).toBeNull();
    expect(mode()).toBe('edit');
  });

  it('comes back from the drafts file into Full edit from Preview too, and closes into Main', async () => {
    await chooseMode('preview');
    const initial = fullEditText(TEXT, state().review!.hunks);
    expect(
      state().reopenDrafts([
        { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: `${initial} More.`, whole: true }
      ])
    ).toBe(1);
    expect(mode()).toBe('edit');
    expect(state().viewMode).toBe('main');
    const run = cancelFullEdit();
    await tick();
    state().answerChoice('confirm');
    expect(await run).toBe(true);
    expect(mode()).toBe('main');
  });

  /* rr.5 review: a chapter opened from Preview kept Preview over the boxes the
     drafts file put back, and their card said they were open again. A box
     with typed text opens the window in Main, where it shows; one left as it
     opened stays behind Preview, as a switch to Preview leaves it. */
  it('comes back from the drafts file into Main from Preview when a box holds typed text', async () => {
    await chooseMode('preview');
    expect(
      state().reopenDrafts([{ key: 1, paragraphs: [1], initial: 'She should of known.', text: 'She knew.' }])
    ).toBe(1);
    expect(mode()).toBe('main');
    expect(state().drafts[1]?.text).toBe('She knew.');
  });

  it('stays in Preview when the boxes that come back hold nothing typed', async () => {
    await chooseMode('preview');
    const box = { key: 1, paragraphs: [1], initial: 'She should of known.', text: 'She should of known.' };
    expect(state().reopenDrafts([box])).toBe(1);
    expect(mode()).toBe('preview');
    expect(state().drafts[1]).toEqual(box);
  });
});

/* rr.2 review: in Preview the review keys acted on suggestions the page did
   not show, a accepting one and e opening the suggestion editor over the
   page, and the arrows, taken to step through them, could not scroll it.
   The key handler asks `reviewKeysActive` before any of them, and returns
   before preventDefault when it says no (keyboard.test.ts), so the browser
   scrolls the page. */
describe('the review keys are Main s', () => {
  it('act in Main, and not in Preview or Full edit', async () => {
    expect(reviewKeysActive(state())).toBe(true);
    await chooseMode('preview');
    expect(reviewKeysActive(state())).toBe(false);
    await chooseMode('edit');
    expect(reviewKeysActive(state())).toBe(false);
    await cancelFullEdit();
    expect(mode()).toBe('main');
    expect(reviewKeysActive(state())).toBe(true);
  });
});

/* rr.2 review: another review of the chapter from the review selector or
   History, with Full edit open, closed Full edit with no question; its box,
   opened on this review's text, could not go back over another review that
   composes differently, so what was typed was set aside with a card saying
   the chapter no longer read as it did, which was untrue. It was refused
   then, as Review with AI and Submit manual review are. rr.5: the mode is the
   window's, so the other review opens in Full edit too, afresh; with typed
   text the question a switch out of Full edit asks comes first. */
describe('another review of the chapter while Full edit is open (rr.5)', () => {
  const deps = { save: () => Promise.resolve('saved' as const) };

  /** Leave for review-2, answer the question it asks with `choice`, and give back the question and the decision. */
  async function leaveAnswering(choice: ConfirmChoice | null) {
    const run = beforeLeaving({ kind: 'review', id: 'review-2' }, deps);
    await tick();
    const asked = state().confirmSpec;
    if (choice) state().answerChoice(choice);
    return { asked, decision: await run };
  }

  it('with typed text asks first; Cancel stays, with what was typed kept', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const typed = fullEditDraft(state().drafts)?.text;
    const { asked, decision } = await leaveAnswering('cancel');
    expect(asked).toEqual(fullEditOtherReviewPrompt());
    expect(decision).toBe('stay');
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toBe(typed);
    expect(state().review!.id).toBe('review-1');
    expect(state().notifications).toEqual([]);
  });

  it('Discard throws the text away and goes on, held in Full edit while the other review loads', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const { decision } = await leaveAnswering('alt');
    expect(decision).toBe('go');
    expect(fullEditDraft(state().drafts)).toBeNull();
    expect(state().review!.hunks).toEqual(chapter().hunks);
    // No Main drawn for the moments the other review takes to load.
    expect(mode()).toBe('edit');
    expect(state().fullEditPending).toBe('review-1');
  });

  it('opens Full edit again on the review still on screen when the other fails to open', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    await leaveAnswering('alt');
    // App's catch, with the review being left.
    state().openPendingFullEdit('review-1');
    expect(state().fullEditPending).toBeNull();
    expect(fullEditDraft(state().drafts)?.text).toBe(fullEditText(TEXT, chapter().hunks));
  });

  it('opens Full edit again on the review on screen when a later click took over meanwhile', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const run = beforeLeaving({ kind: 'review', id: 'review-2' }, deps);
    await tick();
    expect(state().confirmSpec).toEqual(fullEditOtherReviewPrompt());
    // A later click, on the review on screen, only flushes, and is now the last.
    expect(await beforeLeaving({ kind: 'review', id: 'review-1' }, deps)).toBe('here');
    state().answerChoice('alt');
    expect(await run).toBe('stay');
    expect(state().fullEditPending).toBeNull();
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toBe(fullEditText(TEXT, chapter().hunks));
  });

  it('Apply first applies it in this review, as Done does, and goes on', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const { decision } = await leaveAnswering('confirm');
    expect(decision).toBe('go');
    expect(fullEditDraft(state().drafts)).toBeNull();
    expect(mode()).toBe('edit');
    expect(state().fullEditPending).toBe('review-1');
    expect(composeReview(state().review!)).toContain('the fourth night');
    expect(state().notifications.map((n) => n.text)).toEqual([
      'Full edit: 1 change added, already accepted.'
    ]);
  });

  it('stays when Apply first cannot apply, with the card saying why', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const review = state().review!;
    state().setReview({ ...review, base: { ...review.base, text: TEXT.replace('lamp', 'candle') } }, null);
    const { decision } = await leaveAnswering('confirm');
    expect(decision).toBe('stay');
    expect(mode()).toBe('edit');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_CHANGED]);
  });

  it('with nothing typed goes on with no question, and the review on screen still only flushes', async () => {
    await chooseMode('edit');
    expect(await beforeLeaving({ kind: 'review', id: 'review-1' }, deps)).toBe('here');
    const { asked, decision } = await leaveAnswering(null);
    expect(asked).toBeNull();
    expect(decision).toBe('go');
    expect(state().notifications).toEqual([]);
    // The box stays until the other review replaces it, so nothing waits.
    expect(fullEditDraft(state().drafts)).not.toBeNull();
    expect(state().fullEditPending).toBeNull();
  });

  it('then opens the other review in Full edit, afresh, once what was kept is back', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    await leaveAnswering('alt');
    state().setReview({ ...chapter('review-2'), hunks: [] }, null, 'edit');
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)).toBeNull();
    state().openPendingFullEdit('review-2');
    expect(fullEditDraft(state().drafts)).toEqual({
      key: WHOLE_DRAFT_KEY,
      paragraphs: [],
      initial: fullEditText(TEXT, []),
      text: fullEditText(TEXT, []),
      whole: true
    });
  });

  it('opens as before, with no question, once Full edit is closed', async () => {
    expect(await beforeLeaving({ kind: 'review', id: 'review-2' }, deps)).toBe('go');
    expect(state().confirmSpec).toBeNull();
    expect(state().notifications).toEqual([]);
  });
});

/* rr.5: another chapter opens in the mode in use. Main and Preview are set as
   it comes on screen; Full edit waits for what was kept for that chapter, so
   a kept box goes first, and opens afresh once it is back. */
describe('Full edit across chapters (rr.5)', () => {
  const two = (id = 'review-2'): Review => chapter(id, TWO);
  const typedBox = {
    key: 1,
    paragraphs: [1],
    initial: 'She should of known.',
    text: 'She should have known.'
  };

  it('waits in Full edit with no box, then opens one afresh on the other chapter', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    state().setReview(two(), null, 'edit');
    expect(mode()).toBe('edit');
    expect(state().fullEditPending).toBe('review-2');
    expect(state().drafts).toEqual({});
    expect(state().viewMode).toBe('main');
    // Nothing of Main's acts meanwhile.
    expect(reviewKeysActive(state())).toBe(false);
    // What comes back for another review counts for nothing.
    state().openPendingFullEdit('review-1');
    expect(state().fullEditPending).toBe('review-2');
    expect(fullEditDraft(state().drafts)).toBeNull();
    state().openPendingFullEdit('review-2');
    expect(state().fullEditPending).toBeNull();
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toBe(fullEditText(TEXT, chapter().hunks));
    // It closes into Main, as ever.
    expect(await cancelFullEdit()).toBe(true);
    expect(mode()).toBe('main');
  });

  it('leaves what was typed in Full edit, back from the drafts file, as it was left', async () => {
    await chooseMode('edit');
    state().setReview(two(), null, 'edit');
    const initial = fullEditText(TEXT, chapter().hunks);
    state().reopenDrafts([
      { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: `${initial} More.`, whole: true }
    ]);
    state().openPendingFullEdit('review-2');
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toBe(`${initial} More.`);
  });

  it('keeps the window in Main when paragraph boxes with typed text come back', async () => {
    await chooseMode('edit');
    state().setReview(two(), null, 'edit');
    expect(state().reopenDrafts([typedBox])).toBe(1);
    state().openPendingFullEdit('review-2');
    expect(state().fullEditPending).toBeNull();
    expect(mode()).toBe('main');
    expect(state().drafts[1]?.text).toBe('She should have known.');
  });

  it('closes boxes that come back as they opened, and opens Full edit', async () => {
    await chooseMode('edit');
    state().setReview(two(), null, 'edit');
    expect(state().reopenDrafts([{ ...typedBox, text: typedBox.initial }])).toBe(1);
    state().openPendingFullEdit('review-2');
    expect(mode()).toBe('edit');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });

  it('stays in Main with the card while a review of the chapter runs or a save is under way', async () => {
    await chooseMode('edit');
    state().setReview(two(), null, 'edit');
    useApp.setState({ aiBusyPath: TWO });
    state().openPendingFullEdit('review-2');
    expect(mode()).toBe('main');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_REVIEW]);
    useApp.setState({ aiBusyPath: null, chapterSaving: true });
    state().setReview(chapter('review-3', THREE), null, 'edit');
    state().openPendingFullEdit('review-3');
    expect(mode()).toBe('main');
    expect(state().notifications.map((n) => n.text)).toEqual([FULL_EDIT_WAIT_FOR_SAVE]);
  });

  it('ends the wait when the author chooses Main or Preview, or opens a box, meanwhile', async () => {
    await chooseMode('edit');
    state().setReview(two(), null, 'edit');
    expect(await chooseMode('main')).toBe(true);
    expect(mode()).toBe('main');
    expect(state().fullEditPending).toBeNull();
    state().openPendingFullEdit('review-2');
    expect(mode()).toBe('main');

    state().setReview(chapter('review-3', THREE), null, 'edit');
    expect(await chooseMode('preview')).toBe(true);
    state().openPendingFullEdit('review-3');
    expect(mode()).toBe('preview');

    state().setReview(chapter('review-4', SOURCE), null, 'edit');
    expect(state().openDraft(1)).toBe(true);
    expect(mode()).toBe('main');
    state().openPendingFullEdit('review-4');
    expect(mode()).toBe('main');
    expect(fullEditDraft(state().drafts)).toBeNull();
  });

  it('keeps Full edit and what was typed through a reload of the same review', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    const review = state().review!;
    state().setReview({ ...review, base: { ...review.base, hash: 'h2' } }, null);
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.text).toContain('fourth');
    expect(state().fullEditPending).toBeNull();
  });

  it('opens a review with no chapter file in Main, having no drafts to wait for; no review ends the wait', async () => {
    await chooseMode('edit');
    state().setReview(chapter('review-2', ''), null, 'edit');
    expect(mode()).toBe('main');
    expect(state().fullEditPending).toBeNull();
    state().setReview(two('review-3'), null, 'edit');
    expect(state().fullEditPending).toBe('review-3');
    state().setReview(null);
    expect(state().fullEditPending).toBeNull();
  });
});

describe('switching with something typed (as leaving the chapter asks)', () => {
  it('from a changed Full edit: Cancel stays, Discard throws it away, Apply first applies it', async () => {
    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    let answer = await switchAnswering('preview', 'cancel');
    expect(answer.asked).toEqual(leaveFullEditPrompt('preview'));
    expect(answer.done).toBe(false);
    expect(mode()).toBe('edit');

    answer = await switchAnswering('preview', 'alt');
    expect(answer.done).toBe(true);
    expect(mode()).toBe('preview');
    expect(state().review!.hunks).toEqual(chapter().hunks);

    await chooseMode('edit');
    typeInFullEdit((t) => t.replace('third', 'fourth'));
    answer = await switchAnswering('main', 'confirm');
    expect(answer.asked).toEqual(leaveFullEditPrompt('main'));
    expect(mode()).toBe('main');
    expect(composeReview(state().review!)).toContain('fourth night');
  });

  it('from Full edit with nothing typed: no question', async () => {
    await chooseMode('edit');
    const answer = await switchAnswering('preview', null);
    expect(answer.asked).toBeNull();
    expect(mode()).toBe('preview');
  });

  it('into Full edit over changed paragraph boxes: Cancel stays, Apply first applies them, then opens', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She should have known.');
    let answer = await switchAnswering('edit', 'cancel');
    expect(answer.asked).toEqual(boxesBeforeFullEditPrompt(1));
    expect(answer.done).toBe(false);
    expect(Object.keys(state().drafts)).toEqual(['1']);
    answer = await switchAnswering('edit', 'confirm');
    expect(answer.done).toBe(true);
    expect(mode()).toBe('edit');
    expect(fullEditDraft(state().drafts)?.initial).toContain('She should have known.');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });

  it('into Full edit over boxes left as they opened: no question, and they close', async () => {
    state().openDraft(1);
    const answer = await switchAnswering('edit', null);
    expect(answer.asked).toBeNull();
    expect(mode()).toBe('edit');
    expect(changedParagraphCount(state().drafts)).toBe(0);
  });

  it('from Main to Preview over changed boxes: Keep for later leaves them in Main, Apply first applies them', async () => {
    state().openDraft(1);
    state().setDraftText(1, 'She should have known.');
    const answer = await switchAnswering('preview', 'alt');
    expect(answer.asked).toEqual(boxesBeforePreviewPrompt(1));
    expect(mode()).toBe('preview');
    expect(state().drafts[1]?.text).toBe('She should have known.');
    await chooseMode('main');
    expect(state().drafts[1]?.text).toBe('She should have known.');
    await switchAnswering('preview', 'cancel');
    expect(mode()).toBe('main');
    await switchAnswering('preview', 'confirm');
    expect(mode()).toBe('preview');
    expect(state().drafts).toEqual({});
    expect(composeReview(state().review!)).toContain('She should have known.');
  });
});

describe("Full edit's box counted where paragraph boxes are", () => {
  it('in the close and leave states, which name it once something is typed', async () => {
    await chooseMode('edit');
    expect(closeGuardStateOf(state()).changedParagraphs).toBe(0);
    expect('fullEdit' in closeGuardStateOf(state())).toBe(false);
    typeInFullEdit((t) => `${t} More.`);
    expect(closeGuardStateOf(state())).toMatchObject({ changedParagraphs: 1, fullEdit: true });
    expect(leaveStateOf(state())).toMatchObject({ changedParagraphs: 1, fullEdit: true });
  });

  it('for Ctrl+S, from inside its box', () => {
    expect(saveShortcutContext(state(), false, true).inFullEdit).toBe(true);
    expect('inFullEdit' in saveShortcutContext(state(), false)).toBe(false);
  });

  it('comes back from the drafts file into Full edit, and no box beside it', () => {
    const initial = fullEditText(TEXT, state().review!.hunks);
    const opened = state().reopenDrafts([
      { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text: `${initial} More.`, whole: true },
      { key: 1, paragraphs: [1], initial: 'She should of known.', text: 'x' }
    ]);
    expect(opened).toBe(1);
    expect(mode()).toBe('edit');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
  });
});

describe('the pieces in the page (source checks)', () => {
  const SRC = path.join(__dirname, '../../src');
  const read = (file: string): string => readFileSync(path.join(SRC, file), 'utf8');

  it('draws Full edit, Preview or Main in the one scroller, the find bar in Main only', () => {
    const app = read('renderer/App.tsx');
    expect(app).toMatch(
      /mode === 'edit' \? \(\s*<FullEdit review=\{review\} \/>\s*\) : mode === 'preview' \? \(\s*<PreviewPane review=\{review\} \/>\s*\) : \(\s*<ReviewPane/
    );
    expect(app).toContain("{review && mode === 'main' ? <FindBar /> : null}");
    expect(app).toContain('const mode = useApp(currentMode);');
    // rr.7: Full edit's foot right after the scroller, outside it, before the cards.
    expect(app).toMatch(
      /<\/main>\s*\{\/\*[^}]*\*\/\}\s*\{review && mode === 'edit' \? <FullEditFoot \/> : null\}\s*<NotificationCards/
    );
    // Ctrl+S from Done or Cancel says what it says from inside the text, as from a paragraph box's.
    expect(read('renderer/state/keyboard.ts')).toContain(
      "target?.closest('.fulledit, .fulledit__foot') != null"
    );
  });

  it('goes through chooseMode from the select, holding back the keys that would switch at every press', () => {
    const bar = read('renderer/components/ModeSelect.tsx');
    expect(bar).toContain('if (pickerHoldsKey(event)) event.preventDefault();');
    expect(bar).toContain('void chooseMode(target).then((switched) => {');
    expect(bar).toContain('value={mode}');
  });

  it("keeps each mode's place in the one scroller, put back before the frame is painted and held as it grows", () => {
    const hook = read('renderer/state/modePlaces.ts');
    expect(hook).toMatch(
      /useLayoutEffect\(\(\) => \{\s*const next = modePlace\(places\.current, chapter, mode\);/
    );
    expect(hook).toContain('if (next.top === null || !element) return;');
    expect(hook).toContain('const stop = holdPlace(element, next.top, browserWatch(element), () => {');
    expect(hook).toContain('return stop ?? undefined;');
    // The scroller's own moves while a place is held are not the author's.
    expect(hook).toMatch(
      /if \(holding\.current\) return;\s*places\.current\.tops\[places\.current\.mode\] = event\.currentTarget\.scrollTop;/
    );
    // The content's size, and the author's wheel, keys, presses and touches.
    expect(hook).toContain('for (const child of Array.from(scroller.children)) observer.observe(child);');
    expect(hook).toContain("const kinds = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const;");
  });

  it('hands the focus back to the page after a choice that lands in Main or Preview, as the review selector does', () => {
    const bar = read('renderer/components/ModeSelect.tsx');
    expect(bar).toContain(
      "if (switched && target !== 'edit' && document.activeElement === select) select.blur();"
    );
  });

  it("gives Full edit's box Escape for Cancel and Ctrl+Enter for Done", () => {
    const box = read('renderer/components/FullEdit.tsx');
    expect(box).toMatch(/event\.key === 'Escape'[\s\S]*void cancelFullEdit\(\)/);
    expect(box).toMatch(
      /event\.key === 'Enter' && \(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*finishFullEdit\(\)/
    );
  });

  /* rr.5: the mode in use at the click, taken before the question whose
     Apply and save first closes Full edit, is the mode the chapter or review
     opens in; Full edit opens once the drafts persistence has put back what
     was kept, and its box takes the focus when it opens, not when the empty
     view under it was drawn. */
  it('opens another chapter or review in the mode in use at the click', () => {
    const app = read('renderer/App.tsx');
    for (const [from, to] of [
      ['const openChapter = useCallback(', 'const openHistoryEntry = useCallback('],
      ['const openHistoryEntry = useCallback(', '/* ---------------- external changes']
    ] as const) {
      const open = app.slice(app.indexOf(from), app.indexOf(to));
      const taken = open.indexOf('const modeInUse = currentMode(useApp.getState());');
      expect(taken, from).toBeGreaterThan(-1);
      expect(taken, from).toBeLessThan(open.indexOf('await beforeLeaving('));
      const calls = open.match(/setReview\([^;]*;/g) ?? [];
      expect(calls.length, from).toBeGreaterThan(1);
      for (const call of calls) expect(call, from).toMatch(/,\s*modeInUse\s*\);$/);
    }
    // A review that fails to open puts back the Full edit held over the one on screen.
    const history = app.slice(app.indexOf('const openHistoryEntry = useCallback('));
    expect(history).toMatch(/const leaving = useApp\.getState\(\)\.review\?\.id \?\? null;\s*try \{/);
    expect(history).toMatch(
      /notify\('error', errorMessage\(err\), OPEN_CHAPTER_CARD\);[\s\S]{0,200}if \(leaving !== null && useApp\.getState\(\)\.review\?\.id === leaving\) \{\s*useApp\.getState\(\)\.openPendingFullEdit\(leaving\);/
    );
    const drafts = read('renderer/state/drafts.ts');
    expect(drafts).toContain(
      'void restore(review).then(() => useApp.getState().openPendingFullEdit(reviewId));'
    );
    const box = read('renderer/components/FullEdit.tsx');
    expect(box).toMatch(/const open = draft !== null;\s*useLayoutEffect\(\(\) => \{/);
    expect(box).toContain('if (!open || !area) return;');
    expect(box).toContain('}, [open]);');
  });
});

describe('the CSS of the three modes', () => {
  const CSS = readFileSync(path.join(__dirname, '../../src/renderer/styles/app.css'), 'utf8');
  const rule = (selector: string): string => {
    const at = CSS.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return CSS.slice(at, CSS.indexOf('}', at));
  };

  /* rr.6: the select left the strip above the prose for the toolbar's left,
     so the column has no strip and the prose starts at its top again. Where
     it stands in the toolbar is in toolbarMenu.render.test.ts, and its steps
     in chipsRow.test.ts. */
  it('draws no strip above the prose: the select is in the toolbar', () => {
    expect(CSS).not.toContain('.modebar');
    expect(rule('.mode-select')).toContain('flex: none;');
    expect(rule('.mode-select__label')).toContain('color: var(--ink-soft);');
  });

  /** A rule's own declarations, by property, its comments left out. */
  const decls = (selector: string): Map<string, string> => {
    const body = rule(selector);
    return new Map(
      body
        .slice(body.indexOf('{') + 1)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(';')
        .map((decl) => decl.split(':').map((part) => part.trim()))
        .filter((parts) => parts.length >= 2 && parts[0] !== '')
        .map(([property = '', ...value]): [string, string] => [property, value.join(':')])
    );
  };

  /** A rule's padding as [top, right, bottom, left], from its shorthand. */
  const padding = (selector: string): string[] => {
    const found = decls(selector).get('padding');
    if (found === undefined) throw new Error(`no padding in ${selector}`);
    const [top = '', right = top, bottom = top, left = right] = found.split(' ');
    return [top, right, bottom, left];
  };

  /* rr.4: Full edit's box and Preview's page sat to the left, as the rr.2
     review had them keep Main's 344 px margin for the notes free on the
     right, though neither has margin notes. Both are centred in the column
     now, with the same margin on each side, their text at the prose's 66ch
     at most. rr.7 made Full edit's box Preview's sheet (below). */
  it("centres Full edit's sheet and Preview's page in the column, at the prose's measure at most", () => {
    // The same padding on each side, and the rest shared out by the auto margins.
    expect(padding('.preview')).toEqual(['16px', '40px', '120px', '40px']);
    expect(decls('.preview__page').get('margin')).toBe('0 auto');
    expect(padding('.preview__page')).toEqual(['32px', '40px', '32px', '40px']);
    expect(padding('.fulledit')).toEqual(['16px', '40px', '16px', '40px']);
    expect(decls('.fulledit').get('margin')).toBe('0 auto');
    // 66ch of text: the page's 80 px of padding and 2 px of frame; Full edit's
    // column, which holds the sheet, counts in its own padding beside it, 40
    // px on each side or 16 in a narrow window, so the two sheets match.
    expect(decls('.preview__page').get('max-width')).toBe('calc(66ch + 82px)');
    expect(decls('.fulledit').get('max-width')).toBe(`calc(66ch + ${82 + 2 * 40}px)`);
    expect(decls('.body--narrow .fulledit').get('max-width')).toBe(`calc(66ch + ${82 + 2 * 16}px)`);
    // The measure is counted in the prose's typeface at the prose's size, as Main's is.
    for (const selector of ['.fulledit', '.preview__page']) {
      expect(decls(selector).get('font-family')).toBe('var(--font-prose)');
      expect(decls(selector).get('font-size')).toBe('17px');
    }
    expect(decls('.prose').get('max-width')).toBe('calc(66ch + 50px)');
    // None of Main's room for the margin notes is kept, at any width.
    for (const selector of ['.fulledit', '.preview', '.preview__page']) {
      expect(rule(selector)).not.toMatch(/344px|819px|clamp\(/);
    }
    // The narrow window's padding stays the same on each side too.
    for (const selector of ['.body--narrow .fulledit', '.body--narrow .preview']) {
      expect(decls(selector).get('padding-left')).toBe('16px');
      expect(decls(selector).get('padding-right')).toBe('16px');
    }
  });

  /* rr.7: Full edit is Preview's page, editable. Until rr.7 its text was a
     box with an --accent border on --editor-bg, the height of the column,
     which scrolled itself; the author found it "bland and out of place" and
     did not like its border. The sheet is Preview's now, and the text area in
     it has no box of its own: it fills the sheet, carries the sheet's margins
     as its padding and grows with the text, so the column scrolls, as
     Preview's does. The window measured the two sheets at the same place and
     size (PLAN rr.7's tick). */
  it("draws Full edit as Preview's sheet, editable, its text area with no box of its own (rr.7)", () => {
    const sheet = decls('.fulledit__page');
    const page = decls('.preview__page');
    // The same frame and paper as Preview's page.
    expect(sheet.get('border')).toBe('1px solid var(--border)');
    expect(sheet.get('border')).toBe(page.get('border'));
    expect(sheet.get('background')).toBe('var(--panel)');
    expect(sheet.get('background')).toBe(page.get('background'));
    // The page's margins round the text, and its line height.
    const area = decls('.fulledit__area');
    expect(padding('.fulledit__area')).toEqual(padding('.preview__page'));
    expect(area.get('font')).toBe('inherit');
    expect(area.get('line-height')).toBe(page.get('line-height'));
    expect(area.get('line-height')).toBe('1.6');
    // No box inside the sheet: no border, corner or glow of the area's own, on the sheet's paper.
    expect(area.get('border')).toBe('0');
    expect(area.get('border-radius')).toBe('0');
    expect(area.get('background')).toBe(sheet.get('background'));
    expect(area.has('box-shadow')).toBe(false);
    expect(area.get('resize')).toBe('none');
    expect(CSS).not.toMatch(/fulledit__area[^{]*\{[^}]*(editor-bg|--accent)/);
    // It fills the sheet, the sheet the column, and both grow with the text,
    // so the area has nothing to scroll and its bar's rounded corners went.
    // It stays a scroller, as a text area is by default: Chromium moves the
    // caret at Page Down only in one, and with `overflow: hidden` the key
    // scrolled the column and left the caret behind (the window found it).
    expect(area.get('flex')).toBe('1 0 auto');
    expect(area.get('field-sizing')).toBe('content');
    expect(area.get('overflow')).toBe('auto');
    expect(sheet.get('flex')).toBe('1 0 auto');
    expect(decls('.fulledit').get('min-height')).toBe('100%');
    // The scroller is a block here, so the sheet's column is at least its
    // height and grows past it (a stretched flex item stops at it).
    expect(decls('.center--edit').get('display')).toBe('block');
    expect(CSS).not.toMatch(/\.fulledit__area::-webkit-scrollbar/);
  });

  it("shows Full edit's focus as the caret and the sheet's edge, never a ring round the text (rr.7)", () => {
    // CLAUDE.md's fourth exception to the browser's ring; themeContrast.test.ts holds the edge to 3:1.
    expect([...decls('.fulledit__area:focus')]).toEqual([['outline', 'none']]);
    expect([...decls('.fulledit__page:focus-within')]).toEqual([['border-color', 'var(--sheet-focus)']]);
  });

  /* The foot is under the scroller, not in it (FullEditFoot, drawn by App
     after the scroller): a foot held at the scroller's foot by `position:
     sticky` made Chromium scroll the column to the foot's own place, at the
     chapter's end, when Tab reached Cancel. Its row lines up with the sheet:
     the same width counted in the same typeface, the same padding beside it,
     and the scroller's gutter kept on both. */
  it('draws the foot under the scroller, its row as wide as the sheet and under it (rr.7)', () => {
    const foot = decls('.fulledit__foot');
    expect(foot.has('position')).toBe(false);
    // A little room round the caret's line as it runs past the column's edges, and no more:
    // nothing stands over the scroller to keep the caret clear of.
    expect([...decls('.center--edit')]).toEqual([
      ['display', 'block'],
      ['scrollbar-gutter', 'stable'],
      ['scroll-padding-block', '16px']
    ]);
    expect(foot.get('flex')).toBe('0 0 auto');
    expect(foot.get('background')).toBe('var(--bg)');
    // The row: Preview's page's width at most, in the prose's typeface as the sheet's is counted.
    expect(foot.get('grid-template-columns')).toBe(
      `minmax(0, ${decls('.preview__page').get('max-width') ?? ''})`
    );
    expect(foot.get('justify-content')).toBe('center');
    expect(foot.get('font-family')).toBe(decls('.fulledit').get('font-family'));
    expect(foot.get('font-size')).toBe(decls('.fulledit').get('font-size'));
    // The column's padding beside it, 40 px or 16 in a narrow window, as beside the sheet.
    expect(padding('.fulledit__foot').filter((_, i) => i % 2 === 1)).toEqual(['40px', '40px']);
    expect(decls('.body--narrow .fulledit__foot').get('padding-left')).toBe('16px');
    expect(decls('.body--narrow .fulledit__foot').get('padding-right')).toBe('16px');
    // The gutter of the scroller's bar on both, kept whether the column scrolls or not.
    expect(foot.get('scrollbar-gutter')).toBe('stable');
    expect(foot.get('overflow')).toBe('hidden');
    expect(decls('.center--edit').get('scrollbar-gutter')).toBe('stable');
    // The words in the app's own typeface, the hint, then Cancel and Done on the right.
    expect(decls('.fulledit__foot-row').get('font-family')).toBe('var(--font-ui)');
    expect(decls('.fulledit__foot-row > button:first-of-type').get('margin-left')).toBe('auto');
  });

  it("draws Preview's paragraphs apart, a tight block's lines together, in the prose's serif", () => {
    expect(decls('.preview__page').get('font-family')).toBe('var(--font-prose)');
    expect(rule('.preview__page p')).toContain('margin: 0 0 1.2em;');
    expect(rule('.preview__page p.rr-tight')).toContain('margin-bottom: 0;');
  });
});
