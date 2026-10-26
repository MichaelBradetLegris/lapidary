import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Legend } from '../../src/renderer/components/StatusBar';
import { Toolbar } from '../../src/renderer/components/Toolbar';
import { useDrawer } from '../../src/renderer/state/columns';
import {
  FULL_SCREEN_CARD,
  escapeTakers,
  installFullScreen,
  leaveFullScreen,
  toggleFullScreen,
  useFullScreen
} from '../../src/renderer/state/fullScreen';
import { useApp, type AppState } from '../../src/renderer/state/store';
import { normalizeSettings } from '../../src/shared/settings';
import type { ApiEventMap, IpcResult } from '../../src/shared/ipc';
import { WHOLE_DRAFT_KEY } from '../../src/shared/ui/drafts';
import type { Review } from '../../src/shared/types';

/* polish.23: the page's half of full screen. The toolbar's button before
   Settings, its words, icon and key; the legend's words; F11 and Escape in the
   keyboard bindings, what the button does when clicked and the page's class,
   checked in their source in fullScreen.test.ts since the tests run without a
   DOM; what takes Escape
   first, read from the store and the page; and the page's store, which asks
   main through a stubbed bridge and follows what it says. Main's half is
   test/main/fullScreen.test.ts. */

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

const noop = (): void => undefined;

function renderToolbar(review: Review | null, singleScreen = false): string {
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

/** The server render reads a store's initial state, so a test sets it there and puts it back. */
function drawnFullScreen(on: boolean): void {
  useFullScreen.getInitialState().on = on;
}

const appInitial = useApp.getInitialState();
const keptReview = appInitial.review;

afterEach(() => {
  useFullScreen.getInitialState().on = false;
  useFullScreen.setState({ on: false });
  appInitial.review = keptReview;
  vi.unstubAllGlobals();
});

/** The toolbar's buttons in order, with their attributes and inner markup. */
function buttons(html: string): { attrs: string; inner: string }[] {
  return [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    attrs: m[1] ?? '',
    inner: m[2] ?? ''
  }));
}

function fullScreenButton(html: string): { attrs: string; inner: string; index: number; count: number } {
  const all = buttons(html);
  const index = all.findIndex((b) => b.attrs.includes('toolbar__full-screen'));
  expect(index).toBeGreaterThanOrEqual(0);
  const found = all[index] ?? { attrs: '', inner: '' };
  return { ...found, index, count: all.length };
}

const ENTER_ICON = 'M9.5 2.5h4v4M13.5 2.5 9.3 6.7M6.5 13.5h-4v-4M2.5 13.5l4.2-4.2';
const LEAVE_ICON = 'M13.5 2.5 9.5 6.5M9.5 2.5v4h4M2.5 13.5l4-4M2.5 9.5h4v4';

describe("the toolbar's full-screen button (polish.23)", () => {
  it('stands at the right end, after Save to chapter and just before Settings', () => {
    appInitial.review = REVIEW;
    const html = renderToolbar(REVIEW);
    const all = buttons(html);
    const button = fullScreenButton(html);
    expect(button.index).toBe(button.count - 2);
    expect(all[button.index - 1]?.inner).toContain('Save to chapter');
    expect(all[button.index + 1]?.attrs).toContain('data-opens="settings"');
  });

  it('says Full screen with F11 in its tooltip, draws the arrows out, and is never disabled', () => {
    drawnFullScreen(false);
    const { attrs, inner } = fullScreenButton(renderToolbar(REVIEW));
    expect(attrs).toContain('type="button"');
    expect(attrs).toContain('aria-label="Full screen"');
    expect(attrs).toContain('title="Full screen (F11)"');
    expect(attrs).toContain('aria-keyshortcuts="F11"');
    expect(attrs).not.toContain('disabled');
    expect(attrs).not.toContain('hidden');
    expect(attrs).not.toContain('aria-pressed');
    expect(inner).toContain(`d="${ENTER_ICON}"`);
    expect(inner).toContain('aria-hidden="true"');
    expect(inner).not.toContain(LEAVE_ICON);
  });

  it('says Leave full screen in full screen, and draws the arrows back in', () => {
    drawnFullScreen(true);
    const { attrs, inner } = fullScreenButton(renderToolbar(REVIEW));
    expect(attrs).toContain('aria-label="Leave full screen"');
    expect(attrs).toContain('title="Leave full screen (F11)"');
    expect(attrs).toContain('aria-keyshortcuts="F11"');
    expect(inner).toContain(`d="${LEAVE_ICON}"`);
    expect(inner).not.toContain(ENTER_ICON);
  });

  it('is there with no chapter open, and over the Setup screen and the welcome guide', () => {
    for (const [review, single] of [
      [null, false],
      [REVIEW, true],
      [null, true]
    ] as const) {
      const html = renderToolbar(review, single);
      const button = fullScreenButton(html);
      expect(button.index).toBe(button.count - 2);
      expect(button.attrs).not.toContain('disabled');
    }
  });
});

