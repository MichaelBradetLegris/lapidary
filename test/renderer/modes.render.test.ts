import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullEdit, FullEditFoot } from '../../src/renderer/components/FullEdit';
import { ModeSelect, ModeSelectCopy } from '../../src/renderer/components/ModeSelect';
import { PreviewPane } from '../../src/renderer/components/PreviewPane';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { useBulkAction } from '../../src/renderer/state/bulk';
import { editFromComment, editHunk } from '../../src/renderer/state/edit';
import { PLACE_HOLD_MS, holdPlace, type PlaceWatch } from '../../src/renderer/state/modePlaces';
import { currentMode, useApp } from '../../src/renderer/state/store';
import { fullEditText } from '../../src/shared/edit';
import type { Hunk, Review, ReviewComment } from '../../src/shared/types';
import type { BulkAction } from '../../src/shared/ui/bulk';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';
import {
  FINISH_FULL_EDIT_FIRST,
  FULL_EDIT_FREEZES,
  FULL_EDIT_HOLDS_PARAGRAPHS,
  FULL_EDIT_OPEN
} from '../../src/shared/ui/modes';

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
    const html = renderToStaticMarkup(createElement(ModeSelect, { step: 0 }));
    expect(html).toContain('<label class="mode-select__label" for="mode-select">Mode</label>');
    expect(html).toMatch(
      /<select id="mode-select" class="mode-select__field" title="Main reviews the suggestions\./
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
    expect(renderToStaticMarkup(createElement(ModeSelect, { step: 0 }))).toMatch(
      /<option value="edit" selected="">Full edit<\/option>/
    );
  });

  /* rr.6: in the toolbar, at the chips' step, which app.css draws it at. */
  it('is drawn at the step it is given, its label and select in one box', () => {
    storeWith({ viewMode: 'main', drafts: {} });
    for (const step of [0, 3]) {
      expect(renderToStaticMarkup(createElement(ModeSelect, { step }))).toMatch(
        new RegExp(
          `^<div class="mode-select" data-chip-step="${step}"><label class="mode-select__label" for="mode-select">Mode</label><select id="mode-select"`
        )
      );
    }
  });

  it('has a copy for the measure, at a step, with the same options and nothing to reach or name it', () => {
    const html = renderToStaticMarkup(createElement(ModeSelectCopy, { step: 2 }));
    expect(html).toMatch(
      /^<div class="mode-select" data-chip-step="2"><span class="mode-select__label">Mode<\/span><select class="mode-select__field" tabindex="-1">/
    );
    expect([...html.matchAll(/<option value="(\w+)"/g)].map((m) => m[1])).toEqual([
      'main',
      'edit',
      'preview'
    ]);
    for (const absent of ['id=', 'for=', 'title=', '<label']) expect(html, absent).not.toContain(absent);
  });
});

