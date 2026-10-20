import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CloseGuardState } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import { closePrompt } from '../../src/shared/ui/save';
import {
  closeGuardStateOf,
  crashedPageState,
  installCloseGuard,
  prepareToLeaveApp,
  type CloseGuardIo,
  type PageWrites
} from '../../src/renderer/state/closeGuard';
import { createCrashPage, type CrashPageView, type CrashWrites } from '../../src/renderer/state/crashPage';
import { useApp } from '../../src/renderer/state/store';

/* hardening.4 review: what the page shown after a crash does as it opens,
   when no question is open and on Try again (`createCrashPage`), run in node
   with stand-ins for the IPC, the writers and the page's own parts.
   `CrashFallback` draws it: test/renderer/crash.render.test.ts, and its
   wiring in test/renderer/closeGuard.test.ts. */

const state = () => useApp.getState();
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await tick();
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const SOURCE = 'C:/vault/Chapter 01.md';

function review() {
  return createReview({
    sourcePath: SOURCE,
    base: { text: 'Tilting his head aside.', hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
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
  });
}

/** Main's side of the guard: what reached it, and its close request. */
function fakeIo() {
  const sent: string[] = [];
  const pushes: CloseGuardState[] = [];
  let closeRequested: () => void = () => undefined;
  const io: CloseGuardIo = {
    pushState: (s) => void pushes.push(s),
    sendStatus: (status) => void sent.push(status),
    sendDecision: (close) => void sent.push(`decision:${close}`),
    onCloseRequested: (listener) => {
      closeRequested = listener;
      return () => {
        closeRequested = () => undefined;
      };
    },
    onFlush: () => () => undefined
  };
  return { io, sent, pushes, requestClose: () => closeRequested() };
}

/** A writer that records its calls, holds a flush when told, and fails when told. */
function fakeWrites(name: string, calls: string[]) {
  const w = {
    failures: [] as string[],
    hold: null as { promise: Promise<void>; resolve: () => void } | null,
    writes: undefined as unknown as PageWrites
  };
  w.writes = {
    retry: () => void calls.push(`${name}.retry`),
    flush: async () => {
      calls.push(`${name}.flush`);
      const hold = w.hold;
      w.hold = null;
      if (hold) await hold.promise;
    },
    failures: () => w.failures
  };
  return w;
}

/** The page's own parts: what it was told to show, and where the focus is. */
function fakeView(focus: 'body' | 'elsewhere' = 'body') {
  const v = {
    shown: [] as CrashWrites[],
    focus: focus as 'body' | 'elsewhere' | 'reload',
    calls: [] as string[],
    view: undefined as unknown as CrashPageView
  };
  v.view = {
    setWrites: (writes) => {
      v.shown.push(writes);
      v.calls.push(writes.writing ? 'writing' : 'written');
    },
    focusReload: () => {
      v.focus = 'reload';
      v.calls.push('focus');
    },
    focusLost: () => v.focus === 'body'
  };
  return v;
}

function setup(focus: 'body' | 'elsewhere' = 'body') {
  const calls: string[] = [];
  const main = fakeIo();
  const close = fakeWrites('close', calls);
  const crash = fakeWrites('crash', calls);
  const v = fakeView(focus);
  const page = createCrashPage({ io: main.io, closeWrites: close.writes, writes: crash.writes }, v.view);
  return { calls, main, close, crash, v, page };
}

let undo: (() => void) | null = null;

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    persistPending: false,
    draftWritesPending: false
  });
  state().setReview(review(), 'C:/reviews/chapter-01/r.review.json');
  state().clearNotifications();
});

afterEach(async () => {
  for (let i = 0; i < 5 && state().confirmSpec; i += 1) {
    state().answerChoice('cancel');
    await settle();
  }
  undo?.();
  undo = null;
});

