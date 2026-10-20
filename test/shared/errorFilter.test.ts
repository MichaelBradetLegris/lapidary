import { describe, expect, it } from 'vitest';
import {
  REPEAT_MS,
  createErrorFilter,
  createRateCap,
  errorSignature,
  isResizeObserverLoop
} from '../../src/shared/diagnostics/errorFilter';
import { MAX_COMPONENTS, componentNames, pageErrorFields } from '../../src/shared/diagnostics/pageError';
import { loggableErrorFields } from '../../src/shared/diagnostics/redact';

/* hardening.4: which unexpected errors reach the log, and how many. */

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

const boom = {
  name: 'TypeError',
  message: 'x is undefined',
  frames: 'at a (app.js:1:1) | at b (app.js:2:2)'
};

describe('createErrorFilter', () => {
  it('lets an error through once, then drops it for a minute, then lets it through again', () => {
    const time = clock();
    const filter = createErrorFilter({ now: time.now });
    expect(filter.accept('error', boom)).toBe(true);
    expect(filter.accept('error', boom)).toBe(false);
    time.advance(REPEAT_MS - 1);
    expect(filter.accept('error', boom)).toBe(false);
    time.advance(1);
    expect(filter.accept('error', boom)).toBe(true);
    // The minute counts from the last time it was let through, not from the last repeat.
    time.advance(REPEAT_MS / 2);
    expect(filter.accept('error', boom)).toBe(false);
    time.advance(REPEAT_MS / 2);
    expect(filter.accept('error', boom)).toBe(true);
  });

  it('tells errors apart by kind, name, code, message and where they were thrown', () => {
    const filter = createErrorFilter({ now: clock().now });
    expect(filter.accept('error', boom)).toBe(true);
    expect(filter.accept('rejection', boom)).toBe(true);
    expect(filter.accept('error', { ...boom, name: 'RangeError' })).toBe(true);
    expect(filter.accept('error', { ...boom, message: 'y is undefined' })).toBe(true);
    expect(filter.accept('error', { ...boom, frames: 'at c (app.js:9:9)' })).toBe(true);
    expect(filter.accept('error', { code: 'io', message: 'Could not save.' })).toBe(true);
    expect(filter.accept('error', { code: 'io-busy', message: 'Could not save.' })).toBe(true);
    expect(filter.accept('error', { error: 'a thrown string' })).toBe(true);
    // A deeper frame that differs does not make it another error.
    expect(filter.accept('error', { ...boom, frames: 'at a (app.js:1:1) | at z (app.js:7:7)' })).toBe(false);
  });

  it("drops Chromium's ResizeObserver notice, in either wording, every time", () => {
    const filter = createErrorFilter({ now: clock().now });
    for (const message of [
      'ResizeObserver loop completed with undelivered notifications.',
      'ResizeObserver loop limit exceeded'
    ]) {
      expect(filter.accept('error', { name: 'Error', message })).toBe(false);
      expect(filter.accept('error', { error: message })).toBe(false);
    }
    expect(isResizeObserverLoop({ message: 'ResizeObserver is not defined' })).toBe(false);
  });

  it('remembers a bounded number of errors, and forgets the oldest first', () => {
    const time = clock();
    const filter = createErrorFilter({ now: time.now });
    for (let i = 0; i < 500; i += 1) {
      expect(filter.accept('error', { name: 'Error', message: `distinct ${i}` })).toBe(true);
    }
    // The newest are still remembered; the first were forgotten to make room.
    expect(filter.accept('error', { name: 'Error', message: 'distinct 499' })).toBe(false);
    expect(filter.accept('error', { name: 'Error', message: 'distinct 0' })).toBe(true);
  });

  it('reads the signature from the first frame only', () => {
    expect(errorSignature('error', boom)).toBe(
      errorSignature('error', { ...boom, frames: 'at a (app.js:1:1)' })
    );
    expect(errorSignature('error', boom)).not.toBe(errorSignature('render', boom));
  });
});

describe('createRateCap', () => {
  it('lets 30 through in any minute, says once when it starts dropping, and has room again as the minute moves', () => {
    const time = clock();
    const cap = createRateCap({ limit: 30, windowMs: 60_000, now: time.now });
    for (let i = 0; i < 30; i += 1) {
      expect(cap.take()).toBe('pass');
      time.advance(1_000);
    }
    expect(cap.take()).toBe('first-drop');
    expect(cap.take()).toBe('drop');
    expect(cap.take()).toBe('drop');
    // 30 s after the first went through, the first has left the window.
    time.advance(30_000);
    expect(cap.take()).toBe('pass');
    expect(cap.take()).toBe('first-drop');
    time.advance(1_000);
    expect(cap.take()).toBe('pass');
  });
});

describe('pageErrorFields', () => {
  it('keeps of an error what the logging policy allows', () => {
    const err = new TypeError('Cannot read properties of undefined');
    expect(pageErrorFields(err)).toEqual(loggableErrorFields(err));
  });

  it('stands the message of a window error with no error object in for it', () => {
    expect(pageErrorFields(null, 'Script error.')).toEqual({ name: 'Error', message: 'Script error.' });
    expect(pageErrorFields(undefined, 'x'.repeat(400))['message']).toHaveLength(300);
    expect(pageErrorFields(undefined)).toEqual({ error: 'undefined' });
  });

  it("keeps only the code of the page's own app error when its message quotes the model (11.3 m)", () => {
    const quoted = Object.assign(new Error('The model replied: Dear diary, the river rose'), {
      name: 'ApiError',
      code: 'openai-invalid-output',
      detail: 'the whole reply'
    });
    expect(pageErrorFields(quoted)).toEqual({ code: 'openai-invalid-output' });
    const plain = Object.assign(new Error('Could not save.'), { name: 'ApiError', code: 'io', detail: 'x' });
    expect(pageErrorFields(plain)).toEqual({ code: 'io', message: 'Could not save.' });
  });
});

describe('componentNames', () => {
  it("names the app's components, innermost first, and never an element or an address", () => {
    const stack = [
      '',
      '    at Thrower (http://localhost:5173/src/renderer/components/StatusBar.tsx?t=1:12:9)',
      '    at div',
      '    at StatusBar (file:///C:/Users/someone/app/out/renderer/assets/index.js:1:2)', // check-public: allow
      '    at App (http://localhost:5173/src/renderer/App.tsx:40:3)',
      '    at ErrorBoundary (http://localhost:5173/src/renderer/components/ErrorBoundary.tsx:20:5)'
    ].join('\n');
    expect(componentNames(stack)).toBe('Thrower < StatusBar < App < ErrorBoundary');
  });

  it('reads the older "in Name" form, and stops at six', () => {
    const stack = Array.from({ length: 9 }, (_, i) => `    in Part${i} (created by App)`).join('\n');
    expect(componentNames(stack).split(' < ')).toHaveLength(MAX_COMPONENTS);
    expect(componentNames(stack)).toMatch(/^Part0 < Part1/);
  });

  it('is empty without a stack', () => {
    expect(componentNames(null)).toBe('');
    expect(componentNames(undefined)).toBe('');
    expect(componentNames('    at div\n    at span')).toBe('');
  });
});
