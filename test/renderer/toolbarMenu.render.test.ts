import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Toolbar } from '../../src/renderer/components/Toolbar';
import { useApp } from '../../src/renderer/state/store';
import { createDiffReview } from '../../src/shared/review';
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

/**
 * The server render reads the store's initial state, so a test puts what it
 * needs there, and it is put back. Each field keeps the value it had before the
 * test's first change to it, so a test may call this more than once.
 */
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

function render(review: Review | null, running = false, saving = false, singleScreen = false): string {
  return renderToStaticMarkup(
    createElement(Toolbar, {
      review,
      running,
      progressLabel: 'Waiting for the model (12s)',
      saving,
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

/**
 * The toolbar's buttons, each with its text and the attributes the tests read;
 * an icon button, the eye or full screen (polish.23), by its accessible name.
 */
function buttons(html: string): { text: string; attrs: string }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
    const attrs = m[1] ?? '';
    const text = (m[2] ?? '').replace(/<[^>]*>/g, '').trim();
    return { attrs, text: text || (/aria-label="([^"]*)"/.exec(attrs)?.[1] ?? '') };
  });
}

const byText = (html: string, text: string): string => {
  const found = buttons(html).find((b) => b.text === text);
  expect(found, text).toBeDefined();
  return found?.attrs ?? '';
};

describe('the toolbar holds Review, Actions, Save to chapter, Full screen and Settings (polish.7, polish.23)', () => {
  it('in that order, with no button of the old names', () => {
    storeWith({ review: REVIEW });
    const html = render(REVIEW);
    expect(buttons(html).map((b) => b.text)).toEqual([
      'Review',
      'Actions',
      'Save to chapter',
      'Full screen',
      'Settings'
    ]);
    for (const gone of [
      'Review with AI',
      'Submit manual review',
      'Bulk',
      'Copy result',
      'Export HTML',
      'Show backups'
    ]) {
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
      'Full screen',
      'Settings'
    ]);
    expect(html).toContain('<span class="progress" aria-live="polite">Waiting for the model (12s)</span>');
    // Another chapter's review is running: Manual can still be used, so Review is on.
    expect(byText(html, 'Review')).not.toContain('disabled');
    storeWith({ review: REVIEW, aiBusyPath: REVIEW.sourcePath });
    html = render(REVIEW, true);
    expect(byText(html, 'Review')).toContain('disabled');
    // Copy result, Export HTML and Show backups still work while the chapter is read-only.
    expect(byText(html, 'Actions')).not.toContain('disabled');
  });
});

/* polish.9: Save to chapter is an ordinary button while there is nothing to
   save, and a primary one, in the turquoise, only while changes are waiting,
   or a save of them is under way. Disabled keeps the fade (app.css) over
   whichever that is. */
