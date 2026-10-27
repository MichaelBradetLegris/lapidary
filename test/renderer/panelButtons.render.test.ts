import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../../src/renderer/components/Toolbar';
import { useApp, type AppState } from '../../src/renderer/state/store';
import { defaultSettings } from '../../src/shared/settings';
import type { ColumnShares, Review } from '../../src/shared/types';
import { USUAL_COLUMN_WIDTHS } from '../../src/shared/ui/columns';

/* polish.28: the side columns' buttons at the toolbar's two ends, in place
   of polish.26's carets: the chapter list's first, before the Mode select,
   the side panel's last, after Settings and full screen, each hiding its
   column or bringing it back. Rendered with react-dom/server, as the page
   first draws the toolbar; what a press writes and where the focus goes are
   in panelButtons.test.ts, the layout in test/shared/columns.test.ts, and the
   window checks (both themes, each column hidden and both, the keys) in PLAN
   (polish.28). */

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-26T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter 01.md',
  createdAt: '2026-10-26T09:00:00.000Z',
  updatedAt: '2026-10-26T09:00:00.000Z',
  base: { text: 'One.\n\nTwo.', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [],
  comments: []
};

let restore: Partial<AppState> = {};

/** The server render reads the store's initial state; each field is put back after the test. */
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

function render(review: Review | null, singleScreen = false): string {
  return renderToStaticMarkup(
    createElement(Toolbar, {
      review,
      running: false,
      progressLabel: '',
      saving: false,
      sideFolded: false,
      singleScreen,
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
}

/** The columns' widths and flags in the store's settings. */
function columns(patch: Partial<ColumnShares>): void {
  storeWith({ settings: { ...defaultSettings(), columnWidths: { ...USUAL_COLUMN_WIDTHS, ...patch } } });
}

/** The toolbar's buttons in order, with their attributes and inner markup. */
function buttons(html: string): { attrs: string; inner: string; name: string }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const attrs = m[1] ?? '';
    const inner = m[2] ?? '';
    const words = inner.replace(/<[^>]*>/g, '').trim();
    return { attrs, inner, name: words || (/aria-label="([^"]*)"/.exec(attrs)?.[1] ?? '') };
  });
}

const panel = (html: string, column: 'files' | 'side'): { attrs: string; inner: string; name: string } => {
  const found = buttons(html).find((b) => b.attrs.includes(`toolbar__panel--${column}`));
  expect(found, column).toBeDefined();
  return found ?? { attrs: '', inner: '', name: '' };
};

/** The filled panes, as icons.tsx draws them. */
const LEFT_PANE = 'd="M3.5 2.5H6v11H3.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" fill="currentColor"';
const RIGHT_PANE = 'd="M10 2.5h2.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10z" fill="currentColor"';
const OUTLINE = '<rect x="1.5" y="2.5" width="13" height="11" rx="2"></rect>';

