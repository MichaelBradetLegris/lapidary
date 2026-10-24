import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { fullEditText } from '../../src/shared/edit';
import type { StoredDraft } from '../../src/shared/ipc';
import type { Hunk } from '../../src/shared/types';
import {
  WHOLE_DRAFT_KEY,
  draftSetProblem,
  isStoredDraft,
  parseDraftFile,
  placeDrafts,
  restoredCardText,
  setAsideCardText,
  setAsideFailedCardText,
  setAsideText,
  toStoredDrafts,
  MAX_DRAFT_TEXT_BYTES
} from '../../src/shared/ui/drafts';

/* rr.2: Full edit's box, which holds the whole chapter, is kept on disk as a
   paragraph box is (apply.16, PLAN 11.3 j): the same drafts file, under
   WHOLE_DRAFT_KEY with no paragraphs, written once something is typed in it,
   put back where the chapter's body still reads as it did, and set aside as a
   .txt otherwise. */

const BASE =
  '---\ntitle: T\n---\nMara waited by the gate.\n\nThe rain came teh hard way.\n\nShe went inside.';

function typo(status: Hunk['status']): Hunk {
  const start = BASE.indexOf('teh');
  return {
    id: 'h1',
    start,
    end: start + 3,
    baseSide: 'original',
    original: 'teh',
    replacement: 'the',
    paragraph: 1,
    category: 'typo',
    reason: 'Typo.',
    source: 'claude',
    status,
    anchor: 'exact'
  };
}

function whole(initial: string, text: string): StoredDraft {
  return { key: WHOLE_DRAFT_KEY, paragraphs: [], initial, text, whole: true };
}

const BODY = fullEditText(BASE, []);
const TYPED = whole(BODY, BODY.replace('waited', 'stood'));

describe("Full edit's box, kept", () => {
  it('is known by its shape: the whole key, no paragraphs and two texts', () => {
    expect(WHOLE_DRAFT_KEY).toBe(-1);
    expect(isStoredDraft(TYPED)).toBe(true);
    expect(isStoredDraft({ ...TYPED, key: 0 })).toBe(false);
    expect(isStoredDraft({ ...TYPED, paragraphs: [0] })).toBe(false);
    expect(isStoredDraft({ ...TYPED, whole: false })).toBe(false);
    expect(isStoredDraft({ ...TYPED, whole: 'yes' })).toBe(false);
    expect(isStoredDraft({ ...TYPED, text: 2 })).toBe(false);
    // A paragraph box under the whole key, or one with the flag and paragraphs, is not one.
    expect(isStoredDraft({ key: -1, paragraphs: [], initial: 'a', text: 'b' })).toBe(false);
  });

  it('is read back from a drafts file with its flag, and written only once something is typed in it', () => {
    const file = { version: 1, sourcePath: 'C:/v/Ch.md', reviewId: 'r', savedAt: 't', drafts: [TYPED] };
    expect(parseDraftFile(file)?.drafts).toEqual([TYPED]);
    expect(toStoredDrafts({ [WHOLE_DRAFT_KEY]: TYPED })).toEqual([TYPED]);
    expect(toStoredDrafts({ [WHOLE_DRAFT_KEY]: whole(BODY, BODY) })).toEqual([]);
  });

  it('says so when it is too long to keep', () => {
    expect(draftSetProblem([whole('a', 'x'.repeat(MAX_DRAFT_TEXT_BYTES + 1))])).toBe(
      'Full edit holds more than 1 MB of text, more than can be kept. Copy it somewhere safe.'
    );
    expect(draftSetProblem([TYPED])).toBeNull();
  });
});

