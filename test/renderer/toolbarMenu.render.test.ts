import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../../src/renderer/components/Toolbar';
import { useApp } from '../../src/renderer/state/store';
import type { Review } from '../../src/shared/types';

/* polish.7: fewer toolbar buttons. Review with AI and Submit manual review
   became one menu, Review (With AI, Manual); Bulk became Actions, holding the
   bulk items, Copy result and Show backups; Save to chapter and Settings stay.
   The toolbar is rendered with react-dom/server, closed, as the page first
   draws it; what the menus do with the keys is in test/shared/menu.test.ts and
   how ToolbarMenu applies it is checked in its source in toolbarMenu.test.ts,
   since the tests run without a DOM. The keyboard walk in the window is in
   PLAN (polish.7). */

const REVIEW: Review = {
  version: 1,
  id: 'chapter--2026-10-22T09-00-00-000Z',
  sourcePath: 'C:/vault/Chapter 01.md',
  createdAt: '2026-10-22T09:00:00.000Z',
  updatedAt: '2026-10-22T09:00:00.000Z',
  base: { text: 'One.\n\nTwo.', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
  generator: { kind: 'manual' },
  hunks: [],
  comments: []
};

type AppState = ReturnType<typeof useApp.getState>;
let restore: Partial<AppState> = {};

/** The server render reads the store's initial state, so a test puts what it needs there, and it is put back. */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  restore = Object.fromEntries(Object.keys(patch).map((k) => [k, initial[k as keyof AppState]]));
  Object.assign(initial, patch);
}

afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
});

const noop = (): void => undefined;

function render(review: Review | null, running = false): string {
  return renderToStaticMarkup(
    createElement(Toolbar, {
      review,
      running,
      progressLabel: 'Waiting for the model (12s)',
      saving: false,
      sideFolded: false,
      singleScreen: false,
      onReviewWithAi: noop,
      onCancelReview: noop,
      onManualReview: noop,
      onSaveChapter: noop,
      onCopyResult: noop,
      onShowBackups: noop,
      onSettings: noop,
      onSaveHintDone: noop
    })
  );
}

/** The toolbar's buttons, each with its text and the attributes the tests read. */
function buttons(html: string): { text: string; attrs: string }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    text: (m[2] ?? '').replace(/<[^>]*>/g, '').trim()
  }));
}

const byText = (html: string, text: string): string => {
  const found = buttons(html).find((b) => b.text === text);
  expect(found, text).toBeDefined();
  return found?.attrs ?? '';
};

describe('the toolbar holds Review, Actions, Save to chapter and Settings (polish.7)', () => {
  it('in that order, with no button of the old names', () => {
    storeWith({ review: REVIEW });
    const html = render(REVIEW);
    expect(buttons(html).map((b) => b.text)).toEqual(['Review', 'Actions', 'Save to chapter', 'Settings']);
    for (const gone of ['Review with AI', 'Submit manual review', 'Bulk', 'Copy result', 'Show backups']) {
      expect(html, gone).not.toContain(`>${gone}<`);
    }
  });

  it('draws both menus closed, as menu buttons, and no list until one opens', () => {
    storeWith({ review: REVIEW });
    const html = render(REVIEW);
    for (const name of ['Review', 'Actions']) {
      const attrs = byText(html, name);
      expect(attrs).toContain('aria-haspopup="menu"');
      expect(attrs).toContain('aria-expanded="false"');
      expect(attrs).not.toContain('aria-controls');
      expect(attrs).not.toContain('disabled');
    }
    expect(html).not.toContain('role="menu"');
    expect(html.match(/<span class="menu">/g)).toHaveLength(2);
  });

  it('marks Review as the opener the two review dialogs hand the focus back to, and only Review', () => {
    storeWith({ review: REVIEW });
    const html = render(REVIEW);
    expect(byText(html, 'Review')).toContain('data-opens="review"');
    expect(byText(html, 'Actions')).not.toContain('data-opens');
    expect(byText(html, 'Settings')).toContain('data-opens="settings"');
  });

  it('turns both menus off with no review open, and Review off for pasted text, which has no chapter file', () => {
    storeWith({ review: null });
    let html = render(null);
    expect(byText(html, 'Review')).toContain('disabled');
    expect(byText(html, 'Actions')).toContain('disabled');
    const pasted: Review = { ...REVIEW, sourcePath: '' };
    storeWith({ review: pasted });
    html = render(pasted);
    expect(byText(html, 'Review')).toContain('disabled');
    expect(byText(html, 'Actions')).not.toContain('disabled');
  });

  it("puts a running review's progress and Cancel before Review, which stays, and turns Review off while it reviews this chapter", () => {
    storeWith({ review: REVIEW, aiBusyPath: 'C:/vault/Chapter 02.md' });
    let html = render(REVIEW, true);
    expect(buttons(html).map((b) => b.text)).toEqual([
      'Cancel',
      'Review',
      'Actions',
      'Save to chapter',
      'Settings'
    ]);
    expect(html).toContain('<span class="progress" aria-live="polite">Waiting for the model (12s)</span>');
    // Another chapter's review is running: Manual can still be used, so Review is on.
    expect(byText(html, 'Review')).not.toContain('disabled');
    storeWith({ review: REVIEW, aiBusyPath: REVIEW.sourcePath });
    html = render(REVIEW, true);
    expect(byText(html, 'Review')).toContain('disabled');
    // Copy result and Show backups still work while the chapter is read-only.
    expect(byText(html, 'Actions')).not.toContain('disabled');
  });
});