describe("Full edit's box", () => {
  it('holds the body as the page reads it, with the frontmatter above it and Cancel and Done below', () => {
    storeWith({ drafts: whole() });
    const html = renderToStaticMarkup(createElement(FullEdit, { review: REVIEW }));
    // rr.7: the foot is drawn under the scroller, by App, not in the sheet's column.
    const foot = renderToStaticMarkup(createElement(FullEditFoot));
    expect(html).not.toContain('fulledit__foot');
    expect(html).toContain(
      '<pre class="frontmatter fulledit__frontmatter" title="Frontmatter, which Full edit leaves as it is">---\ntitle: The Flood\n---</pre>'
    );
    expect(html).toContain('aria-label="Full edit of Chapter 01 - The Flood"');
    // rr.7: a plain text area, the sheet's only child, as Preview's page holds its text,
    // and the frontmatter above the sheet.
    expect(html).toMatch(
      /<div class="fulledit__page"><textarea class="fulledit__area"[^>]*>[^<]*<\/textarea><\/div>/
    );
    expect(html.indexOf('class="frontmatter fulledit__frontmatter"')).toBeLessThan(
      html.indexOf('class="fulledit__page"')
    );
    expect(BODY).toContain('had begun to climb');
    expect(BODY.startsWith('# One')).toBe(true);
    expect(foot).toBe(
      '<div class="fulledit__foot"><div class="fulledit__foot-row"><span class="fulledit__hint">Nothing changed yet. Esc closes.</span>' +
        '<button type="button">Cancel</button><button type="button" class="primary">Done</button></div></div>'
    );
    // No suggestion marks: no hunk, ghost or rail.
    expect(html).not.toMatch(/class="(hunk|ghost|para__rail)/);
  });

  it('says Ctrl+Enter applies once something is typed, and draws nothing with Full edit closed', () => {
    storeWith({ drafts: whole(`${BODY} More.`) });
    expect(renderToStaticMarkup(createElement(FullEditFoot))).toContain(
      '<span class="fulledit__hint">Ctrl+Enter applies, Esc cancels</span>'
    );
    storeWith({ drafts: {} });
    expect(renderToStaticMarkup(createElement(FullEdit, { review: REVIEW }))).toBe('');
    expect(renderToStaticMarkup(createElement(FullEditFoot))).toBe('');
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

/* ------------------------------------------------------------------ */
/* rr.2 review: what picks Full edit's words, run as the window runs it */
/* ------------------------------------------------------------------ */

/* Each of these could be put back to the paragraph boxes' words, or undone,
   and every test still passed: only the words themselves were pinned. These
   run the code that picks them, on the live store. */
describe("Full edit's words where a paragraph box's would be", () => {
  const state = () => useApp.getState();
  const cards = (): string[] => state().notifications.map((n) => n.text);
  const COMMENT: ReviewComment = {
    id: 'c1',
    paragraph: 1,
    category: 'flow',
    text: 'Reads long.',
    status: 'open'
  };
  const LIVE: Review = { ...REVIEW, hunks: [{ ...began, status: 'pending' }], comments: [COMMENT] };
  const SECOND = TEXT.split('\n\n')[2] ?? '';
  const BOX = { 1: { key: 1, paragraphs: [1], initial: SECOND, text: SECOND } };

  afterEach(() => {
    vi.unstubAllGlobals();
    useApp.setState({ drafts: {}, editor: null, viewMode: 'main', confirmSpec: null });
    state().setReview(null);
    state().clearNotifications();
  });

  /** The bulk action as the toolbar and the chips run it, taken from a render. */
  function bulkAction(): (action: BulkAction) => void {
    const got: { run?: (action: BulkAction) => void } = {};
    function Probe(): null {
      got.run = useBulkAction();
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    if (!got.run) throw new Error('no bulk action');
    return got.run;
  }

  it('the pencil, or e, on a suggestion says Full edit is open, where a box names its paragraph', () => {
    state().setReview(LIVE);
    useApp.setState({ drafts: BOX });
    editHunk('began');
    expect(cards()).toEqual([
      'Paragraph 2 is open for editing. Finish it, or cancel it, to change this suggestion.'
    ]);
    state().clearNotifications();
    useApp.setState({ drafts: whole() });
    editHunk('began');
    expect(cards()).toEqual([FULL_EDIT_FREEZES]);
    expect(state().editor).toBeNull();
  });

  it('the bulk actions say to finish or cancel Full edit first, where boxes name the paragraphs', () => {
    state().setReview(LIVE);
    const run = bulkAction();
    useApp.setState({ drafts: BOX });
    run('accept');
    expect(cards()).toEqual(['Finish or cancel the paragraphs you are editing first.']);
    useApp.setState({ drafts: whole() });
    run('accept');
    expect(cards()).toEqual([FINISH_FULL_EDIT_FIRST]);
    expect(state().confirmSpec).toBeNull();
    expect(state().review!.hunks[0]!.status).toBe('pending');
  });

  it("a row's tooltip says Full edit is open, where a box names its paragraph", () => {
    const rowTitle = (): string | undefined =>
      /data-row-id="began"[^>]*title="([^"]*)"/.exec(
        renderToStaticMarkup(createElement(SidePanel, { review: LIVE, onSetCommentStatus: () => undefined }))
      )?.[1];
    storeWith({ drafts: BOX });
    expect(rowTitle()).toBe('Paragraph 2 is open for editing');
    storeWith({ drafts: whole() });
    expect(rowTitle()).toBe(FULL_EDIT_OPEN);
  });

  it("Edit text on a comment in Preview goes back to Main with the paragraph's box open", () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    state().setReview(LIVE);
    state().setViewMode('preview');
    editFromComment(COMMENT);
    expect(state().viewMode).toBe('main');
    expect(currentMode(state())).toBe('main');
    expect(Object.values(state().drafts).map((d) => d.paragraphs)).toEqual([[1]]);
    expect(cards()).toEqual([]);
  });

  it('Edit text on a comment in Full edit opens no box, and says why', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    state().setReview(LIVE);
    useApp.setState({ drafts: whole() });
    editFromComment(COMMENT);
    expect(currentMode(state())).toBe('edit');
    expect(Object.keys(state().drafts)).toEqual([String(WHOLE_DRAFT_KEY)]);
    expect(cards()).toEqual([FULL_EDIT_HOLDS_PARAGRAPHS]);
  });
});

/* rr.2 review: Main, left further down than its first render's height, came
   back cut short: left at 300, 500 or 664 px, then Preview, then Main, it was
   at 254 px each time, since the browser cut the place down to the page's
   height before ReviewPane had laid out its margin column, and nothing put it
   back. `holdPlace` keeps putting it back as the page grows. */
describe('a place put back while the page grows (holdPlace)', () => {
  /** A scroller the browser would cut to its content: scrollTop never past `max`. */
  function scrollerOf(max: number): { max: number; scrollTop: number } {
    let top = 0;
    return {
      max,
      get scrollTop() {
        return top;
      },
      set scrollTop(value: number) {
        top = Math.max(0, Math.min(value, this.max));
      }
    };
  }

  function watched() {
    const on: { grew?: () => void; moved?: () => void; done?: () => void; ms?: number } = {};
    const watch: PlaceWatch = {
      resized: (grew) => {
        on.grew = grew;
        return () => delete on.grew;
      },
      authorMoves: (moved) => {
        on.moved = moved;
        return () => delete on.moved;
      },
      later: (ms, done) => {
        on.done = done;
        on.ms = ms;
        return () => delete on.done;
      }
    };
    return { on, watch };
  }

  it('puts the place back deeper than the first height once the page has grown to it, then lets go', () => {
    const scroller = scrollerOf(254);
    const { on, watch } = watched();
    let ended = 0;
    const stop = holdPlace(scroller, 500, watch, () => (ended += 1));
    expect(stop).not.toBeNull();
    expect(scroller.scrollTop).toBe(254);
    expect(on.ms).toBe(PLACE_HOLD_MS);
    scroller.max = 420;
    on.grew?.();
    expect(scroller.scrollTop).toBe(420);
    expect(ended).toBe(0);
    scroller.max = 664;
    on.grew?.();
    expect(scroller.scrollTop).toBe(500);
    expect(ended).toBe(1);
    expect(on).toEqual({ ms: PLACE_HOLD_MS });
  });

  it('holds nothing when the place is there at once', () => {
    const scroller = scrollerOf(664);
    const { on, watch } = watched();
    expect(holdPlace(scroller, 500, watch)).toBeNull();
    expect(scroller.scrollTop).toBe(500);
    expect(on).toEqual({});
  });

  it('lets go as soon as the author scrolls or moves on, or once the time is up, and when stopped', () => {
    for (const end of ['moved', 'done', 'stop'] as const) {
      const scroller = scrollerOf(254);
      const { on, watch } = watched();
      let ended = 0;
      const stop = holdPlace(scroller, 500, watch, () => (ended += 1));
      if (end === 'stop') stop?.();
      else on[end]?.();
      expect(ended, end).toBe(1);
      expect(on.grew, end).toBeUndefined();
      scroller.max = 664;
      expect(scroller.scrollTop, end).toBe(254);
      stop?.();
      expect(ended, end).toBe(1);
    }
  });
});
