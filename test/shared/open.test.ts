import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { historyWhen } from '../../src/shared/ui/history';
import { chapterNotOpenedText, unwrittenReviewText } from '../../src/shared/ui/open';

/* apply.25 review: the card of an open that did not go ahead says what was
   not opened, since the page stays on what was open and main's words name
   only a review file or a folder. Where it is shown is pinned in
   test/renderer/openChapter.test.ts. */

const HELD = `Windows would not let ${APP_NAME} read the review file 2026-10-18T01-22-54-709Z.review.json. Another program may have it open, such as a sync, backup or antivirus tool, or your Windows account may not be allowed to read it. Close it there, or wait a moment, and try again. ${APP_NAME} has not changed anything.`;

const NOT_SAVED = `The review could not be saved: Windows would not let ${APP_NAME} replace 2026-10-18T01-22-54-709Z.review.json, even after trying for a second and a half.`;

describe('chapterNotOpenedText', () => {
  it("names the chapter that was not opened, then gives main's words as they are", () => {
    expect(chapterNotOpenedText('Chapter 01 - The Flood.md', HELD)).toBe(
      `Could not open Chapter 01 - The Flood.md: ${HELD}`
    );
  });

  it('never starts a sentence with the name, so a file name is shown exactly as it is', () => {
    const text = chapterNotOpenedText('notes, draft 2.txt', HELD);
    expect(text.startsWith('Could not open notes, draft 2.txt: ')).toBe(true);
  });
});

describe('unwrittenReviewText', () => {
  it('names the chapter, says its review file lacks the latest decisions, then why', () => {
    expect(unwrittenReviewText({ chapter: 'Chapter 01 - The Flood.md' }, NOT_SAVED)).toBe(
      `Could not open Chapter 01 - The Flood.md, because your latest decisions in its review are not in the review file yet, and it would open without them. ${NOT_SAVED}`
    );
  });

  it('names a review from History or the selector by its date as they show it', () => {
    const createdAt = '2026-10-17T12:00:00.000Z';
    expect(unwrittenReviewText({ reviewCreatedAt: createdAt }, NOT_SAVED)).toBe(
      `Could not open the review from ${historyWhen(createdAt)}, because your latest decisions in it are not in its file yet, and it would open without them. ${NOT_SAVED}`
    );
  });

  it('says nothing of accepted changes or of the chapter file', () => {
    for (const text of [
      unwrittenReviewText({ chapter: 'Chapter 01.md' }, NOT_SAVED),
      unwrittenReviewText({ reviewCreatedAt: '2026-10-17T12:00:00.000Z' }, NOT_SAVED)
    ]) {
      expect(text).not.toMatch(/accepted changes|Save to chapter|chapter file/);
    }
  });
});
