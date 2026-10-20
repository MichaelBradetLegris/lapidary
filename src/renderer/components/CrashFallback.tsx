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
import { createCrashPage, type CrashPage, type CrashPageDeps, type CrashWrites } from '../state/crashPage';
import { useDiagnosticsReport } from '../state/diagnosticsReport';
import { heldButton } from '../state/heldButton';
import { CRASH_PAGE } from '../state/pageIo';
import { useApp } from '../state/store';
import { ConfirmDialog } from './ConfirmDialog';
import { DiagnosticsPanel } from './DiagnosticsPanel';

interface Props {
  /** reload the window: `location.reload()`, a new page in the same window */
  onReload?: () => void;
  /** the close guard's IPC and the writers (`CRASH_PAGE`) unless a test gives others */
  deps?: CrashPageDeps;
}

/**
 * Reload window shows its focus ring however the focus came to it, as the
 * confirm dialog's default button does (`FOCUS_WITH_RING` there): Chromium
 * leaves the ring off a button that code focuses straight after a click, so
 * after a click on Try again nothing would show that Enter now reloads.
 */
const FOCUS_WITH_RING: FocusOptions & { focusVisible: boolean } = { focusVisible: true };

/** The focus is on nothing: the body, or no element at all. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
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
 * would, in the question it draws itself. What it does is `createCrashPage`'s
 * (state/crashPage.ts), tested in node; this draws it.
 */
export function CrashFallback({ onReload, deps = CRASH_PAGE }: Props): React.JSX.Element {
  const [writes, setWrites] = useState<CrashWrites>({ writing: true });
  const questionOpen = useApp((s) => s.confirmSpec !== null);
  const report = useDiagnosticsReport(false);
  const reloadRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<CrashPage | null>(null);

  // The close guard is this page's now, its questions drawn below (ConfirmDialog), and the writers write.
  useEffect(() => {
    const page = createCrashPage(deps, {
      setWrites,
      focusReload: () => reloadRef.current?.focus(FOCUS_WITH_RING),
      focusLost
    });
    pageRef.current = page;
    const close = page.open();
    return () => {
      close();
      if (pageRef.current === page) pageRef.current = null;
    };
  }, [deps]);

  // Reload window has the focus as the page opens, and once the question the
  // failed page had open is gone: on the first render it is still in the
  // store, the page under it inert, so a focus given then is lost.
  useEffect(() => {
    if (!questionOpen) pageRef.current?.noQuestion();
  }, [questionOpen]);

  const reload = onReload ?? ((): void => window.location.reload());
  const failures = writes.writing ? [] : writes.failures;

  return (
    <div className="app-shell">
      <div className="app-shell__page" inert={questionOpen}>
        <main className="setup crash">
          <div className="setup__page">
            <h1>{CRASH_TITLE}</h1>
            <p>{CRASH_LEAD}</p>
            {writes.writing ? (
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
                  <button type="button" className="link" onClick={() => pageRef.current?.tryAgain()}>
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
                {...heldButton(writes.writing, reload)}
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
