import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { showBareFallback } from './bareFallback';
import { CrashFallback } from './components/CrashFallback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PAGE_ERROR_CARD, PAGE_ERROR_TEXT } from '../shared/ui/crash';
import { call } from './state/client';
import { installCrashedPageGuard, writeAfterCrash } from './state/closeGuard';
import { createErrorReporter } from './state/errorReport';
import { CLOSE_GUARD_IO, CRASH_WRITES, PAGE_WRITES } from './state/pageIo';
import { useApp } from './state/store';
import './styles/app.css';

/* A file dropped on the window would otherwise be opened in place of the app,
   losing any open paragraph boxes (C.41). Only file drags are stopped; dragging
   text inside the page still works. Main refuses the navigation as well. */
for (const type of ['dragover', 'drop'] as const) {
  document.addEventListener(type, (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
}

/* Errors the page did not expect (hardening.4): logged in main's log, and an
   error nothing caught leaves a card with Show diagnostics. Installed before
   anything is drawn, so an error at start-up is heard too. */
const reporter = createErrorReporter({
  send: (line) => void call('log:renderer', line).catch(() => undefined),
  showCard: () =>
    useApp.getState().upsertNotification(PAGE_ERROR_CARD, 'error', PAGE_ERROR_TEXT, 'show-diagnostics')
});
reporter.install(window);

const reload = (): void => window.location.reload();

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

/* Drawing the page can fail. The boundary around App shows the crash page in
   its place, which writes what the page holds and offers Reload window and
   Copy diagnostics. An error past it, in the crash page itself, leaves a
   plain line and Reload window, after the same writes, with the close guard
   taken over as that page does, but asking nothing. */
let bare = false;
createRoot(container, {
  onUncaughtError: (error, info) => {
    reporter.render(error, info.componentStack, 'render-uncaught');
    if (bare) return;
    bare = true;
    // Nothing is drawn to ask a question with, so a close writes and goes.
    installCrashedPageGuard(CLOSE_GUARD_IO, PAGE_WRITES, { questions: false });
    void writeAfterCrash(CRASH_WRITES);
    showBareFallback(document, reload);
  }
}).render(
  <StrictMode>
    <ErrorBoundary
      onError={(error, componentStack) => reporter.render(error, componentStack)}
      fallback={<CrashFallback onReload={reload} />}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>
);
