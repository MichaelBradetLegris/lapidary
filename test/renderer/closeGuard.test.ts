import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unsavedDecisionCount } from '../../src/shared/diff/compose';
import type { CloseGuardState, SaveRequest, SaveResponse } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import type { ConfirmSpec } from '../../src/shared/ui/confirm';
import { closePrompt, needsAttention, stillWritingPrompt, WRITES_WAIT_MS } from '../../src/shared/ui/save';
import {
  closeGuardStateOf,
  crashedPageState,
  installCloseGuard,
  installCrashedPageGuard,
  prepareToLeaveApp,
  writeAfterCrash,
  type CloseGuardDeps,
  type PageWrites
} from '../../src/renderer/state/closeGuard';
import { createKeyedWriter } from '../../src/renderer/state/persist';
import { saveChapter, type SaveDeps, type SaveOutcome } from '../../src/renderer/state/saveChapter';
import { useApp } from '../../src/renderer/state/store';

/* apply.9: the close guard, page side (PLAN 7.7, 11.3 i). The words are
   tested in test/shared/save.test.ts and main's half in
   test/main/closeGuard.test.ts; these check what the page pushes, how it
   answers a close request, and what each answer does. */

const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';
const SOURCE = 'C:/vault/Chapter 01.md';
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

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const state = () => useApp.getState();
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** What reached main but the state pushes, which a store change in a test sends too. */
const toMain = (h: Harness): string[] => h.sent.filter((s) => s !== 'state');

/** Let the run reach its next question, or end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await tick();
}

interface Harness {
  deps: CloseGuardDeps;
  /** what reached main, in order */
  sent: string[];
  pushes: CloseGuardState[];
  saves: unknown[];
  cancels: number;
  flushes: number;
  retries: number;
  /** what `writes.failures()` answers */
  failures: string[];
  /** when set, the next flush waits for it */
  holdFlush: { promise: Promise<void>; resolve: () => void } | null;
  closeRequested: () => void;
  flushRequested: () => void;
  uninstall: () => void;
}

function harness(
  options: {
    save?: CloseGuardDeps['save'];
    /** a writer behind the stand-in, which still counts and holds its flushes */
    writes?: PageWrites;
    writesWaitMs?: number;
    /** what a close puts at risk, as the page shown after a crash reads it (hardening.4) */
    stateOf?: CloseGuardDeps['stateOf'];
  } = {}
): Harness {
  const h: Harness = {
    deps: undefined as unknown as CloseGuardDeps,
    sent: [],
    pushes: [],
    saves: [],
    cancels: 0,
    flushes: 0,
    retries: 0,
    failures: [],
    holdFlush: null,
    closeRequested: () => undefined,
    flushRequested: () => undefined,
    uninstall: () => undefined
  };
  const inner = options.writes;
  const writes: PageWrites = {
    flush: async () => {
      h.flushes += 1;
      const hold = h.holdFlush;
      h.holdFlush = null;
      if (hold) await hold.promise;
      if (inner) await inner.flush();
    },
    retry: () => {
      h.retries += 1;
      inner?.retry();
    },
    failures: () => (inner ? [...inner.failures(), ...h.failures] : h.failures)
  };
  h.deps = {
    io: {
      pushState: (s) => {
        h.pushes.push(s);
        h.sent.push('state');
      },
      sendStatus: (status) => void h.sent.push(status),
      sendDecision: (close) => void h.sent.push(`decision:${close}`),
      onCloseRequested: (listener) => {
        h.closeRequested = listener;
        return () => {
          h.closeRequested = () => undefined;
        };
      },
      onFlush: (listener) => {
        h.flushRequested = () => listener('session-end');
        return () => {
          h.flushRequested = () => undefined;
        };
      }
    },
    writes,
    save:
      options.save ??
      ((opts) => {
        h.saves.push(opts);
        return Promise.resolve('saved' as SaveOutcome);
      }),
    cancelReview: () => {
      h.cancels += 1;
    },
    ...(options.writesWaitMs !== undefined ? { writesWaitMs: options.writesWaitMs } : {}),
    ...(options.stateOf ? { stateOf: options.stateOf } : {})
  };
  h.uninstall = installCloseGuard(h.deps);
  return h;
}

/** Save to chapter itself, writing through a stand-in `files:save`. */
function realSave(...replies: SaveResponse[]) {
  const requests: SaveRequest[] = [];
  const saveDeps: SaveDeps = {
    saveFile: (request) => {
      requests.push(request);
      const next = replies.shift();
      return next === undefined ? Promise.reject(new Error('no reply left')) : Promise.resolve(next);
    },
    writeReview: (_review, file) => Promise.resolve(file)
  };
  return {
    save: (options: Parameters<CloseGuardDeps['save']>[0]) => saveChapter(options, saveDeps),
    requests
  };
}

let current: Harness | null = null;
function guard(options?: Parameters<typeof harness>[0]): Harness {
  current = harness(options);
  return current;
}

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    persistPending: false,
    draftWritesPending: false,
    dialogText: { 'new-chapter': false, 'manual-review': false }
  });
  state().setReview(chapterReview(), REVIEW_PATH);
  state().clearNotifications();
});

