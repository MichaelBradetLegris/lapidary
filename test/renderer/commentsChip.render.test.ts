import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewPane } from '../../src/renderer/components/ReviewPane';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { Toolbar } from '../../src/renderer/components/Toolbar';
import { useApp } from '../../src/renderer/state/store';
import { chipCounts, COMMENTS_CHIP, showOnlyHidden, YOU_CHIP } from '../../src/shared/ui/chips';
import { COMMENTS_HIDDEN_NOTE } from '../../src/shared/ui/comments';
import type { Hunk, Review, ReviewComment } from '../../src/shared/types';

/* polish.13: the review's comments have a chip, "comments N", after the
   category chips and before You, in the colour of a margin card's head,
   counting the open comments. Hiding it, from its own menu, by Show only on
   another chip or by the eye, hides the comment cards in the margin and the
   side panel's list, whose heading stays with its count over a line that says
   why; the commented paragraphs' numbers lose the comment colour and the
   active comment's paragraph is no longer lit, so nothing on the page points
   at a comment that is not shown; and n does nothing. The toolbar, the review
   pane and the side panel are rendered with react-dom/server, which reads the
   store's initial state; the margin's cards need the pane's measured width,
   which the server render does not have, so what the pane hands them is
   checked in its source (test/renderer/chipsRow.test.ts), and in the window
   (PLAN polish.13). */

const TEXT = [
  'They called it a double standard, and said so.',
  'The river had began to climb.',
  'Nobody spoke.',
  'Teh rain stopped.'
].join('\n\n');

function h(id: string, word: string, category: Hunk['category'], extra: Partial<Hunk> = {}): Hunk {
  const start = TEXT.indexOf(word);
  return {
    id,
    start,
    end: start + word.length,
    baseSide: 'original',
    original: word,
    replacement: `${word}!`,
    paragraph: TEXT.slice(0, start).split('\n\n').length - 1,
    category,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

function c(id: string, paragraph: number | null, status: ReviewComment['status'] = 'open'): ReviewComment {
  return { id, paragraph, category: 'pacing', text: `Remark ${id}.`, status };
}

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-23T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter.md',
  createdAt: '2026-10-23T09:00:00.000Z',
  updatedAt: '2026-10-23T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [
    h('double', 'double', 'typo'),
    h('began', 'began', 'grammar'),
    h('teh', 'Teh', 'typo'),
    h('mine', 'Nobody', 'other', { source: 'manual', status: 'accepted' })
  ],
  comments: [c('on-river', 1), c('on-rain', 3), c('done', 0, 'resolved')]
};

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};
/** Patches the store's initial state; each key is put back as it was before the test's first patch. */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  for (const k of Object.keys(patch) as (keyof AppState)[]) {
    if (!(k in restore)) restore = { ...restore, [k]: initial[k] };
  }
  Object.assign(initial, patch);
}
afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

const noop = (): void => undefined;

const toolbar = (): string =>
  renderToStaticMarkup(
    createElement(Toolbar, {
      review: REVIEW,
      running: false,
      progressLabel: '',
      saving: false,
      sideFolded: false,
      singleScreen: false,
      onReviewWith: noop,
      onCancelReview: noop,
      onManualReview: noop,
      onSaveChapter: noop,
      onCopyResult: noop,
      onExportHtml: noop,
      onShowBackups: noop,
      onSettings: noop,
      onSaveHintDone: noop
    })
  );
const pane = (): string =>
  renderToStaticMarkup(createElement(ReviewPane, { review: REVIEW, onSetCommentStatus: noop }));
const panel = (): string =>
  renderToStaticMarkup(createElement(SidePanel, { review: REVIEW, onSetCommentStatus: noop }));

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The chips in the row as drawn (not the copy out of sight): their class, words and tooltip. */
function chips(html: string): { cls: string; words: string; title: string }[] {
  const row = html.slice(html.indexOf('class="chips"'), html.indexOf('chips__measure'));
  return [...row.matchAll(/<span class="(chip [^"]*)">\s*<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    cls: (m[1] ?? '').trim(),
    words: text(m[3] ?? ''),
    title: /title="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? ''
  }));
}

const eye = (html: string): string => /class="chips__eye" aria-label="([^"]*)"/.exec(html)?.[1] ?? '';

/** The paragraphs whose number is in the comment colour, and the one lit for the active comment. */
const commented = (html: string): string[] =>
  [...html.matchAll(/class="para__num para__num--commented"[^>]*>([^<]*)</g)].map((m) => m[1] ?? '');
