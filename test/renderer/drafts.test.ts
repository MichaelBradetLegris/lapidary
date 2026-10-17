import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftFile, DraftSaveRequest, SetAsideRequest, StoredDraft } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import {
  DRAFT_WRITE_DELAY_MS,
  DRAFTS_RESTORED_CARD,
  DRAFTS_SAVE_CARD,
  createDraftPersistence,
  type DraftIo,
  type DraftPersistence
} from '../../src/renderer/state/drafts';
import { hasDialogText, useApp } from '../../src/renderer/state/store';

/* apply.16: paragraph boxes are written as they are typed in, come back when
   their chapter is on screen again, and are set aside when they cannot. */

const ONE = 'C:/vault/Chapter 01.md';
const TWO = 'C:/vault/Chapter 02.md';
const TEXT = 'Mara waited by the gate.\n\nThe rain came hard.\n\nShe went inside.';

function chapter(sourcePath: string, text = TEXT, id = `review-of-${sourcePath}`): Review {
  return {
    ...createReview({
      sourcePath,
      base: {
        text,
        hash: `hash-${text.length}-${text.slice(0, 12)}`,
        eol: 'lf',
        bom: false,
        trailingNewline: true
      },
      hunks: [],
      generator: { kind: 'file' }
    }),
    id
  };
}

const kept = (sourcePath: string, drafts: StoredDraft[]): DraftFile => ({
  version: 1,
  sourcePath,
  reviewId: 'old',
  savedAt: '2026-10-17T08:00:00.000Z',
  drafts
});

const rainBox = (text = 'The rain came hard, and harder.'): StoredDraft => ({
  key: 1,
  paragraphs: [1],
  initial: 'The rain came hard.',
  text
});

interface Fake {
  io: DraftIo;
  files: Map<string, DraftFile>;
  saves: DraftSaveRequest[];
  setAsides: SetAsideRequest[];
  loads: string[];
  /** set to hold the next load until `release` is called */
  holdLoad: boolean;
  release: () => void;
  failSetAside: string | null;
  failSave: string | null;
  failLoad: string | null;
}

function fake(): Fake {
  const f: Fake = {
    io: undefined as unknown as DraftIo,
    files: new Map(),
    saves: [],
    setAsides: [],
    loads: [],
    holdLoad: false,
    release: () => undefined,
    failSetAside: null,
    failSave: null,
    failLoad: null
  };
  f.io = {
    load: async (sourcePath) => {
      f.loads.push(sourcePath);
      if (f.holdLoad) await new Promise<void>((resolve) => (f.release = resolve));
      if (f.failLoad) throw new Error(f.failLoad);
      return f.files.get(sourcePath) ?? null;
    },
    save: (request) => {
      f.saves.push(structuredClone(request));
      if (f.failSave) return Promise.reject(new Error(f.failSave));
      if (request.drafts.length === 0) f.files.delete(request.sourcePath);
      else
        f.files.set(request.sourcePath, {
          ...kept(request.sourcePath, request.drafts),
          reviewId: request.reviewId
        });
      return Promise.resolve();
    },
    setAside: (request) => {
      f.setAsides.push(structuredClone(request));
      if (f.failSetAside) return Promise.reject(new Error(f.failSetAside));
      return Promise.resolve({ name: `Chapter 01 2026-10-17 10.00.0${f.setAsides.length}.txt` });
    }
  };
  return f;
}

const state = () => useApp.getState();
const cards = () =>
  state().notifications.map((n) => ({
    tone: n.tone,
    text: n.text,
    key: n.key,
    action: n.action,
    arg: n.actionArg
  }));

let f: Fake;
let persistence: DraftPersistence;
let uninstall: () => void;

/** Put a review on screen, as opening a chapter does, and let what it brings back settle. */
async function show(review: Review): Promise<void> {
  state().setReview(review, null);
  await persistence.settled();
}

