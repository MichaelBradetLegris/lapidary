import { createErrorFilter, type ErrorFilter } from '../../shared/diagnostics/errorFilter';
import { componentNames, pageErrorFields } from '../../shared/diagnostics/pageError';
import type { FieldValue } from '../../shared/diagnostics/redact';
import type { RendererErrorKind, RendererLogLine } from '../../shared/ipc';

/*
 * The page's unexpected errors (hardening.4, PLAN 7.7 and 11.3 m).
 *
 * - An error nothing caught (the window's `error` event) goes to main's log
 *   (`log:renderer`) and leaves a card with Show diagnostics.
 * - A promise rejected with no handler (`unhandledrejection`) is only logged,
 *   as main's are: a review cancelled or a window closing can leave one that
 *   means nothing went wrong.
 * - An error in drawing the page is logged with the components it happened
 *   in: the error boundary's (`render`), whose fallback then shows, or past
 *   it (`render-uncaught`, React's `onUncaughtError`).
 *
 * Chromium's ResizeObserver notice and repeats of the same error within a
 * minute are dropped (`createErrorFilter`), and main writes at most 30 lines
 * a minute. Each line holds only the error's loggable fields
 * (`pageErrorFields`), never the page's text.
 *
 * Main is reached through `ErrorReportIo`, and the window through
 * `ErrorTarget`, so the module needs neither the DOM nor the preload bridge
 * and is tested in node.
 */

export interface ErrorReportIo {
  /** `log:renderer`; never throws, and a request that fails is dropped */
  send(line: RendererLogLine): void;
  /** the error card (`PAGE_ERROR_CARD`, with Show diagnostics) */
  showCard(): void;
}

/** The parts of the window the reporter listens on. */
export interface ErrorTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', listener: (event: Event) => void): void;
}

/** What an `ErrorEvent` and a `PromiseRejectionEvent` carry that the reporter reads. */
interface ErrorEventLike {
  error?: unknown;
  message?: unknown;
}

interface RejectionEventLike {
  reason?: unknown;
}

export interface ErrorReporter {
  /** an error nothing caught: logged, with a card */
  error(error: unknown, message?: string): void;
  /** a rejection nothing handled: logged only */
  rejection(reason: unknown): void;
  /** drawing the page failed, caught by the boundary (`render`) or past it (`render-uncaught`): logged */
  render(
    error: unknown,
    componentStack: string | null | undefined,
    kind?: 'render' | 'render-uncaught'
  ): void;
  /** listen on the window's `error` and `unhandledrejection` events; returns the uninstall */
  install(target: ErrorTarget): () => void;
}

export function createErrorReporter(
  io: ErrorReportIo,
  options: { now?: () => number; filter?: ErrorFilter } = {}
): ErrorReporter {
  const filter = options.filter ?? createErrorFilter(options.now ? { now: options.now } : {});

  /** Send the line unless it is the ResizeObserver notice or a repeat; true when sent. */
  function report(kind: RendererErrorKind, fields: Record<string, FieldValue>): boolean {
    if (!filter.accept(kind, fields)) return false;
    try {
      io.send({ kind, fields });
    } catch {
      /* the log is best effort */
    }
    return true;
  }

  const reporter: ErrorReporter = {
    error(error, message) {
      if (report('error', pageErrorFields(error, message))) io.showCard();
    },
    rejection(reason) {
      report('rejection', pageErrorFields(reason));
    },
    render(error, componentStack, kind = 'render') {
      const components = componentNames(componentStack);
      report(kind, { ...pageErrorFields(error), ...(components ? { components } : {}) });
    },
    install(target) {
      const onError = (event: Event): void => {
        const e = event as unknown as ErrorEventLike;
        reporter.error(e.error, typeof e.message === 'string' ? e.message : undefined);
      };
      const onRejection = (event: Event): void => {
        reporter.rejection((event as unknown as RejectionEventLike).reason);
      };
      target.addEventListener('error', onError);
      target.addEventListener('unhandledrejection', onRejection);
      return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
      };
    }
  };
  return reporter;
}