afterEach(async () => {
  vi.useRealTimers();
  // A run left with its question open is answered, so the next test starts clean.
  for (let i = 0; i < 5 && state().confirmSpec; i += 1) {
    state().answerChoice('cancel');
    await settle();
  }
  current?.uninstall();
  current = null;
});

describe('closeGuardStateOf (apply.9)', () => {
  it('counts what a close would put at risk from the store', () => {
    expect(closeGuardStateOf(state())).toEqual({
      chapter: SOURCE,
      unsavedDecisions: 0,
      changedParagraphs: 0,
      locked: false,
      reviewRunning: false,
      writesPending: false,
      dialogText: false
    });
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    state().setDialogText('manual-review', true);
    expect(closeGuardStateOf(state())).toMatchObject({
      unsavedDecisions: 1,
      changedParagraphs: 1,
      dialogText: true
    });
  });

  it('a review of this chapter is running and locks it; one of another chapter only runs', () => {
    state().setAiBusy(SOURCE);
    expect(closeGuardStateOf(state())).toMatchObject({ locked: true, reviewRunning: true });
    state().setAiBusy('C:/vault/Chapter 02.md');
    expect(closeGuardStateOf(state())).toMatchObject({ locked: false, reviewRunning: true });
  });

  it('counts review and paragraph writes and a Save to chapter under way as writes pending', () => {
    for (const patch of [{ persistPending: true }, { draftWritesPending: true }, { chapterSaving: true }]) {
      useApp.setState({ persistPending: false, draftWritesPending: false, chapterSaving: false, ...patch });
      expect(closeGuardStateOf(state()).writesPending).toBe(true);
    }
  });

  it('has no chapter with nothing open', () => {
    state().setReview(null);
    expect(closeGuardStateOf(state())).toMatchObject({ chapter: null, unsavedDecisions: 0 });
  });
});

describe('the state push (apply.9)', () => {
  it('pushes once as soon as it is installed, so a reloaded page is known at once', () => {
    const h = guard();
    expect(h.pushes).toEqual([closeGuardStateOf(state())]);
  });

  it('pushes a decision before the call that made it returns, so a close right after it knows', () => {
    const h = guard();
    state().toggleAccepted('h1');
    // No await: the push went out in the same task as the decision.
    expect(h.pushes.at(-1)).toMatchObject({ unsavedDecisions: 1 });
  });

  it('pushes again only when the state changes', () => {
    const h = guard();
    state().setHoveredHunk('h1');
    state().focusHunk('h1');
    expect(h.pushes).toHaveLength(1);
    state().toggleAccepted('h1');
    state().setHoveredHunk(null);
    expect(h.pushes).toHaveLength(2);
    // A new review object that counts the same changes nothing.
    state().patchReview((r) => ({ ...r }));
    expect(h.pushes).toHaveLength(2);
    state().toggleAccepted('h1');
    expect(h.pushes.map((p) => p.unsavedDecisions)).toEqual([0, 1, 0]);
  });

  it('pushes boxes, a running review, typed dialog text and writes as they change', () => {
    const h = guard();
    state().openDraft(1);
    expect(h.pushes).toHaveLength(1); // a box as it opened puts nothing at risk
    state().setDraftText(1, 'She said nothing.');
    state().setAiBusy(SOURCE);
    state().setDialogText('new-chapter', true);
    useApp.setState({ draftWritesPending: true });
    expect(h.pushes.slice(1)).toEqual([
      expect.objectContaining({ changedParagraphs: 1, locked: false }),
      expect.objectContaining({ locked: true, reviewRunning: true }),
      expect.objectContaining({ dialogText: true }),
      expect.objectContaining({ writesPending: true })
    ]);
  });

  it("pushes the suggestion editor's typed words, which the Setup screen keeps (setup.7 review)", () => {
    const h = guard();
    state().openEditor({ kind: 'suggestion', hunkId: 'h1', initial: 'As he tilted', anchor: null });
    expect(h.pushes).toHaveLength(1); // an editor as it opened puts nothing at risk
    state().setEditorText('He tilted');
    expect(h.pushes.at(-1)).toMatchObject({ dialogText: true });
    // Setup takes the panel off the page; the words still count.
    state().setSetupOpen(true);
    expect(closeGuardStateOf(state()).dialogText).toBe(true);
    state().setSetupOpen(false);
    state().closeEditor();
    expect(h.pushes.map((p) => p.dialogText)).toEqual([false, true, false]);
  });

  it('stops when uninstalled, and a new install pushes again', () => {
    const h = guard();
    h.uninstall();
    state().toggleAccepted('h1');
    expect(h.pushes).toHaveLength(1);
    const again = guard();
    expect(again.pushes).toEqual([expect.objectContaining({ unsavedDecisions: 1 })]);
  });
});

