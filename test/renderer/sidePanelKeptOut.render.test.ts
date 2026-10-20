import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import type { Hunk, Review } from '../../src/shared/types';

/* files.7 (PLAN 11.3 k): a suggestion the guard kept out of the text is
   listed under Unanchored with the model's reason and then the app's note
   saying why. Rendered with react-dom/server; type-checked with the
   renderer's project, as it renders components. */

const TEXT = 'See [[Chapter 2]] for the rest.\n\nThe river had began to climb.';

function h(id: string, original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = TEXT.indexOf(original);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'consistency',
    reason: `Reason ${id}.`,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

const KEPT = h('kept', '2', 'Two', { anchor: 'stale', start: 0, end: 0, keptOut: 'wikilink' });
const LOST = h('lost', 'the candle had burned', 'the candle had burnt', {
  anchor: 'stale',
  start: 0,
  end: 0,
  paragraph: 1,
  reason: 'Reason lost. [Could not find this text in the chapter.]'
});
const WORD = h('word', 'began', 'begun', { paragraph: 1, category: 'grammar' });

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-19T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter.md',
  createdAt: '2026-10-19T09:00:00.000Z',
  updatedAt: '2026-10-19T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'claude', provider: 'claude' },
  hunks: [KEPT, WORD, LOST],
  comments: []
};

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const render = (review: Review = REVIEW): string =>
  renderToStaticMarkup(createElement(SidePanel, { review, onSetCommentStatus: () => undefined }));

/** The text of each item under Unanchored, in order. */
function unanchored(html: string): string[] {
  const list = /<h3>Unanchored \(\d+\)<\/h3><ul class="stale">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  return [...list.matchAll(/<li [^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1] ?? ''));
}

describe('a suggestion kept out of the text, under Unanchored (files.7)', () => {
  it("shows the model's reason, then the note saying why, then where it was", () => {
    const html = render();
    expect(html).toContain('<h3>Unanchored (2)</h3>');
    expect(unanchored(html)).toEqual([
      'Original: 2 Suggested: Two Reason kept. Kept out of the text: it would change Obsidian syntax (an internal link). Make this change in Obsidian or with the paragraph pen if you want it. Paragraph 1 in the original review',
      'Original: the candle had burned Suggested: the candle had burnt Reason lost. [Could not find this text in the chapter.] Paragraph 2 in the original review'
    ]);
    expect(html.match(/class="stale__note"/g)).toHaveLength(1);
  });

  it('gives the note without a reason when the model gave none', () => {
    const { reason: _reason, ...bare } = KEPT;
    const html = render({ ...REVIEW, hunks: [{ ...bare, keptOut: 'combined' }] });
    expect(unanchored(html)).toEqual([
      'Original: 2 Suggested: Two Kept out of the text: it would change Obsidian syntax (together with the suggestion before it). Make this change in Obsidian or with the paragraph pen if you want it. Paragraph 1 in the original review'
    ]);
  });

  it('leaves it out of the suggestions list', () => {
    const html = render();
    const list = [...html.matchAll(/<button type="button" class="row__main"[^>]*>([\s\S]*?)<\/button>/g)].map(
      (m) => text(m[1] ?? '')
    );
    expect(list).toEqual(['began \u2192 begun']);
  });
});