describe('the legend names F11 and Escape (polish.23)', () => {
  it('in a paragraph at its foot', () => {
    const html = renderToStaticMarkup(createElement(Legend, { onClose: noop }));
    const text = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');
    expect(text).toContain(
      'F11, or the two arrows before Settings, puts the window in full screen and back. Escape leaves full screen too, unless something else is open, such as a dialog, a menu, the find bar or a box you are typing in.'
    );
    expect(html.match(/class="legend__foot"/g)).toHaveLength(2);
  });
});

describe('what takes Escape before full screen (polish.23)', () => {
  let popupOpen = false;
  const base = useApp.getState();

  beforeEach(() => {
    popupOpen = false;
    vi.stubGlobal('document', {
      querySelector: (selector: string) => (selector === '.menu__list, .legend' && popupOpen ? {} : null)
    });
    useDrawer.setState({ open: null });
    useApp.setState({
      settings: normalizeSettings({ onboardingDone: true }),
      welcomeClosed: false,
      review: REVIEW,
      drafts: {},
      viewMode: 'main',
      fullEditPending: null,
      editor: null,
      hoveredHunkId: null,
      find: { ...base.find, open: false },
      confirmSpec: null,
      settingsOpen: false,
      setupOpen: false,
      newChapterOpen: false,
      manualReviewOpen: false,
      reviewDialogOpen: false,
      diagnosticsOpen: null,
      aboutOpen: false,
      updateOverlay: false
    });
  });

  const takers = (): ReturnType<typeof escapeTakers> => escapeTakers(useApp.getState());
  const nothing = {
    modal: false,
    popup: false,
    hoverCard: false,
    find: false,
    editor: false,
    boxes: false,
    drawer: false
  };

  it('is nothing on a plain page, in Main and in Preview', () => {
    expect(takers()).toEqual(nothing);
    useApp.setState({ viewMode: 'preview' });
    expect(takers()).toEqual(nothing);
  });

  it('counts every dialog, the question, Setup, the welcome guide and the overlay as modal', () => {
    const covers: Partial<AppState>[] = [
      { settingsOpen: true },
      { setupOpen: true },
      { newChapterOpen: true },
      { manualReviewOpen: true },
      { reviewDialogOpen: true },
      { diagnosticsOpen: 'show' },
      { aboutOpen: true },
      { updateOverlay: true },
      { settings: normalizeSettings({ onboardingDone: false }) }
    ];
    for (const cover of covers) {
      useApp.setState(cover);
      expect(takers(), JSON.stringify(cover)).toEqual({ ...nothing, modal: true });
      useApp.setState({
        settingsOpen: false,
        setupOpen: false,
        newChapterOpen: false,
        manualReviewOpen: false,
        reviewDialogOpen: false,
        diagnosticsOpen: null,
        aboutOpen: false,
        updateOverlay: false,
        settings: normalizeSettings({ onboardingDone: true })
      });
    }
  });

  it('finds a menu or the legend in the page, and reads the hover card, the find bar and the editor', () => {
    popupOpen = true;
    expect(takers()).toEqual({ ...nothing, popup: true });
    popupOpen = false;
    useApp.setState({ hoveredHunkId: 'h1' });
    expect(takers()).toEqual({ ...nothing, hoverCard: true });
    useApp.setState({ hoveredHunkId: null, find: { ...base.find, open: true } });
    expect(takers()).toEqual({ ...nothing, find: true });
    useApp.setState({
      find: { ...base.find, open: false },
      editor: { kind: 'suggestion', hunkId: 'h1', initial: 'One', anchor: null, text: 'One' }
    });
    expect(takers()).toEqual({ ...nothing, editor: true });
  });

  it('counts a paragraph box in Main, Full edit and Full edit waiting to open as boxes', () => {
    const box = { key: 0, paragraphs: [0], initial: 'One.', text: 'One.' };
    useApp.setState({ drafts: { 0: box } });
    expect(takers()).toEqual({ ...nothing, boxes: true });
    const whole = { key: WHOLE_DRAFT_KEY, paragraphs: [], initial: 'x', text: 'x', whole: true };
    useApp.setState({ drafts: { [WHOLE_DRAFT_KEY]: whole } as AppState['drafts'] });
    expect(takers()).toEqual({ ...nothing, boxes: true });
    useApp.setState({ drafts: {}, fullEditPending: REVIEW.id });
    expect(takers()).toEqual({ ...nothing, boxes: true });
  });

  it('counts a paragraph box only in Main: one kept behind Preview is not drawn, and takes nothing', () => {
    const left = { key: 0, paragraphs: [0], initial: 'One.', text: 'One.' };
    const typed = { key: 1, paragraphs: [1], initial: 'Two.', text: 'Two, typed.' };
    const kept: AppState['drafts'][] = [{ 0: left }, { 1: typed }, { 0: left, 1: typed }];
    for (const drafts of kept) {
      useApp.setState({ drafts, viewMode: 'preview' });
      expect(takers(), JSON.stringify(drafts)).toEqual(nothing);
      useApp.setState({ viewMode: 'main' });
      expect(takers(), JSON.stringify(drafts)).toEqual({ ...nothing, boxes: true });
    }
    // Full edit is the mode whatever `viewMode` last said (`currentMode`), so its box counts either way.
    const whole = { key: WHOLE_DRAFT_KEY, paragraphs: [], initial: 'x', text: 'x', whole: true };
    useApp.setState({ drafts: { [WHOLE_DRAFT_KEY]: whole } as AppState['drafts'], viewMode: 'preview' });
    expect(takers()).toEqual({ ...nothing, boxes: true });
    useApp.setState({ drafts: {}, fullEditPending: REVIEW.id });
    expect(takers()).toEqual({ ...nothing, boxes: true });
  });

  it('counts an open drawer', () => {
    useDrawer.setState({ open: 'files' });
    expect(takers()).toEqual({ ...nothing, drawer: true });
  });
});