describe('Save to chapter is primary only while changes are waiting or saving (polish.9)', () => {
  /** REVIEW with one change the chapter file does not have: its one suggestion, accepted. */
  const ONE: Review = (() => {
    const diff = createDiffReview({
      originalRaw: 'The river had began.',
      correctedRaw: 'The river had begun.'
    });
    expect(diff.hunks).toHaveLength(1);
    return {
      ...REVIEW,
      base: diff.base,
      hunks: diff.hunks.map((h) => ({ ...h, status: 'accepted' as const }))
    };
  })();

  const save = (html: string): { text: string; attrs: string } => {
    const found = buttons(html).find((b) => /^Sav/.test(b.text));
    expect(found).toBeDefined();
    return found ?? { text: '', attrs: '' };
  };
  const primary = (attrs: string): boolean => /\bclass="primary"/.test(attrs);

  it('is plain with nothing to save, and primary at one change', () => {
    storeWith({ review: REVIEW });
    let button = save(render(REVIEW));
    expect(button.text).toBe('Save to chapter');
    expect(button.attrs).not.toContain('class=');
    expect(button.attrs).not.toContain('disabled');

    storeWith({ review: ONE });
    button = save(render(ONE));
    expect(button.text).toBe('Save 1 change to chapter');
    expect(primary(button.attrs)).toBe(true);
    expect(button.attrs).not.toContain('disabled');
  });

  it('is plain and disabled with no chapter open, as for pasted text', () => {
    storeWith({ review: null });
    let button = save(render(null));
    expect(button.text).toBe('Save to chapter');
    expect(button.attrs).toContain('disabled');
    expect(button.attrs).not.toContain('class=');

    const pasted: Review = { ...ONE, sourcePath: '' };
    storeWith({ review: pasted });
    button = save(render(pasted));
    expect(button.attrs).toContain('disabled');
    expect(primary(button.attrs)).toBe(false);
  });

  it('keeps the look the count gives while a review of the chapter runs, disabled', () => {
    storeWith({ review: REVIEW, aiBusyPath: REVIEW.sourcePath });
    let button = save(render(REVIEW, true));
    expect(button.attrs).toContain('disabled');
    expect(primary(button.attrs)).toBe(false);

    storeWith({ review: ONE, aiBusyPath: ONE.sourcePath });
    button = save(render(ONE, true));
    expect(button.text).toBe('Save 1 change to chapter');
    expect(button.attrs).toContain('disabled');
    expect(primary(button.attrs)).toBe(true);
  });

  it('stays primary while saving, disabled', () => {
    storeWith({ review: ONE });
    let button = save(render(ONE, false, true));
    expect(button.text).toBe('Saving…');
    expect(button.attrs).toContain('disabled');
    expect(primary(button.attrs)).toBe(true);

    // The chapter written and the count at 0, while the save still writes the review.
    storeWith({ review: REVIEW });
    button = save(render(REVIEW, false, true));
    expect(button.text).toBe('Saving…');
    expect(button.attrs).toContain('disabled');
    expect(primary(button.attrs)).toBe(true);
  });

  it('stays plain with only a paragraph box changed, until its Done makes it a change', () => {
    storeWith({
      review: REVIEW,
      drafts: { 0: { key: 0, paragraphs: [0], initial: 'One.', text: 'One more.' } }
    });
    const button = save(render(REVIEW));
    expect(button.text).toBe('Save to chapter');
    expect(button.attrs).toContain('You are asked first about the paragraph you are editing.');
    expect(primary(button.attrs)).toBe(false);
  });
});

/* polish.10: one bar at the top. The chapter's name went to the window's
   title, and the category chips took its place in the toolbar's row, before
   the buttons. polish.11: an eye before them shows or hides them all, each
   chip is one menu button named by its category and count, and the author's
   own edits have a chip of their own, You, last. */