describe('prepareToLeaveApp, the close request (apply.9)', () => {
  it('says it has the request first, and closes at once with nothing to ask', async () => {
    const h = guard();
    h.sent.length = 0;
    h.closeRequested();
    expect(h.sent).toEqual(['received']);
    await settle();
    expect(state().confirmSpec).toBeNull();
    expect(h.sent).toEqual(['received', 'decision:true']);
    expect(h.flushes).toBe(1);
    expect(h.retries).toBe(1);
  });

  it("asks closePrompt's question once the writes are done, with Close, keep for later focused", async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.sent.length = 0;
    const hold = deferred();
    h.holdFlush = { promise: hold.promise, resolve: () => hold.resolve() };
    const run = prepareToLeaveApp('close');
    await settle();
    // Still writing: no question yet.
    expect(state().confirmSpec).toBeNull();
    hold.resolve();
    await settle();
    expect(state().confirmSpec).toEqual(closePrompt(closeGuardStateOf(state())));
    expect(state().confirmSpec).toMatchObject({
      title: 'Close Lapidary?',
      confirmLabel: 'Save 1 change and close',
      altLabel: 'Close, keep for later',
      cancelLabel: 'Cancel',
      defaultButton: 'alt'
    });
    expect(h.sent).toEqual(['received', 'prompting']);
    state().answerChoice('cancel');
    expect(await run).toBe(false);
  });

  it('Cancel keeps the window and changes nothing', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy('C:/vault/Chapter 02.md');
    const before = state().review;
    const h = guard();
    const run = prepareToLeaveApp('close');
    await settle();
    state().answerChoice('cancel');
    expect(await run).toBe(false);
    expect(h.sent.at(-1)).toBe('decision:false');
    expect(h.saves).toEqual([]);
    expect(h.cancels).toBe(0);
    expect(state().review).toBe(before);
  });

  it('Close, keep for later writes what is waiting again, stops a running review and closes', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy('C:/vault/Chapter 02.md');
    const h = guard();
    const run = prepareToLeaveApp('close');
    await settle();
    expect(h.flushes).toBe(1);
    expect(state().confirmSpec?.body).toContain('The review that is running will stop');
    state().answerChoice('alt');
    expect(await run).toBe(true);
    expect(h.saves).toEqual([]);
    expect(h.cancels).toBe(1);
    expect(h.flushes).toBe(2);
    expect(h.sent.at(-1)).toBe('decision:true');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
  });

  it('Save and close saves, applying boxes without a second question, and closes only when the file reads like the page', async () => {
    for (const [outcome, close] of [
      ['saved', true],
      ['nothing-to-save', true],
      ['failed', false],
      ['blocked', false]
    ] as const) {
      state().setReview(chapterReview(), REVIEW_PATH);
      state().toggleAccepted('h1');
      const saves: unknown[] = [];
      const h = guard({
        save: (options) => {
          saves.push(options);
          return Promise.resolve(outcome);
        }
      });
      const run = prepareToLeaveApp('close');
      await settle();
      state().answerChoice('confirm');
      expect(await run).toBe(close);
      expect(saves).toEqual([{ applyDrafts: 'apply' }]);
      expect(h.sent.at(-1)).toBe(`decision:${close}`);
      // Written once before the question, then after the save and, when it closes, once more.
      expect(h.flushes).toBe(close ? 3 : 2);
      h.uninstall();
    }
  });

  it('Apply, save and close writes the page with the open box applied, then closes', async () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const s = realSave({ status: 'written', hash: 'h2' });
    const h = guard({ save: s.save });
    const run = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.confirmLabel).toBe('Apply, save and close');
    state().answerChoice('confirm');
    expect(await run).toBe(true);
    expect(s.requests.map((r) => r.text)).toEqual([
      'As he tilted his head aside, the man watched.\n\nShe said nothing.'
    ]);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    expect(state().drafts).toEqual({});
    expect(h.sent.at(-1)).toBe('decision:true');
  });

  it('a Save and close that fails keeps the window, with the decision still unsaved and the card saying why', async () => {
    state().toggleAccepted('h1');
    const s = realSave();
    const h = guard({ save: s.save });
    const run = prepareToLeaveApp('close');
    await settle();
    state().answerChoice('confirm');
    expect(await run).toBe(false);
    expect(h.sent.at(-1)).toBe('decision:false');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
    expect(state().notifications.at(-1)?.text).toBe('no reply left');
  });

  it('lets a save under way end before it asks', async () => {
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const saveDeps: SaveDeps = {
      saveFile: () => reply.promise,
      writeReview: (_review, file) => Promise.resolve(file)
    };
    const saving = saveChapter({ applyDrafts: 'ask' }, saveDeps);
    const h = guard();
    const run = prepareToLeaveApp('close');
    await settle();
    expect(h.flushes).toBe(0);
    expect(state().confirmSpec).toBeNull();
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await saving).toBe('saved');
    await settle();
    // Saved: nothing is left to ask about.
    expect(h.flushes).toBe(1);
    expect(state().confirmSpec).toBeNull();
    expect(await run).toBe(true);
  });

  it('writes again what arrived while the writes ran, before closing with nothing to ask', async () => {
    const h = guard();
    h.sent.length = 0;
    const first = deferred();
    h.holdFlush = { promise: first.promise, resolve: () => first.resolve() };
    const run = prepareToLeaveApp('close');
    await settle();
    expect(h.flushes).toBe(1);
    // A dismissal while that write runs: the writer keeps it for its own 700 ms
    // and lets the flush end without it, so the store still counts it.
    state().toggleDismissed('h1');
    useApp.setState({ persistPending: true });
    const second = deferred();
    h.holdFlush = { promise: second.promise, resolve: () => second.resolve() };
    first.resolve();
    await vi.waitFor(() => expect(h.flushes).toBe(2));
    expect(toMain(h)).toEqual(['received']);
    useApp.setState({ persistPending: false });
    second.resolve();
    expect(await run).toBe(true);
    expect(toMain(h)).toEqual(['received', 'decision:true']);
    expect(state().confirmSpec).toBeNull();
  });

  it('with the real writer: a dismissal made while the last decision is written is on disk before the window goes', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const firstWrite = deferred();
    let held = false;
    const writer = createKeyedWriter<string>({
      delayMs: 700,
      write: async (_key, value) => {
        if (!held) {
          held = true;
          await firstWrite.promise;
        }
        written.push(value);
      },
      onPendingChange: (pending) => useApp.setState({ persistPending: pending })
    });
    const h = guard({
      writes: { flush: () => writer.flush(), retry: () => writer.retry(), failures: () => writer.failures() }
    });
    writer.schedule('review', 'A dismissed');
    await vi.advanceTimersByTimeAsync(700); // its write starts, and takes its time
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(0);
    writer.schedule('review', 'A and B dismissed');
    firstWrite.resolve();
    await vi.advanceTimersByTimeAsync(10); // well inside B's own 700 ms
    expect(written).toEqual(['A dismissed', 'A and B dismissed']);
    expect(await run).toBe(true);
    expect(h.sent.at(-1)).toBe('decision:true');
    expect(state().persistPending).toBe(false);
  });

  it('with the real writer: a write that fails is asked about at once, not tried round after round', async () => {
    vi.useFakeTimers();
    const writer = createKeyedWriter<string>({
      delayMs: 700,
      write: () => Promise.reject(new Error('the disk is full')),
      onPendingChange: (pending) => useApp.setState({ persistPending: pending })
    });
    const h = guard({
      writes: { flush: () => writer.flush(), retry: () => writer.retry(), failures: () => writer.failures() }
    });
    writer.schedule('review', 'A dismissed');
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(10);
    // The writer still counts the value as pending, since it is not on disk.
    expect(state().persistPending).toBe(true);
    expect(state().confirmSpec?.title).toBe('Still writing your decisions');
    expect(state().confirmSpec?.body).toContain('the disk is full');
    expect(h.flushes).toBe(1);
    state().answerChoice('alt'); // Close anyway
    expect(await run).toBe(true);
  });

  it('waits for a Save to chapter pressed while the writes ran, and then has nothing to ask', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const saveDeps: SaveDeps = {
      saveFile: () => reply.promise,
      writeReview: (_review, file) => Promise.resolve(file)
    };
    const h = guard();
    h.sent.length = 0;
    const hold = deferred();
    h.holdFlush = { promise: hold.promise, resolve: () => hold.resolve() };
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(0);
    const saving = saveChapter({ applyDrafts: 'ask' }, saveDeps);
    await vi.advanceTimersByTimeAsync(0);
    expect(state().chapterSaving).toBe(true);
    hold.resolve();
    await vi.advanceTimersByTimeAsync(10);
    // Not asked about the change the save is writing.
    expect(state().confirmSpec).toBeNull();
    expect(toMain(h)).toEqual(['received']);
    reply.resolve({ status: 'written', hash: 'h2' });
    expect(await saving).toBe('saved');
    await vi.advanceTimersByTimeAsync(10);
    expect(await run).toBe(true);
    expect(h.flushes).toBe(2);
    expect(state().confirmSpec).toBeNull();
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
  });

  it('a write the store still counts after every round runs out the time and asks, with the page free meanwhile', async () => {
    const h = guard({ writesWaitMs: 40 });
    h.sent.length = 0;
    useApp.setState({ persistPending: true });
    const run = prepareToLeaveApp('close');
    // Each round gives the page a task of its own, so its clock still runs.
    await vi.waitFor(() => expect(state().confirmSpec?.title).toBe('Still writing your decisions'));
    expect(h.flushes).toBeGreaterThan(1);
    const rounds = h.flushes;
    await new Promise((r) => setTimeout(r, 30));
    // The rounds stop with the time they were given.
    expect(h.flushes).toBe(rounds);
    useApp.setState({ persistPending: false });
    state().answerChoice('cancel'); // Wait
    expect(await run).toBe(true);
    expect(toMain(h)).toEqual(['received', 'prompting', 'decision:true']);
  });

  it('takes the place of a question already open, which stays as Cancel left it', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    const leave = state().askChoice({
      title: 'Leave Chapter 01?',
      body: 'b',
      confirmLabel: 'Save',
      altLabel: 'Keep'
    });
    const run = prepareToLeaveApp('close');
    expect(await leave).toBe('cancel');
    await settle();
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    state().answerChoice('cancel');
    expect(await run).toBe(false);
    expect(h.sent.at(-1)).toBe('decision:false');
  });

  it('ends a save waiting on its own question, rather than timing it out as still writing', async () => {
    vi.useFakeTimers();
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    const s = realSave({ status: 'written', hash: 'h2' });
    const saving = s.save({ applyDrafts: 'ask' });
    await vi.advanceTimersByTimeAsync(0);
    expect(state().confirmSpec?.title).toBe('Apply paragraph edits first?');
    const h = guard({ save: s.save });
    const run = prepareToLeaveApp('close');
    expect(await saving).toBe('cancelled');
    await vi.advanceTimersByTimeAsync(0);
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    expect(state().confirmSpec?.confirmLabel).toBe('Apply, save and close');
    expect(s.requests).toEqual([]);
    state().answerChoice('cancel');
    expect(await run).toBe(false);
    expect(h.sent.at(-1)).toBe('decision:false');
  });

  it('keeps the decisions in the review on screen, which the chapter opens with (apply.26)', async () => {
    state().toggleAccepted('h1');
    guard();
    const run = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.body.split('\n')).toEqual([
      '1 change is not saved to the chapter yet.',
      'Your decisions are kept in this review. The chapter file changes only when you press Save to chapter.'
    ]);
    state().answerChoice('cancel');
    await run;
  });

  it('answers a second request with its own receipt and shares the answer of the run under way', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.sent.length = 0;
    const first = prepareToLeaveApp('close');
    await settle();
    const second = prepareToLeaveApp('close');
    expect(second).toBe(first);
    expect(h.sent).toEqual(['received', 'prompting', 'received', 'prompting']);
    state().answerChoice('alt');
    expect(await first).toBe(true);
    expect(h.sent.filter((s) => s.startsWith('decision'))).toEqual(['decision:true']);
  });

  it('always answers, false when something goes wrong, and says so', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.deps.writes = {
      ...h.deps.writes,
      retry: () => {
        throw new Error('broken');
      }
    };
    expect(await prepareToLeaveApp('close')).toBe(false);
    expect(h.sent.at(-1)).toBe('decision:false');
    expect(state().notifications.at(-1)?.text).toBe('The window could not get ready to close: broken');
  });
});

