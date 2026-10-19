import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftFile, DraftSaveRequest, SetAsideRequest, StoredDraft } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { draftsUnreadableCardText } from '../../src/shared/ui/drafts';
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
  /** when set, only this many more loads fail */
  failLoads: number | null;
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
    failLoad: null,
    failLoads: null
  };
  f.io = {
    load: async (sourcePath) => {
      f.loads.push(sourcePath);
      if (f.holdLoad) await new Promise<void>((resolve) => (f.release = resolve));
      if (f.failLoad && f.failLoads !== 0) {
        if (f.failLoads !== null) f.failLoads -= 1;
        throw new Error(f.failLoad);
      }
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

describe('what closing the window needs to know (apply.9)', () => {
  it('says why boxes whose write failed are not on disk, counts them as waiting, and writes them on retry', async () => {
    f.failSave = 'the disk is full';
    await show(chapter(ONE));
    state().openDraft(1);
    state().setDraftText(1, 'The rain came hard, and harder.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(persistence.failures()).toEqual([
      'The paragraphs you are editing could not be kept: the disk is full'
    ]);
    // Nothing is waiting to be written, but it is not on disk: a close must ask.
    expect(persistence.pending()).toBe(false);
    expect(state().draftWritesPending).toBe(true);

    f.failSave = null;
    persistence.retry();
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    expect(persistence.failures()).toEqual([]);
    expect(state().draftWritesPending).toBe(false);
  });

  it('says why a write held over an unreadable file is not made, until it can be', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(persistence.failures()).toEqual([draftsUnreadableCardText('it is locked')]);
    expect(state().draftWritesPending).toBe(true);

    f.failLoad = null;
    await persistence.flush();
    expect(persistence.failures()).toEqual([]);
    expect(state().draftWritesPending).toBe(false);
  });

  it('retry leaves a chapter alone when a newer write for it is waiting', async () => {
    f.failSave = 'the disk is full';
    await show(chapter(ONE));
    state().openDraft(1);
    state().setDraftText(1, 'The rain came.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    f.failSave = null;
    state().setDraftText(1, 'The rain came hard, and harder.');
    persistence.retry();
    await persistence.flush();
    expect(f.saves.map((s) => s.drafts.map((d) => d.text))).toEqual([
      ['The rain came.'],
      ['The rain came hard, and harder.']
    ]);
    expect(persistence.failures()).toEqual([]);
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

  it('takes the card away when the author leaves, after Keep for later or Save first', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    await show(chapter(ONE));
    expect(cards().map((card) => card.key)).toEqual([DRAFTS_RESTORED_CARD]);
    // Another chapter: the card was about the one left.
    await show(chapter(TWO));
    expect(cards()).toEqual([]);

    // Back, and on to another review of the same chapter whose text differs:
    // the box is set aside there, and only that card is left.
    await show(chapter(ONE));
    expect(cards().map((card) => card.key)).toEqual([DRAFTS_RESTORED_CARD]);
    await show(chapter(ONE, 'Another text altogether.', 'a-newer-review'));
    expect(cards().map((card) => card.key)).toEqual([undefined]);
    expect(cards()[0]?.action).toBe('reveal-drafts');
  });

  it('takes the card away once every box it names is applied or closed, and not before', async () => {
    const gateBox: StoredDraft = {
      key: 0,
      paragraphs: [0],
      initial: 'Mara waited by the gate.',
      text: 'Mara waited.'
    };
    f.files.set(ONE, kept(ONE, [gateBox, rainBox()]));
    await show(chapter(ONE));
    expect(cards().map((card) => card.text)).toEqual([
      'Paragraphs 1 and 2 are open for editing again, as you left them.'
    ]);
    // A box the card does not name, opened and closed, changes nothing.
    state().openDraft(2);
    state().cancelDraft(2);
    state().cancelDraft(0);
    expect(cards()).toHaveLength(1);
    // Applied, as Save first does with the last one.
    state().commitAllDrafts();
    expect(state().drafts).toEqual({});
    expect(cards()).toEqual([]);
  });

  it('puts boxes back on another review of the same chapter when the text agrees', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    await show(chapter(ONE, TEXT, 'a-newer-review'));
    expect(state().drafts).toEqual({ 1: rainBox() });
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.files.get(ONE)?.reviewId).toBe('a-newer-review');
  });

  it('writes what is waiting before it reads back, so a box closed just before a new review stays closed', async () => {
    await show(chapter(ONE));
    state().openDraft(1);
    state().setDraftText(1, 'The rain came hard, and harder.');
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    // Closed, and within the debounce a new review of the chapter comes on
    // screen without a leave (Submit manual review, or a model's result).
    state().cancelDraft(1);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS - 100);
    await show(chapter(ONE, TEXT, 'a-new-review'));
    expect(state().drafts).toEqual({});
    expect(f.files.has(ONE)).toBe(false);
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
        text: 'The paragraphs you left open in this chapter could not be read back: it is locked. Nothing is written over them, so what you type in this chapter is kept only once they can be read.',
        key: DRAFTS_SAVE_CARD,
        action: undefined,
        arg: undefined
      }
    ]);
  });

  it('writes nothing over a file it could not read, and keeps both sets once it can', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    const unreadCard = state().notifications;
    expect(unreadCard).toHaveLength(1);

    // Typed in while the file still cannot be read: it is read again, and nothing is written.
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.loads).toEqual([ONE, ONE]);
    expect(f.saves).toEqual([]);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    // The same failure again leaves the card as it was, not a new one per pause in typing.
    expect(state().notifications).toEqual(unreadCard);

    // Readable again: the next write reads it first and keeps what it held after the box on screen.
    f.failLoad = null;
    state().setDraftText(0, 'Mara waited there.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    const typed = {
      key: 0,
      paragraphs: [0],
      initial: 'Mara waited by the gate.',
      text: 'Mara waited there.'
    };
    expect(f.files.get(ONE)?.drafts).toEqual([typed, rainBox()]);
    expect(cards()).toEqual([
      {
        tone: 'info',
        text: 'The paragraphs you left open in this chapter could be read back after all. They are kept, and open for editing again the next time you come back to this chapter.',
        key: DRAFTS_RESTORED_CARD,
        action: undefined,
        arg: undefined
      }
    ]);
    // Read once, so later writes go straight to disk, still with what it held.
    state().cancelDraft(0);
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(f.loads).toHaveLength(3);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    // The card is about boxes that are not on screen, so closing one that is leaves it.
    expect(cards().map((card) => card.key)).toEqual([DRAFTS_RESTORED_CARD]);

    // And it comes back when the chapter does, its card replacing that one.
    await show(chapter(TWO));
    await show(chapter(ONE));
    expect(state().drafts).toEqual({ 1: rainBox() });
    expect(cards().map((card) => card.text)).toEqual([
      'Paragraph 2 is open for editing again, as you left it.'
    ]);
  });

  it('keeps a box typed in while the read was failing, without writing over the file', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    f.holdLoad = true;
    state().setReview(chapter(ONE), null);
    await vi.advanceTimersByTimeAsync(0);
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    f.holdLoad = false;
    f.release();
    await persistence.settled();
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS * 2);
    expect(f.saves).toEqual([]);
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    // Held, not dropped: it still counts as waiting to be written.
    expect(persistence.pending(ONE)).toBe(true);
    expect(state().draftWritesPending).toBe(true);
    await persistence.flush();
    expect(f.saves).toEqual([]);

    // Leaving flushes: the file is read first, then written with both.
    f.failLoad = null;
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([
      { key: 0, paragraphs: [0], initial: 'Mara waited by the gate.', text: 'Mara waited.' },
      rainBox()
    ]);
    expect(persistence.pending()).toBe(false);
    expect(state().draftWritesPending).toBe(false);
  });

  it('dismisses the card about an unreadable file once a later open reads it', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    await show(chapter(TWO));
    f.failLoad = null;
    await show(chapter(ONE));
    expect(state().drafts).toEqual({ 1: rainBox() });
    expect(cards().map((card) => card.key)).toEqual([DRAFTS_RESTORED_CARD]);
  });

  it('does not read the file back while a write for it is held', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    await vi.advanceTimersByTimeAsync(DRAFT_WRITE_DELAY_MS);
    expect(persistence.pending(ONE)).toBe(true);
    // A new review of the chapter: the held write is tried again and fails,
    // and the read just after it would have worked.
    f.failLoads = 1;
    const loads = f.loads.length;
    await show(chapter(ONE, TEXT, 'a-new-review'));
    expect(f.loads).toHaveLength(loads + 1);
    expect(state().drafts).toEqual({});
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    // The next flush reads it, and writes the held box with what it held.
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([
      { key: 0, paragraphs: [0], initial: 'Mara waited by the gate.', text: 'Mara waited.' },
      rainBox()
    ]);
  });

  it('does not let closing every box delete a file it could not read', async () => {
    f.files.set(ONE, kept(ONE, [rainBox()]));
    f.failLoad = 'it is locked';
    await show(chapter(ONE));
    state().openDraft(0);
    state().setDraftText(0, 'Mara waited.');
    // The last box closed (Cancel, then Discard), then the flush before the next chapter.
    state().cancelDraft(0);
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
    f.failLoad = null;
    state().openDraft(2);
    state().cancelDraft(2);
    await persistence.flush();
    expect(f.files.get(ONE)?.drafts).toEqual([rainBox()]);
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
    state().setDialogText('manual-review', true);
    expect(hasDialogText(state())).toBe(true);
    state().setDialogText('new-chapter', false);
    expect(hasDialogText(state())).toBe(true);
    const before = state().dialogText;
    state().setDialogText('manual-review', true);
    expect(state().dialogText).toBe(before);
    state().setDialogText('manual-review', false);
    expect(hasDialogText(state())).toBe(false);
    // The suggestion editor's words are read from its request (setup.7 review).
    useApp.setState({ editor: { kind: 'suggestion', hunkId: 'h1', initial: 'As he tilted', anchor: null } });
    expect(hasDialogText(state())).toBe(false);
    state().setEditorText('He tilted');
    expect(hasDialogText(state())).toBe(true);
    state().closeEditor();
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
      ['components/ManualReviewDialog.tsx', 'manual-review']
    ] as const) {
      const text = source(file);
      expect(text).toContain(`setDialogText('${sourceName}', typed)`);
      expect(text).toContain(`() => () => setDialogText('${sourceName}', false)`);
    }
  });

  it("keeps the suggestion editor's words in the store, so a panel taken off the page loses none (setup.7 review)", () => {
    const popover = source('components/EditPopover.tsx');
    expect(popover).toContain('const text = editorText(request);');
    expect(popover).toContain('onChange={(event) => setText(event.target.value)}');
    expect(popover).toContain('const setText = useApp((s) => s.setEditorText);');
    expect(popover).not.toContain('useState');
    expect(popover).not.toContain('setDialogText');
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
