import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { FocusOverlay, FocusOverlayView } from '../../src/renderer/components/FocusOverlay';
import { FOCUS_OVERLAY_CLOSED, useFocusOverlay, useFullScreen } from '../../src/renderer/state/fullScreen';
import { FOCUS_OVERLAY_FOCUS_FALLBACK } from '../../src/shared/ui/dialog';
import type { FocusHoldSeconds, FocusModeState } from '../../src/shared/ui/focusMode';

/* focus.1: focus mode's overlay, rendered with react-dom/server: the count in
   a ring that fills as the time runs, the task's words under it, and the
   overlay over everything, which a click closes. Its keys and timing are
   test/renderer/focusMode.render.test.ts; its click, its wiring into App and
   its layer are checked in their source in focusMode.test.ts, since the
   tests run without a DOM. */

const decode = (html: string): string =>
  html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const text = (html: string): string =>
  decode(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

function view(seconds: FocusHoldSeconds, elapsedMs: number): string {
  return renderToStaticMarkup(
    createElement(FocusOverlayView, { seconds, elapsedMs, titleId: 'title', textId: 'text' })
  );
}

/** The arc's dash offset: 100 is an empty ring, 0 a full one. */
const offset = (html: string): number => Number(/stroke-dashoffset="([^"]+)"/.exec(html)?.[1]);

/** The server render reads a store's initial state, so a test sets it there and puts it back. */
function drawn(
  open: Partial<ReturnType<typeof useFocusOverlay.getState>>,
  focus: FocusModeState = { holdSeconds: 30 }
): void {
  Object.assign(useFocusOverlay.getInitialState(), FOCUS_OVERLAY_CLOSED, open);
  useFullScreen.getInitialState().focus = focus;
}

afterEach(() => {
  Object.assign(useFocusOverlay.getInitialState(), FOCUS_OVERLAY_CLOSED);
  useFullScreen.getInitialState().focus = null;
});

describe("the overlay's view (focus.1)", () => {
  it("shows the count in the middle of an empty ring, and the task's words under it, while it waits", () => {
    const html = view(15, 0);
    expect(text(html)).toBe(
      "0 / 15 s You're in focus mode. Are you sure you want to exit? Hold F11 or Esc for 15 seconds to exit. Press any other key or click to resume."
    );
    // The track alone: no arc until the count starts, which left a sliver at the top.
    expect(html).toContain('class="focus-overlay__track"');
    expect(html).not.toContain('focus-overlay__arc');
    expect(decode(html)).toContain(`<h2 id="title">You're in focus mode.</h2>`);
    expect(html).toContain(
      '<p id="text" class="focus-overlay__text"><span>Are you sure you want to exit?</span>'
    );
  });

  it('fills the ring and counts the whole seconds held', () => {
    const html = view(30, 12_400);
    expect(text(html).startsWith('12 / 30 s ')).toBe(true);
    expect(offset(html)).toBeCloseTo(100 - (12_400 / 30_000) * 100, 6);
    expect(offset(view(30, 30_000))).toBe(0);
    expect(text(view(60, 59_999)).startsWith('59 / 60 s ')).toBe(true);
    expect(text(view(60, 61_000)).startsWith('60 / 60 s ')).toBe(true);
  });

  it('gives the ring a name and a value a screen reader reads, the drawing hidden from it', () => {
    const html = view(30, 12_400);
    expect(html).toContain(
      'role="progressbar" aria-label="Time held" aria-valuemin="0" aria-valuemax="30" aria-valuenow="12" aria-valuetext="12 of 30 seconds held"'
    );
    expect(html).toContain('<svg viewBox="0 0 120 120" aria-hidden="true">');
  });

  it('draws the ring with no colour of its own: its two circles take theirs from app.css', () => {
    const html = view(30, 1000);
    expect(html).toContain(
      '<circle class="focus-overlay__track" cx="60" cy="60" r="52" fill="none"></circle>'
    );
    expect(html).toContain('class="focus-overlay__arc"');
    expect(html).toContain('pathLength="100" stroke-dasharray="100 100"');
    expect(html).toContain('transform="rotate(-90 60 60)"');
    expect(html).not.toMatch(/\sstroke="/);
  });
});

describe('the overlay (focus.1)', () => {
  it('is drawn only while it is open in focus mode', () => {
    expect(renderToStaticMarkup(createElement(FocusOverlay))).toBe('');
    drawn({ open: false });
    expect(renderToStaticMarkup(createElement(FocusOverlay))).toBe('');
    drawn({ open: true });
    useFullScreen.getInitialState().focus = null;
    expect(renderToStaticMarkup(createElement(FocusOverlay))).toBe('');
  });

  it('covers the window as an alert dialog named by its heading and described by its words, with a box that takes the focus', () => {
    drawn({ open: true });
    const html = renderToStaticMarkup(createElement(FocusOverlay));
    const opening =
      /^<div class="modal-backdrop modal-backdrop--focus" role="alertdialog" aria-modal="true" aria-labelledby="([^"]+)" aria-describedby="([^"]+)"><div class="modal focus-overlay" tabindex="-1">/.exec(
        html
      );
    expect(opening).not.toBeNull();
    expect(html).toContain(`<h2 id="${opening?.[1] ?? ''}">`);
    expect(html).toContain(`<p id="${opening?.[2] ?? ''}" class="focus-overlay__text">`);
    expect(text(html)).toContain('0 / 30 s');
    expect(text(html)).toContain('Hold F11 or Esc for 30 seconds to exit.');
  });

  it('shows the hold time focus mode was entered with', () => {
    drawn({ open: true }, { holdSeconds: 60 });
    expect(text(renderToStaticMarkup(createElement(FocusOverlay)))).toContain('0 / 60 s');
  });

  it('shows the ring full once the hold is done and main is asked to leave', () => {
    drawn({ open: true, holding: 'F11', heldCode: 'F11', since: 0, leaving: true });
    const html = renderToStaticMarkup(createElement(FocusOverlay));
    expect(text(html)).toContain('30 / 30 s');
    expect(offset(html)).toBe(0);
  });

  it('hands the focus back to a dialog open under it, or to nothing', () => {
    expect(FOCUS_OVERLAY_FOCUS_FALLBACK).toEqual(['.app-shell__dialogs .modal']);
  });
});
