import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createReview } from '../../src/shared/review';
import { normalizeSettings } from '../../src/shared/settings';
import type { Review } from '../../src/shared/types';
import { isModalOpen, reviewKeysActive, useApp, type AppState } from '../../src/renderer/state/store';

/* apply.20 review: the page's keys acted behind Review with AI. With the
   dialog open and the focus on the page, a accepted the focused suggestion out
   of sight, which changed the dialog's count, its warning and its blue button
   ("Save 2 changes, then review" against "Start review"), and e opened the
   suggestion editor over the dialog, where the next key was typed. Ctrl+F
   opened the find bar behind it and put the focus there. `reviewKeysActive`
   decides; keyboard.ts touches the DOM and is checked in its source, since
   the tests run without one. The window checks are in PLAN (apply.20). */

const SOURCE = 'C:/vault/Chapter 01.md';

function chapterReview(): Review {
  return createReview({
    sourcePath: SOURCE,
    base: {
      text: 'Tilting his head aside, the man watched.',
      hash: 'h1',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    },
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

const state = () => useApp.getState();

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    settingsOpen: false,
    setupOpen: false,
    settings: null,
    newChapterOpen: false,
    manualReviewOpen: false,
    reviewDialogOpen: false
  });
  state().setReview(chapterReview(), 'C:/reviews/chapter-01/r.review.json');
  state().focusHunk('h1');
});

describe('reviewKeysActive (apply.20 review)', () => {
  it('lets the keys act with a review on screen and nothing in front of it', () => {
    expect(reviewKeysActive(state())).toBe(true);
  });

  const covers: [string, Partial<AppState>][] = [
    ['Review with AI', { reviewDialogOpen: true }],
    ['Submit manual review', { manualReviewOpen: true }],
    ['New chapter', { newChapterOpen: true }],
    ['Settings', { settingsOpen: true }],
    ['the Setup screen', { setupOpen: true }],
    // Shown again from Settings with a chapter open (setup.11).
    [
      'the welcome guide',
      { settings: normalizeSettings({ manuscriptFolder: 'C:/vault', onboardingDone: false }) }
    ],
    ['a question', { confirmSpec: { title: 'Review without saving?', body: '', confirmLabel: 'OK' } }]
  ];
  for (const [name, patch] of covers) {
    it(`stops them behind ${name}, as Ctrl+S already was`, () => {
      useApp.setState(patch);
      expect(isModalOpen(state())).toBe(true);
      expect(reviewKeysActive(state())).toBe(false);
    });
  }

  it('lets them act once the welcome guide is done, and before the settings are in', () => {
    useApp.setState({ settings: normalizeSettings({ manuscriptFolder: 'C:/vault' }) });
    expect(isModalOpen(state())).toBe(false);
    expect(reviewKeysActive(state())).toBe(true);
    useApp.setState({ settings: null });
    expect(reviewKeysActive(state())).toBe(true);
  });

  it('stops them while the suggestion editor is open, which keeps them for its box', () => {
    state().openEditor({ kind: 'suggestion', hunkId: 'h1', initial: 'As he tilted', anchor: null });
    expect(isModalOpen(state())).toBe(false);
    expect(reviewKeysActive(state())).toBe(false);
  });

  it('stops them while a review of the chapter runs, and with no review on screen', () => {
    useApp.setState({ aiBusyPath: SOURCE });
    expect(reviewKeysActive(state())).toBe(false);
    useApp.setState({ aiBusyPath: 'C:/vault/Chapter 02.md' });
    expect(reviewKeysActive(state())).toBe(true);
    useApp.setState({ review: null });
    expect(reviewKeysActive(state())).toBe(false);
  });
});

describe('the key handler asks it (apply.20 review)', () => {
  const source = readFileSync(path.join(__dirname, '../../src/renderer/state/keyboard.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

  it('returns before any of j, k, the arrows, a, u, d, e or n is acted on', () => {
    const guard = code.indexOf('if (!reviewKeysActive(state)) return;');
    expect(guard).toBeGreaterThan(code.indexOf('if (isTypingTarget(event.target)) return;'));
    expect(guard).toBeLessThan(code.indexOf('switch (event.key)'));
    for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp', 'a', 'u', 'd', 'e', 'n']) {
      expect(code.indexOf(`case '${key}':`), key).toBeGreaterThan(guard);
    }
    // The older guard, which let them through behind every dialog but a question, is gone.
    expect(code).not.toContain('state.confirmSpec || state.editor');
  });

  it('opens the find bar on Ctrl+F only when nothing covers the page', () => {
    const find = code.indexOf("event.key.toLowerCase() === 'f'");
    const guard = code.indexOf('if (!state.review || isModalOpen(state)) return;', find);
    expect(guard).toBeGreaterThan(find);
    expect(guard).toBeLessThan(code.indexOf('state.openFind();'));
  });
});
