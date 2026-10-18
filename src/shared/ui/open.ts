/**
 * The card of an open that did not go ahead (apply.25 and its review, PLAN
 * section 7 and 6.4). The page stays on what was open, so the card says what
 * was not opened as well as why: main's words for a review that could not be
 * read, or a reviews folder that could not be made, name only a review file
 * or a folder, and nothing else on screen shows that the click did nothing.
 *
 * A name never starts a sentence, as in main's words (6.1), so a file name is
 * shown exactly as it is.
 *
 * Pure (CLAUDE.md rule 4), so every case has a test without a DOM.
 */

import { historyWhen } from './history';

/**
 * A chapter that did not open because the review it opens with could not be
 * read, or its reviews folder could not be made: `why` is main's words. A
 * chapter file that could not be read is not shown through this, since main's
 * words for it already name the chapter.
 */
export function chapterNotOpenedText(chapterFileName: string, why: string): string {
  return `Could not open ${chapterFileName}: ${why}`;
}

/** What did not open: a chapter from the list, or a review from History or the review selector. */
export type NotOpened = { chapter: string } | { reviewCreatedAt: string };

/**
 * A review whose file does not have the author's latest decisions, because
 * writing them failed and has not worked since, even when tried again just
 * before the open (apply.25 review). Read from disk, it would come on screen
 * without them, and the next write would put them back over what the page
 * showed, so it does not open. `notSaved` is the words of the card that said
 * the review could not be saved ("The review could not be saved: ..."). A
 * review is named by its date as History and the selector show it.
 */
export function unwrittenReviewText(what: NotOpened, notSaved: string): string {
  const head =
    'chapter' in what
      ? `Could not open ${what.chapter}, because your latest decisions in its review are not in the review file yet`
      : `Could not open the review from ${historyWhen(what.reviewCreatedAt)}, because your latest decisions in it are not in its file yet`;
  return `${head}, and it would open without them. ${notSaved}`;
}
