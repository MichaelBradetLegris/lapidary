/**
 * The words of crash handling (hardening.4, PLAN 7.7 and section 7): the card
 * an unexpected error leaves, in the page or in main; the page shown in place
 * of the window's when drawing it failed; and the box main shows when the
 * page's process has gone. Pure, so the tests and both processes share one
 * source.
 */

import { APP_NAME } from '../branding';
import type { AppNotice } from '../ipc';

/** The key of the page's own error card: a later error replaces it in place. */
export const PAGE_ERROR_CARD = 'page-error';

/** What follows an unexpected error, in either card. */
const AFTER_ERROR =
  'what you did last may not have finished. If it happens again, Show diagnostics has the details for a message or a GitHub issue.';

/** The card for an error the page did not expect (a window `error` event), with Show diagnostics. */
export const PAGE_ERROR_TEXT = `Something went wrong in this window, and ${AFTER_ERROR}`;

/** The card main asks for after an error it did not expect (`uncaughtException`), at most once a minute. */
export const MAIN_ERROR_NOTICE: AppNotice = {
  tone: 'error',
  message: `Something went wrong in ${APP_NAME}'s background process, and ${AFTER_ERROR}`,
  action: 'show-diagnostics'
};

/* ------------------------------------------------------------------ */
/* The page shown when drawing the window failed (the error boundary)  */
/* ------------------------------------------------------------------ */

export const CRASH_TITLE = 'Something went wrong';

export const CRASH_LEAD = `This window ran into an error ${APP_NAME} did not expect, and cannot go on showing your chapter.`;

/** While the review and paragraph writers are flushed. */
export const CRASH_WRITING = 'Writing your decisions and open paragraph boxes…';

/** Once everything the writers held is on disk. */
export const CRASH_WRITTEN =
  'Your decisions and any open paragraph boxes are written. Reload window starts this window again, and they are there when you open the chapter.';

/** When a write could not be made: the line before the writers' own words. */
export const CRASH_NOT_WRITTEN = 'Some of your decisions could not be written:';

/** After the writers' words, beside Try again. */
export const CRASH_NOT_WRITTEN_AFTER = 'Reloading the window or closing it now loses them.';

export const RELOAD_WINDOW = 'Reload window';

/** The heading over the diagnostics panel. */
export const CRASH_REPORT_TITLE = 'Diagnostics';

/** Under it, before the panel's own words. */
export const CRASH_REPORT = `If it happens again, send the text below with a message or a GitHub issue. What went wrong is in ${APP_NAME}'s log too.`;

/**
 * Shown in place of the page when even the page above could not be drawn
 * (React's `onUncaughtError`), as plain text and a button.
 */
export const BARE_CRASH_TEXT = `This window ran into an error ${APP_NAME} did not expect and cannot show its page. Your decisions and open paragraph boxes are written as you make them.`;

/* ------------------------------------------------------------------ */
/* The box main shows when the page's process has gone                 */
/* ------------------------------------------------------------------ */

/** The native box after `render-process-gone`: Reload window, the default, or Quit. */
export interface RendererGoneBox {
  title: string;
  message: string;
  detail: string;
  reloadLabel: string;
  quitLabel: string;
}

/** Why the page's process went, in Electron's words (`RenderProcessGoneDetails.reason`), for the author. */
export function goneCause(reason: string): string {
  switch (reason) {
    case 'oom':
      return 'It ran out of memory.';
    case 'killed':
      return 'Its process was ended from outside the app, by Task Manager or another program.';
    case 'launch-failed':
      return 'Its process could not start.';
    case 'integrity-failure':
      return 'Windows stopped it because its code failed an integrity check.';
    default:
      return 'Its process stopped unexpectedly.';
  }
}

export function rendererGoneBox(reason: string): RendererGoneBox {
  return {
    title: APP_NAME,
    message: `${APP_NAME}'s window stopped working`,
    detail: [
      goneCause(reason),
      `Your decisions and open paragraph boxes are written as you make them, so ${RELOAD_WINDOW} starts the window again and they are there when you open the chapter, apart from changes made in the second before it stopped.`,
      `Quit closes ${APP_NAME}.`
    ].join('\n'),
    reloadLabel: RELOAD_WINDOW,
    quitLabel: 'Quit'
  };
}