describe("putting Full edit's box back", () => {
  it('goes back where the body still reads as it did, the frontmatter apart', () => {
    expect(placeDrafts({ base: BASE, hunks: [] }, [TYPED])).toEqual({
      reopen: [TYPED],
      setAside: [],
      dropped: []
    });
  });

  it('reads the page with every decision applied, as Done does', () => {
    const accepted = typo('accepted');
    const initial = fullEditText(BASE, [accepted]);
    const box = whole(initial, initial.replace('waited', 'stood'));
    expect(placeDrafts({ base: BASE, hunks: [accepted] }, [box]).reopen).toEqual([box]);
    // The same box on the page with the suggestion pending does not read so.
    expect(placeDrafts({ base: BASE, hunks: [typo('pending')] }, [box]).setAside).toEqual([box]);
  });

  it('is set aside when the chapter changed, and dropped when nothing was typed', () => {
    const changed = { base: BASE.replace('She went inside.', 'She went in.'), hunks: [] };
    expect(placeDrafts(changed, [TYPED])).toEqual({ reopen: [], setAside: [TYPED], dropped: [] });
    expect(placeDrafts({ base: BASE, hunks: [] }, [whole(BODY, BODY)])).toEqual({
      reopen: [],
      setAside: [],
      dropped: [whole(BODY, BODY)]
    });
  });

  it('never goes back beside a paragraph box, and no box goes back beside it', () => {
    const box = { key: 1, paragraphs: [1], initial: 'The rain came teh hard way.', text: 'The rain came.' };
    expect(placeDrafts({ base: BASE, hunks: [] }, [TYPED], [{ paragraphs: [1] }])).toEqual({
      reopen: [],
      setAside: [TYPED],
      dropped: []
    });
    expect(placeDrafts({ base: BASE, hunks: [] }, [box, TYPED])).toEqual({
      reopen: [TYPED],
      setAside: [box],
      dropped: []
    });
    expect(placeDrafts({ base: BASE, hunks: [] }, [box], [{ paragraphs: [], whole: true }]).setAside).toEqual(
      [box]
    );
    // Of two, the first goes back.
    const other = whole(BODY, `${BODY} More.`);
    expect(placeDrafts({ base: BASE, hunks: [] }, [TYPED, other]).setAside).toEqual([other]);
  });
});

describe("Full edit's words in the drafts cards and the set-aside file", () => {
  const box: StoredDraft = { key: 11, paragraphs: [11], initial: 'as it was', text: 'typed' };

  it('says Full edit came back, on its own', () => {
    expect(restoredCardText([TYPED])).toBe('Full edit is open again, as you left it.');
    expect(restoredCardText([whole(BODY, BODY)])).toBeNull();
  });

  it('names the set-aside file, for Full edit and beside paragraph boxes', () => {
    const name = 'Chapter 01 2026-10-23 14.02.33.txt';
    expect(setAsideCardText([TYPED], name)).toBe(
      `The chapter no longer reads as it did when you left Full edit open, so Full edit was not opened again. What you typed is kept in ${name}.`
    );
    expect(setAsideCardText([TYPED, box], name)).toBe(
      `The chapter no longer reads as it did when you left Full edit open, so Full edit was not opened again. Paragraph 12 no longer reads as it did when you left it open for editing, so its box was not reopened. What you typed is kept in ${name}.`
    );
    expect(setAsideFailedCardText([TYPED], 'the disk is full')).toBe(
      'The chapter no longer reads as it did when you left Full edit open, and what you typed could not be set aside: the disk is full. It is still kept, and is tried again the next time you open this chapter.'
    );
    expect(setAsideFailedCardText([TYPED, box], 'x')).toMatch(
      /^The chapter no longer reads as it did when you left Full edit open, and paragraph 12 no longer reads as it did when you left it open for editing, and what you typed could not be set aside: x\. /
    );
  });

  it('writes Full edit into the set-aside file with what the chapter read when it opened', () => {
    const at = new Date(2026, 9, 23, 9, 5, 7);
    expect(setAsideText('C:/vault/Chapter 01.md', [TYPED], at)).toBe(
      [
        `Set aside by ${APP_NAME} on 2026-10-23 at 09:05.`,
        '',
        `You left Full edit open on Chapter 01.md. The chapter no longer reads as it did when you opened it, so ${APP_NAME} did not open it again. Copy what you want to keep into the chapter.`,
        '',
        'Chapter file: C:/vault/Chapter 01.md',
        '',
        '',
        'Full edit, as you left it:',
        '',
        TYPED.text,
        '',
        'The chapter, as it read when you opened Full edit:',
        '',
        TYPED.initial,
        ''
      ].join('\n')
    );
    const both = setAsideText('C:/vault/Chapter 01.md', [box, TYPED], at);
    expect(both).toContain(
      `You left Full edit open on Chapter 01.md. The chapter no longer reads as it did when you opened it, so ${APP_NAME} did not open it again. Copy what you want to keep into the chapter. You left this paragraph of Chapter 01.md open for editing.`
    );
    // Full edit first, then the boxes in paragraph order.
    expect(both.indexOf('Full edit, as you left it:')).toBeLessThan(
      both.indexOf('Paragraph 12, as you left it:')
    );
  });

  it('never says "accepted changes"', () => {
    for (const text of [
      restoredCardText([TYPED]),
      setAsideCardText([TYPED], 'f.txt'),
      setAsideFailedCardText([TYPED], 'x'),
      setAsideText('C:/v/Ch.md', [TYPED], new Date())
    ]) {
      expect(text).not.toMatch(/accepted changes?/i);
    }
  });
});
