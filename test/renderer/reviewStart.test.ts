import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { composeReview, unsavedDecisionCount } from '../../src/shared/diff/compose';
import { diffToHunks } from '../../src/shared/diff/wordDiff';
import type { SaveRequest, SaveResponse } from '../../src/shared/ipc';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { historyWhen } from '../../src/shared/ui/history';
import {
  manualBuildPrompt,
  notSavedLines,
  replaceReviewPrompt,
  reviewWithoutPrompt
} from '../../src/shared/ui/save';
import {
  buildManualReview,
  fileReadsLikePage,
  reviewWithoutSaving,
  saveThenReview,
  type SaveFn
} from '../../src/renderer/state/reviewStart';
import {
  SAVE_CARD,
  saveChapter,
  type SaveDeps,
  type SaveOutcome
} from '../../src/renderer/state/saveChapter';
import { useApp } from '../../src/renderer/state/store';

/* apply.20: no stranded decisions. A new review starts from the chapter file
   and replaces the review on screen, so Review with AI saves first ("Save N
   changes, then review") or asks ("Review without them"), and Submit manual
   review asks Save then build, Build without them or Cancel. The words are
   tested in test/shared/save.test.ts; these check what each answer does. */

const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';
const SAVED = 'As he tilted his head aside, the man watched.\n\nShe said nothing at all.';
const SOURCE = 'C:/vault/Chapter 01.md';
const REVIEW_PATH = 'C:/reviews/chapter-01/2026-10-16.review.json';
const CREATED = '2026-10-16T09:00:00.000Z';

function chapterReview(): Review {
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
        },
        {
          id: 'h2',
          start: 58,
          end: 65,
          baseSide: 'original',
          original: ' at all',
          replacement: '',
          paragraph: 1,
          category: 'redundancy',
          reason: 'Padding.',
          source: 'claude',
          status: 'pending',
          anchor: 'exact'
        }
      ],
      generator: { kind: 'claude' }
    }),
    id: 'review-1',
    createdAt: CREATED
  };
}

/** A stand-in Save to chapter that answers with `outcome` and records each call. */
function fakeSave(outcome: SaveOutcome = 'saved') {
  const calls: unknown[] = [];
  const save: SaveFn = (options) => {
    calls.push(options);
    return Promise.resolve(outcome);
  };
  return { save, calls };
}

/** Save to chapter itself, writing through a stand-in `files:save`. */
function realSave(...replies: SaveResponse[]) {
  const requests: SaveRequest[] = [];
  const deps: SaveDeps = {
    saveFile: (request) => {
      requests.push(request);
      const next = replies.shift();
      return next === undefined ? Promise.reject(new Error('no reply left')) : Promise.resolve(next);
    },
    writeReview: (_review, file) => Promise.resolve(file)
  };
  const save: SaveFn = (options) => saveChapter(options, deps);
  return { save, requests };
}

/** What a started review would be given: the review on screen when `start` runs. */
function starter() {
  const started: Review[] = [];
  return {
    start: () => {
      const review = useApp.getState().review;
      if (review) started.push(review);
    },
    started
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const state = () => useApp.getState();
const open = () => true;

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({ drafts: {}, aiBusyPath: null, chapterSaving: false, editor: null });
  state().setReview(chapterReview(), REVIEW_PATH);
  state().clearNotifications();
});

describe('fileReadsLikePage (apply.20)', () => {
  it('is true only for saved and nothing-to-save', () => {
    expect(fileReadsLikePage('saved')).toBe(true);
    expect(fileReadsLikePage('nothing-to-save')).toBe(true);
    expect(fileReadsLikePage('cancelled')).toBe(false);
    expect(fileReadsLikePage('blocked')).toBe(false);
    expect(fileReadsLikePage('failed')).toBe(false);
  });
});