describe('"Still writing your decisions" (apply.9)', () => {
  it('asks after 5 s of writing, Wait focused, and Wait gives the writes another 5 s', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    const h = guard();
    h.sent.length = 0;
    const hold = deferred();
    h.holdFlush = { promise: hold.promise, resolve: () => hold.resolve() };
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS - 1);
    expect(state().confirmSpec).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(state().confirmSpec).toEqual(stillWritingPrompt([], closeGuardStateOf(state())));
    expect(state().confirmSpec).toMatchObject({
      cancelLabel: 'Wait',
      altLabel: 'Close anyway',
      confirmLabel: ''
    });
    expect(h.sent).toEqual(['received', 'prompting']);
    // Wait: the same writes are given more time, and tried again.
    h.holdFlush = { promise: hold.promise, resolve: () => hold.resolve() };
    state().answerChoice('cancel');
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS - 1);
    expect(state().confirmSpec).toBeNull();
    hold.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    expect(h.flushes).toBe(2);
    expect(h.retries).toBe(2);
    state().answerChoice('alt');
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toBe(true);
  });

  it('Close anyway closes without the close prompt, stopping a running review', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    const h = guard();
    h.holdFlush = { promise: new Promise<void>(() => undefined), resolve: () => undefined };
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS);
    expect(state().confirmSpec?.body).toContain('The review that is running will stop');
    state().answerChoice('alt');
    expect(await run).toBe(true);
    expect(h.cancels).toBe(1);
    expect(h.sent.at(-1)).toBe('decision:true');
  });

  it('asks when a write fails, saying why, and Wait tries it again', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.failures = ['The review could not be saved: the disk is full.'];
    const run = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.title).toBe('Still writing your decisions');
    expect(state().confirmSpec?.body.split('\n')).toEqual([
      'Some of your decisions could not be written.',
      'The review could not be saved: the disk is full.',
      'Wait tries again. Close anyway closes the window now, and anything not yet written is lost.'
    ]);
    // Wait, and this time the write is made.
    h.failures = [];
    state().answerChoice('cancel');
    await settle();
    expect(h.retries).toBe(2);
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    state().answerChoice('cancel');
    expect(await run).toBe(false);
  });

  it('asks after Close, keep for later too, when the last writes fail', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    const run = prepareToLeaveApp('close');
    await settle();
    h.failures = ['The paragraphs you are editing could not be kept: the disk is full.'];
    state().answerChoice('alt');
    await settle();
    expect(state().confirmSpec?.title).toBe('Still writing your decisions');
    state().answerChoice('alt');
    expect(await run).toBe(true);
  });

  it('times a slow Save and close as it does the writes', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    const reply = deferred<SaveResponse>();
    const saveDeps: SaveDeps = {
      saveFile: () => reply.promise,
      writeReview: (_review, file) => Promise.resolve(file)
    };
    const h = guard({ save: (options) => saveChapter(options, saveDeps) });
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(0);
    state().answerChoice('confirm');
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS);
    expect(state().confirmSpec?.title).toBe('Still writing your decisions');
    // Wait, and the save ends: written, so the window closes.
    state().answerChoice('cancel');
    reply.resolve({ status: 'written', hash: 'h2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toBe(true);
    expect(h.sent.at(-1)).toBe('decision:true');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
  });
});

