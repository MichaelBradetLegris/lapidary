import { useEffect, useRef, useState } from 'react';
import {
  CRASH_LEAD,
  CRASH_NOT_WRITTEN,
  CRASH_NOT_WRITTEN_AFTER,
  CRASH_REPORT,
  CRASH_REPORT_TITLE,
  CRASH_TITLE,
  CRASH_WRITING,
  CRASH_WRITTEN,
  RELOAD_WINDOW
} from '../../shared/ui/crash';
import { installCrashedPageGuard, writeAfterCrash, type PageWrites } from '../state/closeGuard';
import { useDiagnosticsReport } from '../state/diagnosticsReport';
import { heldButton } from '../state/heldButton';
import { CLOSE_GUARD_IO, CRASH_WRITES, PAGE_WRITES } from '../state/pageIo';
import { useApp } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';
import { DiagnosticsPanel } from './DiagnosticsPanel';

/** How the page's writes stand: being written, or done with what could not be written. */
type WriteState = { writing: true } | { writing: false; failures: string[] };

interface Props {
  /** reload the window: `location.reload()`, a new page in the same window */
  onReload?: () => void;
  /** the review and paragraph writers (`CRASH_WRITES`) unless a test gives others */
  writes?: PageWrites;
}

/**
 * The page shown in place of the window's when drawing it failed
 * (hardening.4, the `ErrorBoundary` around App). As it opens it writes what
 * the review and paragraph writers hold (`flushReviewWrites`,
 * `flushDraftWrites`, failed writes queued again first), then offers Reload
 * window, held until the writes are done, and Copy diagnostics, with the
 * report on screen. A write that failed is named in its card's words, with
 * Try again.
 *
 * It takes the close guard over from App (`crashedPageState`): once written,
 * decisions are in their review and boxes in their drafts, and nothing can be
 * saved to the chapter from here, so a close goes through at once unless a
 * write is still waiting or a review is running, and then asks as the page
 * would, in the question it draws itself.
 */
export function CrashFallback({ onReload, writes = CRASH_WRITES }: Props): React.JSX.Element {
  const [state, setState] = useState<WriteState>({ writing: true });
  const [attempt, setAttempt] = useState(0);
  const questionOpen = useApp((s) => s.confirmSpec !== null);
  const report = useDiagnosticsReport(false);
  const reloadRef = useRef<HTMLButtonElement>(null);

  // The close guard is this page's now, its questions drawn below (ConfirmDialog).
  useEffect(() => installCrashedPageGuard(CLOSE_GUARD_IO, PAGE_WRITES, { questions: true }), []);

  useEffect(() => {
    let live = true;
    void writeAfterCrash(writes).then((failures) => {
      if (live) setState({ writing: false, failures });
    });
    return () => {
      live = false;
    };
  }, [attempt, writes]);

  useEffect(() => {
    reloadRef.current?.focus();
  }, []);

  const reload = onReload ?? ((): void => window.location.reload());
  const failures = state.writing ? [] : state.failures;

  return (
    <div className="app-shell">
      <div className="app-shell__page" inert={questionOpen}>
        <main className="setup crash">
          <div className="setup__page">
            <h1>{CRASH_TITLE}</h1>
            <p>{CRASH_LEAD}</p>
            {state.writing ? (
              <p className="crash__status" role="status">
                {CRASH_WRITING}
              </p>
            ) : failures.length === 0 ? (
              <p className="crash__status" role="status">
                {CRASH_WRITTEN}
              </p>
            ) : (
              <div className="crash__status crash__status--failed" role="alert">
                <p>{CRASH_NOT_WRITTEN}</p>
                <ul>
                  {failures.map((failure) => (
                    <li key={failure}>{failure}</li>
                  ))}
                </ul>
                <p>
                  {CRASH_NOT_WRITTEN_AFTER}{' '}
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setState({ writing: true });
                      setAttempt((n) => n + 1);
                    }}
                  >
                    Try again
                  </button>
                </p>
              </div>
            )}
            <div className="crash__actions">
              <button
                type="button"
                className="primary"
                ref={reloadRef}
                {...heldButton(state.writing, reload)}
              >
                {RELOAD_WINDOW}
              </button>
            </div>
            <h2>{CRASH_REPORT_TITLE}</h2>
            <p className="crash__report">{CRASH_REPORT}</p>
            <DiagnosticsPanel
              text={report.text}
              error={report.error}
              copyState={report.copyState}
              onCopy={report.copy}
              onRetry={report.retry}
              copyPrimary={false}
            />
          </div>
        </main>
      </div>
      <ConfirmDialog />
    </div>
  );
}