describe('Save N changes, then review (apply.20)', () => {
  for (const outcome of ['saved', 'nothing-to-save'] as const) {
    it(`starts the review after a save that ends ${outcome}`, async () => {
      const s = fakeSave(outcome);
      const r = starter();
      expect(await saveThenReview({ save: s.save, start: r.start, stillWanted: open })).toBe(true);
      expect(s.calls).toEqual([{ applyDrafts: 'ask' }]);
      expect(r.started).toHaveLength(1);
    });
  }

  for (const outcome of ['cancelled', 'blocked', 'failed'] as const) {
    it(`starts nothing after a save that ends ${outcome}`, async () => {
      const s = fakeSave(outcome);
      const r = starter();
      expect(await saveThenReview({ save: s.save, start: r.start, stillWanted: open })).toBe(false);
      expect(s.calls).toHaveLength(1);
      expect(r.started).toEqual([]);
    });
  }

  it('starts nothing when the dialog was closed while the save ran', async () => {
    const r = starter();
    let wanted = true;
    const save: SaveFn = () => {
      wanted = false; // Cancel or Escape during the write
      return Promise.resolve('saved');
    };
    expect(await saveThenReview({ save, start: r.start, stillWanted: () => wanted })).toBe(false);
    expect(r.started).toEqual([]);
  });

  it('writes the file first, and the review starts from the saved text', async () => {
    state().toggleAccepted('h1');
    const s = realSave({ status: 'written', hash: 'h-saved' });
    const order: string[] = [];
    const save: SaveFn = async (options) => {
      order.push('save');
      return s.save(options);
    };
    const r = starter();
    const start = (): void => {
      order.push('start');
      r.start();
    };
    expect(await saveThenReview({ save, start, stillWanted: open })).toBe(true);
    expect(order).toEqual(['save', 'start']);
    expect(s.requests.map((q) => q.text)).toEqual([SAVED]);
    expect(r.started).toHaveLength(1);
    const base = r.started[0]!.base;
    expect(base.text).toBe(SAVED);
    expect(base.hash).toBe('h-saved');
    expect(unsavedDecisionCount(r.started[0]!.hunks)).toBe(0);
    expect(state().notifications.at(-1)?.text).toBe('Saved to the chapter file.');
  });

  it('starts nothing when the real save fails, and the changes stay unsaved', async () => {
    state().toggleAccepted('h1');
    const s = realSave();
    const r = starter();
    expect(await saveThenReview({ save: s.save, start: r.start, stillWanted: open })).toBe(false);
    expect(r.started).toEqual([]);
    expect(state().review?.base.hash).toBe('h1');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
  });
});

/* apply.20 review: a save that does not reach the file says why on cards in
   the corner of the manuscript pane, under the dialog's backdrop, where they
   could not be read or closed. The dialog is handed what they said. */
describe('what a save that did not reach the file said, for the dialog (apply.20 review)', () => {
  /** Records each call of `onNotSaved`. */
  function told() {
    const calls: string[][] = [];
    return { onNotSaved: (lines: string[]) => calls.push(lines), calls };
  }

  it('hands Review with AI the card of the failed save, under a line saying the review has not started', async () => {
    state().toggleAccepted('h1');
    const t = told();
    const r = starter();
    expect(await saveThenReview({ save: realSave().save, start: r.start, stillWanted: open, ...t })).toBe(
      false
    );
    expect(t.calls).toEqual([
      ['The review has not started, because the changes were not saved.', 'no reply left']
    ]);
    expect(t.calls[0]).toEqual(notSavedLines('review', ['no reply left']));
    expect(r.started).toEqual([]);
  });

  it('gives only the cards the save put up, the save card it replaced included, not older ones', async () => {
    state().toggleAccepted('h1');
    state().notify('info', 'OpenAI suggested 6 changes and 3 comments.');
    state().notify('info', 'Saved to the chapter file.', SAVE_CARD);
    const t = told();
    await saveThenReview({ save: realSave().save, start: starter().start, stillWanted: open, ...t });
    expect(t.calls).toEqual([notSavedLines('review', ['no reply left'])]);
    // The cards themselves stay, for when the dialog has closed.
    expect(state().notifications.map((n) => n.text)).toEqual([
      'OpenAI suggested 6 changes and 3 comments.',
      'no reply left'
    ]);
  });

  it('says why a blocked save stopped: a review of the chapter running', async () => {
    state().toggleAccepted('h1');
    useApp.setState({ aiBusyPath: SOURCE });
    const t = told();
    await saveThenReview({ save: realSave().save, start: starter().start, stillWanted: open, ...t });
    expect(t.calls).toEqual([notSavedLines('review', ['Wait for the review to finish, then save.'])]);
  });

  it('says nothing after Cancel to applying paragraph boxes, which the author answered', async () => {
    const t = told();
    await saveThenReview({
      save: fakeSave('cancelled').save,
      start: starter().start,
      stillWanted: open,
      ...t
    });
    expect(t.calls).toEqual([[]]);
  });

  it('tells nothing after a save that reached the file, or once the dialog has closed', async () => {
    const t = told();
    for (const outcome of ['saved', 'nothing-to-save'] as const) {
      await saveThenReview({ save: fakeSave(outcome).save, start: starter().start, stillWanted: open, ...t });
    }
    state().toggleAccepted('h1');
    await saveThenReview({ save: realSave().save, start: starter().start, stillWanted: () => false, ...t });
    expect(t.calls).toEqual([]);
  });

  it('hands Submit manual review the card of the failed save, under a line saying the review was not built', async () => {
    state().toggleAccepted('h1');
    const t = told();
    const built: string[] = [];
    const asked = buildManualReview({
      save: realSave().save,
      build: () => built.push('built'),
      stillWanted: open,
      ...t
    });
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(false);
    expect(t.calls).toEqual([
      ['The review was not built, because the changes were not saved.', 'no reply left']
    ]);
    expect(built).toEqual([]);
  });

  it('tells Submit manual review nothing once it has closed, or for Build without them', async () => {
    state().toggleAccepted('h1');
    const t = told();
    const closed = buildManualReview({
      save: realSave().save,
      build: () => {},
      stillWanted: () => false,
      ...t
    });
    await tick();
    state().answerChoice('confirm');
    expect(await closed).toBe(false);
    const without = buildManualReview({ save: realSave().save, build: () => {}, stillWanted: open, ...t });
    await tick();
    state().answerChoice('alt');
    expect(await without).toBe(true);
    expect(t.calls).toEqual([]);
  });
});

