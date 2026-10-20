import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { blockSpanFor, liveTextIn } from '../../src/shared/edit';
import type { StoredDraft } from '../../src/shared/ipc';
import { splitParagraphs } from '../../src/shared/text/paragraphs';
import type { Hunk, HunkStatus } from '../../src/shared/types';
import { confirmButtons, focusedChoice } from '../../src/shared/ui/confirm';
import {
  DRAFT_FILE_VERSION,
  MAX_DRAFTS,
  MAX_DRAFT_TEXT_BYTES,
  discardDraftPrompt,
  draftLabel,
  draftSetProblem,
  draftsReadLaterCardText,
  draftsUnreadableCardText,
  isStoredDraft,
  parseDraftFile,
  placeDrafts,
  restoredCardText,
  setAsideCardText,
  setAsideFailedCardText,
  setAsideFileName,
  setAsideText,
  toStoredDrafts,
  utf8Length
} from '../../src/shared/ui/drafts';

/* apply.16: which kept paragraph boxes go back on the page, which are set
   aside, and what the cards, the question and the .txt say (PLAN 11.3 j). */

const BASE = 'Mara waited by the gate.\n\nThe rain came teh hard way.\n\nShe went inside.';

function hunk(base: string, original: string, replacement: string, status: HunkStatus, id = 'h1'): Hunk {
  const start = base.indexOf(original);
  if (start < 0) throw new Error(`no "${original}" in the base`);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: splitParagraphs(base).find((p) => p.start <= start && start < p.end)?.index ?? 0,
    category: 'typo',
    reason: 'Typo.',
    source: 'claude',
    status,
    anchor: 'exact'
  };
}

/** A box as `openDraft` opens it on this page, holding `text`. */
function boxOn(base: string, hunks: readonly Hunk[], paragraph: number, text?: string): StoredDraft {
  const span = blockSpanFor(base, splitParagraphs(base), hunks, paragraph);
  if (!span) throw new Error(`no block for ${paragraph}`);
  const initial = liveTextIn(base, hunks, span);
  return {
    key: span.paragraphs[0] ?? paragraph,
    paragraphs: span.paragraphs,
    initial,
    text: text ?? initial
  };
}

