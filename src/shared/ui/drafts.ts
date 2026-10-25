/**
 * Paragraph boxes kept on disk (apply.16, PLAN 11.3 j and 7.4), decided
 * without React or Electron so every rule has a test.
 *
 * A box the author left open is written to `<userData>/drafts` while they
 * type, and comes back when its chapter is on screen again: after leaving the
 * chapter, closing the app, an update or a crash. It reopens only where its
 * block still reads exactly as it did when the box opened (`placeDrafts`),
 * because Done turns the box into changes against that text, and against any
 * other text it would undo whatever changed the paragraph. A box that cannot
 * go back and holds something typed is set aside as a .txt instead
 * (`setAsideFileName`, `setAsideText`), so nothing typed is ever thrown away
 * unasked. Full edit's box (rr.2), which holds the whole chapter, is kept the
 * same way once something is typed in it (`whole`, `WHOLE_DRAFT_KEY`). File
 * work is in `src/main/drafts.ts`, the store side in
 * `src/renderer/state/drafts.ts`.
 *
 * Pure (CLAUDE.md rule 4).
 */

import { formatLocalStamp } from '../backups';
import { APP_NAME } from '../branding';
import { fullEditText, liveTextIn } from '../edit';
import type { DraftFile, StoredDraft } from '../ipc';
import { paragraphNumber } from '../prompt/chapter';
import { buildRenderBlocks } from '../render';
import { chapterName } from '../review';
import { splitParagraphs } from '../text/paragraphs';
import type { Hunk } from '../types';
import type { ConfirmSpec } from './confirm';

/** The `version` of a drafts file this app writes and reads. */
export const DRAFT_FILE_VERSION = 1;

/**
 * The key of Full edit's box (rr.2), which holds the whole chapter: no
 * paragraph has it, since a paragraph box's key is its first paragraph's
 * index, from 0.
 */
export const WHOLE_DRAFT_KEY = -1;

/** At most this many boxes are kept for one chapter. */
export const MAX_DRAFTS = 200;

/** A box's text, and what its block read when it opened, are kept up to this many UTF-8 bytes each. */
export const MAX_DRAFT_TEXT_BYTES = 1024 * 1024;

/* ------------------------------------------------------------------ */
/* Checking what is kept                                                */
/* ------------------------------------------------------------------ */

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * A `StoredDraft` in shape: a key, the block's paragraphs starting with it, and
 * two texts; or Full edit's box (rr.2), `whole`, under `WHOLE_DRAFT_KEY` with
 * no paragraphs.
 */
export function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  const paragraphs = draft['paragraphs'];
  const texts = typeof draft['initial'] === 'string' && typeof draft['text'] === 'string';
  if (draft['whole'] !== undefined) {
    return (
      draft['whole'] === true &&
      draft['key'] === WHOLE_DRAFT_KEY &&
      Array.isArray(paragraphs) &&
      paragraphs.length === 0 &&
      texts
    );
  }
  return (
    isIndex(draft['key']) &&
    Array.isArray(paragraphs) &&
    paragraphs.length > 0 &&
    paragraphs.every(isIndex) &&
    paragraphs[0] === draft['key'] &&
    texts
  );
}

/** The length of `text` in UTF-8, counted without an encoder. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Why this set of boxes cannot be kept, addressed to the author, or null when
 * it can: more than `MAX_DRAFTS` boxes, a box over `MAX_DRAFT_TEXT_BYTES`, or
 * anything not a `StoredDraft`. Two boxes may share a key: one open on screen
 * and one that could not be set aside, still kept for the next open, where
 * `placeDrafts` lets the first that fits go back.
 */
export function draftSetProblem(drafts: unknown): string | null {
  if (!Array.isArray(drafts)) return 'The paragraph boxes to keep were not a list.';
  if (drafts.length > MAX_DRAFTS) {
    return `Only ${MAX_DRAFTS} open paragraphs can be kept for a chapter, and ${drafts.length} are open. Close some with Done or Cancel.`;
  }
  for (const draft of drafts) {
    if (!isStoredDraft(draft)) return 'A paragraph box to keep was not in the expected form.';
    if (utf8Length(draft.text) > MAX_DRAFT_TEXT_BYTES || utf8Length(draft.initial) > MAX_DRAFT_TEXT_BYTES) {
      return draft.whole
        ? 'Full edit holds more than 1 MB of text, more than can be kept. Copy it somewhere safe.'
        : `The box for ${paragraphPhrase([draft]).toLowerCase()} holds more than 1 MB of text, more than can be kept. Copy it somewhere safe.`;
    }
  }
  return null;
}

