import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { unsavedDecisionCount } from '../../src/shared/diff/compose';
import type { SaveRequest, SaveResponse } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { leavePrompt, type LeaveTarget } from '../../src/shared/ui/save';

import { beforeLeaving, confirmLeave, leaveStateOf, type LeaveDeps } from '../../src/renderer/state/leave';
import { saveChapter, type SaveDeps, type SaveOutcome } from '../../src/renderer/state/saveChapter';
import { useApp } from '../../src/renderer/state/store';

/* apply.7: the leave prompt before another chapter replaces the one on screen
   (PLAN 11.3 i, 7.7), and apply.26: another review of the open chapter, from
   History or the review selector, replaces it without a question. The words
   are tested in test/shared/save.test.ts; these check what each answer does. */

const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';
const SOURCE = 'C:/vault/Chapter 01.md';
const OTHER = 'C:/vault/Chapter 02.md';
const REVIEW_PATH = 'C:/reviews/chapter-01/2026-10-16.review.json';

function chapterReview(id = 'review-1', createdAt = '2026-10-16T09:00:00.000Z'): Review {
  return {
    ...createReview({
      sourcePath: SOURCE,
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
      generator: { kind: 'claude' }
    }),
    id,
    createdAt
  };
}

const toOther: LeaveTarget = { kind: 'chapter', path: OTHER };
const toOlder: LeaveTarget = { kind: 'review', id: 'review-0' };

/** A stand-in Save to chapter that answers with `outcome` and records each call. */
function deps(outcome: SaveOutcome | Promise<SaveOutcome> = 'saved') {
  const saves: unknown[] = [];
  const leave: LeaveDeps = {
    save: (options) => {
      saves.push(options);
      return Promise.resolve(outcome);
    }
  };
  return { leave, saves };
}

/** Save to chapter itself, writing through a stand-in `files:save`. */
function realSave(...replies: (SaveResponse | Promise<SaveResponse>)[]) {
  const requests: SaveRequest[] = [];
  const saveDeps: SaveDeps = {
    saveFile: (request) => {
      requests.push(request);
      const next = replies.shift();
      return next === undefined ? Promise.reject(new Error('no reply left')) : Promise.resolve(next);
    },
    writeReview: (_review, file) => Promise.resolve(file)
  };
  const leave: LeaveDeps = { save: (options) => saveChapter(options, saveDeps) };
  return { leave, requests, saveDeps };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const state = () => useApp.getState();

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({ drafts: {}, aiBusyPath: null, chapterSaving: false, editor: null });
  state().setReview(chapterReview(), REVIEW_PATH);
  state().clearNotifications();
});

describe('confirmLeave (apply.7)', () => {
  it('asks nothing, and goes, when nothing is unsaved', async () => {
    const d = deps();
    expect(await confirmLeave(toOther, d.leave)).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(d.saves).toEqual([]);
  });

  it("asks leavePrompt's question, with Keep for later focused", async () => {
    state().toggleAccepted('h1');
    const asked = confirmLeave(toOther, deps().leave);
    await tick();
    expect(state().confirmSpec).toEqual(leavePrompt(leaveStateOf(state()), toOther));
    expect(state().confirmSpec).toMatchObject({
      title: 'Leave Chapter 01?',
      confirmLabel: 'Save 1 change first',
      altLabel: 'Keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
    state().answerChoice('alt');
    await asked;
  });

  it('Keep for later goes without saving, and leaves the decisions and the boxes as they are', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const before = { review: state().review, drafts: state().drafts };
    const d = deps();
    const asked = confirmLeave(toOther, d.leave);
    await tick();
    expect(state().confirmSpec?.body.split('\n')).toEqual([
      '1 change is not saved to the chapter yet.',
      'Your decisions are kept in this review. The chapter file changes only when you press Save to chapter.',
      'The paragraph you are editing is kept as you left it and opens for editing again when you come back to this chapter.'
    ]);
    expect(state().confirmSpec?.confirmLabel).toBe('Apply and save first');
    state().answerChoice('alt');
    expect(await asked).toBe(true);
    expect(d.saves).toEqual([]);
    // Nothing is thrown away: App writes both before anything else is read (apply.1, apply.16).
    expect(state().review).toBe(before.review);
    expect(state().drafts).toBe(before.drafts);
  });

  it('Cancel and Escape stay, and change nothing', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const before = { review: state().review, drafts: state().drafts };
    const d = deps();
    const asked = confirmLeave(toOther, d.leave);
    await tick();
    state().answerChoice('cancel'); // Escape answers the same
    expect(await asked).toBe(false);
    expect(d.saves).toEqual([]);
    expect(state().review).toBe(before.review);
    expect(state().drafts).toBe(before.drafts);
  });

  it('a question that replaces this one stays', async () => {
    state().toggleAccepted('h1');
    const asked = confirmLeave(toOther, deps().leave);
    await tick();
    void state().askConfirm({ title: 'Something else?', body: 'b', confirmLabel: 'Yes' });
    expect(await asked).toBe(false);
  });

  it('Save first saves, applying boxes without a second question, and goes only when the file reads like the page', async () => {
    for (const [outcome, go] of [
      ['saved', true],
      ['nothing-to-save', true],
      ['failed', false],
      ['blocked', false],
      ['cancelled', false]
    ] as const) {
      state().setReview(chapterReview(), REVIEW_PATH);
      state().toggleAccepted('h1');
      const d = deps(outcome);
      const asked = confirmLeave(toOther, d.leave);
      await tick();
      state().answerChoice('confirm');
      expect(await asked).toBe(go);
      expect(d.saves).toEqual([{ applyDrafts: 'apply' }]);
    }
  });

  it('Save first writes the page, the open box applied, and the chapter then matches it', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const s = realSave({ status: 'written', hash: 'h2' });
    const asked = confirmLeave(toOther, s.leave);
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(s.requests.map((r) => r.text)).toEqual([
      'As he tilted his head aside, the man watched.\n\nShe said nothing.'
    ]);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    expect(state().drafts).toEqual({});
  });

  it('Save first that fails stays on the chapter, with the decisions still unsaved', async () => {
    state().toggleAccepted('h1');
    const s = realSave();
    const asked = confirmLeave(toOther, s.leave);
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(false);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
    expect(state().notifications.at(-1)?.text).toBe('no reply left');
  });

  it('asks nothing while a review of the chapter runs', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    expect(await confirmLeave(toOther, deps().leave)).toBe(true);
    expect(state().confirmSpec).toBeNull();
  });

  it('asks about a box with typed text only: one left as it opened is kept without a question', async () => {
    state().openDraft(1);
    expect(await confirmLeave(toOther, deps().leave)).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(Object.keys(state().drafts)).toEqual(['1']);
  });

  it('asks nothing before another review of the open chapter, whatever is unsaved (apply.26)', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const before = { review: state().review, drafts: state().drafts };
    const d = deps();
    expect(await confirmLeave(toOlder, d.leave)).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(d.saves).toEqual([]);
    // The decisions stay in this review and the box goes with the chapter (C.53).
    expect(state().review).toBe(before.review);
    expect(state().drafts).toBe(before.drafts);
  });
});