describe('the category chips lead the toolbar (polish.10, polish.11)', () => {
  /** Three suggestions: two grammar, one punctuation. */
  const CHIPPED: Review = (() => {
    const diff = createDiffReview({
      originalRaw: 'The river had began. Its late, she said.\n\nThey was there.',
      correctedRaw: 'The river had begun. It is late, she said.\n\nThey were there.'
    });
    expect(diff.hunks).toHaveLength(3);
    const categories = ['grammar', 'punctuation', 'grammar'] as const;
    return {
      ...REVIEW,
      base: diff.base,
      hunks: diff.hunks.map((h, i) => ({ ...h, category: categories[i] }))
    };
  })();

  /** The same, with the last one an edit of the author's, accepted, as the paragraph box makes them. */
  const EDITED: Review = {
    ...CHIPPED,
    hunks: CHIPPED.hunks.map((h, i) =>
      i === 2
        ? { ...h, source: 'manual' as const, category: 'other' as const, status: 'accepted' as const }
        : h
    )
  };

  it('draws the eye, then a chip for each category, the most first, before Review, and no chapter name', () => {
    storeWith({ review: CHIPPED });
    const html = render(CHIPPED);
    expect(buttons(html).map((b) => b.text)).toEqual([
      'Hide all categories',
      'grammar 2',
      'punctuation 1',
      'Review',
      'Actions',
      'Save to chapter',
      'Full screen',
      'Settings'
    ]);
    expect(html).toContain('role="group" aria-label="Filter suggestions by category"');
    expect(html).not.toContain('Chapter 01');
    expect(html).not.toContain('toolbar__name');
  });

  it('makes each chip one menu button, its description saying whether it is shown, with no ▾', () => {
    storeWith({ review: CHIPPED });
    const html = render(CHIPPED);
    const chip = buttons(html).find((b) => b.text === 'grammar 2')?.attrs ?? '';
    expect(chip).toContain('class="chip__button"');
    expect(chip).toContain('aria-haspopup="menu"');
    expect(chip).toContain('aria-expanded="false"');
    expect(chip).not.toContain('aria-pressed');
    expect(chip).not.toContain('tabindex');
    expect(chip).toContain('title="Shown. Click for Hide, Show only, Accept all and Dismiss all."');
    expect(html).not.toContain('chip__more');
    // Closed, no list is drawn, and while the chips fit no arrow and no line.
    expect(html).not.toContain('role="menu"');
    expect(html).not.toContain('chips__arrow');
    expect(html).not.toContain('chips__line');
    // Drawn at the largest step until the window has measured them.
    expect(html).toContain('class="chips" data-chip-step="0"');
  });

  it('opens the eye while every chip is shown, and closes it once one is hidden, named by what it does', () => {
    storeWith({ review: CHIPPED, hiddenCategories: [] });
    let eye = buttons(render(CHIPPED)).find((b) => b.attrs.includes('chips__eye'))?.attrs ?? '';
    expect(eye).toContain('aria-label="Hide all categories"');
    expect(eye).toContain('title="Hide all categories"');
    storeWith({ review: CHIPPED, hiddenCategories: ['punctuation'] });
    eye = buttons(render(CHIPPED)).find((b) => b.attrs.includes('chips__eye'))?.attrs ?? '';
    expect(eye).toContain('aria-label="Show all categories"');
    // A hidden category with no chip leaves it open.
    storeWith({ review: CHIPPED, hiddenCategories: ['spelling'] });
    eye = buttons(render(CHIPPED)).find((b) => b.attrs.includes('chips__eye'))?.attrs ?? '';
    expect(eye).toContain('aria-label="Hide all categories"');
  });

  it("gives the author's own edits a chip of their own, You, last, which other no longer counts", () => {
    storeWith({ review: EDITED });
    const html = render(EDITED);
    expect(buttons(html).map((b) => b.text)).toEqual([
      'Hide all categories',
      'grammar 1',
      'punctuation 1',
      'You 1',
      'Review',
      'Actions',
      'Save 1 change to chapter',
      'Full screen',
      'Settings'
    ]);
    expect(html).toContain('class="chip cat-you"');
    expect(html).not.toContain('class="chip cat-other');
    expect(buttons(html).find((b) => b.text === 'You 1')?.attrs).toContain(
      'title="Your own edits. Shown. Click for Hide, Show only, Accept all and Dismiss all."'
    );
  });

  it('marks a hidden chip, and fades the row and the eye while a review of the chapter runs', () => {
    storeWith({ review: EDITED, hiddenCategories: ['punctuation', 'you'] });
    let html = render(EDITED);
    expect(buttons(html).find((b) => b.text === 'punctuation 1')?.attrs).toContain(
      'title="Hidden. Click for Show, Show only, Accept all and Dismiss all."'
    );
    expect(html).toContain('class="chip cat-punctuation chip--off"');
    expect(html).toContain('class="chip cat-you chip--off"');
    storeWith({ review: CHIPPED, hiddenCategories: [], aiBusyPath: CHIPPED.sourcePath });
    html = render(CHIPPED, true);
    expect(html).toContain('class="chips-bar chips--locked" inert=""');
    expect(html.indexOf('chips__eye')).toBeGreaterThan(html.indexOf('chips--locked'));
  });

  it('draws the copy the steps are measured from, out of sight and hidden from screen readers', () => {
    storeWith({ review: CHIPPED });
    const html = render(CHIPPED);
    expect(html).toContain('class="chips__measure" aria-hidden="true"');
    expect(html.match(/class="chips__measure-row" data-chip-step="\d"/g)).toEqual([
      'class="chips__measure-row" data-chip-step="0"',
      'class="chips__measure-row" data-chip-step="1"',
      'class="chips__measure-row" data-chip-step="2"',
      'class="chips__measure-row" data-chip-step="3"'
    ]);
    // Its chips are words, not buttons.
    const copy = html.slice(html.indexOf('class="chips__measure"'), html.indexOf('<span class="menu">'));
    expect(copy).toContain('<span class="chip__button">grammar <span class="chip__count">2</span></span>');
    expect(copy).not.toContain('<button');
  });

  it('draws none behind the Setup screen or the welcome guide, nor with no review open', () => {
    storeWith({ review: CHIPPED });
    expect(render(CHIPPED, false, false, true)).not.toContain('class="chip');
    storeWith({ review: null });
    expect(render(null)).not.toContain('class="chip');
  });
});

/* rr.6: the Mode select left its strip above the prose for the toolbar's
   left, before the eye. It is drawn while a chapter is on screen, at the
   chips' step (the largest until the window has measured them, and with no
   chips), outside the chips' bar, which a review of the chapter makes inert,
   and its copy at every step is in the chips' copy out of sight. What it
   does on a choice and with the keys is in modes.test.ts and
   modes.render.test.ts; its steps' CSS in chipsRow.test.ts. */