describe('Review without them (apply.20)', () => {
  it('asks first, with Cancel focused, and Cancel starts nothing', async () => {
    state().toggleAccepted('h1');
    state().toggleAccepted('h2');
    const r = starter();
    const asked = reviewWithoutSaving({ start: r.start, stillWanted: open });
    await tick();
    expect(state().confirmSpec).toEqual(reviewWithoutPrompt(2, historyWhen(CREATED)));
    expect(state().confirmSpec?.defaultButton).toBe('cancel');
    state().answerChoice('cancel');
    expect(await asked).toBe(false);
    expect(r.started).toEqual([]);
  });

  it('starts from the chapter file as it is when the author says so, writing nothing', async () => {
    state().toggleAccepted('h1');
    const r = starter();
    const asked = reviewWithoutSaving({ start: r.start, stillWanted: open });
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(true);
    expect(r.started).toHaveLength(1);
    expect(r.started[0]!.base.text).toBe(CHAPTER);
    // The change is still on the page and in the review, not in the file.
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
  });

  it('starts without asking when nothing is unsaved by then', async () => {
    const r = starter();
    expect(await reviewWithoutSaving({ start: r.start, stillWanted: open })).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(r.started).toHaveLength(1);
  });

  it('starts nothing when a question replaced it, or the dialog has gone', async () => {
    state().toggleAccepted('h1');
    const r = starter();
    const asked = reviewWithoutSaving({ start: r.start, stillWanted: open });
    await tick();
    void state().askConfirm({ title: 'Another question', body: '', confirmLabel: 'OK' });
    expect(await asked).toBe(false);
    state().answerChoice('cancel');

    const gone = reviewWithoutSaving({ start: r.start, stillWanted: () => false });
    await tick();
    state().answerChoice('confirm');
    expect(await gone).toBe(false);
    expect(r.started).toEqual([]);
  });
});

