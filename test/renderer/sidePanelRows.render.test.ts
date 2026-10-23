import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { HunkTooltip } from '../../src/renderer/components/HunkTooltip';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { useApp } from '../../src/renderer/state/store';
import type { Hunk, Review } from '../../src/shared/types';

/* small.5 (PLAN 11.7): the side panel and the hover card write each side of a
   change as the table in small.ts names it, "(nothing)" only for the empty
   string, and a small change's row shows a few words of its line around a chip
   holding the change. Rendered with react-dom/server; type-checked with the
   renderer's project, as it renders components. */

const TEXT = [
  'They called it a double-standard, and said so.',
  'By the time she caught up with Mira who had already crossed the bridge, the rain had stopped.',
  'The river had began to climb.'
].join('\n\n');

const at = (needle: string): number => TEXT.indexOf(needle);

function h(
  id: string,
  start: number,
  original: string,
  replacement: string,
  extra: Partial<Hunk> = {}
): Hunk {
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

const HYPHEN = h('hyphen', at('-standard'), '-', ' ', { status: 'accepted', source: 'manual' });
const COMMA = h('comma', at(' who had'), '', ',', { paragraph: 1 });
const WORD = h('word', at('began'), 'began', 'begun', { paragraph: 2, category: 'grammar' });
const STALE = h('stale', 0, '  ', '', { anchor: 'stale' });

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-19T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter.md',
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [HYPHEN, COMMA, WORD, STALE],
  comments: []
};

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Each list row's main button: its spoken name, when it has one of its own, and its text. */
function rows(html: string): { label: string | null; text: string }[] {
  return [...html.matchAll(/<button type="button" class="row__main"([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (m) => ({
      label: /aria-label="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? null,
      text: text(m[2] ?? '')
    })
  );
}

const render = (): string =>
  renderToStaticMarkup(createElement(SidePanel, { review: REVIEW, onSetCommentStatus: () => undefined }));

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};

/**
 * The server render reads the store's initial state (zustand's server
 * snapshot), so a test that needs a focused or hovered suggestion puts it
 * there, and it is put back after the test.
 */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  restore = Object.fromEntries(Object.keys(patch).map((k) => [k, initial[k as keyof AppState]]));
  Object.assign(initial, patch);
}

afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

describe('the side panel names small changes (small.5)', () => {
  it('shows a small change in its line, and a word-sized one as before', () => {
    const list = rows(render());
    // Each after its tag (polish.12).
    expect(list.map((r) => r.text)).toEqual([
      'you\u2026a double- (hyphen)(space)standard, and\u2026accepted',
      'punctuation\u2026with Mira, (comma) who had\u2026',
      'grammarbegan \u2192 begun'
    ]);
  });

  it('gives a small change a chip, with a deletion tag where nothing is put in', () => {
    const html = render();
    expect(html.match(/class="row__chip"/g)).toHaveLength(2);
    expect(html).toContain('<span class="row__old">- (hyphen)</span>');
    expect(html).toContain('<span class="row__new">(space)</span>');
    expect(html).toContain('<span class="row__new">, (comma)</span>');
    expect(html).not.toContain('row__tag');
  });

  it('speaks the change by its names, not the words around it', () => {
    // Every row has a name of its own since polish.12, its tag's first.
    expect(rows(render()).map((r) => r.label)).toEqual([
      'you, - (hyphen) \u2192 (space), accepted',
      'punctuation, (nothing) \u2192 , (comma)',
      'grammar, began \u2192 begun'
    ]);
  });

  it('names the sides in the focused suggestion and in Unanchored, "(nothing)" for the empty string only', () => {
    storeWith({ focusedHunkId: 'hyphen' });
    const html = render();
    const pairs = [...html.matchAll(/<dd class="pair__(original|suggested)">([\s\S]*?)<\/dd>/g)].map(
      (m) => `${m[1]}: ${text(m[2] ?? '')}`
    );
    expect(pairs).toEqual([
      'original: - (hyphen)',
      'suggested: (space)',
      'original: (2 spaces)',
      'suggested: (nothing)'
    ]);
  });

  it('names them in the hover card too', () => {
    storeWith({ review: REVIEW, hoveredHunkId: 'comma' });
    const html = renderToStaticMarkup(createElement(HunkTooltip));
    const pairs = [...html.matchAll(/<dd class="pair__(original|suggested)">([\s\S]*?)<\/dd>/g)].map(
      (m) => `${m[1]}: ${text(m[2] ?? '')}`
    );
    expect(pairs).toEqual(['original: (nothing)', 'suggested: , (comma)']);
  });
});