/**
 * A drafts file as read from disk, or null when it is not one this app wrote:
 * another version, or a broken shape. A box in it that is not a
 * `StoredDraft` is left out.
 */
export function parseDraftFile(value: unknown): DraftFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const file = value as Record<string, unknown>;
  const drafts = file['drafts'];
  if (
    file['version'] !== DRAFT_FILE_VERSION ||
    typeof file['sourcePath'] !== 'string' ||
    file['sourcePath'] === '' ||
    typeof file['reviewId'] !== 'string' ||
    typeof file['savedAt'] !== 'string' ||
    !Array.isArray(drafts)
  ) {
    return null;
  }
  return {
    version: DRAFT_FILE_VERSION,
    sourcePath: file['sourcePath'],
    reviewId: file['reviewId'],
    savedAt: file['savedAt'],
    drafts: drafts.filter(isStoredDraft).map(copyDraft)
  };
}

function copyDraft(draft: StoredDraft): StoredDraft {
  return {
    key: draft.key,
    paragraphs: [...draft.paragraphs],
    initial: draft.initial,
    text: draft.text,
    ...(draft.whole ? { whole: true as const } : {})
  };
}

/**
 * The boxes open on screen, as they are kept: first paragraph first, without
 * their selection. Full edit's box is kept only once something is typed in it
 * (rr.2): left as it opened it holds nothing to lose, and the chapter then
 * opens in the mode in use, as any chapter does (rr.5).
 */
export function toStoredDrafts(drafts: Readonly<Record<number, StoredDraft>>): StoredDraft[] {
  return Object.values(drafts)
    .filter((draft) => !draft.whole || draft.text !== draft.initial)
    .map(copyDraft)
    .sort((a, b) => a.key - b.key);
}

/* ------------------------------------------------------------------ */
/* Putting boxes back                                                   */
/* ------------------------------------------------------------------ */

/** The page a box would go back on: the review on screen. */
export interface DraftPage {
  base: string;
  hunks: readonly Hunk[];
}

export interface DraftPlacement {
  /** boxes that go back, first paragraph first, each with the block it now covers */
  reopen: StoredDraft[];
  /** boxes holding typed text whose block no longer reads as when they opened */
  setAside: StoredDraft[];
  /** boxes left as they opened that cannot go back: nothing typed, nothing lost */
  dropped: StoredDraft[];
}

/**
 * Which kept boxes go back on the page (PLAN 11.3 j). A box goes back only
 * where a block of the page starts at its key and reads exactly as the box's
 * `initial`, the same test Done applies (`commitDraft`), so a box that goes
 * back can always be applied. It is not looked for elsewhere: a paragraph
 * added or removed above it moves its number, and the box is set aside rather
 * than guessed onto a paragraph that happens to read the same. A box whose
 * block is covered by a box already `open`, or by one placed before it, does
 * not go back either. One that cannot go back is set aside when its text
 * differs from its `initial`, and dropped when it does not. Full edit's box
 * goes back where the chapter's body reads as `initial` and no box is open,
 * and only when something was typed in it (rr.2).
 *
 * Which review the box was typed in does not matter: the test is the text,
 * whatever decisions produced it.
 */
export function placeDrafts(
  page: DraftPage,
  stored: readonly StoredDraft[],
  open: readonly Pick<StoredDraft, 'paragraphs' | 'whole'>[] = []
): DraftPlacement {
  const blocks = buildRenderBlocks(page.base, splitParagraphs(page.base), page.hunks).filter(
    (block) => !block.isFrontmatter
  );
  const taken = new Set<number>(open.flatMap((draft) => draft.paragraphs));
  const placement: DraftPlacement = { reopen: [], setAside: [], dropped: [] };
  /* Full edit's box holds every paragraph (rr.2), so it goes back only onto a
     page with no box open, by the same test Done applies (`fullEditText`), and
     no box goes back beside it. Its key sorts it first. One left as it opened
     is dropped, so the chapter opens in the mode in use (rr.5). */
  let whole = open.some((draft) => draft.whole === true);

  for (const draft of [...stored].sort((a, b) => a.key - b.key)) {
    if (draft.whole) {
      const typed = draft.text !== draft.initial;
      const fits =
        typed && !whole && taken.size === 0 && fullEditText(page.base, page.hunks) === draft.initial;
      if (fits) {
        whole = true;
        placement.reopen.push(copyDraft(draft));
      } else if (typed) {
        placement.setAside.push(copyDraft(draft));
      } else {
        placement.dropped.push(copyDraft(draft));
      }
      continue;
    }
    const block = blocks.find((b) => b.paragraphs[0] === draft.key);
    const fits =
      !whole &&
      block !== undefined &&
      !block.paragraphs.some((p) => taken.has(p)) &&
      liveTextIn(page.base, page.hunks, block) === draft.initial;
    if (fits) {
      for (const p of block.paragraphs) taken.add(p);
      placement.reopen.push({ ...copyDraft(draft), paragraphs: [...block.paragraphs] });
    } else if (draft.text !== draft.initial) {
      placement.setAside.push(copyDraft(draft));
    } else {
      placement.dropped.push(copyDraft(draft));
    }
  }
  return placement;
}

