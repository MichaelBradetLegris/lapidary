import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { FullEdit } from '../../src/renderer/components/FullEdit';
import { ModeBar } from '../../src/renderer/components/ModeBar';
import { PreviewPane } from '../../src/renderer/components/PreviewPane';
import { useApp } from '../../src/renderer/state/store';
import { fullEditText } from '../../src/shared/edit';
import type { Hunk, Review } from '../../src/shared/types';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';

/* rr.2: the Mode select, Full edit's box and Preview's page as the window
   draws them, rendered with react-dom/server from the store; what a switch
   does is tested in modes.test.ts, and the window checks are in PLAN (rr.2). */

const TEXT = [
  '---\ntitle: The Flood\n---',
  '# One',
  'It was the third night of rain, and the river had began to climb.',
  '[Status]\nName: Mara\nLevel: 5',
  '***',
  'See [the map](https://example.com/map) and ![the mill](https://example.com/mill.png).'
].join('\n\n');

const began: Hunk = {
  id: 'began',
  start: TEXT.indexOf('began'),
  end: TEXT.indexOf('began') + 5,
  baseSide: 'original',
  original: 'began',
  replacement: 'begun',
  paragraph: 1,
  category: 'tense',
  reason: 'Tense.',
  source: 'claude',
  status: 'accepted',
  anchor: 'exact'
};

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-23T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter 01 - The Flood.md',
  createdAt: '2026-10-23T09:00:00.000Z',
  updatedAt: '2026-10-23T09:00:00.000Z',
  base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [began],
  comments: []
};

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};

/** The server render reads the store's initial state, so a test sets it there, and it is put back. */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  for (const key of Object.keys(patch)) {
    if (!(key in restore)) (restore as Record<string, unknown>)[key] = initial[key as keyof AppState];
  }
  Object.assign(initial, patch);
}

afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

const BODY = fullEditText(TEXT, [began]);
const whole = (text = BODY) => ({
  [WHOLE_DRAFT_KEY]: { key: WHOLE_DRAFT_KEY, paragraphs: [], initial: BODY, text, whole: true as const }
});

describe('the Mode select', () => {
  it('is labelled Mode and offers Main, Full edit and Preview, the mode of the window selected', () => {
    storeWith({ viewMode: 'preview', drafts: {} });
    const html = renderToStaticMarkup(createElement(ModeBar));
    expect(html).toContain('<label class="modebar__label" for="mode-select">Mode</label>');
    expect(html).toMatch(
      /<select id="mode-select" class="modebar__select" title="Main reviews the suggestions\./
    );
    expect(
      [...html.matchAll(/<option value="(\w+)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]])
    ).toEqual([
      ['main', 'Main'],
      ['edit', 'Full edit'],
      ['preview', 'Preview']
    ]);
    expect(html).toMatch(/<option value="preview" selected="">Preview<\/option>/);
    // Full edit's box open: Full edit, whatever Main or Preview was.
    storeWith({ drafts: whole() });
    expect(renderToStaticMarkup(createElement(ModeBar))).toMatch(
      /<option value="edit" selected="">Full edit<\/option>/
    );
  });
});

describe("Full edit's box", () => {
  it('holds the body as the page reads it, with the frontmatter above it and Cancel and Done below', () => {
    storeWith({ drafts: whole() });
    const html = renderToStaticMarkup(createElement(FullEdit, { review: REVIEW }));
    expect(html).toContain(
      '<pre class="frontmatter fulledit__frontmatter" title="Frontmatter, which Full edit leaves as it is">---\ntitle: The Flood\n---</pre>'
    );
    expect(html).toContain('aria-label="Full edit of Chapter 01 - The Flood"');
    expect(html).toContain('class="fulledit__area"');
    expect(BODY).toContain('had begun to climb');
    expect(BODY.startsWith('# One')).toBe(true);
    expect(html).toContain('<span class="fulledit__hint">Nothing changed yet. Esc closes.</span>');
    expect(html).toMatch(
      /<button type="button">Cancel<\/button><button type="button" class="primary">Done<\/button>/
    );
    // No suggestion marks: no hunk, ghost or rail.
    expect(html).not.toMatch(/class="(hunk|ghost|para__rail)/);
  });

  it('says Ctrl+Enter applies once something is typed, and draws nothing with Full edit closed', () => {
    storeWith({ drafts: whole(`${BODY} More.`) });
    expect(renderToStaticMarkup(createElement(FullEdit, { review: REVIEW }))).toContain(
      '<span class="fulledit__hint">Ctrl+Enter applies, Esc cancels</span>'
    );
    storeWith({ drafts: {} });
    expect(renderToStaticMarkup(createElement(FullEdit, { review: REVIEW }))).toBe('');
  });
});

describe("Preview's page", () => {
  const html = renderToStaticMarkup(createElement(PreviewPane, { review: REVIEW }));

  it('draws the Royal Road HTML of the text as it reads, the frontmatter left out', () => {
    expect(html).toContain(
      '<article class="preview__page" aria-label="Preview of Chapter 01 - The Flood, as Royal Road will show it">'
    );
    expect(html).toContain('<h1>One</h1>');
    expect(html).toContain('<p>It was the third night of rain, and the river had begun to climb.</p>');
    expect(html).toContain(
      '<p class="rr-tight">[Status]</p><p class="rr-tight">Name: Mara</p><p>Level: 5</p>'
    );
    expect(html).toContain('<hr/>');
    expect(html).not.toContain('title: The Flood');
  });

  it('keeps a link s look and address with no href, and shows an image s words without fetching it', () => {
    expect(html).toContain('<a class="preview__link" title="https://example.com/map">the map</a>');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<img');
    expect(html).toContain(
      '<span class="preview__image" title="https://example.com/mill.png">Image: the mill</span>'
    );
  });

  it('says so for a chapter with no words', () => {
    const empty = { ...REVIEW, base: { ...REVIEW.base, text: '---\ntitle: T\n---' }, hunks: [] };
    expect(renderToStaticMarkup(createElement(PreviewPane, { review: empty }))).toContain(
      '<p class="preview__empty">Nothing to preview yet: the chapter has no words.</p>'
    );
  });
});