describe('beforeLeaving (apply.7)', () => {
  it('only flushes for the chapter or review already on screen, whatever is unsaved', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const d = deps();
    expect(await beforeLeaving({ kind: 'chapter', path: SOURCE }, d.leave)).toBe('here');
    expect(await beforeLeaving({ kind: 'chapter', path: 'C:\\vault\\Chapter 01.md' }, d.leave)).toBe('here');
    expect(await beforeLeaving({ kind: 'review', id: 'review-1' }, d.leave)).toBe('here');
    expect(state().confirmSpec).toBeNull();
    expect(d.saves).toEqual([]);
  });

  it('only flushes for the open chapter while an older review of it is on screen (apply.26)', async () => {
    // The chapter opens with the review last on screen, so it is open as it is.
    state().setReview(chapterReview('review-0', '2026-10-01T09:00:00.000Z'), REVIEW_PATH);
    state().toggleAccepted('h1');
    const d = deps();
    expect(await beforeLeaving({ kind: 'chapter', path: SOURCE }, d.leave)).toBe('here');
    expect(state().confirmSpec).toBeNull();
    expect(d.saves).toEqual([]);
  });

  it('goes to another review of the open chapter without a question, whatever is unsaved (apply.26)', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const d = deps();
    expect(await beforeLeaving(toOlder, d.leave)).toBe('go');
    expect(state().confirmSpec).toBeNull();
    expect(d.saves).toEqual([]);
  });

  it('lets a save under way end before another review opens, and lets only the last click go', async () => {
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const s = realSave(reply.promise);
    const saving = saveChapter({ applyDrafts: 'ask' }, s.saveDeps);
    await tick();
    const first = beforeLeaving(toOlder, s.leave);
    const second = beforeLeaving({ kind: 'review', id: 'review-2' }, s.leave);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await saving).toBe('saved');
    expect(await first).toBe('stay');
    expect(await second).toBe('go');
    expect(state().confirmSpec).toBeNull();
  });

  it('goes at once to another chapter when nothing is unsaved', async () => {
    expect(await beforeLeaving(toOther, deps().leave)).toBe('go');
    expect(state().confirmSpec).toBeNull();
  });

  it('goes on Keep for later and stays on Cancel', async () => {
    state().toggleAccepted('h1');
    const keep = beforeLeaving(toOther, deps().leave);
    await tick();
    state().answerChoice('alt');
    expect(await keep).toBe('go');
    const cancel = beforeLeaving(toOther, deps().leave);
    await tick();
    state().answerChoice('cancel');
    expect(await cancel).toBe('stay');
  });

  it('lets a save under way end first, and then asks nothing when it left nothing unsaved', async () => {
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const s = realSave(reply.promise);
    const saving = saveChapter({ applyDrafts: 'ask' }, s.saveDeps);
    await tick();
    let decided: string | null = null;
    const leaving = beforeLeaving(toOther, s.leave).then((d) => (decided = d));
    await tick();
    expect(decided).toBeNull();
    expect(state().confirmSpec).toBeNull();
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await saving).toBe('saved');
    await leaving;
    expect(decided).toBe('go');
    expect(state().confirmSpec).toBeNull();
  });

  it('lets only the last of several clicks go ahead', async () => {
    state().toggleAccepted('h1');
    const first = beforeLeaving(toOther, deps().leave);
    await tick();
    // A second question replaces the first, which answers cancel.
    const second = beforeLeaving({ kind: 'chapter', path: 'C:/vault/Chapter 03.md' }, deps().leave);
    expect(await first).toBe('stay');
    await tick();
    expect(state().confirmSpec?.title).toBe('Leave Chapter 01?');
    state().answerChoice('alt');
    expect(await second).toBe('go');
  });

  it('drops a Save first whose chapter was clicked away from while it saved', async () => {
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const s = realSave(reply.promise);
    const first = beforeLeaving(toOther, s.leave);
    await tick();
    state().answerChoice('confirm');
    await tick();
    expect(state().chapterSaving).toBe(true);
    // Another chapter clicked while the file is written: it waits for the save.
    const second = beforeLeaving({ kind: 'chapter', path: 'C:/vault/Chapter 03.md' }, s.leave);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await first).toBe('stay');
    expect(await second).toBe('go');
    expect(s.requests).toHaveLength(1);
    expect(state().confirmSpec).toBeNull();
  });

  it('stays when Save first could not save', async () => {
    state().toggleAccepted('h1');
    const asked = beforeLeaving(toOther, deps('failed').leave);
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe('stay');
  });
});