describe('createCrashPage, as the page opens', () => {
  it('writes both writers, failed writes queued again first, and shows them written', async () => {
    const s = setup();
    undo = s.page.open();
    expect(s.calls).toEqual(['crash.retry', 'crash.flush']);
    expect(s.v.shown).toEqual([]);
    await settle();
    expect(s.v.shown).toEqual([{ writing: false, failures: [] }]);
  });

  it('names a write that failed, in the words of its card, once', async () => {
    const s = setup();
    s.crash.failures = [
      'The review could not be saved: the disk is full.',
      'The review could not be saved: the disk is full.'
    ];
    undo = s.page.open();
    await settle();
    expect(s.v.shown).toEqual([
      { writing: false, failures: ['The review could not be saved: the disk is full.'] }
    ]);
  });

  it('takes the close guard over: pushes what a crashed page puts at risk, and answers a close itself, with no Save', async () => {
    state().toggleAccepted('h1');
    const s = setup();
    undo = s.page.open();
    expect(s.main.pushes).toEqual([crashedPageState(state())]);
    expect(s.main.pushes[0]?.unsavedDecisions).toBe(0);
    await settle();
    s.main.requestClose();
    await settle();
    expect(s.main.sent).toEqual(['received', 'decision:true']);
    // The close writes what a close writes, not only what the page wrote as it opened.
    expect(s.calls).toContain('close.flush');
  });

  it('asks a close about a running review in its own question, which offers no Save', async () => {
    state().toggleAccepted('h1');
    state().setAiBusy(SOURCE);
    const s = setup();
    undo = s.page.open();
    s.main.requestClose();
    await settle();
    expect(state().confirmSpec).toEqual(closePrompt(crashedPageState(state())));
    expect(state().confirmSpec?.confirmLabel).toBe('');
    state().answerChoice('cancel');
    await settle();
    expect(s.main.sent).toEqual(['received', 'prompting', 'decision:false']);
    state().setAiBusy(null);
  });

  it('ends a close the failed page held, answers its question Cancel, and gives Reload window the focus once it has gone', async () => {
    state().toggleAccepted('h1');
    const failed = fakeIo();
    const failedWrites = fakeWrites('failed', []);
    const uninstall = installCloseGuard({
      io: failed.io,
      writes: failedWrites.writes,
      save: () => Promise.resolve('saved'),
      cancelReview: () => undefined
    });
    const held = prepareToLeaveApp('close');
    await settle();
    expect(state().confirmSpec).toEqual(closePrompt(closeGuardStateOf(state())));
    uninstall();
    // The crash page's first render: the question is still in the store, so
    // the page under it is inert and no focus is given.
    const s = setup();
    undo = s.page.open();
    expect(state().confirmSpec).toBeNull();
    expect(await held).toBe(false);
    expect(failed.sent).toEqual(['received', 'prompting', 'decision:false']);
    // The next render has no question: the focus, lost with the failed page, goes to Reload window.
    s.page.noQuestion();
    expect(s.v.focus).toBe('reload');
  });

  it('a round of writes that ends after the page has gone shows nothing', async () => {
    const s = setup();
    const hold = deferred();
    s.crash.hold = hold;
    const close = s.page.open();
    close();
    hold.resolve();
    await settle();
    expect(s.v.shown).toEqual([]);
  });
});

describe('createCrashPage, the focus', () => {
  it('gives Reload window the focus when no question is open and the focus is on nothing', () => {
    const s = setup('body');
    s.page.noQuestion();
    expect(s.v.focus).toBe('reload');
  });

  it('leaves the focus where the author put it', () => {
    const s = setup('elsewhere');
    s.page.noQuestion();
    expect(s.v.focus).toBe('elsewhere');
    expect(s.v.calls).toEqual([]);
  });
});

describe('createCrashPage, Try again', () => {
  it('puts the focus on Reload window first, since the link goes with the failure, then writes again', async () => {
    const s = setup('elsewhere');
    s.crash.failures = ['The review could not be saved: the disk is full.'];
    undo = s.page.open();
    await settle();
    s.crash.failures = [];
    s.calls.length = 0;
    s.v.calls.length = 0;
    s.page.tryAgain();
    expect(s.v.calls).toEqual(['focus', 'writing']);
    expect(s.v.focus).toBe('reload');
    expect(s.calls).toEqual(['crash.retry', 'crash.flush']);
    await settle();
    expect(s.v.shown.at(-1)).toEqual({ writing: false, failures: [] });
  });

  it('shows only the latest round: an earlier one that ends later is not shown over it', async () => {
    const s = setup();
    const first = deferred();
    s.crash.hold = first;
    s.crash.failures = ['The review could not be saved: the disk is full.'];
    undo = s.page.open();
    s.page.tryAgain();
    await settle();
    expect(s.v.shown).toEqual([
      { writing: true },
      { writing: false, failures: ['The review could not be saved: the disk is full.'] }
    ]);
    s.crash.failures = [];
    first.resolve();
    await settle();
    expect(s.v.shown).toHaveLength(2);
  });
});
