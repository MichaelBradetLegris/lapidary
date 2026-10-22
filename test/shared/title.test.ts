import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { createDiffReview } from '../../src/shared/review';
import type { Hunk, Review } from '../../src/shared/types';
import { saveButtonInput, saveButtonState } from '../../src/shared/ui/save';
import {
  PASTED_TEXT_TITLE,
  TITLE_SEPARATOR,
  TITLE_UNSAVED_MARK,
  windowTitle,
  windowTitleFor
} from '../../src/shared/ui/title';

/* polish.10: the chapter's name, and the dot while changes are not saved to
   it, are in the window's own title, which Electron takes from the page's
   `document.title` (App sets it), in place of the toolbar's name and dot. */

const CHAPTER = 'C:\\Users\\author\\Novel\\Chapter 01 - The Flood.md'; // check-public: allow

/** Three suggestions on the chapter, all pending. */
function review(sourcePath = CHAPTER): Review {
  return createDiffReview({
    sourcePath,
    originalRaw: 'The river had began.\n\nShe nodded her head slowly.\n\nIts late.',
    correctedRaw: 'The river had begun.\n\nShe nodded slowly.\n\nIt is late.'
  });
}

/** `review` with the hunks at these positions given these decisions. */
function decided(statuses: Partial<Record<number, Hunk['status']>>, from: Review = review()): Review {
  return { ...from, hunks: from.hunks.map((h, i) => ({ ...h, status: statuses[i] ?? h.status })) };
}

describe('the window title (polish.10)', () => {
  it("is the chapter's name and the app's, an em dash between", () => {
    expect(windowTitle({ sourcePath: CHAPTER }, 0)).toBe(`Chapter 01 - The Flood — ${APP_NAME}`);
    expect(TITLE_SEPARATOR).toBe(' — ');
    // The name is the file's, without its extension, from either kind of path.
    const notes = '/home/author/Novel/Notes.txt'; // check-public: allow
    expect(windowTitle({ sourcePath: notes }, 0)).toBe(`Notes — ${APP_NAME}`);
  });

  it('leads with the dot while changes are not saved to the chapter', () => {
    expect(TITLE_UNSAVED_MARK).toBe('•');
    expect(windowTitle({ sourcePath: CHAPTER }, 1)).toBe(`• Chapter 01 - The Flood — ${APP_NAME}`);
    expect(windowTitle({ sourcePath: CHAPTER }, 12)).toBe(`• Chapter 01 - The Flood — ${APP_NAME}`);
  });

  it("is the app's name alone with nothing open", () => {
    expect(windowTitle(null, 0)).toBe(APP_NAME);
    expect(windowTitleFor(null)).toBe(APP_NAME);
  });

  it('names pasted text as the toolbar did, with no dot, as it has no chapter file to save to', () => {
    expect(PASTED_TEXT_TITLE).toBe('Pasted text');
    expect(windowTitle({ sourcePath: '' }, 0)).toBe(`Pasted text — ${APP_NAME}`);
    expect(windowTitle({ sourcePath: '' }, 3)).toBe(`Pasted text — ${APP_NAME}`);
  });

  it('counts the changes the chapter file does not have, as Save to chapter does', () => {
    expect(windowTitleFor(review())).toBe(`Chapter 01 - The Flood — ${APP_NAME}`);
    expect(windowTitleFor(decided({ 0: 'accepted' }))).toBe(`• Chapter 01 - The Flood — ${APP_NAME}`);
    // A dismissal leaves the file as it is, so nothing is waiting.
    expect(windowTitleFor(decided({ 1: 'dismissed' }))).toBe(`Chapter 01 - The Flood — ${APP_NAME}`);
  });

  it('has the dot exactly when the Save button state says the chapter has changes waiting', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Hunk['status']>('pending', 'accepted', 'dismissed'), {
          minLength: 3,
          maxLength: 3
        }),
        fc.constantFrom(CHAPTER, ''),
        fc.boolean(),
        fc.boolean(),
        fc.nat(3),
        (statuses, sourcePath, saving, locked, changedParagraphs) => {
          const open = decided({ ...statuses }, review(sourcePath));
          const state = saveButtonState(saveButtonInput({ review: open, changedParagraphs, saving, locked }));
          const title = windowTitleFor(open);
          expect(title.startsWith(`${TITLE_UNSAVED_MARK} `)).toBe(state.dot);
          expect(title.endsWith(`${TITLE_SEPARATOR}${APP_NAME}`)).toBe(true);
        }
      )
    );
  });
});