const lit = (html: string): string[] =>
  [...html.matchAll(/<p class="para para--active" data-paragraph="(\d+)"/g)].map((m) => m[1] ?? '');

/** The side panel's comment cards and the lines under its comments heading. */
const cards = (html: string): string[] =>
  [...html.matchAll(/<li class="comment\b[^"]*">[\s\S]*?<p>(.*?)<\/p>/g)].map((m) => text(m[1] ?? ''));
const headings = (html: string): string[] =>
  [...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => text(m[1] ?? ''));

describe('the comments chip in the toolbar (polish.13)', () => {
  it('stands after the categories and before You, counting the open comments, in its own colour', () => {
    expect(chips(toolbar()).map((chip) => chip.words)).toEqual([
      'typo 2',
      'grammar 1',
      'comments 2',
      'You 1'
    ]);
    const comments = chips(toolbar())[2];
    expect(comments?.cls).toBe('chip cat-comments');
    expect(comments?.title).toBe('Comments, counting the open ones. Shown. Click for Hide and Show only.');
    expect(eye(toolbar())).toBe('Hide all categories');
  });

  it('fades when hidden and closes the eye, which counts it among every category', () => {
    storeWith({ hiddenCategories: [COMMENTS_CHIP] });
    const html = toolbar();
    const comments = chips(html)[2];
    expect(comments?.cls).toBe('chip cat-comments chip--off');
    expect(comments?.title).toBe('Comments, counting the open ones. Hidden. Click for Show and Show only.');
    expect(chips(html).filter((chip) => chip.cls.includes('chip--off'))).toHaveLength(1);
    expect(eye(html)).toBe('Show all categories');
  });

  it('is hidden by Show only on a category, and by the eye with the rest', () => {
    const keys = chipCounts(REVIEW.hunks, REVIEW.comments).map(([key]) => key);
    storeWith({ hiddenCategories: showOnlyHidden(keys, 'grammar') });
    expect(
      chips(toolbar())
        .filter((chip) => chip.cls.includes('chip--off'))
        .map((chip) => chip.words)
    ).toEqual(['typo 2', 'comments 2', 'You 1']);
    storeWith({ hiddenCategories: keys });
    expect(chips(toolbar()).every((chip) => chip.cls.includes('chip--off'))).toBe(true);
    expect(eye(toolbar())).toBe('Show all categories');
  });
});

describe('what hiding the comments hides (polish.13)', () => {
  it('takes the comment colour off the commented paragraphs, and the light off the active one', () => {
    storeWith({ activeCommentId: 'on-rain' });
    expect(commented(pane())).toEqual(['2', '4']);
    expect(lit(pane())).toEqual(['3']);
    storeWith({ hiddenCategories: [COMMENTS_CHIP] });
    expect(commented(pane())).toEqual([]);
    expect(lit(pane())).toEqual([]);
    // Hiding a category leaves the comments alone.
    storeWith({ hiddenCategories: ['typo', YOU_CHIP] });
    expect(commented(pane())).toEqual(['2', '4']);
    expect(lit(pane())).toEqual(['3']);
  });

  it('leaves the comments heading with its count, and says why the list is gone', () => {
    expect(cards(panel())).toEqual(['Remark on-river.', 'Remark on-rain.', 'Remark done.']);
    storeWith({ hiddenCategories: [COMMENTS_CHIP] });
    const html = panel();
    expect(headings(html)).toContain('Comments (1 of 3 resolved)');
    expect(cards(html)).toEqual([]);
    expect(text(html)).toContain(COMMENTS_HIDDEN_NOTE);
    expect(text(html)).not.toContain('No comments.');
    // The suggestions are untouched by it.
    expect(headings(html)).toContain('Suggestions (1 of 4 decided)');
  });

  it('hides them with every category but one after Show only, and not after Show only on them', () => {
    const keys = chipCounts(REVIEW.hunks, REVIEW.comments).map(([key]) => key);
    storeWith({ hiddenCategories: showOnlyHidden(keys, 'typo') });
    expect(cards(panel())).toEqual([]);
    expect(headings(panel())).toContain('Suggestions (2)');
    storeWith({ hiddenCategories: showOnlyHidden(keys, COMMENTS_CHIP) });
    expect(cards(panel())).toHaveLength(3);
    expect(headings(panel())).toContain('Suggestions (0)');
  });
});