/* ------------------------------------------------------------------ */
/* Words                                                                */
/* ------------------------------------------------------------------ */

/** "12", or "12-13" for a box over a block of two paragraphs, as the rail labels it. */
export function draftLabel(paragraphs: readonly number[]): string {
  const first = paragraphs[0] ?? 0;
  const last = paragraphs[paragraphs.length - 1] ?? first;
  return first === last ? `${paragraphNumber(first)}` : `${paragraphNumber(first)}-${paragraphNumber(last)}`;
}

/** "3", "3 and 7", "3, 7 and 12". */
function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** More than one paragraph, counting each paragraph a box covers. */
function plural(drafts: readonly Pick<StoredDraft, 'paragraphs'>[]): boolean {
  return drafts.length > 1 || (drafts[0]?.paragraphs.length ?? 0) > 1;
}

/** "Paragraph 12", "Paragraphs 12-13", "Paragraphs 3 and 12". */
function paragraphPhrase(drafts: readonly Pick<StoredDraft, 'paragraphs'>[]): string {
  const labels = [...drafts]
    .sort((a, b) => (a.paragraphs[0] ?? 0) - (b.paragraphs[0] ?? 0))
    .map((draft) => draftLabel(draft.paragraphs));
  return `${plural(drafts) ? 'Paragraphs' : 'Paragraph'} ${listPhrase(labels)}`;
}

/**
 * The card when boxes holding typed text came back, or null when none did:
 * one left as it opened is just open again and needs no card.
 */
export function restoredCardText(reopened: readonly StoredDraft[]): string | null {
  const typed = reopened.filter((draft) => draft.text !== draft.initial);
  if (typed.length === 0) return null;
  // Full edit's box goes back alone, as no paragraph box goes back beside it (rr.2).
  if (typed.some((draft) => draft.whole)) return 'Full edit is open again, as you left it.';
  return plural(typed)
    ? `${paragraphPhrase(typed)} are open for editing again, as you left them.`
    : `${paragraphPhrase(typed)} is open for editing again, as you left it.`;
}

/** Why Full edit's box was not put back (rr.2), before the words the card and the .txt add. */
const WHOLE_NOT_REOPENED =
  'The chapter no longer reads as it did when you left Full edit open, so Full edit was not opened again.';

/** Why paragraph boxes were not put back, before the words the card adds. */
function boxesNotReopened(boxes: readonly StoredDraft[]): string {
  const many = plural(boxes);
  const box = boxes.length === 1 ? `${many ? 'their' : 'its'} box was` : 'their boxes were';
  return many
    ? `${paragraphPhrase(boxes)} no longer read as they did when you left them open for editing, so ${box} not reopened.`
    : `${paragraphPhrase(boxes)} no longer reads as it did when you left it open for editing, so ${box} not reopened.`;
}

/** The card when boxes were set aside into the file `name`; its button is Show the text. */
export function setAsideCardText(setAside: readonly StoredDraft[], name: string): string {
  const boxes = setAside.filter((draft) => !draft.whole);
  const reasons = [
    ...(setAside.some((draft) => draft.whole) ? [WHOLE_NOT_REOPENED] : []),
    ...(boxes.length > 0 ? [boxesNotReopened(boxes)] : [])
  ];
  return `${reasons.join(' ')} What you typed is kept in ${name}.`;
}

/** An error message as a sentence of its own: ending in a full stop. */
function asSentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The card when boxes that cannot go back could not be written to a .txt either. */
export function setAsideFailedCardText(setAside: readonly StoredDraft[], message: string): string {
  const boxes = setAside.filter((draft) => !draft.whole);
  const whole = setAside.some((draft) => draft.whole);
  const many = plural(boxes);
  const phrase = paragraphPhrase(boxes);
  const what = [
    ...(whole ? ['The chapter no longer reads as it did when you left Full edit open'] : []),
    ...(boxes.length > 0
      ? [
          `${whole ? phrase.toLowerCase() : phrase} no longer ${many ? 'read as they' : 'reads as it'} did when you left ${
            many ? 'them' : 'it'
          } open for editing`
        ]
      : [])
  ];
  return `${what.join(', and ')}, and what you typed could not be set aside: ${asSentence(message)} It is still kept, and is tried again the next time you open this chapter.`;
}

