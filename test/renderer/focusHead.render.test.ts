import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { useApp } from '../../src/renderer/state/store';
import type { Hunk, Review } from '../../src/shared/types';

/* polish.8: the focused suggestion's heading and its category line became one
   line, "Focused suggestion · punctuation", the category in its own colour and
   the pencil at the end, so the box is a line shorter. The side panel is
   rendered with react-dom/server, as the page draws it; the CSS that keeps the
   line to one row is checked in focusBox.test.ts, and the window checks, the
   accessibility tree among them, are in PLAN (polish.8). */

const TEXT = ['Its raining.', 'She should of known.', 'The river had began to climb.'].join('\n\n');
const at = (needle: string): number => TEXT.indexOf(needle);

function h(id: string, original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = at(original);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'punctuation',
    reason: `Reason ${id}.`,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-22T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter.md',
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-22T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [
    h('its', 'Its', "It's"),
    h('of', 'of', 'have', { paragraph: 1, category: 'grammar', anchor: 'fuzzy' }),
    h('began', 'began', 'begun', { paragraph: 2, category: 'tense', edited: true }),
    h('none', 'river', 'stream', { paragraph: 2, category: undefined, anchor: 'ambiguous' })
  ],
  comments: []
};

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};

/** The server render reads the store's initial state, so a test puts the focus there, and it is put back. */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  restore = Object.fromEntries(Object.keys(patch).map((k) => [k, initial[k as keyof AppState]]));
  Object.assign(initial, patch);
}

afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

/** The box as rendered with this suggestion focused, or none. */
function box(focusedHunkId: string | null): { head: string; h3: string; body: string } {
  storeWith({ focusedHunkId });
  const html = renderToStaticMarkup(
    createElement(SidePanel, { review: REVIEW, onSetCommentStatus: () => undefined })
  );
  const head = /<div class="side__focus-head">([\s\S]*?)<\/div><div class="side__focus-body"/.exec(html)?.[1];
  const body = /<div class="side__focus-body">([\s\S]*?)<\/div><\/section><div class="side__regions"/.exec(
    html
  )?.[1];
  const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(head ?? '')?.[1];
  if (head === undefined || body === undefined || h3 === undefined) throw new Error('no box in the render');
  return { head, h3, body };
}

describe('the heading line of the focused suggestion (polish.8)', () => {
  it('reads "Focused suggestion · <category>", with the spaces round the dot kept in the text', () => {
    const { h3 } = box('its');
    expect(text(h3)).toBe('Focused suggestion · punctuation');
    expect(h3).toBe(
      '<span class="side__focus-title">Focused suggestion</span>' +
        '<span class="side__focus-cat cat-punctuation"><span class="side__focus-sep"> · </span>punctuation</span>'
    );
  });

  it('puts the anchor after the category when it is not exact, in its own span', () => {
    const { h3 } = box('of');
    expect(text(h3)).toBe('Focused suggestion · grammar fuzzy');
    expect(h3).toContain(
      '<span class="side__focus-cat cat-grammar"><span class="side__focus-sep"> · </span>grammar<span class="detail__anchor"> fuzzy</span></span>'
    );
  });

  it('says "your edit" for words the author wrote, in the colour of the category it came from', () => {
    const { h3 } = box('began');
    expect(text(h3)).toBe('Focused suggestion · your edit');
    expect(h3).toContain(
      '<span class="side__focus-cat cat-tense"><span class="side__focus-sep"> · </span>your edit</span>'
    );
  });

  it('says "change" in the colour of other for a suggestion with no category', () => {
    expect(text(box('none').h3)).toBe('Focused suggestion · change ambiguous');
    expect(box('none').h3).toContain('<span class="side__focus-cat cat-other">');
  });

  it('ends in the pencil, after the heading', () => {
    const { head } = box('its');
    expect(head.indexOf('</h3>')).toBeLessThan(head.indexOf('side__focus-edit'));
    expect(head).toMatch(
      /<\/h3><button type="button" class="row__act side__focus-edit" aria-label="Edit suggestion"/
    );
  });

  it('leaves the category out of the body, which starts with Original', () => {
    const { body } = box('its');
    expect(body).not.toContain('punctuation');
    expect(body).not.toContain('detail__cat');
    expect(body.startsWith('<dl class="pair"><dt>Original:</dt>')).toBe(true);
    expect(text(body)).toBe("Original:ItsSuggested:It'sReason its.");
  });

  it('with nothing focused, reads "Focused suggestion" alone, with no pencil, over the box\'s present text', () => {
    const { head, h3, body } = box(null);
    expect(h3).toBe('<span class="side__focus-title">Focused suggestion</span>');
    expect(head).not.toContain('side__focus-edit');
    expect(text(body)).toBe(
      'Press j or click a row to focus a suggestion. Shift+J goes to the next pending one.'
    );
  });
});
