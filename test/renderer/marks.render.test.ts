import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewPane } from '../../src/renderer/components/ReviewPane';
import { useApp } from '../../src/renderer/state/store';
import type { Hunk, Review } from '../../src/shared/types';

/* small.8 (PLAN 11.7): the review pane puts a margin mark in each paragraph
   for its pending small changes and for the focused change, each placed by
   the anchor name its change's live text carries. Rendered with
   react-dom/server, which reads the store's initial state; type-checked with
   the renderer's project, as it renders a component. */

const TEXT = [
  'They called it a double-standard, and said so.',
  'By the time she caught up with Mira who had crossed the bridge, the rain had stopped.',
  'The river had began to climb.'
].join('\n\n');

function h(id: string, at: number, original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  return {
    id,
    start: at,
    end: at + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'punctuation',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

const HUNKS = [
  h('hyphen', TEXT.indexOf('-standard'), '-', ' '),
  h('done', TEXT.indexOf(', and'), ',', '', { status: 'accepted' }),
  h('comma', TEXT.indexOf(' who'), '', ',', { paragraph: 1 }),
  h('word', TEXT.indexOf('began'), 'began', 'begun', { paragraph: 2, category: 'grammar' })
];

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-19T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter.md',
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: HUNKS,
  comments: []
};

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  restore = Object.fromEntries(Object.keys(patch).map((k) => [k, initial[k as keyof AppState]]));
  Object.assign(initial, patch);
}
afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

const render = (): string =>
  renderToStaticMarkup(createElement(ReviewPane, { review: REVIEW, onSetCommentStatus: () => undefined }));

/** Each mark in the pane: its kind, its paragraph and its anchor. */
function marks(html: string): { kind: string; para: string; anchor: string }[] {
  const out: { kind: string; para: string; anchor: string }[] = [];
  for (const p of html.matchAll(/<p class="para[^"]*" data-paragraph="(\d+)"[\s\S]*?<\/p>/g)) {
    for (const m of p[0].matchAll(
      /class="mark mark--(bar|focus)[^"]*"[^>]*style="position-anchor:([^"]+)"/g
    )) {
      out.push({ kind: m[1] ?? '', para: p[1] ?? '', anchor: m[2] ?? '' });
    }
  }
  return out;
}

const anchors = (html: string): string[] =>
  [...html.matchAll(/class="hunk__live" style="anchor-name:([^"]+)"/g)].map((m) => m[1] ?? '');

describe('margin marks in the review pane (small.8)', () => {
  it('puts a bar beside each pending small change, and none beside a decided or word-sized one', () => {
    const html = render();
    expect(marks(html).map((m) => `${m.kind} ${m.para}`)).toEqual(['bar 0', 'bar 1']);
  });

  it('places each mark by the anchor name of its own change, and names no other', () => {
    const html = render();
    expect(marks(html).map((m) => m.anchor)).toEqual(anchors(html));
    expect(new Set(anchors(html)).size).toBe(anchors(html).length);
  });

  it('gives the focused change the arrowhead, a word-sized one too, and focus wins over its bar', () => {
    storeWith({ focusedHunkId: 'word' });
    expect(marks(render()).map((m) => `${m.kind} ${m.para}`)).toEqual(['bar 0', 'bar 1', 'focus 2']);
    storeWith({ focusedHunkId: 'comma' });
    expect(marks(render()).map((m) => `${m.kind} ${m.para}`)).toEqual(['bar 0', 'focus 1']);
  });

  it('keeps the marks out of the paragraph text, which find and copy read', () => {
    const html = render();
    for (const m of html.matchAll(/<(button|span) [^>]*class="mark [^"]*"[^>]*>([\s\S]*?)<\/\1>/g)) {
      expect(m[2]).toBe('');
    }
  });
});