describe('Submit manual review: Save then build, Build without them, Cancel (apply.20)', () => {
  /** A build that records the base it was made against, as the dialog's does. */
  function builder() {
    const built: string[] = [];
    return { build: () => built.push(state().review!.base.text), built };
  }

  it('asks the three-way question when something is unsaved, Save then build focused', async () => {
    state().toggleAccepted('h1');
    const b = builder();
    const asked = buildManualReview({ save: fakeSave().save, build: b.build, stillWanted: open });
    await tick();
    expect(state().confirmSpec).toEqual(manualBuildPrompt(1, historyWhen(CREATED)));
    expect(state().confirmSpec).toMatchObject({
      confirmLabel: 'Save 1 change, then build',
      altLabel: 'Build without it',
      cancelLabel: 'Cancel',
      defaultButton: 'confirm'
    });
    state().answerChoice('cancel');
    expect(await asked).toBe(false);
    expect(b.built).toEqual([]);
  });

  it('Save then build writes the file first and builds against the saved text', async () => {
    state().toggleAccepted('h1');
    const s = realSave({ status: 'written', hash: 'h-saved' });
    const b = builder();
    const asked = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(true);
    expect(s.requests.map((q) => q.text)).toEqual([SAVED]);
    expect(b.built).toEqual([SAVED]);
    expect(state().review?.base.hash).toBe('h-saved');
  });

  it('Save then build offers the old words back where the pasted text lacks the change, as the question says', async () => {
    state().toggleAccepted('h1');
    const s = realSave({ status: 'written', hash: 'h-saved' });
    // Corrected elsewhere from the file as it was, without the author's change.
    const corrected = CHAPTER.replace('nothing at all', 'nothing');
    let hunks: { original: string; replacement: string }[] = [];
    const build = (): void => {
      hunks = diffToHunks(state().review!.base.text, corrected).map((h) => ({
        original: h.original,
        replacement: h.replacement
      }));
    };
    const asked = buildManualReview({ save: s.save, build, stillWanted: open });
    await tick();
    expect(state().confirmSpec?.body).toContain('the review suggests putting the old words back');
    state().answerChoice('confirm');
    expect(await asked).toBe(true);
    expect(hunks).toEqual([
      { original: 'As he tilted', replacement: 'Tilting' },
      { original: ' at all', replacement: '' }
    ]);
  });

  it('Save then build builds nothing when the save fails', async () => {
    state().toggleAccepted('h1');
    const s = realSave();
    const b = builder();
    const asked = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(false);
    expect(b.built).toEqual([]);
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(1);
  });

  for (const outcome of ['cancelled', 'blocked', 'failed'] as const) {
    it(`Save then build builds nothing after a save that ends ${outcome}`, async () => {
      state().toggleAccepted('h1');
      const s = fakeSave(outcome);
      const b = builder();
      const asked = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
      await tick();
      state().answerChoice('confirm');
      expect(await asked).toBe(false);
      expect(s.calls).toEqual([{ applyDrafts: 'ask' }]);
      expect(b.built).toEqual([]);
    });
  }

  it('Build without them builds against the file as it is and saves nothing', async () => {
    state().toggleAccepted('h1');
    const s = fakeSave();
    const b = builder();
    const asked = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    state().answerChoice('alt');
    expect(await asked).toBe(true);
    expect(s.calls).toEqual([]);
    expect(b.built).toEqual([CHAPTER]);
  });

  it('builds nothing when the dialog was closed while the save ran', async () => {
    state().toggleAccepted('h1');
    let wanted = true;
    const save: SaveFn = () => {
      wanted = false; // Cancel in Submit manual review during the write
      return Promise.resolve('saved');
    };
    const b = builder();
    const asked = buildManualReview({ save, build: b.build, stillWanted: () => wanted });
    await tick();
    state().answerChoice('confirm');
    expect(await asked).toBe(false);
    expect(b.built).toEqual([]);
  });

  it('asks the older Replace question when every decision is in the file or dismissed', async () => {
    state().toggleDismissed('h2');
    expect(unsavedDecisionCount(state().review!.hunks)).toBe(0);
    const s = fakeSave();
    const b = builder();
    const declined = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    expect(state().confirmSpec).toEqual(replaceReviewPrompt(1));
    state().answerChoice('cancel');
    expect(await declined).toBe(false);

    const accepted = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    state().answerChoice('confirm');
    expect(await accepted).toBe(true);
    expect(s.calls).toEqual([]);
    expect(b.built).toEqual([CHAPTER]);
  });

  it('builds at once, asking nothing, when nothing is decided', async () => {
    const b = builder();
    expect(await buildManualReview({ save: fakeSave().save, build: b.build, stillWanted: open })).toBe(true);
    expect(state().confirmSpec).toBeNull();
    expect(b.built).toEqual([CHAPTER]);
  });

  it('composes what Save then build writes, so the new base is the page as it read', async () => {
    state().toggleAccepted('h1');
    state().toggleAccepted('h2');
    const composed = composeReview(state().review!);
    const s = realSave({ status: 'written', hash: 'h-both' });
    const b = builder();
    const asked = buildManualReview({ save: s.save, build: b.build, stillWanted: open });
    await tick();
    expect(state().confirmSpec?.confirmLabel).toBe('Save 2 changes, then build');
    state().answerChoice('confirm');
    expect(await asked).toBe(true);
    expect(b.built).toEqual([composed]);
    expect(composed).toBe('As he tilted his head aside, the man watched.\n\nShe said nothing.');
  });
});

/* The wiring, checked in the source: the tests run without a DOM, and the
   window checks against the OpenAI mock are in PLAN (apply.20). */