beforeEach(() => {
  vi.useFakeTimers();
  state().answerChoice('cancel');
  useApp.setState({
    review: null,
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    draftWritesPending: false
  });
  state().clearNotifications();
  f = fake();
  persistence = createDraftPersistence(f.io);
  uninstall = persistence.install();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

describe('writing boxes as they are typed in', () => {
  it('writes 700 ms after the last change, and deletes the file when the last box closes', async () => {
    await show(chapter(ONE));
    expect(f.loads).toEqual([ONE]);
    state().openDraft(1);
    state().setDraftText(1, 'The rain came hard');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS - 1);
    state().setDraftText(1, 'The rain came hard, and harder.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS - 1);
    expect(f.saves).toEqual([]);
    expect(state().draftWritesPending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.saves).toEqual([{ sourcePath: ONE, reviewId: `review-of-${ONE}`, drafts: [rainBox()] }]);
    expect(state().draftWritesPending).toBe(false);

    state().cancelDraft(1);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.saves.at(-1)).toEqual({ sourcePath: ONE, reviewId: `review-of-${ONE}`, drafts: [] });
    expect(f.files.has(ONE)).toBe(false);
  });

  it('writes at once when flushed, as leaving a chapter does', async () => {
    await show(chapter(ONE));
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await persistence.flush();
    expect(f.saves.at(-1)?.drafts).toEqual([
      { key: 0, paragraphs: [0], initial: 'Mara waited by the gate.', text: 'Mara waited.' }
    ]);
    expect(persistence.pending()).toBe(false);
  });

  it('says once that boxes could not be kept, however often it fails', async () => {
    f.failSave = 'the disk is full';
    await show(chapter(ONE));
    state().openDraft(1);
    for (const text of ['a', 'ab', 'abc']) {
      state().setDraftText(1, text);
      await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    }
    expect(f.saves).toHaveLength(3);
    expect(cards()).toEqual([
      {
        tone: 'error',
        text: 'The paragraphs you are editing could not be kept: the disk is full',
        key: DRAFTS_SAVE_CARD,
        action: undefined,
        arg: undefined
      }
    ]);
  });
});

describe('bringing boxes back', () => {
  it('puts a box back when its chapter is on screen again, and says so', async () => {
    await show(chapter(ONE));
    state().openDraft(1);
    state().setDraftText(1, 'The rain came hard, and harder.');
    await persistence.flush();

    // Another chapter: nothing is written for either, and nothing comes back.
    await show(chapter(TWO));
    expect(state().drafts).toEqual({});
    expect(f.saves).toHaveLength(1);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);

    // The first chapter again, read from disk as a new object.
    await show(chapter(ONE));
    expect(f.loads).toEqual([ONE, TWO, ONE]);
    expect(state().drafts).toEqual({ 1: rainBox() });
    expect(cards()).toEqual([
      {
        tone: 'info',
        text: 'Paragraph 2 is open for editing again, as you left it.',
        key: DRAFTS_RESTORED_CARD,
        action: undefined,
        arg: undefined
      }
    ]);
  });

  it('puts boxes back on another review of the same chapter when the text agrees', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    await show(chapter(ONE, TEXT, 'a-newer-review'));
    expect(state().drafts).toEqual({ 1: rainBox() });
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.get(ONE)?.reviewId).toBe('a-newer-review');
  });

  it('does not read the file again when the same review is reloaded after a change on disk', async () => {
    await show(chapter(ONE));
    state().openDraft(1);
    const reloaded = chapter(ONE, `${TEXT}\n\nA new last line.`);
    await show(reloaded);
    expect(f.loads).toEqual([ONE]);
    expect(Object.keys(state().drafts)).toEqual(['1']);
  });

  it('sets aside a typed box whose paragraph changed, with a card that opens the file', async () => {
    f.files.set(
      ONE,
      kept(ONE, [rainBox(), { key: 2, paragraphs: [2], initial: 'She went in.', text: 'She went in.' }])
    );
    await show(chapter(ONE, TEXT.replace('came hard', 'fell hard')));
    expect(state().drafts).toEqual({});
    expect(f.setAsides).toEqual([{ sourcePath: ONE, drafts: [rainBox()] }]);
    expect(cards()).toEqual([
      {
        tone: 'warn',
        text: 'Paragraph 2 no longer reads as it did when you left it open for editing, so its box was not reopened. What you typed is kept in Chapter 01 2026-10-17 10.00.01.txt.',
        key: undefined,
        action: 'reveal-drafts',
        arg: 'Chapter 01 2026-10-17 10.00.01.txt'
      }
    ]);
    // Set aside and dropped, nothing is left to keep for the chapter.
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.has(ONE)).toBe(false);
  });

  it('keeps a box it could not set aside in every write, and tries again at the next open', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failSetAside = 'access is denied';
    const changed = TEXT.replace('came hard', 'fell hard');
    await show(chapter(ONE, changed));
    expect(cards()).toEqual([
      {
        tone: 'error',
        text: 'Paragraph 2 no longer reads as it did when you left it open for editing, and what you typed could not be set aside: access is denied. It is still kept, and is tried again the next time you open this chapter.',
        key: undefined,
        action: undefined,
        arg: undefined
      }
    ]);
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.get(ONE)?.drafts).toEqual([
      { key: 0, paragraphs: [0], initial: 'Mara waited by the gate.', text: 'Mara waited.' },
      rainBox()
    ]);
    // Closing every box still keeps it.
    state().cancelDraft(0);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);

    f.failSetAside = null;
    await show(chapter(TWO));
    await show(chapter(ONE, changed));
    expect(f.setAsides).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.has(ONE)).toBe(false);
  });

  it('holds writes while the file is read, so a box opened meanwhile cannot replace it', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.holdLoad = true;
    state().setReview(chapter(ONE), null);
    await vi.advanceTimersByTimeAsync(0);
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS * 2);
    expect(f.saves).toEqual([]);
    f.release();
    await persistence.settled();
    expect(Object.keys(state().drafts)).toEqual(['0', '1']);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.get(ONE)?.drafts.map((d) => d.key)).toEqual([0, 1]);
  });

  it('leaves the file alone when it cannot be read', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.saves).toEqual([]);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    expect(cards()).toEqual([
      {
        tone: 'error',
        text: 'The paragraphs you left open in this chapter could not be read back: it is locked.',
        key: DRAFTS_SAVE_CARD,
        action: undefined,
        arg: undefined
      }
    ]);
  });

  it('leaves the file for next time when the author has moved on before it was read', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.holdLoad = true;
    state().setReview(chapter(ONE), null);
    await vi.advanceTimersByTimeAsync(0);
    f.holdLoad = false;
    state().setReview(chapter(TWO), null);
    f.release();
    await persistence.settled();
    expect(state().drafts).toEqual({});
    expect(f.setAsides).toEqual([]);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
  });
});

