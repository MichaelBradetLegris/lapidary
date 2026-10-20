import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createErrorReporter, PAGE_CARD_INTERVAL_MS } from '../../src/renderer/state/errorReport';
import { REPEAT_MS } from '../../src/shared/diagnostics/errorFilter';
import { loggableErrorFields } from '../../src/shared/diagnostics/redact';
import type { RendererLogLine } from '../../src/shared/ipc';
import { PAGE_ERROR_CARD, PAGE_ERROR_TEXT } from '../../src/shared/ui/crash';

/* hardening.4: the page's unexpected errors go to main's log (`log:renderer`),
   and an error nothing caught leaves a card. The window is a plain
   EventTarget here, so the test runs in node. */

function reporter() {
  const lines: RendererLogLine[] = [];
  let cards = 0;
  let at = 1_000_000;
  const report = createErrorReporter(
    {
      send: (line) => void lines.push(line),
      showCard: () => {
        cards += 1;
      }
    },
    { now: () => at }
  );
  return {
    report,
    lines,
    cards: (): number => cards,
    advance: (ms: number): void => {
      at += ms;
    }
  };
}

/** A window `error` event as Chromium dispatches it: the error, and its message. */
function errorEvent(error: unknown, message?: string): Event {
  return Object.assign(new Event('error'), { error, message });
}

