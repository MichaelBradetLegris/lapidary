import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { showBareFallback } from '../../src/renderer/bareFallback';
import { CrashFallback } from '../../src/renderer/components/CrashFallback';
import { DiagnosticsPanel } from '../../src/renderer/components/DiagnosticsPanel';
import { ErrorBoundary } from '../../src/renderer/components/ErrorBoundary';
import { COPY_DIAGNOSTICS, DIAGNOSTICS_INTRO, DIAGNOSTICS_LOADING } from '../../src/shared/ui/diagnostics';
import {
  BARE_CRASH_TEXT,
  CRASH_LEAD,
  CRASH_REPORT,
  CRASH_TITLE,
  CRASH_WRITING,
  RELOAD_WINDOW
} from '../../src/shared/ui/crash';

/* hardening.4: the page shown when drawing the window failed, rendered with
   react-dom/server. Effects do not run here, so it shows the writes still
   under way and the report still being gathered, and nothing is asked of
   main. The boundary itself is driven through its own methods, since the
   server renderer has no error boundaries. Type-checked with the renderer's
   project (tsconfig.web.json). */

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const say = (text: string): string => escape(text).replace(/'/g, '&#x27;');

describe('CrashFallback', () => {
  const html = renderToStaticMarkup(createElement(CrashFallback, { onReload: () => undefined }));

  it('says what happened and that it is writing what the page holds', () => {
    expect(html).toContain(`<h1>${CRASH_TITLE}</h1>`);
    expect(html).toContain(say(CRASH_LEAD));
    expect(html).toContain(`<p class="crash__status" role="status">${say(CRASH_WRITING)}</p>`);
  });

  it('holds Reload window, the blue button, until the writes are done, rather than disabling it', () => {
    const reload = /<button type="button" class="primary"[^>]*>([^<]*)<\/button>/.exec(html);
    expect(reload?.[1]).toBe(RELOAD_WINDOW);
    expect(reload?.[0]).toContain('aria-disabled="true"');
    expect(reload?.[0]).not.toContain('disabled=""');
  });

  it('offers Copy diagnostics with the report, as a plain button under Reload window', () => {
    expect(html).toContain(say(CRASH_REPORT));
    expect(html).toContain(say(DIAGNOSTICS_INTRO));
    expect(html).toMatch(
      new RegExp(`<button type="button" aria-disabled="true"[^>]*>${COPY_DIAGNOSTICS}</button>`)
    );
    expect(html).toContain(DIAGNOSTICS_LOADING);
    expect(html.indexOf(RELOAD_WINDOW)).toBeLessThan(html.indexOf(COPY_DIAGNOSTICS));
  });

  it("lays out as the Setup screen's scroller, with the page under a question inert", () => {
    expect(html).toMatch(
      /^<div class="app-shell"><div class="app-shell__page"><main class="setup crash"><div class="setup__page">/
    );
  });
});

describe('DiagnosticsPanel', () => {
  it('draws Copy blue unless told not to', () => {
    const props = {
      text: 'report',
      error: null,
      copyState: 'idle' as const,
      onCopy: () => undefined,
      onRetry: () => undefined
    };
    expect(renderToStaticMarkup(createElement(DiagnosticsPanel, props))).toContain(
      `<button type="button" class="primary">${COPY_DIAGNOSTICS}</button>`
    );
    expect(renderToStaticMarkup(createElement(DiagnosticsPanel, { ...props, copyPrimary: false }))).toContain(
      `<button type="button">${COPY_DIAGNOSTICS}</button>`
    );
  });
});

describe('ErrorBoundary', () => {
  const child = createElement('p', null, 'the app');
  const fallback = createElement('p', null, 'the crash page');

  it('draws its children until drawing them fails', () => {
    expect(
      renderToStaticMarkup(
        createElement(ErrorBoundary, { fallback, onError: () => undefined, children: child })
      )
    ).toBe('<p>the app</p>');
  });

  /** A boundary outside React, whose setState merges at once as React's would. */
  function boundaryWith(caught: [unknown, string | null | undefined][]): ErrorBoundary {
    const boundary = new ErrorBoundary({
      fallback,
      onError: (error, stack) => void caught.push([error, stack]),
      children: child
    });
    boundary.setState = (next) => {
      boundary.state = { ...boundary.state, ...(next as Partial<typeof boundary.state>) };
    };
    return boundary;
  }

  /** What React does when the boundary catches: the derived state, then componentDidCatch in the commit. */
  function caughtBy(boundary: ErrorBoundary, error: unknown, componentStack: string): void {
    boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError() };
    boundary.componentDidCatch(error, { componentStack });
  }

  it('turns to the fallback for good once an error is caught, and hands the error and its components on', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const caught: [unknown, string | null | undefined][] = [];
    const boundary = boundaryWith(caught);
    expect(boundary.render()).toBe(child);
    const err = new Error('render failed');
    caughtBy(boundary, err, '\n    at StatusBar');
    expect(caught).toEqual([[err, '\n    at StatusBar']]);
    expect(boundary.render()).toBe(fallback);
  });

  it('catches once: an error in the fallback is thrown from its own render, past it, and handed on by the root', () => {
    // React hands a boundary an error in any render where it has not already
    // caught one, and draws the fallback afresh, which writes and takes the
    // close guard again; an error that came back on that render went round
    // for good (hardening.4 review). React never hands a boundary its own
    // render's error, so this one reaches the root's onUncaughtError.
    const caught: [unknown, string | null | undefined][] = [];
    const boundary = boundaryWith(caught);
    const first = new Error('render failed');
    caughtBy(boundary, first, '\n    at StatusBar');
    expect(boundary.render()).toBe(fallback);
    const again = new Error('the crash page failed when its writes ended');
    caughtBy(boundary, again, '\n    at CrashFallback');
    expect(() => boundary.render()).toThrow(again);
    // Only the first is handed on here: the root's onUncaughtError logs the second.
    expect(caught).toEqual([[first, '\n    at StatusBar']]);
  });
});