/* App's wiring. The tests run without a DOM; the window checks are in PLAN (apply.7). */
describe('the wiring (apply.7)', () => {
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const APP = withoutComments(readFileSync(path.join(__dirname, '../../src/renderer/App.tsx'), 'utf8'));
  const STORE = withoutComments(
    readFileSync(path.join(__dirname, '../../src/renderer/state/store.ts'), 'utf8')
  );
  const between = (from: string, to: string): string => {
    const start = APP.indexOf(from);
    return APP.slice(start, APP.indexOf(to, start));
  };

  it('asks before a chapter from the list, or the one New chapter made, replaces the page', () => {
    const open = between('const openChapter = useCallback(', 'const openHistoryEntry');
    expect(open).toContain("await beforeLeaving({ kind: 'chapter', path: file.path }, leaveDeps);");
    expect(open).toContain("if (decision === 'stay') return;");
    // New chapter opens what it made through the same path.
    expect(APP).toMatch(
      /onCreated=\{\(file\) => \{\s*setNewChapterOpen\(false\);\s*refreshFiles\(\);\s*openChapter\(file\);/
    );
  });

  it('opens a History or selector entry after a save under way, and records it as last on screen (apply.26)', () => {
    const open = between('const openHistoryEntry = useCallback(', 'useEffect(');
    expect(open).toContain("await beforeLeaving({ kind: 'review', id: summary.id }, leaveDeps);");
    expect(open).toContain("if (decision === 'stay') return;");
    // Main records it once it is on screen, under the chapter's path as open.
    const shown = open.indexOf("call('reviews:shown', { sourcePath, path: loaded.path })");
    expect(shown).toBeGreaterThan(open.lastIndexOf('setReview('));
  });

  it('writes what is waiting, then stops there for what is already open, before anything is read', () => {
    for (const open of [
      between('const openChapter = useCallback(', 'const openHistoryEntry'),
      between('const openHistoryEntry = useCallback(', 'useEffect(')
    ]) {
      const flush = open.search(/await flushReviewWrites\(\);\s+await flushDraftWrites\(\);/);
      const here = open.indexOf("if (decision === 'here') return;");
      expect(flush).toBeGreaterThan(open.indexOf('beforeLeaving('));
      expect(here).toBeGreaterThan(flush);
      expect(open.indexOf("call('files:read'")).toBeGreaterThan(here);
      expect(open.indexOf('setReview(')).toBeGreaterThan(here);
    }
  });

  it('dates a History row with the words the review selector uses', () => {
    const side = readFileSync(path.join(__dirname, '../../src/renderer/components/SidePanel.tsx'), 'utf8');
    expect(side).toContain('<span className="history__when">{historyWhen(entry.createdAt)}</span>');
    // The selector's entries come from reviewPicker, which dates them by historyWhen.
    expect(side).toContain('reviewPicker(history, activeReviewPath, review)');
    expect(side).toContain('onChange={(event) => chooseReview(event.target.value)}');
  });

  it('saves first through Save to chapter, and no longer reads History to ask', () => {
    expect(APP).toContain('const leaveDeps = useMemo<LeaveDeps>(() => ({ save }), [save]);');
    expect(APP).not.toContain('historyRef');
    expect(APP).not.toContain('Open the review from');
  });

  it('no longer offers to discard open paragraph boxes', () => {
    expect(APP).not.toContain('confirmLeaveDrafts');
    expect(APP).not.toContain('Discard paragraph edits');
    expect(APP).not.toContain('discardDrafts');
    expect(STORE).not.toContain('discardDrafts');
  });
});