function rejectionEvent(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

describe('the window events', () => {
  it('logs an error nothing caught, with its loggable fields, and shows the card', () => {
    const r = reporter();
    const target = new EventTarget();
    r.report.install(target);
    const err = new TypeError("Cannot read properties of undefined (reading 'hunks')");
    target.dispatchEvent(errorEvent(err, `Uncaught ${String(err)}`));
    expect(r.lines).toEqual([{ kind: 'error', fields: loggableErrorFields(err) }]);
    expect(r.cards()).toBe(1);
  });

  it('logs a rejection nothing handled, and shows no card', () => {
    const r = reporter();
    const target = new EventTarget();
    r.report.install(target);
    target.dispatchEvent(
      rejectionEvent(Object.assign(new Error('Review cancelled.'), { name: 'ApiError', code: 'cancelled' }))
    );
    expect(r.lines).toEqual([
      { kind: 'rejection', fields: { code: 'cancelled', message: 'Review cancelled.' } }
    ]);
    expect(r.cards()).toBe(0);
  });

  it("drops Chromium's ResizeObserver notice, which comes with no error object", () => {
    const r = reporter();
    const target = new EventTarget();
    r.report.install(target);
    target.dispatchEvent(errorEvent(null, 'ResizeObserver loop completed with undelivered notifications.'));
    expect(r.lines).toEqual([]);
    expect(r.cards()).toBe(0);
    // Another error with no object stands on its message.
    target.dispatchEvent(errorEvent(null, 'Script error.'));
    expect(r.lines).toEqual([{ kind: 'error', fields: { name: 'Error', message: 'Script error.' } }]);
  });

  it('logs the same error once a minute, and its repeats bring no new card', () => {
    const r = reporter();
    const target = new EventTarget();
    r.report.install(target);
    const fire = (): void => {
      try {
        throw new Error('every frame');
      } catch (err) {
        target.dispatchEvent(errorEvent(err));
      }
    };
    for (let i = 0; i < 10; i += 1) fire();
    expect(r.lines).toHaveLength(1);
    expect(r.cards()).toBe(1);
    r.advance(REPEAT_MS);
    fire();
    expect(r.lines).toHaveLength(2);
    expect(r.cards()).toBe(2);
  });

  it('shows the card at most once a minute, whatever the errors, as main does, and logs each one', () => {
    // hardening.4 review: a card closed came straight back with the next
    // different error, where 7.7 and section 5 say once a minute.
    const r = reporter();
    const target = new EventTarget();
    r.report.install(target);
    target.dispatchEvent(errorEvent(new Error('first')));
    r.advance(1_000);
    target.dispatchEvent(errorEvent(new Error('second, a different one')));
    r.advance(PAGE_CARD_INTERVAL_MS - 1_001);
    target.dispatchEvent(errorEvent(new TypeError('third')));
    expect(r.lines).toHaveLength(3);
    expect(r.cards()).toBe(1);
    // A minute after the card, the next error brings it again.
    r.advance(1);
    target.dispatchEvent(errorEvent(new Error('fourth')));
    expect(r.lines).toHaveLength(4);
    expect(r.cards()).toBe(2);
    expect(PAGE_CARD_INTERVAL_MS).toBe(60_000);
  });

  it('stops listening when uninstalled', () => {
    const r = reporter();
    const target = new EventTarget();
    const uninstall = r.report.install(target);
    uninstall();
    target.dispatchEvent(errorEvent(new Error('after')));
    target.dispatchEvent(rejectionEvent(new Error('after')));
    expect(r.lines).toEqual([]);
  });

  it('carries on when sending fails', () => {
    let cards = 0;
    const report = createErrorReporter({
      send: () => {
        throw new Error('no bridge');
      },
      showCard: () => {
        cards += 1;
      }
    });
    expect(() => report.error(new Error('x'))).not.toThrow();
    expect(cards).toBe(1);
  });
});

describe('errors in drawing the page', () => {
  const stack = [
    '',
    '    at Thrower (http://localhost:5173/src/renderer/components/Thrower.tsx:3:9)',
    '    at div',
    '    at App (http://localhost:5173/src/renderer/App.tsx:40:3)',
    '    at ErrorBoundary (http://localhost:5173/src/renderer/components/ErrorBoundary.tsx:20:5)'
  ].join('\n');

  it('logs one the boundary caught with the components it happened in, and shows no card', () => {
    const r = reporter();
    const err = new Error('render failed');
    r.report.render(err, stack);
    expect(r.lines).toEqual([
      { kind: 'render', fields: { ...loggableErrorFields(err), components: 'Thrower < App < ErrorBoundary' } }
    ]);
    expect(r.cards()).toBe(0);
  });

  it('logs one past the boundary as its own kind', () => {
    const r = reporter();
    r.report.render(new Error('the fallback failed'), null, 'render-uncaught');
    expect(r.lines[0]?.kind).toBe('render-uncaught');
    expect(r.lines[0]?.fields).not.toHaveProperty('components');
  });
});

describe('the wiring', () => {
  const read = (file: string): string =>
    readFileSync(path.join(__dirname, '../../src/renderer', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
  const MAIN = read('main.tsx');

  it('listens on the window before anything is drawn, sends through log:renderer and cards with Show diagnostics', () => {
    expect(MAIN).toContain("send: (line) => void call('log:renderer', line).catch(() => undefined),");
    expect(MAIN).toMatch(
      /showCard: \(\) =>\s*useApp\.getState\(\)\.upsertNotification\(PAGE_ERROR_CARD, 'error', PAGE_ERROR_TEXT, 'show-diagnostics'\)/
    );
    const install = MAIN.indexOf('reporter.install(window);');
    expect(install).toBeGreaterThan(0);
    expect(install).toBeLessThan(MAIN.indexOf('createRoot('));
    expect(PAGE_ERROR_CARD).toBe('page-error');
    expect(PAGE_ERROR_TEXT).toContain('Show diagnostics');
  });

  it('puts the boundary around App, logs what it catches, and handles what gets past it', () => {
    expect(MAIN).toMatch(
      /<ErrorBoundary\s+onError=\{\(error, componentStack\) => reporter\.render\(error, componentStack\)\}\s+fallback=\{<CrashFallback onReload=\{reload\} \/>\}\s*>\s*<App \/>\s*<\/ErrorBoundary>/
    );
    const uncaught = MAIN.slice(MAIN.indexOf('onUncaughtError:'), MAIN.indexOf('}).render('));
    expect(uncaught).toContain("reporter.render(error, info.componentStack, 'render-uncaught');");
    expect(uncaught).toContain('installCrashedPageGuard(CLOSE_GUARD_IO, PAGE_WRITES, { questions: false });');
    expect(uncaught).toContain('void writeAfterCrash(CRASH_WRITES);');
    expect(uncaught).toContain('showBareFallback(document, reload);');
    expect(MAIN).toContain('const reload = (): void => window.location.reload();');
  });
});