describe('the Mode select leads the toolbar (rr.6)', () => {
  /** Two suggestions, grammar and punctuation. */
  const TWO: Review = (() => {
    const diff = createDiffReview({
      originalRaw: 'The river had began. Its late, she said.',
      correctedRaw: 'The river had begun. It is late, she said.'
    });
    expect(diff.hunks).toHaveLength(2);
    const categories = ['grammar', 'punctuation'] as const;
    return {
      ...REVIEW,
      base: diff.base,
      hunks: diff.hunks.map((h, i) => ({ ...h, category: categories[i] }))
    };
  })();

  const SELECT = '<select id="mode-select" class="mode-select__field"';

  it('is the first thing in the toolbar, before the eye, the chips and Review, and the first Tab stop', () => {
    storeWith({ review: TWO, viewMode: 'main', drafts: {} });
    const html = render(TWO);
    expect(html).toMatch(
      /^<header class="toolbar"><div class="mode-select" data-chip-step="0"><label class="mode-select__label" for="mode-select">Mode<\/label><select id="mode-select" class="mode-select__field" title="Main reviews the suggestions\./
    );
    const select = html.indexOf(SELECT);
    expect(select).toBeLessThan(html.indexOf('<div class="chips-bar'));
    expect(select).toBeLessThan(html.indexOf('chips__eye'));
    expect(select).toBeLessThan(html.indexOf('>Review'));
    // Nothing before it takes the focus.
    expect(html.slice(0, select)).not.toMatch(/<button|<select|<input|tabindex="0"/);
    // One select of the window's mode; the copies have no id.
    expect(html.split('id="mode-select"')).toHaveLength(2);
  });

  it('shows the mode of the window', () => {
    storeWith({ review: TWO, viewMode: 'preview', drafts: {} });
    expect(render(TWO)).toMatch(/<option value="preview" selected="">Preview<\/option>/);
  });

  it('stands at the left alone with no chips, at the largest step, before Review', () => {
    storeWith({ review: REVIEW, viewMode: 'main', drafts: {} });
    const html = render(REVIEW);
    expect(html).toMatch(/^<header class="toolbar"><div class="mode-select" data-chip-step="0">/);
    expect(html).not.toContain('chips-bar');
    expect(html.match(/<select/g)).toHaveLength(1);
    expect(html.indexOf(SELECT)).toBeLessThan(html.indexOf('>Review'));
  });

  it('stays out of the chips bar, so it is in reach while a review of the chapter runs', () => {
    storeWith({ review: TWO, viewMode: 'main', drafts: {}, aiBusyPath: TWO.sourcePath });
    const html = render(TWO, true);
    const bar = html.indexOf('<div class="chips-bar chips--locked" inert="">');
    expect(bar).toBeGreaterThan(0);
    const mode = html.slice(0, bar);
    expect(mode).toContain(SELECT);
    expect(mode).toMatch(/<\/select><\/div>$/);
    expect(mode).not.toContain('inert');
    expect(mode).not.toContain('disabled');
  });

  it('has its copy at every step after the chips in the copy out of sight, with no id and out of the Tab order', () => {
    storeWith({ review: TWO, viewMode: 'main', drafts: {} });
    const html = render(TWO);
    const copy = html.slice(html.indexOf('class="chips__measure"'), html.indexOf('<span class="menu">'));
    expect(
      copy.match(
        /<div class="mode-select" data-chip-step="\d"><span class="mode-select__label">Mode<\/span>/g
      )
    ).toEqual(
      [0, 1, 2, 3].map(
        (at) => `<div class="mode-select" data-chip-step="${at}"><span class="mode-select__label">Mode</span>`
      )
    );
    expect(copy.lastIndexOf('chips__measure-row')).toBeLessThan(copy.indexOf('<div class="mode-select"'));
    expect(copy.match(/<select class="mode-select__field" tabindex="-1">/g)).toHaveLength(4);
    expect(copy).not.toContain('id="mode-select"');
    expect(copy).not.toContain('<label');
  });

  it('is not drawn behind the Setup screen or the welcome guide, nor with no review open', () => {
    storeWith({ review: TWO });
    expect(render(TWO, false, false, true)).not.toContain('mode-select');
    storeWith({ review: null });
    expect(render(null)).not.toContain('mode-select');
  });
});