describe('the dialogs and App use these (apply.20)', () => {
  const RENDERER = path.join(__dirname, '../../src/renderer');
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const read = (file: string): string => withoutComments(readFileSync(path.join(RENDERER, file), 'utf8'));
  const REVIEW_DIALOG = read('components/ReviewDialog.tsx');
  const MANUAL = read('components/ManualReviewDialog.tsx');
  const APP = read('App.tsx');

  it('labels the review dialog from the count and saves first only when something is unsaved', () => {
    expect(REVIEW_DIALOG).toContain('const labels = reviewStartLabels(unsavedDecisions);');
    expect(REVIEW_DIALOG).toContain('const note = reviewStartNote(unsavedDecisions);');
    expect(REVIEW_DIALOG).toContain('onClick={unsavedDecisions > 0 ? saveThenStart : onStart}');
    expect(REVIEW_DIALOG).toMatch(/\{labels\.secondary \? \(\s*<button[^>]*onClick=\{onStartWithout\}/);
    expect(REVIEW_DIALOG).toContain("{saving ? 'Saving…' : labels.primary}");
    expect(REVIEW_DIALOG).not.toContain('Start review');
    expect(REVIEW_DIALOG).not.toMatch(/accepted changes/i);
  });

  it('wires the review dialog to saveThenReview and reviewWithoutSaving, started only while it is open', () => {
    expect(APP).toContain(
      'saveThenReview({ save, start: startReview, stillWanted: reviewDialogStillOpen, onNotSaved })'
    );
    expect(APP).toContain('reviewWithoutSaving({ start: startReview, stillWanted: reviewDialogStillOpen })');
    expect(APP).toContain('useCallback(() => useApp.getState().reviewDialogOpen, [])');
    expect(APP).toContain('onSaveThenStart={saveThenStartReview}');
    expect(APP).toContain('onStartWithout={startReviewWithoutSaving}');
    // The review is read when it starts, after the save, with the settings of that moment.
    expect(APP).toContain('const { review: current, settings } = useApp.getState();');
  });

  it('builds the manual review through buildManualReview, against the review on screen then', () => {
    expect(MANUAL).toMatch(
      /buildManualReview\(\{\s*save: onSave,\s*build: make,\s*stillWanted: \(\) => useApp\.getState\(\)\.manualReviewOpen,\s*onNotSaved: setNotSaved\s*\}\)/
    );
    expect(MANUAL).toContain('const current = useApp.getState().review ?? review;');
    expect(MANUAL).toContain('hunks: diffToHunks(current.base.text, normalizeText(corrected).text)');
    expect(MANUAL).not.toContain('askConfirm');
    expect(APP).toContain('onSave={save}');
  });

  /* apply.20 review: the save's cards sit under the dialog's backdrop, so
     each dialog shows what they said in a box of its own. */
  it('shows what a save that did not reach the file said inside the review dialog, in place of the warning', () => {
    expect(REVIEW_DIALOG).toContain('const [notSaved, setNotSaved] = useState<string[]>([]);');
    expect(REVIEW_DIALOG).toContain('const showNotSaved = notSaved.length > 0 && unsavedDecisions > 0;');
    expect(REVIEW_DIALOG).toMatch(/setNotSaved\(\[\]\);\s*onSaveThenStart\(setNotSaved\);/);
    expect(REVIEW_DIALOG).toMatch(
      /\{showNotSaved \? \(\s*<div className="modal__warn modal__warn--stack modal__warn--error" role="alert">\s*\{notSaved\.map\(/
    );
    expect(REVIEW_DIALOG).toMatch(/\) : note \? \(\s*<div className="modal__warn" role="alert">/);
    expect(APP).toMatch(/\(onNotSaved: \(lines: string\[\]\) => void\) =>\s*void saveThenReview\(/);
  });

  it('shows it inside Submit manual review too, between the pasted text and the buttons', () => {
    expect(MANUAL).toContain('const [notSaved, setNotSaved] = useState<string[]>([]);');
    expect(MANUAL).toContain(
      'const showNotSaved = notSaved.length > 0 && unsavedDecisionCount(review.hunks) > 0;'
    );
    expect(MANUAL).toMatch(/setNotSaved\(\[\]\);\s*void buildManualReview\(/);
    expect(MANUAL).toMatch(
      /<\/label>\s*\{showNotSaved \? \(\s*<div className="modal__warn modal__warn--stack modal__warn--error" role="alert">\s*\{notSaved\.map\(/
    );
    const css = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8');
    expect(css).toMatch(
      /\.modal__warn--error \{\s*border-color: var\(--danger\);\s*background: var\(--danger-bg\);\s*color: var\(--danger\);\s*\}/
    );
  });
});
