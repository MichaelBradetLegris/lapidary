import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import type { Hunk, Review, ReviewComment } from '../../src/shared/types';

/* ui.7: the side panel's comments are one list under one heading that shows
   progress, "Comments (4 of 9 resolved)": the open comments first, then the
   unanchored, then the resolved, each run in paragraph order, an unanchored
   comment by the paragraph it had and reading "unanchored (was paragraph 12)"
   where the paragraph number goes. Resolved comments keep their quieter look
   and Unresolve, and the Unanchored heading, which lists suggestions, keeps its
   place below. The panel is rendered with react-dom/server; the effects, which
   measure and scroll, do not run there. This file is type-checked with the
   renderer's project (tsconfig.web.json), as it renders a component. */

const BASE_TEXT = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} of the chapter.`).join('\n\n');

function c(
  id: string,
  paragraph: number | null,
  status: ReviewComment['status'] = 'open',
  wasParagraph?: number
): ReviewComment {
  return {
    id,
    paragraph,
    ...(wasParagraph === undefined ? {} : { wasParagraph }),
    category: 'style',
    text: `Remark ${id}.`,
    status
  };
}

const LOST_HUNK: Hunk = {
  id: 'h-lost',
  start: 0,
  end: 0,
  baseSide: 'original',
  original: 'gone words',
  replacement: 'other words',
  paragraph: 5,
  category: 'grammar',
  source: 'claude',
  status: 'pending',
  anchor: 'stale'
};

function review(comments: ReviewComment[], hunks: Hunk[] = []): Review {
  return {
    version: 1,
    id: 'chapter-12--2026-10-18T09-00-00-000Z',
    sourcePath: 'C:/vault/Chapter 12.md',
    createdAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:00:00.000Z',
    base: { text: BASE_TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    generator: { kind: 'manual' },
    hunks,
    comments
  };
}

const render = (r: Review): string =>
  renderToStaticMarkup(createElement(SidePanel, { review: r, onSetCommentStatus: () => undefined }));

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The headings of the side panel's sections, in order. */
const headings = (html: string): string[] =>
  [...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => text(m[1] ?? ''));

interface Card {
  classes: string[];
  place: string;
  text: string;
  html: string;
}

/** Every comment card in the panel, in the order it lists them. */
function cards(html: string): Card[] {
  return [...html.matchAll(/<li class="(comment\b[^"]*)">([\s\S]*?)<\/li>/g)].map((m) => ({
    classes: (m[1] ?? '').split(/\s+/).filter(Boolean),
    place: text(/<span class="comment__para">(.*?)<\/span>/.exec(m[2] ?? '')?.[1] ?? ''),
    text: text(/<p>(.*?)<\/p>/.exec(m[2] ?? '')?.[1] ?? ''),
    html: m[2] ?? ''
  }));
}

const MIXED = [
  c('open-9', 8),
  c('lost-12', null, 'open', 11),
  c('resolved-7', 6, 'resolved'),
  c('chapter', null),
  c('open-2', 1),
  c('resolved-lost-1', null, 'resolved', 0),
  c('lost-4', null, 'open', 3),
  c('resolved-chapter', null, 'resolved'),
  c('resolved-3', 2, 'resolved')
];

describe('the side panel lists comments under one heading (ui.7)', () => {
  const html = render(review(MIXED, [LOST_HUNK]));

  it('heads them with how many of all are resolved, and has no other comments heading', () => {
    expect(headings(html)).toEqual([
      'Focused suggestion',
      'Suggestions (0)',
      'Comments (4 of 9 resolved)',
      'Unanchored (1)'
    ]);
    expect(html).not.toContain('Resolved comments');
    expect(html).not.toContain('All resolved.');
  });

  it('lists the open comments, then the unanchored, then the resolved, each in paragraph order', () => {
    expect(cards(html).map((card) => card.text)).toEqual([
      'Remark open-2.',
      'Remark open-9.',
      'Remark chapter.',
      'Remark lost-4.',
      'Remark lost-12.',
      'Remark resolved-lost-1.',
      'Remark resolved-3.',
      'Remark resolved-7.',
      'Remark resolved-chapter.'
    ]);
  });

  it('puts "unanchored (was paragraph 12)" where the paragraph number goes', () => {
    expect(cards(html).map((card) => card.place)).toEqual([
      'paragraph 2',
      'paragraph 9',
      'chapter',
      'unanchored (was paragraph 4)',
      'unanchored (was paragraph 12)',
      'unanchored (was paragraph 1)',
      'paragraph 3',
      'paragraph 7',
      'chapter'
    ]);
  });

  it('keeps the resolved ones quieter, with Unresolve, and the others with Resolve and Edit text', () => {
    for (const card of cards(html)) {
      const resolved = card.text.startsWith('Remark resolved');
      expect(card.classes.includes('comment--resolved')).toBe(resolved);
      expect(card.html.includes('Unresolve')).toBe(resolved);
      expect(card.html.includes('type="checkbox"')).toBe(!resolved);
      expect(card.html.includes('Edit text')).toBe(!resolved);
    }
  });

  it('leaves the lost suggestions under Unanchored, below the comments', () => {
    const comments = html.indexOf('Comments (4 of 9 resolved)');
    const unanchored = html.indexOf('Unanchored (1)');
    expect(comments).toBeGreaterThan(0);
    expect(unanchored).toBeGreaterThan(html.lastIndexOf('Remark resolved-chapter.'));
    expect(html.indexOf('gone words')).toBeGreaterThan(unanchored);
    expect(text(html)).toContain('Paragraph 6 in the original review');
  });

  it('says so when there are no comments', () => {
    const empty = render(review([]));
    expect(headings(empty)).toContain('Comments (0)');
    expect(text(empty)).toContain('No comments.');
    expect(cards(empty)).toEqual([]);
  });

  it('lists every comment, open, once they are all open', () => {
    const open = render(review([c('b', 4), c('a', 1)]));
    expect(headings(open)).toContain('Comments (0 of 2 resolved)');
    expect(cards(open).map((card) => card.place)).toEqual(['paragraph 2', 'paragraph 5']);
  });

  it('keeps the resolved ones listed once they are all resolved', () => {
    const done = render(review([c('b', 4, 'resolved'), c('a', 1, 'resolved')]));
    expect(headings(done)).toContain('Comments (2 of 2 resolved)');
    expect(cards(done).map((card) => card.place)).toEqual(['paragraph 2', 'paragraph 5']);
    expect(text(done)).not.toContain('No comments.');
  });
});