describe('Restart now and the end of a session (apply.9)', () => {
  it("prepareToLeaveApp('update') asks the same question but reports no close, and still answers", async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.sent.length = 0;
    const run = prepareToLeaveApp('update');
    await settle();
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    state().answerChoice('alt');
    expect(await run).toBe(true);
    expect(h.sent).toEqual(['decision:true']);
  });

  it("prepareToLeaveApp('update') resolves true at once with nothing at risk", async () => {
    const h = guard();
    h.sent.length = 0;
    expect(await prepareToLeaveApp('update')).toBe(true);
    expect(state().confirmSpec).toBeNull();
  });

  it('app:flush writes what is waiting, retrying what failed, and asks nothing', () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.sent.length = 0;
    h.flushRequested();
    expect(h.retries).toBe(1);
    expect(h.flushes).toBe(1);
    expect(state().confirmSpec).toBeNull();
    expect(h.sent).toEqual([]);
  });
});

/* hardening.4: once drawing the window has failed, the page shown in its place
   takes the guard over with `crashedPageState`. */
describe('after a crash (hardening.4)', () => {
  it('counts only a write not yet made and a review running, and names no chapter', () => {
    state().toggleAccepted('h1');
    state().openDraft(1);
    state().setDraftText(1, 'She said nothing.');
    state().setDialogText('manual-review', true);
    state().setAiBusy(SOURCE);
    useApp.setState({ persistPending: true });
    expect(crashedPageState(state())).toEqual({
      chapter: null,
      unsavedDecisions: 0,
      changedParagraphs: 0,
      locked: false,
      reviewRunning: true,
      writesPending: true,
      dialogText: false
    });
    state().setAiBusy(null);
    useApp.setState({ persistPending: false, draftWritesPending: false });
    expect(needsAttention(crashedPageState(state()))).toBe(false);
  });

  it('pushes that state as it takes the guard over, so a close with everything written goes at once', () => {
    state().toggleAccepted('h1');
    const h = guard({ stateOf: crashedPageState });
    expect(h.pushes).toEqual([crashedPageState(state())]);
    expect(needsAttention(h.pushes[0] ?? null)).toBe(false);
    // A write that starts is pushed, and so is its end.
    useApp.setState({ persistPending: true });
    useApp.setState({ persistPending: false });
    expect(h.pushes.map((p) => p.writesPending)).toEqual([false, true, false]);
  });

  it('answers a close by writing and closing, asking nothing and saving nothing', async () => {
    state().toggleAccepted('h1');
    const h = guard({ stateOf: crashedPageState });
    h.sent.length = 0;
    expect(await prepareToLeaveApp('close')).toBe(true);
    expect(toMain(h)).toEqual(['received', 'decision:true']);
    expect(h.flushes).toBeGreaterThan(0);
    expect(h.saves).toEqual([]);
  });

  it('asks Still writing when a write failed, in the words of its card, with no Save', async () => {
    state().toggleAccepted('h1');
    const h = guard({ stateOf: crashedPageState });
    h.failures = ['The review could not be saved: the disk is full.'];
    const run = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec).toEqual(stillWritingPrompt(h.failures, crashedPageState(state())));
    // Wait: tried again, and made.
    h.failures = [];
    state().answerChoice('cancel');
    expect(await run).toBe(true);
    expect(h.retries).toBe(2);
    expect(h.saves).toEqual([]);
  });

  it('asks before a running review is lost, with Close anyway and no Save', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    guard({ stateOf: crashedPageState });
    const run = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec).toEqual(closePrompt(crashedPageState(state())));
    expect(state().confirmSpec).toMatchObject({
      confirmLabel: '',
      altLabel: 'Close anyway',
      defaultButton: 'cancel'
    });
    state().answerChoice('cancel');
    expect(await run).toBe(false);
  });

  it('takes the guard over: answers the failed page its open question Cancel, and offers no Save', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    // The failed page had its close question up: main was told it was on screen.
    const held = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    h.uninstall();
    h.sent.length = 0;
    h.pushes.length = 0;
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: true }) };
    // Kept, as Cancel keeps it; the next close is this page's.
    expect(await held).toBe(false);
    expect(state().confirmSpec).toBeNull();
    expect(h.sent).toEqual(['state', 'decision:false']);
    expect(h.pushes).toEqual([crashedPageState(state())]);
    h.sent.length = 0;
    expect(await prepareToLeaveApp('close')).toBe(true);
    expect(toMain(h)).toEqual(['received', 'decision:true']);
    expect(h.saves).toEqual([]);
  });

  /** Every question put on screen from now on, until the returned function is called. */
  function questionsAsked(): { specs: ConfirmSpec[]; stop: () => void } {
    const specs: ConfirmSpec[] = [];
    const stop = useApp.subscribe((s, prev) => {
      if (s.confirmSpec && s.confirmSpec !== prev.confirmSpec) specs.push(s.confirmSpec);
    });
    return { specs, stop };
  }

  it('ends a close the failed page held at "Still writing": Wait goes no further, and nothing offers Save', async () => {
    state().toggleAccepted('h1');
    const h = guard();
    h.failures = ['The review could not be saved: the disk is full.'];
    const held = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.title).toBe('Still writing your decisions');
    // The write would now be made: on the failed page, Wait went on to the
    // close question, Save included, drawn by the crash page (review finding).
    h.failures = [];
    h.uninstall();
    const asked = questionsAsked();
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: true }) };
    const flushesAtTakeover = h.flushes;
    h.sent.length = 0;
    expect(await held).toBe(false);
    await settle();
    asked.stop();
    expect(asked.specs).toEqual([]);
    expect(state().confirmSpec).toBeNull();
    expect(h.saves).toEqual([]);
    expect(h.flushes).toBe(flushesAtTakeover);
    expect(toMain(h)).toEqual(['decision:false']);
    // An ended run is not a failure: no card says the window could not get ready.
    expect(state().notifications).toEqual([]);
    // The next close is the crash page's, and with everything written it goes at once.
    h.sent.length = 0;
    expect(await prepareToLeaveApp('close')).toBe(true);
    expect(toMain(h)).toEqual(['received', 'decision:true']);
    expect(h.saves).toEqual([]);
  });

  it('ends a close the failed page held in its write race at once, asking nothing after', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    const h = guard();
    const hold = deferred();
    h.holdFlush = { promise: hold.promise, resolve: () => hold.resolve() };
    const held = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state().confirmSpec).toBeNull();
    h.uninstall();
    const asked = questionsAsked();
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: true }) };
    h.sent.length = 0;
    // Answered without waiting out the rest of the 5 s.
    await vi.advanceTimersByTimeAsync(0);
    expect(await held).toBe(false);
    expect(toMain(h)).toEqual(['decision:false']);
    // The write it was waiting on ends, and the clock runs out: still nothing asked or saved.
    hold.resolve();
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS * 2);
    asked.stop();
    expect(asked.specs).toEqual([]);
    expect(state().confirmSpec).toBeNull();
    expect(h.saves).toEqual([]);
    expect(toMain(h)).toEqual(['decision:false']);
  });

  it('does not act on an answer that made the failed page fail: its Save is not run', async () => {
    // Save and close pressed, and drawing what that changed failed: React
    // shows the crash page, which takes the guard over, in the same task,
    // before the run reads the answer.
    state().toggleAccepted('h1');
    const h = guard();
    const held = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    state().answerChoice('confirm');
    h.uninstall();
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: true }) };
    expect(await held).toBe(false);
    await settle();
    expect(h.saves).toEqual([]);
    expect(h.cancels).toBe(0);
    expect(toMain(h).at(-1)).toBe('decision:false');
  });

  it("ends a close the failed page held while its Save and close ran, without waiting on that save's answer", async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    const reply = deferred<SaveOutcome>();
    const h = guard({ save: () => reply.promise });
    const held = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(state().confirmSpec?.title).toBe('Close Lapidary?');
    state().answerChoice('confirm');
    await vi.advanceTimersByTimeAsync(0);
    h.uninstall();
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: true }) };
    h.sent.length = 0;
    await vi.advanceTimersByTimeAsync(0);
    expect(await held).toBe(false);
    reply.resolve('saved');
    await vi.advanceTimersByTimeAsync(WRITES_WAIT_MS);
    expect(toMain(h)).toEqual(['decision:false']);
    expect(state().confirmSpec).toBeNull();
  });

  it('with nothing drawn to ask with, a close gives the writes their time and goes, asking nothing', async () => {
    vi.useFakeTimers();
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    const h = guard();
    h.uninstall();
    current = { ...h, uninstall: installCrashedPageGuard(h.deps.io, h.deps.writes, { questions: false }) };
    h.failures = ['The review could not be saved: the disk is full.'];
    h.sent.length = 0;
    const run = prepareToLeaveApp('close');
    await vi.advanceTimersByTimeAsync(0);
    expect(await run).toBe(true);
    expect(state().confirmSpec).toBeNull();
    // Never `prompting`: main's own box stays the way out while the writes run.
    expect(toMain(h)).toEqual(['received', 'decision:true']);
    expect(h.retries).toBeGreaterThan(0);
  });

  it('writeAfterCrash queues failed writes again, writes, and says what is still not on disk', async () => {
    const calls: string[] = [];
    let failures = ['The paragraphs you are editing could not be kept: the disk is full.'];
    const writes: PageWrites = {
      retry: () => void calls.push('retry'),
      flush: async () => {
        calls.push('flush');
        await Promise.resolve();
        failures = [];
      },
      failures: () => failures
    };
    expect(await writeAfterCrash(writes)).toEqual([]);
    expect(calls).toEqual(['retry', 'flush']);
    const throwing: PageWrites = {
      retry: () => undefined,
      flush: () => Promise.reject(new Error('gone')),
      failures: () => ['The review could not be saved: gone']
    };
    expect(await writeAfterCrash(throwing)).toEqual(['The review could not be saved: gone']);
    // The same words from both writers are said once.
    const twice: PageWrites = {
      retry: () => undefined,
      flush: () => Promise.resolve(),
      failures: () => ['x', 'x']
    };
    expect(await writeAfterCrash(twice)).toEqual(['x']);
  });
});