describe("the page's store asks main and follows it (polish.23)", () => {
  type Invoked = { channel: string; payload: unknown };
  let invoked: Invoked[];
  let answer: IpcResult<{ fullScreen: boolean }>;
  let listener: ((payload: ApiEventMap['window:full-screen-changed']) => void) | null;
  let removed: number;

  beforeEach(() => {
    invoked = [];
    answer = { ok: true, value: { fullScreen: true } };
    listener = null;
    removed = 0;
    useApp.setState({ notifications: [] });
    vi.stubGlobal('window', {
      api: {
        invoke: (channel: string, payload: unknown) => {
          invoked.push({ channel, payload });
          return Promise.resolve(answer);
        },
        on: (event: string, fn: typeof listener) => {
          expect(event).toBe('window:full-screen-changed');
          listener = fn;
          return () => {
            removed += 1;
          };
        }
      }
    });
  });

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('asks to toggle for F11 and the button, and to leave for Escape, taking main at its word', async () => {
    toggleFullScreen();
    await settle();
    expect(invoked).toEqual([{ channel: 'window:full-screen', payload: { action: 'toggle' } }]);
    expect(useFullScreen.getState().on).toBe(true);
    answer = { ok: true, value: { fullScreen: false } };
    leaveFullScreen();
    await settle();
    expect(invoked[1]).toEqual({ channel: 'window:full-screen', payload: { action: 'leave' } });
    expect(useFullScreen.getState().on).toBe(false);
  });

  it('reads where the window stands as it installs, and follows every change main reports', async () => {
    const off = installFullScreen();
    await settle();
    expect(invoked).toEqual([{ channel: 'window:full-screen', payload: { action: 'current' } }]);
    expect(useFullScreen.getState().on).toBe(true);
    listener?.({ fullScreen: false });
    expect(useFullScreen.getState().on).toBe(false);
    listener?.({ fullScreen: true });
    expect(useFullScreen.getState().on).toBe(true);
    off();
    expect(removed).toBe(1);
  });

  it('shows one card when main refuses, and changes nothing', async () => {
    answer = { ok: false, error: { code: 'unknown', message: 'The window has gone.' } };
    toggleFullScreen();
    toggleFullScreen();
    await settle();
    expect(useFullScreen.getState().on).toBe(false);
    const cards = useApp.getState().notifications;
    expect(cards).toHaveLength(1);
    expect(cards[0]?.key).toBe(FULL_SCREEN_CARD);
    expect(cards[0]?.tone).toBe('error');
    expect(cards[0]?.text).toBe('Full screen could not be changed: The window has gone.');
  });

  it('says nothing when the first read fails: a start is never full screen', async () => {
    answer = { ok: false, error: { code: 'unknown', message: 'No.' } };
    installFullScreen();
    await settle();
    expect(useFullScreen.getState().on).toBe(false);
    expect(useApp.getState().notifications).toEqual([]);
  });

  it('does nothing outside the app window, where there is no bridge', () => {
    vi.stubGlobal('window', {});
    const off = installFullScreen();
    expect(invoked).toEqual([]);
    off();
  });
});
