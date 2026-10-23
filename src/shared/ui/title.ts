/**
 * The window's title (polish.10, PLAN 7): the open chapter's name and the
 * app's, "Chapter 01 - The Flood — <APP_NAME>", with a leading dot while the
 * chapter file lacks some of the page's changes, "• Chapter 01 - The Flood —
 * <APP_NAME>", and the app's name alone with nothing open. The page sets it as
 * `document.title`, which Electron gives the window, so the name shows in the
 * system's own title bar and on the taskbar; the toolbar's name and its dot
 * gave way to it, and the category chips took their place. The dot goes with
 * the count Save to chapter shows, `unsavedDecisionCount`, as the toolbar's
 * dot did (`saveButtonState`). The app's name comes from `APP_NAME` (C.21).
 *
 * Pure (CLAUDE.md rule 4).
 */

import { APP_NAME } from '../branding';
import { unsavedDecisionCount } from '../diff/compose';
import { chapterName } from '../review';
import type { Review } from '../types';

/** What stands before the chapter's name while changes are not saved to it. */
export const TITLE_UNSAVED_MARK = '•';

/** Between the chapter's name and the app's: a space, an em dash and a space. */
export const TITLE_SEPARATOR = ' — ';

/** The name of a review with no chapter file, as the toolbar called it. */
export const PASTED_TEXT_TITLE = 'Pasted text';

/**
 * The window's title for the review on screen: the app's name alone with none
 * open, else the chapter's name (its file name without the extension, as the
 * chapter list shows it) and the app's, the dot first while
 * `unsavedDecisions` is above 0. Pasted text has no chapter file to save to,
 * so it never has the dot.
 */
export function windowTitle(review: Pick<Review, 'sourcePath'> | null, unsavedDecisions: number): string {
  if (!review) return APP_NAME;
  if (!review.sourcePath) return `${PASTED_TEXT_TITLE}${TITLE_SEPARATOR}${APP_NAME}`;
  const mark = unsavedDecisions > 0 ? `${TITLE_UNSAVED_MARK} ` : '';
  return `${mark}${chapterName(review.sourcePath)}${TITLE_SEPARATOR}${APP_NAME}`;
}

/** `windowTitle` with the count taken from the review's own hunks, as the toolbar takes it. */
export function windowTitleFor(review: Pick<Review, 'sourcePath' | 'hunks'> | null): string {
  return windowTitle(review, review ? unsavedDecisionCount(review.hunks) : 0);
}