describe("the columns' buttons at the toolbar's ends (polish.28)", () => {
  it('puts the chapter list first and the side panel last, after Settings and full screen', () => {
    storeWith({ review: REVIEW });
    columns({});
    const html = render(REVIEW);
    expect(buttons(html).map((b) => b.name)).toEqual([
      'Hide the chapter list',
      'Review',
      'Actions',
      'Save to chapter',
      'Settings',
      'Full screen',
      'Hide the side panel'
    ]);
  });

  it('stands outside the row that wraps, each in an end of its own, full screen beside the side panel', () => {
    storeWith({ review: REVIEW });
    columns({});
    const html = render(REVIEW);
    const main = html.indexOf('<div class="toolbar__main">');
    const ends = [...html.matchAll(/<span class="toolbar__end">/g)].map((m) => m.index ?? -1);
    expect(ends).toHaveLength(2);
    expect(ends[0]).toBeLessThan(main);
    expect(ends[1]).toBeGreaterThan(html.indexOf('data-opens="settings"'));
    const rowEnd = html.indexOf('</div><span class="toolbar__end">');
    expect(rowEnd).toBeGreaterThan(main);
    const row = html.slice(main, rowEnd);
    for (const out of ['toolbar__panel', 'toolbar__full-screen']) expect(row, out).not.toContain(out);
    expect(html.slice(rowEnd)).toMatch(
      /^<\/div><span class="toolbar__end"><button[^>]*toolbar__full-screen[\s\S]*?<\/button><button[^>]*toolbar__panel--side[\s\S]*?<\/button><\/span>/
    );
  });

  it('names each for what a press does, with its tooltip, and controls its column', () => {
    storeWith({ review: REVIEW });
    columns({});
    const html = render(REVIEW);
    const files = panel(html, 'files');
    expect(files.attrs).toContain('type="button"');
    expect(files.attrs).toContain('class="toolbar__icon toolbar__panel toolbar__panel--files"');
    expect(files.attrs).toContain('aria-label="Hide the chapter list"');
    expect(files.attrs).toContain('title="Hide the chapter list"');
    expect(files.attrs).toContain('aria-controls="drawer-files"');
    const side = panel(html, 'side');
    expect(side.attrs).toContain('class="toolbar__icon toolbar__panel toolbar__panel--side"');
    expect(side.attrs).toContain('aria-label="Hide the side panel"');
    expect(side.attrs).toContain('title="Hide the side panel"');
    expect(side.attrs).toContain('aria-controls="drawer-side"');
    for (const b of [files, side]) {
      // The name says the state; aria-expanded or aria-pressed beside it would say it twice.
      expect(b.attrs).not.toContain('aria-expanded');
      expect(b.attrs).not.toContain('aria-pressed');
      expect(b.attrs).not.toContain('disabled');
      expect(b.inner).toContain('aria-hidden="true"');
    }
  });

  it('fills the pane while its column shows, and leaves it hollow while it is hidden', () => {
    storeWith({ review: REVIEW });
    columns({});
    let html = render(REVIEW);
    expect(panel(html, 'files').inner).toContain(LEFT_PANE);
    expect(panel(html, 'side').inner).toContain(RIGHT_PANE);
    for (const column of ['files', 'side'] as const) expect(panel(html, column).inner).toContain(OUTLINE);
    expect(panel(html, 'files').inner).toContain('<path d="M6 2.5v11"></path>');
    expect(panel(html, 'side').inner).toContain('<path d="M10 2.5v11"></path>');

    columns({ filesHidden: true, sideHidden: true });
    html = render(REVIEW);
    const files = panel(html, 'files');
    const side = panel(html, 'side');
    expect(files.attrs).toContain('aria-label="Show the chapter list"');
    expect(files.attrs).toContain('title="Show the chapter list"');
    expect(side.attrs).toContain('aria-label="Show the side panel"');
    expect(side.attrs).toContain('title="Show the side panel"');
    expect(files.inner).not.toContain('fill="currentColor"');
    expect(side.inner).not.toContain('fill="currentColor"');
    expect(files.inner).toContain(OUTLINE);
    expect(side.inner).toContain(OUTLINE);
  });

  it('reads each flag on its own, and shows both before the settings are read', () => {
    storeWith({ review: REVIEW });
    columns({ sideHidden: true, files: 0.3 });
    let html = render(REVIEW);
    expect(panel(html, 'files').name).toBe('Hide the chapter list');
    expect(panel(html, 'side').name).toBe('Show the side panel');
    columns({ filesHidden: true });
    html = render(REVIEW);
    expect(panel(html, 'files').name).toBe('Show the chapter list');
    expect(panel(html, 'side').name).toBe('Hide the side panel');
    storeWith({ settings: null });
    html = render(REVIEW);
    expect(panel(html, 'files').name).toBe('Hide the chapter list');
    expect(panel(html, 'side').name).toBe('Hide the side panel');
  });

  it('is there with no chapter open, and not over the Setup screen or the welcome guide', () => {
    columns({});
    storeWith({ review: null });
    let html = render(null);
    expect(buttons(html).map((b) => b.name)).toEqual([
      'Hide the chapter list',
      'Review',
      'Actions',
      'Save to chapter',
      'Settings',
      'Full screen',
      'Hide the side panel'
    ]);
    for (const review of [REVIEW, null]) {
      storeWith({ review });
      html = render(review, true);
      expect(html).not.toContain('toolbar__panel');
      expect(html).not.toContain('aria-controls="drawer-');
      // Full screen is the last thing there, still at the end and outside the row.
      expect(
        buttons(html)
          .map((b) => b.name)
          .slice(-2)
      ).toEqual(['Settings', 'Full screen']);
      expect(html).toContain('<span class="toolbar__end"><button');
      expect(html.match(/<span class="toolbar__end">/g)).toHaveLength(1);
    }
  });
});