/**
 * The card when the boxes kept for a chapter could not be read. Nothing is
 * written to the file until it has been read, so boxes typed in meanwhile are
 * not kept yet.
 */
export function draftsUnreadableCardText(message: string): string {
  return `The paragraphs you left open in this chapter could not be read back: ${asSentence(
    message
  )} Nothing is written over them, so what you type in this chapter is kept only once they can be read.`;
}

/**
 * The card when that file could be read at a later write: what it held is
 * kept with the boxes on screen, and goes back on the page at the next open.
 */
export function draftsReadLaterCardText(): string {
  return 'The paragraphs you left open in this chapter could be read back after all. They are kept, and open for editing again the next time you come back to this chapter.';
}

/**
 * The question before Escape or Cancel closes a box whose text changed
 * (7.4). Keep editing has the focus, so Enter never throws the text away.
 */
export function discardDraftPrompt(paragraphs: readonly number[]): ConfirmSpec {
  const which = paragraphs.length > 1 ? 'paragraphs' : 'paragraph';
  return {
    title: `Discard your changes to ${which} ${draftLabel(paragraphs)}?`,
    body: 'What you typed in this box will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    defaultButton: 'cancel'
  };
}

/* ------------------------------------------------------------------ */
/* The set-aside file                                                   */
/* ------------------------------------------------------------------ */

/** Characters Windows refuses in a file name, the control characters among them. */
function safeNameChar(ch: string): string {
  return ch.charCodeAt(0) < 0x20 || '<>:"/\\|?*'.includes(ch) ? '_' : ch;
}

/**
 * `Chapter 03 2026-10-17 14.02.33.txt` (PLAN 11.3 j): the chapter's name
 * without its extension, then the local time it was set aside, as backups
 * name theirs (6.5). Characters a file name cannot hold become `_`, and a
 * second file in the same second gets `-2` after the time, a third `-3`.
 */
export function setAsideFileName(sourcePath: string, date: Date, seq = 1): string {
  const chapter =
    [...chapterName(sourcePath)]
      .slice(0, 100)
      .map(safeNameChar)
      .join('')
      .replace(/[. ]+$/, '')
      .trim() || 'chapter';
  const suffix = seq > 1 ? `-${Math.floor(seq)}` : '';
  return `${chapter} ${formatLocalStamp(date)}${suffix}.txt`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * What a set-aside file says: when and why, the chapter it came from, then
 * each box's text and what its block read when it opened. Lines end in "\n";
 * main writes them as the platform does.
 */
export function setAsideText(sourcePath: string, drafts: readonly StoredDraft[], date: Date): string {
  const segments = sourcePath.split(/[\\/]/);
  const file = segments[segments.length - 1] ?? sourcePath;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const boxes = drafts.filter((draft) => !draft.whole);
  const many = plural(boxes);
  const intro: string[] = [];
  if (drafts.some((draft) => draft.whole)) {
    intro.push(
      `You left Full edit open on ${file}. The chapter no longer reads as it did when you opened it, so ${APP_NAME} did not open it again. Copy what you want to keep into the chapter.`
    );
  }
  if (boxes.length > 0) {
    intro.push(
      many
        ? `You left these paragraphs of ${file} open for editing. They no longer read as they did when you opened them, so ${APP_NAME} did not put the boxes back. Copy what you want to keep into the chapter.`
        : `You left this paragraph of ${file} open for editing. It no longer reads as it did when you opened it, so ${APP_NAME} did not put the box back. Copy what you want to keep into the chapter.`
    );
  }
  const lines = [
    `Set aside by ${APP_NAME} on ${day} at ${time}.`,
    '',
    intro.join(' '),
    '',
    `Chapter file: ${sourcePath}`
  ];
  for (const draft of [...drafts].sort((a, b) => a.key - b.key)) {
    if (draft.whole) {
      lines.push(
        '',
        '',
        'Full edit, as you left it:',
        '',
        draft.text,
        '',
        'The chapter, as it read when you opened Full edit:',
        '',
        draft.initial
      );
      continue;
    }
    const label = draftLabel(draft.paragraphs);
    const two = draft.paragraphs.length > 1;
    const name = two ? `Paragraphs ${label}` : `Paragraph ${label}`;
    lines.push(
      '',
      '',
      `${name}, as you left ${two ? 'them' : 'it'}:`,
      '',
      draft.text,
      '',
      `${name}, as ${two ? 'they' : 'it'} read when you opened ${two ? 'them' : 'it'}:`,
      '',
      draft.initial
    );
  }
  return `${lines.join('\n')}\n`;
}
