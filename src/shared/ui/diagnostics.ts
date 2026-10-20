/**
 * The words of Copy diagnostics (hardening.5): the link on the Setup screen,
 * the Diagnostics dialog and what its Copy says. The report itself is
 * `src/shared/diagnostics/report.ts`. Pure, so the render tests and the
 * components share one source.
 */

import { APP_NAME } from '../branding';

/** The Setup screen's link, and the dialog's button. */
export const COPY_DIAGNOSTICS = 'Copy diagnostics';

/** The dialog's title. */
export const DIAGNOSTICS_TITLE = 'Diagnostics';

/** The Setup screen's line, after its link. */
export const SETUP_DIAGNOSTICS_TEXT = `puts ${APP_NAME}'s versions, its settings and what its last checks found on the clipboard, for a message or a GitHub issue when something goes wrong. It holds no chapter text, email address or key.`;

/** The dialog's first line. */
export const DIAGNOSTICS_INTRO = `${APP_NAME}'s versions, its settings and what its last checks found, as Copy diagnostics puts them on the clipboard. No chapter text, chapter names, email address or key is included, and your user folder is written as ~.`;

/** While main gathers the report. */
export const DIAGNOSTICS_LOADING = 'Collecting…';

/** How a copy went, for the line under the dialog's intro. */
export type DiagnosticsCopyState = 'idle' | 'copied' | 'failed';

/** What the dialog says after a copy; nothing before one. */
export function diagnosticsCopyLine(state: DiagnosticsCopyState): string | null {
  if (state === 'copied') return 'Copied to the clipboard. Paste it into your message or issue.';
  if (state === 'failed') return 'Could not copy. Select the text below and copy it yourself.';
  return null;
}

/** Where the focus goes when the dialog closes and where it was is gone: Setup's link. */
export const DIAGNOSTICS_LINK_SELECTOR = '[data-opens="diagnostics"]';