describe('the wiring (apply.9)', () => {
  const read = (file: string): string =>
    readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', file), 'utf8');
  const app = read('App.tsx');
  // The IPC and the writers moved to state/pageIo.ts with hardening.4, so the
  // page shown after a crash installs the guard with the same ones.
  const io = read('state/pageIo.ts');

  it('App installs the guard with the IPC channels and both writers', () => {
    expect(app).toContain('useEffect(() => installCloseGuard(closeDeps), [closeDeps]);');
    expect(app).toContain('io: CLOSE_GUARD_IO,');
    expect(app).toContain('writes: PAGE_WRITES,');
    expect(io).toContain("call('app:guard-state', state)");
    expect(io).toContain("call('app:close-status', { status })");
    expect(io).toContain("call('app:close-decision', { close })");
    expect(io).toContain("onMain('app:close-requested'");
    expect(io).toContain("onMain('app:flush'");
    // apply.12 adds the hint writes, so a hint Save and close puts away is on disk first,
    // and ui.6 the split's, so a split moved just before a close is kept.
    expect(io).toMatch(
      /Promise\.all\(\[flushReviewWrites\(\), flushDraftWrites\(\), flushHintWrites\(\), flushSplitWrites\(\)\]\)/
    );
    expect(io).toContain('retryReviewWrites();');
    expect(io).toContain('retryDraftWrites();');
    expect(io).toContain('[...reviewWriteFailures(), ...draftWriteFailures()]');
    expect(app).toContain('cancelReview');
  });

  it('the page shown after a crash writes both writers, and takes the guard over with the IPC and the writes a close makes', () => {
    // hardening.4 review: nothing else pins these, since CrashFallback's
    // effects never run in node; what they call is tested in crashPage.test.ts.
    const crashWrites = io.slice(
      io.indexOf('export const CRASH_WRITES'),
      io.indexOf('export const CRASH_PAGE')
    );
    expect(crashWrites).toContain('await Promise.all([flushReviewWrites(), flushDraftWrites()]);');
    expect(crashWrites).toContain('retry: () => PAGE_WRITES.retry(),');
    expect(crashWrites).toContain('failures: () => PAGE_WRITES.failures()');
    expect(io).toMatch(
      /export const CRASH_PAGE: CrashPageDeps = \{\s*io: CLOSE_GUARD_IO,\s*closeWrites: PAGE_WRITES,\s*writes: CRASH_WRITES\s*\};/
    );
    const fallback = read('components/CrashFallback.tsx');
    expect(fallback).toContain('export function CrashFallback({ onReload, deps = CRASH_PAGE }: Props)');
    expect(fallback).toMatch(
      /useEffect\(\(\) => \{\s*const page = createCrashPage\(deps, \{\s*setWrites,\s*focusReload: \(\) => reloadRef\.current\?\.focus\(FOCUS_WITH_RING\),\s*focusLost\s*\}\);\s*pageRef\.current = page;\s*const close = page\.open\(\);/
    );
    expect(fallback).toMatch(
      /useEffect\(\(\) => \{\s*if \(!questionOpen\) pageRef\.current\?\.noQuestion\(\);\s*\}, \[questionOpen\]\);/
    );
    expect(fallback).toContain('onClick={() => pageRef.current?.tryAgain()}');
    expect(fallback).toMatch(
      /className="primary"\s*ref=\{reloadRef\}\s*\{\.\.\.heldButton\(writes\.writing, reload\)\}/
    );
    expect(fallback).toContain('return active === null || active === document.body;');
    expect(fallback).toContain(
      'const FOCUS_WITH_RING: FocusOptions & { focusVisible: boolean } = { focusVisible: true };'
    );
  });

  it('the review writer says why it failed in its card words, and retries through the writer', () => {
    const source = read('state/reviewPersistence.ts');
    expect(source).toContain('writer.retry();');
    expect(source).toContain('return writer.failures().map(notSavedText);');
    expect(source).toContain("notify('error', notSavedText(message), 'review-save')");
  });

  it('every layout App returns has the question, with the page under it inert while it is open', () => {
    // The Setup screen can show with a review still open, and a close can ask
    // from there (apply.9 review): a layout without the dialog left the
    // question in the store and nothing on screen.
    const layouts = [...app.matchAll(/return \(\s*<div className="app-shell">([\s\S]*?)\r?\n {2,4}\);/g)].map(
      (m) => m[1] ?? ''
    );
    // The main layout, the Setup screen's and the card of a settings.json
    // that could not be read (hardening.15).
    expect(layouts).toHaveLength(3);
    for (const layout of layouts) {
      // The main layout's page is inert under a dialog too, and under a
      // question through `shellInert` (ui.4, test/shared/dialog.test.ts).
      // The card's layout takes it only from what it draws (hardening.15 review).
      expect(layout).toMatch(
        /<div className="app-shell__page" inert=\{(questionOpen|inert\.page|cardInert\.page)\}>/
      );
      expect(layout.match(/<ConfirmDialog \/>/g)).toHaveLength(1);
      expect(layout).toMatch(/<ConfirmDialog \/>\s*<\/div>\s*$/);
    }
    expect(layouts.some((layout) => layout.includes('<SetupScreen'))).toBe(true);
    expect(layouts.some((layout) => layout.includes('<SettingsUnreadable'))).toBe(true);
  });

  it('pushes in the same task: no await, timer or microtask before the send', () => {
    const source = read('state/closeGuard.ts');
    const push = source.slice(source.indexOf('const push = '), source.indexOf('push(useApp.getState());'));
    expect(push).toContain('deps.io.pushState(next);');
    expect(push).not.toMatch(/await|setTimeout|queueMicrotask|Promise\.resolve/);
  });
});