describe('placeDrafts', () => {
  it('puts a box back where its paragraph still reads as it did', () => {
    const box = boxOn(BASE, [], 1, 'The rain came the hard way, slanting.');
    const placement = placeDrafts({ base: BASE, hunks: [] }, [box]);
    expect(placement.reopen).toEqual([box]);
    expect(placement.setAside).toEqual([]);
    expect(placement.dropped).toEqual([]);
  });

  it('compares with the page, accepted changes applied, not with the file', () => {
    const fix = hunk(BASE, 'teh', 'the', 'accepted');
    const box = boxOn(BASE, [fix], 1, 'The rain came the hard way, slanting.');
    expect(box.initial).toBe('The rain came the hard way.');
    expect(placeDrafts({ base: BASE, hunks: [fix] }, [box]).reopen).toEqual([box]);
    // Turned back to pending, the page reads "teh" again: the box would undo that.
    const pending = { ...fix, status: 'pending' as const };
    const placement = placeDrafts({ base: BASE, hunks: [pending] }, [box]);
    expect(placement.reopen).toEqual([]);
    expect(placement.setAside).toEqual([box]);
  });

  it('sets aside a box with typed text whose paragraph changed, and drops one left as it opened', () => {
    const typed = boxOn(BASE, [], 1, 'Something else entirely.');
    const untouched = boxOn(BASE, [], 2);
    const changed = BASE.replace('The rain came', 'The rain fell').replace(
      'She went inside.',
      'She went in.'
    );
    const placement = placeDrafts({ base: changed, hunks: [] }, [typed, untouched]);
    expect(placement.reopen).toEqual([]);
    expect(placement.setAside).toEqual([typed]);
    expect(placement.dropped).toEqual([untouched]);
  });

  it('does not look for the paragraph elsewhere when one is added above it', () => {
    const box = boxOn(BASE, [], 1, 'The rain came the hard way.');
    const moved = `A new opening line.\n\n${BASE}`;
    // Paragraph 2 now reads what the box opened on, but the box was for paragraph 2 of the old text, which is now 3.
    const placement = placeDrafts({ base: moved, hunks: [] }, [box]);
    expect(placement.reopen).toEqual([]);
    expect(placement.setAside).toEqual([box]);
  });

  it('takes the block a hunk across the blank line makes, and only that block', () => {
    // Deleting paragraph 2 with the blank line after it joins 2 and 3 into one block.
    const deletion: Hunk = {
      ...hunk(BASE, 'The rain came teh hard way.\n\n', '', 'accepted'),
      category: 'other',
      reason: 'Edited by author',
      source: 'manual'
    };
    const block = boxOn(BASE, [deletion], 1, 'She went inside at once.');
    expect(block.paragraphs).toEqual([1, 2]);
    expect(block.initial).toBe('She went inside.');
    expect(placeDrafts({ base: BASE, hunks: [deletion] }, [block]).reopen).toEqual([block]);

    // Without that hunk the block is two paragraphs again, and neither reads as it did.
    const alone = placeDrafts({ base: BASE, hunks: [] }, [block]);
    expect(alone.setAside).toEqual([block]);

    // A box over paragraph 2 alone cannot go back once 2 and 3 are one block.
    const single = boxOn(BASE, [], 1, 'Changed.');
    expect(placeDrafts({ base: BASE, hunks: [deletion] }, [single]).setAside).toEqual([single]);
  });

  it('leaves alone a paragraph a box already open covers', () => {
    const kept = boxOn(BASE, [], 1, 'Typed before.');
    const placement = placeDrafts(
      { base: BASE, hunks: [] },
      [kept, boxOn(BASE, [], 2)],
      [{ paragraphs: [1] }]
    );
    expect(placement.setAside).toEqual([kept]);
    expect(placement.reopen.map((d) => d.key)).toEqual([2]);
  });

  it('lets only the first of two boxes on one place go back', () => {
    const first = boxOn(BASE, [], 0, 'Mara waited by the old gate.');
    const second = { ...first, text: 'Mara stood by the gate.' };
    const placement = placeDrafts({ base: BASE, hunks: [] }, [first, second]);
    expect(placement.reopen).toEqual([first]);
    expect(placement.setAside).toEqual([second]);
  });

  it('answers in paragraph order and never changes what it is given', () => {
    const boxes = [boxOn(BASE, [], 2, 'x'), boxOn(BASE, [], 0, 'y')];
    const copy = structuredClone(boxes);
    const placement = placeDrafts({ base: BASE, hunks: [] }, boxes);
    expect(placement.reopen.map((d) => d.key)).toEqual([0, 2]);
    expect(boxes).toEqual(copy);
    placement.reopen[0]?.paragraphs.push(9);
    expect(boxes).toEqual(copy);
  });

  it('skips frontmatter, which has no box', () => {
    const base = `---\ntitle: One\n---\n\n${BASE}`;
    const box = boxOn(base, [], 0, 'Mara waited.');
    expect(box.initial).toBe('Mara waited by the gate.');
    expect(placeDrafts({ base, hunks: [] }, [box]).reopen).toEqual([box]);
  });

  it('sets aside a first paragraph s box kept before files.22, which opened on the line break above it', () => {
    // The body follows the closing --- at once. The box then opened on "\n" and the words; now on the words.
    const base = `---\ntitle: One\n---\n${BASE}`;
    expect(boxOn(base, [], 0).initial).toBe('Mara waited by the gate.');
    const typed: StoredDraft = {
      key: 0,
      paragraphs: [0],
      initial: '\nMara waited by the gate.',
      text: '\nMara waited by the old gate.'
    };
    const untouched: StoredDraft = { ...typed, text: typed.initial };
    expect(placeDrafts({ base, hunks: [] }, [typed]).setAside).toEqual([typed]);
    expect(placeDrafts({ base, hunks: [] }, [untouched]).dropped).toEqual([untouched]);
  });

  it('sets aside a box whose paragraph is past the end of the chapter', () => {
    const box: StoredDraft = { key: 7, paragraphs: [7], initial: 'Gone.', text: 'Gone, all gone.' };
    expect(placeDrafts({ base: BASE, hunks: [] }, [box]).setAside).toEqual([box]);
  });

  /* Round trip: every box opened on a page goes back on that same page, and
     after an outside change to one paragraph, only that paragraph's box does
     not. Chapters of unique words with suggestions in random states. */
  it('puts back every box opened on the same page, and only those whose paragraph is unchanged', () => {
    const paragraphArb = fc.array(
      fc.record({
        hunk: fc.boolean(),
        status: fc.constantFrom<HunkStatus>('pending', 'accepted', 'dismissed')
      }),
      { minLength: 2, maxLength: 5 }
    );
    fc.assert(
      fc.property(
        fc.array(paragraphArb, { minLength: 1, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
        fc.nat(5),
        (paragraphs, open, typed, changedIndex) => {
          let base = '';
          let n = 0;
          const hunks: Hunk[] = [];
          const plainWords: { paragraph: number; start: number; word: string }[] = [];
          paragraphs.forEach((words, p) => {
            if (p > 0) base += '\n\n';
            words.forEach((spec, i) => {
              if (i > 0) base += ' ';
              const word = `w${String(n).padStart(3, '0')}`;
              const start = base.length;
              base += word;
              if (spec.hunk) {
                hunks.push({
                  id: `h${n}`,
                  start,
                  end: start + word.length,
                  baseSide: 'original',
                  original: word,
                  replacement: `r${n}`,
                  paragraph: p,
                  source: 'claude',
                  status: spec.status,
                  anchor: 'exact'
                });
              } else {
                plainWords.push({ paragraph: p, start, word });
              }
              n += 1;
            });
          });
          const boxes = paragraphs
            .map((_, p) => p)
            .filter((p) => open[p])
            .map((p) => (typed[p] ? boxOn(base, hunks, p, `typed in ${p}`) : boxOn(base, hunks, p)));

          const same = placeDrafts({ base, hunks }, boxes);
          expect(same.reopen).toEqual(boxes);
          expect(same.setAside).toEqual([]);
          expect(same.dropped).toEqual([]);

          // Change one plain word to another of the same length, so no offset moves.
          const target = plainWords[changedIndex % Math.max(1, plainWords.length)];
          if (!target) return;
          const changed = `${base.slice(0, target.start)}x${target.word.slice(1)}${base.slice(target.start + target.word.length)}`;
          const after = placeDrafts({ base: changed, hunks }, boxes);
          const hit = boxes.filter((b) => b.key === target.paragraph);
          expect(after.reopen).toEqual(boxes.filter((b) => b.key !== target.paragraph));
          expect(after.setAside).toEqual(hit.filter((b) => b.text !== b.initial));
          expect(after.dropped).toEqual(hit.filter((b) => b.text === b.initial));
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('what is kept', () => {
  const good: StoredDraft = { key: 3, paragraphs: [3, 4], initial: 'a', text: 'b' };

  it('knows a stored box by its shape', () => {
    expect(isStoredDraft(good)).toBe(true);
    expect(isStoredDraft({ ...good, paragraphs: [4, 3] })).toBe(false);
    expect(isStoredDraft({ ...good, paragraphs: [] })).toBe(false);
    expect(isStoredDraft({ ...good, key: -1, paragraphs: [-1] })).toBe(false);
    expect(isStoredDraft({ ...good, key: 1.5 })).toBe(false);
    expect(isStoredDraft({ ...good, text: 3 })).toBe(false);
    expect(isStoredDraft(null)).toBe(false);
    expect(isStoredDraft('box')).toBe(false);
  });

  it('counts UTF-8 bytes without an encoder', () => {
    for (const text of ['', 'plain', 'café', '€', 'naïve 😀 done', '\ud800 lone']) {
      expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'));
    }
  });

  it('refuses more than 200 boxes, more than 1 MB in one, or a broken box, and allows a shared key', () => {
    expect(draftSetProblem([])).toBeNull();
    expect(draftSetProblem([good, { ...good, text: 'c' }])).toBeNull();
    const many = Array.from({ length: MAX_DRAFTS + 1 }, (_, i) => ({ ...good, key: i, paragraphs: [i] }));
    expect(draftSetProblem(many)).toBe(
      'Only 200 open paragraphs can be kept for a chapter, and 201 are open. Close some with Done or Cancel.'
    );
    expect(draftSetProblem(many.slice(0, MAX_DRAFTS))).toBeNull();
    // 1 MB counted in bytes: 600,000 two-byte letters are 1.2 MB.
    const long = 'é'.repeat(600_000);
    expect(long.length).toBeLessThan(MAX_DRAFT_TEXT_BYTES);
    expect(draftSetProblem([{ ...good, text: long }])).toBe(
      'The box for paragraphs 4-5 holds more than 1 MB of text, more than can be kept. Copy it somewhere safe.'
    );
    expect(draftSetProblem([{ ...good, initial: 'x'.repeat(MAX_DRAFT_TEXT_BYTES + 1) }])).toMatch(
      /more than 1 MB/
    );
    expect(draftSetProblem([{ ...good, text: 'x'.repeat(MAX_DRAFT_TEXT_BYTES) }])).toBeNull();
    expect(draftSetProblem([{ key: 1 }])).toBe('A paragraph box to keep was not in the expected form.');
    expect(draftSetProblem('boxes')).toBe('The paragraph boxes to keep were not a list.');
  });

  it('reads back only a file this app wrote, and leaves out a broken box', () => {
    const file = {
      version: 1,
      sourcePath: 'C:/v/Ch.md',
      reviewId: 'r',
      savedAt: 't',
      drafts: [good, { key: 'x' }]
    };
    expect(parseDraftFile(file)).toEqual({ ...file, drafts: [good] });
    expect(parseDraftFile({ ...file, version: 2 })).toBeNull();
    expect(parseDraftFile({ ...file, sourcePath: '' })).toBeNull();
    expect(parseDraftFile({ ...file, drafts: 'none' })).toBeNull();
    expect(parseDraftFile({ ...file, reviewId: undefined })).toBeNull();
    expect(parseDraftFile([])).toBeNull();
    expect(parseDraftFile(null)).toBeNull();
    expect(DRAFT_FILE_VERSION).toBe(1);
  });

  it('keeps the boxes on screen first paragraph first, without their selection', () => {
    const onScreen = {
      7: { key: 7, paragraphs: [7], initial: 'a', text: 'b', select: { start: 0, end: 1 } },
      2: { key: 2, paragraphs: [2, 3], initial: 'c', text: 'c' }
    };
    expect(toStoredDrafts(onScreen)).toEqual([
      { key: 2, paragraphs: [2, 3], initial: 'c', text: 'c' },
      { key: 7, paragraphs: [7], initial: 'a', text: 'b' }
    ]);
  });
});

describe('the words', () => {
  const box = (key: number, text = 'typed', paragraphs = [key]): StoredDraft => ({
    key,
    paragraphs,
    initial: 'as it was',
    text
  });

  it('labels a box as the rail does', () => {
    expect(draftLabel([11])).toBe('12');
    expect(draftLabel([11, 12])).toBe('12-13');
  });

  it('says which boxes came back with typed text, and nothing for one left as it opened', () => {
    expect(restoredCardText([box(11)])).toBe('Paragraph 12 is open for editing again, as you left it.');
    expect(restoredCardText([box(6), box(2), box(11, 'as it was')])).toBe(
      'Paragraphs 3 and 7 are open for editing again, as you left them.'
    );
    expect(restoredCardText([box(11, 'x', [11, 12])])).toBe(
      'Paragraphs 12-13 are open for editing again, as you left them.'
    );
    expect(restoredCardText([box(1, 'as it was')])).toBeNull();
    expect(restoredCardText([])).toBeNull();
  });

  it('names the set-aside file on its card', () => {
    const name = 'Chapter 01 2026-10-17 14.02.33.txt';
    expect(setAsideCardText([box(11)], name)).toBe(
      `Paragraph 12 no longer reads as it did when you left it open for editing, so its box was not reopened. What you typed is kept in ${name}.`
    );
    expect(setAsideCardText([box(11), box(2), box(6)], name)).toBe(
      `Paragraphs 3, 7 and 12 no longer read as they did when you left them open for editing, so their boxes were not reopened. What you typed is kept in ${name}.`
    );
    expect(setAsideCardText([box(11, 'x', [11, 12])], name)).toBe(
      `Paragraphs 12-13 no longer read as they did when you left them open for editing, so their box was not reopened. What you typed is kept in ${name}.`
    );
  });

  it('says a failed set-aside keeps the text for the next open', () => {
    expect(setAsideFailedCardText([box(11)], 'the disk is full')).toBe(
      'Paragraph 12 no longer reads as it did when you left it open for editing, and what you typed could not be set aside: the disk is full. It is still kept, and is tried again the next time you open this chapter.'
    );
    expect(setAsideFailedCardText([box(1), box(2)], 'No space.')).toMatch(
      /^Paragraphs 2 and 3 no longer read as they did when you left them open for editing, and what you typed could not be set aside: No space\. It is/
    );
    expect(draftsUnreadableCardText('locked')).toBe(
      'The paragraphs you left open in this chapter could not be read back: locked. Nothing is written over them, so what you type in this chapter is kept only once they can be read.'
    );
    expect(draftsReadLaterCardText()).toBe(
      'The paragraphs you left open in this chapter could be read back after all. They are kept, and open for editing again the next time you come back to this chapter.'
    );
  });

  it('asks before a changed box is discarded, with Keep editing focused', () => {
    const spec = discardDraftPrompt([11]);
    expect(spec.title).toBe('Discard your changes to paragraph 12?');
    expect(spec.body).toBe('What you typed in this box will be lost.');
    expect(confirmButtons(spec).map((b) => b.label)).toEqual(['Keep editing', 'Discard']);
    expect(focusedChoice(spec)).toBe('cancel');
    expect(discardDraftPrompt([3, 4]).title).toBe('Discard your changes to paragraphs 4-5?');
  });

  it('never says "accepted changes"', () => {
    const texts = [
      restoredCardText([box(1)]),
      setAsideCardText([box(1), box(2)], 'f.txt'),
      setAsideFailedCardText([box(1)], 'x'),
      discardDraftPrompt([1]).title,
      discardDraftPrompt([1]).body,
      setAsideText('C:/v/Ch.md', [box(1)], new Date(2026, 9, 17, 9, 5, 7))
    ];
    for (const text of texts) expect(text).not.toMatch(/accepted changes?/i);
  });
});

describe('the set-aside file', () => {
  const at = new Date(2026, 9, 17, 9, 5, 7);

  it('is named by the chapter and the local time, as backups are', () => {
    expect(setAsideFileName('C:/vault/Chapter 01 - The Flood.md', at)).toBe(
      'Chapter 01 - The Flood 2026-10-17 09.05.07.txt'
    );
    expect(setAsideFileName('/srv/vault/Notes.txt', at, 2)).toBe('Notes 2026-10-17 09.05.07-2.txt');
    expect(setAsideFileName('C:\\vault\\Part 1\\Ch 3.md', at, 3)).toBe('Ch 3 2026-10-17 09.05.07-3.txt');
  });

  it('keeps a file name Windows accepts', () => {
    expect(setAsideFileName('/v/What? A "test": yes*.md', at)).toBe(
      'What_ A _test__ yes_ 2026-10-17 09.05.07.txt'
    );
    expect(setAsideFileName('/v/tab\there|pipe<>.md', at)).toBe('tab_here_pipe__ 2026-10-17 09.05.07.txt');
    expect(setAsideFileName('/v/ends with dots...md', at)).toBe('ends with dots 2026-10-17 09.05.07.txt');
    expect(setAsideFileName('/v/.md', at)).toBe('untitled 2026-10-17 09.05.07.txt');
    expect(setAsideFileName('/v/', at)).toBe('untitled 2026-10-17 09.05.07.txt');
    const long = setAsideFileName(`/v/${'é'.repeat(150)}😀.md`, at);
    expect(long).toBe(`${'é'.repeat(100)} 2026-10-17 09.05.07.txt`);
  });

  it('says when, why and where, then each box and what its block read', () => {
    const text = setAsideText(
      'C:/vault/Chapter 01.md',
      [
        { key: 11, paragraphs: [11, 12], initial: 'It read so.', text: 'I typed this.' },
        { key: 2, paragraphs: [2], initial: 'Before.', text: 'After.' }
      ],
      at
    );
    expect(text).toBe(
      [
        `Set aside by ${APP_NAME} on 2026-10-17 at 09:05.`,
        '',
        `You left these paragraphs of Chapter 01.md open for editing. They no longer read as they did when you opened them, so ${APP_NAME} did not put the boxes back. Copy what you want to keep into the chapter.`,
        '',
        'Chapter file: C:/vault/Chapter 01.md',
        '',
        '',
        'Paragraph 3, as you left it:',
        '',
        'After.',
        '',
        'Paragraph 3, as it read when you opened it:',
        '',
        'Before.',
        '',
        '',
        'Paragraphs 12-13, as you left them:',
        '',
        'I typed this.',
        '',
        'Paragraphs 12-13, as they read when you opened them:',
        '',
        'It read so.',
        ''
      ].join('\n')
    );
    expect(setAsideText('C:/v/Ch.md', [{ key: 0, paragraphs: [0], initial: 'a', text: 'b' }], at)).toContain(
      `You left this paragraph of Ch.md open for editing. It no longer reads as it did when you opened it, so ${APP_NAME} did not put the box back.`
    );
  });
});