describe('showBareFallback', () => {
  /** Just enough of a document: elements that keep their attributes, children and listeners. */
  class FakeElement {
    id = '';
    className = '';
    type = '';
    textContent = '';
    focused = false;
    readonly attributes = new Map<string, string>();
    readonly children: FakeElement[] = [];
    readonly listeners = new Map<string, () => void>();
    constructor(readonly tag: string) {}
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
    append(...nodes: FakeElement[]): void {
      this.children.push(...nodes);
    }
    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, listener);
    }
    focus(): void {
      this.focused = true;
    }
  }
  function fakeDocument() {
    const body = new FakeElement('body');
    const all = (): FakeElement[] => {
      const out: FakeElement[] = [];
      const walk = (e: FakeElement): void => {
        out.push(e);
        e.children.forEach(walk);
      };
      walk(body);
      return out;
    };
    const doc = {
      body,
      createElement: (tag: string) => new FakeElement(tag),
      getElementById: (id: string) => all().find((e) => e.id === id) ?? null
    };
    return { doc: doc as unknown as Document, body };
  }

  it('puts the heading, the line and a focused Reload window over the window, once', () => {
    const { doc, body } = fakeDocument();
    let reloads = 0;
    showBareFallback(doc, () => {
      reloads += 1;
    });
    showBareFallback(doc, () => undefined);
    expect(body.children).toHaveLength(1);
    const box = body.children[0]!;
    expect(box.className).toBe('bare-crash');
    expect(box.attributes.get('role')).toBe('alert');
    expect(box.children.map((c) => [c.tag, c.textContent])).toEqual([
      ['h1', CRASH_TITLE],
      ['p', BARE_CRASH_TEXT],
      ['button', RELOAD_WINDOW]
    ]);
    const button = box.children[2]!;
    expect(button.className).toBe('primary');
    expect(button.focused).toBe(true);
    button.listeners.get('click')?.();
    expect(reloads).toBe(1);
  });
});