describe('the store', () => {
  it('reopens kept boxes, skipping one whose paragraphs a box already covers', () => {
    state().setReview(chapter(ONE), null);
    state().openDraft(1);
    const opened = state().reopenDrafts([
      { key: 0, paragraphs: [0], initial: 'a', text: 'b' },
      { key: 1, paragraphs: [1], initial: 'c', text: 'd' }
    ]);
    expect(opened).toBe(1);
    expect(state().drafts[0]).toEqual({ key: 0, paragraphs: [0], initial: 'a', text: 'b' });
    expect(state().drafts[1]?.text).toBe('The rain came hard.');
  });

  it('knows when a dialog holds typed text, from any of the three', () => {
    expect(hasDialogText(state())).toBe(false);
    state().setDialogText('new-chapter', true);
    state().setDialogText('edit-popover', true);
    expect(hasDialogText(state())).toBe(true);
    state().setDialogText('new-chapter', false);
    expect(hasDialogText(state())).toBe(true);
    const before = state().dialogText;
    state().setDialogText('edit-popover', true);
    expect(state().dialogText).toBe(before);
    state().setDialogText('edit-popover', false);
    state().setDialogText('manual-review', true);
    state().setDialogText('manual-review', false);
    expect(hasDialogText(state())).toBe(false);
  });

  it('carries what a card button acts on only with the button', () => {
    state().notify('warn', 'Set aside.', undefined, 'reveal-drafts', 'Ch 2026-10-17 10.00.00.txt');
    state().notify('info', 'Plain.', undefined, undefined, 'ignored');
    expect(cards()).toEqual([
      {
        tone: 'warn',
        text: 'Set aside.',
        key: undefined,
        action: 'reveal-drafts',
        arg: 'Ch 2026-10-17 10.00.00.txt'
      },
      { tone: 'info', text: 'Plain.', key: undefined, action: undefined, arg: undefined }
    ]);
  });
});

/* The components have no DOM in these tests, so their wiring is read from the source. */
const source = (file: string): string =>
  readFileSync(path.join(__dirname, '../../src/renderer', file), 'utf8');

describe('the wiring', () => {
  it('asks before Escape or Cancel throws away a changed box', () => {
    const editor = source('components/ParagraphEditor.tsx');
    expect(editor).toMatch(/discardDraftPrompt\(draft\.paragraphs\)/);
    expect(editor).toMatch(/event\.key === 'Escape'[\s\S]{0,120}close\(\);/);
    expect(editor).toMatch(/<button type="button" onClick=\{close\}>\s*Cancel/);
    expect(editor).toMatch(/if \(draft\.text === draft\.initial\) \{\s*cancel\(draft\.key\);/);
  });

  it('tells the store when each dialog holds typed text, and clears it on close', () => {
    for (const [file, sourceName] of [
      ['components/NewChapterDialog.tsx', 'new-chapter'],
      ['components/ManualReviewDialog.tsx', 'manual-review'],
      ['components/EditPopover.tsx', 'edit-popover']
    ] as const) {
      const text = source(file);
      expect(text).toContain(`setDialogText('${sourceName}', typed)`);
      expect(text).toContain(`() => () => setDialogText('${sourceName}', false)`);
    }
  });

  it('keeps boxes from the start, and writes them before another chapter or review opens', () => {
    const app = source('App.tsx');
    expect(app).toContain('useEffect(() => installDraftPersistence(DRAFT_IO), []);');
    expect(app).toContain("load: (sourcePath) => call('drafts:load', { sourcePath })");
    // In both openChapter and openHistoryEntry, before anything is read back.
    expect(app.match(/await flushReviewWrites\(\);\s+await flushDraftWrites\(\);/g)).toHaveLength(2);
    expect(app.indexOf('await flushDraftWrites();')).toBeLessThan(app.indexOf("call('files:read'"));
    expect(app).toMatch(/\{ target: 'drafts', \.\.\.\(arg \? \{ name: arg \} : \{\}\) \}/);
    expect(source('components/NotificationCards.tsx')).toContain('onAction(action, note.actionArg)');
  });
});
