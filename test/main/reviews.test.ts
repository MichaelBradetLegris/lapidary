import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFailure, explainReadError, explainWriteError, toAppError } from '../../src/main/errors';
import {
  ADOPT_MIN_LENGTH,
  findAdoptable,
  isDefaultReviewsFolder,
  listReviews,
  loadLatestReview,
  loadReviewFile,
  makeReviewsFolder,
  recordShown,
  resolveReviewsFolder,
  reviewIndex,
  saveReview
} from '../../src/main/reviews';
import { APP_NAME } from '../../src/shared/branding';
import { rebaseReview } from '../../src/shared/diff/rebase';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { chapterListMarks } from '../../src/shared/ui/chapterList';
import { historyCounts } from '../../src/shared/ui/history';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-store-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function make(sourcePath: string, createdAt: string, hunks: Review['hunks'] = []): Review {
  return createReview({
    sourcePath,
    base: { text: 'the text', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    hunks,
    generator: { kind: 'claude' },
    now: createdAt
  });
}

const pendingHunk: Review['hunks'][number] = {
  id: 'h1',
  start: 0,
  end: 3,
  baseSide: 'original',
  original: 'the',
  replacement: 'The',
  paragraph: 0,
  source: 'claude',
  status: 'pending',
  anchor: 'exact'
};

describe('review store', () => {
  it('writes into a per-chapter folder named after the chapter', async () => {
    const review = make('C:/vault/Chapter 12.md', '2026-09-08T10:00:00.000Z');
    const { path: file } = await saveReview(root, review);
    expect(path.dirname(file).endsWith(path.join('chapter-12'))).toBe(true);
    expect(path.basename(file)).toBe('2026-09-08T10-00-00-000Z.review.json');
    expect((await loadReviewFile(file)).id).toBe(review.id);
  });

  it('lists a chapter history newest first', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, make(source, '2026-09-08T10:00:00.000Z'));
    await saveReview(root, make(source, '2026-09-08T12:00:00.000Z'));
    const list = await listReviews(root, source);
    expect(list.map((s) => s.createdAt)).toEqual(['2026-09-08T12:00:00.000Z', '2026-09-08T10:00:00.000Z']);
  });

  it('loads the newest review for a chapter', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, make(source, '2026-09-08T10:00:00.000Z'));
    await saveReview(root, make(source, '2026-09-08T12:00:00.000Z', [pendingHunk]));
    const latest = await loadLatestReview(root, source);
    expect(latest?.review.createdAt).toBe('2026-09-08T12:00:00.000Z');
    expect(latest?.review.hunks).toHaveLength(1);
  });

  it('returns null when a chapter has no reviews', async () => {
    expect(await loadLatestReview(root, 'C:/vault/Nothing.md')).toBeNull();
    expect(await listReviews(root, 'C:/vault/Nothing.md')).toEqual([]);
  });

  it('overwrites in place when given a path, so decisions land in the same entry', async () => {
    const review = make('C:/vault/Chapter 12.md', '2026-09-08T10:00:00.000Z', [pendingHunk]);
    const { path: file } = await saveReview(root, review);
    const decided: Review = {
      ...review,
      hunks: [{ ...pendingHunk, status: 'accepted' }]
    };
    const again = await saveReview(root, decided, file);
    expect(again.path).toBe(file);
    expect(await listReviews(root, review.sourcePath)).toHaveLength(1);
    expect((await loadReviewFile(file)).hunks[0]?.status).toBe('accepted');
  });

  it('counts pending suggestions for the badge', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, make(source, '2026-09-08T10:00:00.000Z', [pendingHunk]));
    const [summary] = await listReviews(root, source);
    expect(summary).toMatchObject({ hunkCount: 1, pendingCount: 1, generatorKind: 'claude' });
  });

  it('builds an index of the current review per chapter, keyed by the paths asked for', async () => {
    await saveReview(root, make('C:/vault/Chapter 1.md', '2026-09-08T10:00:00.000Z', [pendingHunk]));
    await saveReview(root, make('C:/vault/Chapter 1.md', '2026-09-08T11:00:00.000Z'));
    await saveReview(root, make('C:/vault/Chapter 2.md', '2026-09-08T10:00:00.000Z', [pendingHunk]));
    // Spelled with backslashes, as the file list has them; the reviews say C:/vault.
    const chapters = ['C:\\vault\\Chapter 1.md', 'C:\\vault\\Chapter 2.md', 'C:\\vault\\Chapter 3.md'];
    const index = await reviewIndex(root, chapters);
    expect(Object.keys(index)).toEqual(chapters.slice(0, 2));
    const first = index[chapters[0]!];
    expect(first?.createdAt).toBe('2026-09-08T11:00:00.000Z');
    expect(first?.pendingCount).toBe(0);
    expect(first?.sourcePath).toBe('C:/vault/Chapter 1.md');
  });

  it('ignores foreign or corrupt json in the reviews folder', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, make(source, '2026-09-08T10:00:00.000Z'));
    const dir = path.join(root, 'chapter-12');
    await fs.writeFile(path.join(dir, 'junk.review.json'), '{ not json');
    await fs.writeFile(path.join(dir, 'other.json'), '{}');
    expect(await listReviews(root, source)).toHaveLength(1);
  });

  it('rejects a file that is not a review', async () => {
    const file = path.join(root, 'x.json');
    await fs.writeFile(file, '{"version":2}');
    await expect(loadReviewFile(file)).rejects.toThrow(/Not a review file/);
  });

  it('explains a review file it cannot read as a read, naming the file (apply.24)', async () => {
    const { path: file } = await saveReview(root, make('C:/vault/Chapter 12.md', '2026-09-08T10:00:00.000Z'));
    const name = `the review file ${path.basename(file)}`;
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      const refused = Object.assign(new Error(`${code}: refused`), { code, path: file });
      const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(refused);
      try {
        const err = await loadReviewFile(file).then(
          () => null,
          (e: unknown) => e
        );
        expect(err).toBeInstanceOf(AppFailure);
        // What the IPC bridge sends on: the read words, not a failed save's.
        const shown = toAppError(err);
        expect(shown).toMatchObject({
          code: 'io',
          message: explainReadError(refused, name, process.platform)
        });
        expect(shown.message).not.toMatch(/replace|save again|Nothing was written|Controlled folder access/);
      } finally {
        read.mockRestore();
      }
    }
    // A History entry whose file was deleted or moved outside the app: a
    // review file cannot be opened again from where it is now, so the words
    // stop at what may have happened to it.
    await fs.rm(file);
    const gone = await loadReviewFile(file).then(
      () => null,
      (e: unknown) => e
    );
    expect(toAppError(gone)).toMatchObject({
      code: 'io',
      message: `${APP_NAME} could not find the review file ${path.basename(file)}. It may have been renamed, moved or deleted. ${APP_NAME} has not changed anything.`
    });
    // Words that are not the file system's are left as they were.
    await fs.writeFile(file, '{ not json');
    await expect(loadReviewFile(file)).rejects.toThrow(SyntaxError);
  });

  it('returns an empty index when the reviews folder does not exist', async () => {
    expect(await reviewIndex(path.join(root, 'nope'), ['C:/vault/Chapter 1.md'])).toEqual({});
  });
});

describe('reviews folder resolution', () => {
  const userData = path.join('C:', 'Users', 'A', 'AppData', 'Roaming', 'manuscript-review');

  it('uses the folder the author chose', () => {
    expect(resolveReviewsFolder('D:/reviews', userData)).toBe('D:/reviews');
    expect(isDefaultReviewsFolder('D:/reviews')).toBe(false);
  });

  it('falls back to a folder in the app data directory, never to an error', () => {
    // A generated review must always have somewhere to go (plan 6.4, item 15).
    const expected = path.join(userData, 'reviews');
    expect(resolveReviewsFolder(null, userData)).toBe(expected);
    expect(resolveReviewsFolder(undefined, userData)).toBe(expected);
    expect(resolveReviewsFolder('   ', userData)).toBe(expected);
    expect(isDefaultReviewsFolder(null)).toBe(true);
    expect(isDefaultReviewsFolder('')).toBe(true);
  });

  it('writes and reads back through the resolved default folder', async () => {
    const folder = resolveReviewsFolder(null, root);
    const review = make('C:/vault/Chapter 3.md', '2026-09-09T09:00:00.000Z');
    const { path: file } = await saveReview(folder, review);
    expect(file.startsWith(folder)).toBe(true);
    expect((await loadLatestReview(folder, 'C:/vault/Chapter 3.md'))?.review.id).toBe(review.id);
  });
});

/* files.1: a review belongs to one chapter file, and follows it when the vault
   moves or the chapter is renamed or moved in Obsidian (PLAN 11.3 g, C.45). */

const T1 = '2026-09-08T10:00:00.000Z';
const T2 = '2026-09-08T12:00:00.000Z';
const LONG = 'The ferry crossed slowly. '.repeat(30);
const gone = (): Promise<boolean> => Promise.resolve(false);
const there = (): Promise<boolean> => Promise.resolve(true);

function makeWith(sourcePath: string, createdAt: string, text: string, hash: string): Review {
  return createReview({
    sourcePath,
    base: { text, hash, eol: 'lf', bom: false, trailingNewline: true },
    hunks: [],
    generator: { kind: 'claude' },
    now: createdAt
  });
}

async function missing(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => false,
    () => true
  );
}

describe('reviews belong to one chapter file', () => {
  it('keeps same-named chapters in sibling folders apart', async () => {
    const a = 'C:/vault/A/Chapter 01.md';
    const b = 'C:/vault/B/Chapter 01.md';
    const { path: fileA } = await saveReview(root, make(a, T1, [pendingHunk]));
    expect(await listReviews(root, b)).toEqual([]);
    expect(await loadLatestReview(root, b, { exists: there })).toBeNull();
    // Even with A gone, a shared file name alone is not enough to adopt.
    expect(await loadLatestReview(root, b, { exists: gone })).toBeNull();

    const { path: fileB } = await saveReview(root, make(b, T2));
    expect(path.dirname(fileB)).toBe(path.dirname(fileA));
    const index = await reviewIndex(root, [a, b]);
    expect(index[a]?.path).toBe(fileA);
    expect(index[b]?.path).toBe(fileB);
    expect((await listReviews(root, a)).map((s) => s.path)).toEqual([fileA]);
    expect((await loadLatestReview(root, b))?.path).toBe(fileB);
  });

  it('keeps chapters whose names make the same folder apart, even created the same millisecond', async () => {
    const a = 'C:/vault/Chapter 1.md';
    const b = 'C:/vault/chapter_1.md';
    const saved = await saveReview(root, make(a, T1));
    const other = await saveReview(root, make(b, T1));
    expect(path.dirname(other.path)).toBe(path.dirname(saved.path));
    expect(path.basename(other.path)).toBe('2026-09-08T10-00-00-000Z-2.review.json');
    expect((await loadReviewFile(saved.path)).sourcePath).toBe(a);
    expect((await listReviews(root, a)).map((s) => s.path)).toEqual([saved.path]);
    expect((await listReviews(root, b)).map((s) => s.path)).toEqual([other.path]);
  });

  it('compares paths as the file system does', async () => {
    const { path: file } = await saveReview(root, make('C:/vault/Chapter 4.md', T1), undefined, { ci: true });
    const loaded = await loadLatestReview(root, 'c:\\VAULT\\chapter 4.md', { ci: true });
    expect(loaded?.path).toBe(file);
    expect(await loadLatestReview(root, 'C:/vault/chapter 4.md', { ci: false, exists: there })).toBeNull();
  });
});

/* apply.26: a chapter opens with the review last on screen for it. */
describe('the review a chapter opens with', () => {
  const source = 'C:/vault/Chapter 12.md';
  const lastOpenFile = (): string => path.join(root, 'chapter-12', '.last-open.json');

  /** What the chapter opens with, as `reviews:load-latest` and the list's marks pick it. */
  async function opensWith(chapter = source): Promise<{ load?: string; index?: string }> {
    const load = (await loadLatestReview(root, chapter))?.review.createdAt;
    const index = (await reviewIndex(root, [chapter]))[chapter]?.createdAt;
    return { ...(load ? { load } : {}), ...(index ? { index } : {}) };
  }

  it('is a new review once it arrives, even over one decided in later, while History stays in creation order', async () => {
    await saveReview(root, { ...make(source, T1, [pendingHunk]), decidedAt: '2026-09-09T00:00:00.000Z' });
    await saveReview(root, make(source, T2));
    expect(await opensWith()).toEqual({ load: T2, index: T2 });
    expect((await listReviews(root, source)).map((s) => s.createdAt)).toEqual([T2, T1]);
  });

  it('is an older review once it has been on screen, until another review is', async () => {
    const { path: older } = await saveReview(root, make(source, T1, [pendingHunk]));
    const { path: newer } = await saveReview(root, make(source, T2, [pendingHunk]));
    expect(await recordShown(root, source, older)).toBe(true);
    expect(await opensWith()).toEqual({ load: T1, index: T1 });
    // Decisions written into the newer review, as a save off screen does, change nothing.
    await saveReview(root, { ...make(source, T2), decidedAt: '2026-09-10T00:00:00.000Z' }, newer);
    expect(await opensWith()).toEqual({ load: T1, index: T1 });
    expect(await recordShown(root, source, newer)).toBe(true);
    expect(await opensWith()).toEqual({ load: T2, index: T2 });
    // A third review arriving is on screen, or what opens next.
    await recordShown(root, source, older);
    const T3 = '2026-09-11T08:00:00.000Z';
    await saveReview(root, make(source, T3));
    expect(await opensWith()).toEqual({ load: T3, index: T3 });
  });

  it('is recorded without touching the review file, its times included', async () => {
    const decided = { ...make(source, T1, [pendingHunk]), decidedAt: '2026-09-08T11:00:00.000Z' };
    const { path: older } = await saveReview(root, decided);
    await saveReview(root, make(source, T2));
    const before = { bytes: await fs.readFile(older), mtime: (await fs.stat(older)).mtimeMs };
    expect(await recordShown(root, source, older)).toBe(true);
    expect(await fs.readFile(older)).toEqual(before.bytes);
    expect((await fs.stat(older)).mtimeMs).toBe(before.mtime);
    const [, entry] = await listReviews(root, source);
    expect(entry).toMatchObject({ createdAt: T1, updatedAt: T1, decidedAt: '2026-09-08T11:00:00.000Z' });
  });

  it('writes the record only when it changes', async () => {
    const { path: file } = await saveReview(root, make(source, T1));
    const first = (await fs.stat(lastOpenFile())).mtimeMs;
    const bytes = await fs.readFile(lastOpenFile(), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await recordShown(root, source, file)).toBe(true);
    expect((await fs.stat(lastOpenFile())).mtimeMs).toBe(first);
    expect(JSON.parse(bytes)).toEqual({
      version: 1,
      chapters: [{ sourcePath: source, file: path.basename(file) }]
    });
  });

  it('records only a review of this chapter in its own folder', async () => {
    const { path: own } = await saveReview(root, make(source, T2));
    const other = await saveReview(root, make('C:/vault/B/Chapter 12.md', T1));
    const elsewhere = path.join(root, 'elsewhere', path.basename(own));
    await fs.mkdir(path.dirname(elsewhere));
    await fs.copyFile(own, elsewhere);
    expect(await recordShown(root, source, other.path)).toBe(false);
    expect(await recordShown(root, source, elsewhere)).toBe(false);
    expect(await recordShown(root, source, path.join(root, 'chapter-12', 'nothing.review.json'))).toBe(false);
    expect(await recordShown(root, source, path.join(root, 'chapter-12', '.last-open.json'))).toBe(false);
    expect((await loadLatestReview(root, source))?.path).toBe(own);
  });

  it('keeps a record per chapter for same-named chapters that share a folder', async () => {
    const a = 'C:/vault/A/Chapter 12.md';
    const b = 'C:/vault/B/Chapter 12.md';
    const { path: a1 } = await saveReview(root, make(a, T1));
    await saveReview(root, make(a, T2));
    const { path: b1 } = await saveReview(root, make(b, T1));
    const { path: b2 } = await saveReview(root, make(b, '2026-09-08T13:00:00.000Z'));
    await recordShown(root, a, a1);
    const index = await reviewIndex(root, [a, b]);
    expect(index[a]?.path).toBe(a1);
    expect(index[b]?.path).toBe(b2);
    await recordShown(root, b, b1);
    expect((await loadLatestReview(root, a))?.path).toBe(a1);
    expect((await loadLatestReview(root, b))?.path).toBe(b1);
  });

  it('is the review last decided in when nothing is recorded, or the review recorded is gone', async () => {
    // Every chapter opened that way before anything was recorded, and a
    // decision is made only on screen. The first file in the folder is
    // neither the newest nor the one decided in.
    await saveReview(root, make(source, '2026-09-08T08:00:00.000Z'));
    const { path: older } = await saveReview(root, {
      ...make(source, T1, [pendingHunk]),
      decidedAt: '2026-09-09T00:00:00.000Z'
    });
    const { path: newer } = await saveReview(root, make(source, T2));
    await fs.rm(lastOpenFile());
    expect(await opensWith()).toEqual({ load: T1, index: T1 });
    await recordShown(root, source, newer);
    expect(await opensWith()).toEqual({ load: T2, index: T2 });
    await fs.rm(newer);
    expect(await opensWith()).toEqual({ load: T1, index: T1 });
    expect((await loadLatestReview(root, source))?.path).toBe(older);
    // A record this app did not write is no record.
    await fs.writeFile(lastOpenFile(), '{ half');
    expect(await opensWith()).toEqual({ load: T1, index: T1 });
  });

  it('leaves a review written and its chapter readable when the record cannot be written', async () => {
    // A folder where the record goes: Windows refuses the rename, and the
    // write gives up after its retries (about 1.5 s each time).
    await fs.mkdir(lastOpenFile(), { recursive: true });
    const { path: file } = await saveReview(root, make(source, T1));
    expect((await loadReviewFile(file)).createdAt).toBe(T1);
    expect(await recordShown(root, source, file)).toBe(false);
    expect((await loadLatestReview(root, source))?.path).toBe(file);
  }, 15_000);

  it('counts decisions the chapter file does not have yet', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, make(source, T1, [{ ...pendingHunk, status: 'accepted' }]));
    const [summary] = await listReviews(root, source);
    expect(summary).toMatchObject({ unsavedCount: 1, pendingCount: 0, sourcePath: source });
  });

  /** A saved change, one accepted since, one turned back after a save, a
      dismissed and a lost one, and one still pending. */
  function mixedReview(source: string): Review {
    const hunk = (
      id: string,
      start: number,
      patch: Partial<Review['hunks'][number]>
    ): Review['hunks'][number] => ({
      ...pendingHunk,
      id,
      start,
      end: start + 1,
      original: 'a',
      replacement: 'b',
      ...patch
    });
    return {
      ...make(source, T1),
      base: { text: 'abcdefghij', hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
      hunks: [
        hunk('saved', 0, { status: 'accepted', baseSide: 'replacement' }),
        hunk('accepted', 2, { status: 'accepted' }),
        hunk('turned-back', 4, { status: 'pending', baseSide: 'replacement' }),
        hunk('dismissed', 6, { status: 'dismissed' }),
        hunk('lost', 8, { anchor: 'stale' }),
        hunk('pending', 9, {})
      ]
    };
  }

  it('marks a chapter in the list as it was marked while open (apply.5)', async () => {
    // Once written, the list must mark the chapter it has just left exactly as
    // it marked it open.
    const source = 'C:/vault/Chapter 12.md';
    const review = mixedReview(source);
    await saveReview(root, review);
    const summary = (await reviewIndex(root, [source]))[source];
    expect(chapterListMarks(summary, null)).toEqual(chapterListMarks(undefined, review));
    expect(chapterListMarks(summary, null)).toEqual({
      unsaved: 2,
      dotLabel: '2 changes are not saved to the chapter yet.',
      pending: 2
    });
  });

  it('counts a review in History as it was counted on screen (apply.5)', async () => {
    // Opening another review reads History again: the row of the one just
    // left must keep the numbers it showed while that review was on screen.
    const source = 'C:/vault/Chapter 12.md';
    const review = mixedReview(source);
    const { path: file } = await saveReview(root, review);
    const [summary] = await listReviews(root, source);
    if (!summary) throw new Error('no summary');
    expect(summary.path).toBe(file);
    const onScreen = historyCounts(summary, file, review);
    const other = await saveReview(root, make(source, T2, [pendingHunk]));
    const left = historyCounts(summary, other.path, make(source, T2, [pendingHunk]));
    expect(onScreen).toEqual({ onScreen: true, hunkCount: 6, pendingCount: 2 });
    expect(left).toEqual({ ...onScreen, onScreen: false });
  });
});

describe('following a moved or renamed chapter', () => {
  it('follows a vault that moved, history and all', async () => {
    const old = 'C:/Old/Novel/Ch 1.md';
    const now = 'D:/New/Novel/Ch 1.md';
    await saveReview(root, make(old, T1));
    await saveReview(root, make(old, T2, [pendingHunk]));
    const asked: string[] = [];
    const loaded = await loadLatestReview(root, now, {
      exists: (file) => {
        asked.push(file);
        return Promise.resolve(false);
      }
    });
    expect(asked).toEqual([old]);
    expect(loaded?.adoptedFrom).toBe(old);
    expect(loaded?.review.sourcePath).toBe(now);
    expect(loaded?.review.createdAt).toBe(T2);
    const history = await listReviews(root, now);
    expect(history).toHaveLength(2);
    for (const summary of history) expect((await loadReviewFile(summary.path)).sourcePath).toBe(now);
    expect(await listReviews(root, old)).toEqual([]);
    expect(await fs.readdir(root)).toEqual(['ch-1']);
  });

  it('follows a chapter renamed in Obsidian by its text, moving its whole history', async () => {
    const old = 'C:/vault/Draft 7.md';
    const now = 'C:/vault/Chapter 7.md';
    await saveReview(root, makeWith(old, T1, 'An earlier draft.', 'H6'));
    await saveReview(root, makeWith(old, T2, LONG, 'H7'));
    const loaded = await loadLatestReview(root, now, { hash: 'H7', exists: gone });
    expect(loaded?.adoptedFrom).toBe(old);
    expect(path.dirname(loaded!.path)).toBe(path.join(root, 'chapter-7'));
    expect((await listReviews(root, now)).map((s) => s.createdAt)).toEqual([T2, T1]);
    expect(await fs.readdir(root)).toEqual(['chapter-7']);
    // Asked again, the reviews are simply its own.
    expect((await loadLatestReview(root, now, { hash: 'H7', exists: gone }))?.adoptedFrom).toBeUndefined();
  });

  it('carries the review last on screen to the new path, and leaves no record behind (apply.26)', async () => {
    const old = 'C:/vault/Draft 7.md';
    const now = 'C:/vault/Chapter 7.md';
    const { path: older } = await saveReview(root, makeWith(old, T1, LONG, 'H7'));
    await saveReview(root, makeWith(old, T2, LONG, 'H7'));
    await recordShown(root, old, older);
    const loaded = await loadLatestReview(root, now, { hash: 'H7', exists: gone });
    expect(loaded?.adoptedFrom).toBe(old);
    expect(loaded?.review.createdAt).toBe(T1);
    expect(path.basename(loaded!.path)).toBe(path.basename(older));
    expect((await reviewIndex(root, [now]))[now]?.createdAt).toBe(T1);
    // The old folder held only these reviews and their record, so it goes.
    expect(await fs.readdir(root)).toEqual(['chapter-7']);
  });

  it('carries the record within a shared folder when the vault moved', async () => {
    const old = 'C:/Old/Novel/Ch 1.md';
    const now = 'D:/New/Novel/Ch 1.md';
    const { path: older } = await saveReview(root, make(old, T1));
    await saveReview(root, make(old, T2));
    await recordShown(root, old, older);
    expect((await loadLatestReview(root, now, { exists: gone }))?.path).toBe(older);
    const record: unknown = JSON.parse(await fs.readFile(path.join(root, 'ch-1', '.last-open.json'), 'utf8'));
    expect(record).toEqual({ version: 1, chapters: [{ sourcePath: now, file: path.basename(older) }] });
  });

  it('adopts nothing while the old file still exists', async () => {
    const { path: file } = await saveReview(root, makeWith('C:/vault/Draft 7.md', T1, LONG, 'H7'));
    expect(
      await loadLatestReview(root, 'C:/vault/Copy of Draft 7.md', { hash: 'H7', exists: there })
    ).toBeNull();
    expect((await loadReviewFile(file)).sourcePath).toBe('C:/vault/Draft 7.md');
  });

  it('adopts nothing by text for a chapter shorter than the minimum', async () => {
    const short = 'x'.repeat(ADOPT_MIN_LENGTH - 1);
    await saveReview(root, makeWith('C:/vault/Empty.md', T1, short, 'HS'));
    expect(await loadLatestReview(root, 'C:/vault/Blank.md', { hash: 'HS', exists: gone })).toBeNull();
    await saveReview(root, makeWith('C:/vault/Long.md', T1, 'x'.repeat(ADOPT_MIN_LENGTH), 'HL'));
    expect(await findAdoptable(root, 'C:/vault/Longer.md', { hash: 'HL', exists: gone })).toBe(
      'C:/vault/Long.md'
    );
  });

  it('adopts nothing when two old paths fit equally well', async () => {
    await saveReview(root, makeWith('C:/vault/One.md', T1, LONG, 'H'));
    await saveReview(root, makeWith('C:/vault/Two.md', T2, LONG, 'H'));
    expect(await findAdoptable(root, 'C:/vault/Three.md', { hash: 'H', exists: gone })).toBeNull();
    expect(await loadLatestReview(root, 'C:/vault/Three.md', { hash: 'H', exists: gone })).toBeNull();
    expect(await listReviews(root, 'C:/vault/One.md')).toHaveLength(1);
  });

  it('prefers the text to the path, and the closer path to the farther one', async () => {
    const now = 'D:/New/Novel/Part 1/Ch 1.md';
    await saveReview(root, make('C:/Old/Novel/Part 2/Ch 1.md', T1));
    await saveReview(root, make('C:/Old/Novel/Part 1/Ch 1.md', T1));
    expect(await findAdoptable(root, now, { exists: gone })).toBe('C:/Old/Novel/Part 1/Ch 1.md');
    await saveReview(root, makeWith('C:/vault/Renamed.md', T2, LONG, 'H'));
    expect(await findAdoptable(root, now, { hash: 'H', exists: gone })).toBe('C:/vault/Renamed.md');
  });

  it('finishes an adoption a crash interrupted, on the next call', async () => {
    const old = 'C:/vault/Draft 7.md';
    const now = 'C:/vault/Chapter 7.md';
    const { path: f1 } = await saveReview(root, makeWith(old, T1, LONG, 'H'));
    const { path: f2 } = await saveReview(root, makeWith(old, T2, LONG, 'H'));
    const home = path.join(root, 'chapter-7');
    const t1 = path.join(home, path.basename(f1));
    const t2 = path.join(home, path.basename(f2));
    // The first copy was written and the crash came before its original was removed.
    await fs.mkdir(home);
    await fs.writeFile(t1, JSON.stringify({ ...(await loadReviewFile(f1)), sourcePath: now }));
    await fs.writeFile(
      path.join(root, '.adoption.json'),
      JSON.stringify({
        version: 1,
        to: now,
        moves: [
          { from: f1, to: t1 },
          { from: f2, to: t2 }
        ]
      })
    );

    const history = await listReviews(root, now);
    expect(history.map((s) => s.path)).toEqual([t2, t1]);
    expect(await missing(f1)).toBe(true);
    expect(await missing(f2)).toBe(true);
    expect(await fs.readdir(root)).toEqual(['chapter-7']);
  });

  it('drops a journal it cannot read', async () => {
    await saveReview(root, make('C:/vault/Chapter 12.md', T1));
    await fs.writeFile(path.join(root, '.adoption.json'), '{ half');
    expect(await listReviews(root, 'C:/vault/Chapter 12.md')).toHaveLength(1);
    expect(await missing(path.join(root, '.adoption.json'))).toBe(true);
  });
});

describe('saveReview writes only where the review belongs', () => {
  const source = 'C:/vault/Chapter 12.md';

  it('starts a new entry instead of writing to another folder', async () => {
    const foreign = path.join(root, 'elsewhere', 'x.review.json');
    const { path: saved } = await saveReview(root, make(source, T1), foreign);
    expect(path.dirname(saved)).toBe(path.join(root, 'chapter-12'));
    expect(await missing(foreign)).toBe(true);
  });

  it('is not walked out of its folder by ..', async () => {
    const sneaky = `${path.join(root, 'chapter-12')}${path.sep}..${path.sep}x.review.json`;
    const { path: saved } = await saveReview(root, make(source, T1), sneaky);
    expect(path.dirname(saved)).toBe(path.join(root, 'chapter-12'));
    expect(await missing(path.join(root, 'x.review.json'))).toBe(true);
  });

  it('never overwrites another chapter s review in the shared folder', async () => {
    const a = 'C:/vault/A/Chapter 12.md';
    const { path: fileA } = await saveReview(root, make(a, T1, [pendingHunk]));
    const { path: saved } = await saveReview(root, make('C:/vault/B/Chapter 12.md', T2), fileA);
    expect(saved).not.toBe(fileA);
    expect((await loadReviewFile(fileA)).sourcePath).toBe(a);
  });

  it('writes only review files', async () => {
    const notes = path.join(root, 'chapter-12', 'notes.json');
    const { path: saved } = await saveReview(root, make(source, T1), notes);
    expect(saved.endsWith('.review.json')).toBe(true);
    expect(await missing(notes)).toBe(true);
  });

  it('refuses a review whose time holds a NUL at once, rather than look for a free name for ever', async () => {
    // Every look at such a name fails before it reaches the disk, so the search
    // this guards against never let a timer run, and no timeout could end it
    // (hardening.8 review). The spy ends it after 20 looks instead, by saying
    // the name is free, and the count fails the test.
    const NUL = '\u0000';
    const real = fs.access.bind(fs);
    let looks = 0;
    const access = vi.spyOn(fs, 'access').mockImplementation(((target: string, mode?: number) => {
      if (typeof target === 'string' && target.includes(NUL)) {
        looks += 1;
        if (looks > 20)
          return Promise.reject(Object.assign(new Error('ENOENT: not there'), { code: 'ENOENT' }));
      }
      return real(target, mode);
    }) as typeof fs.access);
    try {
      await expect(saveReview(root, make(source, `2026-10-20T10${NUL}00.000Z`))).rejects.toMatchObject({
        code: 'ERR_INVALID_ARG_VALUE'
      });
    } finally {
      access.mockRestore();
    }
    expect(looks).toBe(1);
    expect(await fs.readdir(path.join(root, 'chapter-12'))).toEqual([]);
  });
});

describe('a review written by 0.1.0', () => {
  const FIXTURE = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'review-0.1.0.json'
  );

  async function installFixture(): Promise<{ raw: Review; file: string }> {
    const raw = JSON.parse(await fs.readFile(FIXTURE, 'utf8')) as Review;
    const dir = path.join(root, 'chapter-03');
    await fs.mkdir(dir);
    const file = path.join(dir, '2026-09-20T18-04-11-201Z.review.json');
    await fs.copyFile(FIXTURE, file);
    return { raw, file };
  }

  it('loads unchanged and is the chapter s current review', async () => {
    const { raw, file } = await installFixture();
    expect(await loadReviewFile(file)).toEqual(raw);
    expect((await loadLatestReview(root, raw.sourcePath))?.path).toBe(file);
  });

  it('saves back with only decidedAt and the decided fields changed', async () => {
    const { raw, file } = await installFixture();
    const loaded = await loadReviewFile(file);
    const decide = (r: Review): Review => ({
      ...r,
      updatedAt: '2026-10-15T08:00:00.000Z',
      decidedAt: '2026-10-15T08:00:00.000Z',
      hunks: r.hunks.map((h) => (h.id === 'h2' ? { ...h, status: 'accepted' as const } : h))
    });
    const { path: saved } = await saveReview(root, decide(loaded), file);
    expect(saved).toBe(file);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(decide(raw));
  });

  it('rebases onto an edited chapter keeping every field it had', async () => {
    const { raw, file } = await installFixture();
    const text = raw.base.text.replace('before the bells', 'before the first bells');
    const { review: rebased } = rebaseReview(await loadReviewFile(file), { ...raw.base, text, hash: 'next' });
    for (const hunk of rebased.hunks) {
      const before = raw.hunks.find((h) => h.id === hunk.id)!;
      expect(Object.keys(hunk)).toEqual(expect.arrayContaining(Object.keys(before)));
      if (hunk.id !== 'h6') expect(text.slice(hunk.start, hunk.end)).toBe(hunk.original);
    }
    expect(rebased.hunks.filter((h) => h.anchor === 'stale').map((h) => h.id)).toEqual(['h6']);
    expect(rebased.generator).toEqual(raw.generator);
    expect(rebased.raw).toEqual(raw.raw);
    expect(rebased.comments).toEqual(raw.comments);
    await saveReview(root, rebased, file);
    expect(await loadReviewFile(file)).toEqual(rebased);
  });
});

/* apply.25: a review file that is there but cannot be read, because another
   program holds it open or the system will not let the app read it, is not
   a file that is not a review. The chapter does not open on another review,
   or on none, which the next decision would make current over it. */
describe('a review file that cannot be read (apply.25)', () => {
  const source = 'C:/vault/Chapter 12.md';
  const folder = (): string => path.join(root, 'chapter-12');

  function busy(file: string, code = 'EBUSY'): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: resource busy or locked, open '${file}'`), {
      code,
      syscall: 'open',
      path: file
    });
  }

  /** Every read of `file` refused with `code`, as while another program holds it with no sharing. */
  function hold(file: string, code = 'EBUSY') {
    const real = fs.readFile.bind(fs) as (...args: unknown[]) => Promise<unknown>;
    return vi
      .spyOn(fs, 'readFile')
      .mockImplementation(((target: unknown, ...rest: unknown[]) =>
        typeof target === 'string' && path.resolve(target) === path.resolve(file)
          ? Promise.reject(busy(file, code))
          : real(target, ...rest)) as unknown as typeof fs.readFile);
  }

  async function failure(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => {
        throw new Error('expected a failure');
      },
      (e: unknown) => e
    );
  }

  /** The folder as it stands: every name, and each file's bytes. */
  async function snapshot(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of (await fs.readdir(folder())).sort()) {
      out[name] = await fs.readFile(path.join(folder(), name), 'utf8');
    }
    return out;
  }

  /** Two reviews of the chapter, the newer recorded as the one it opens with. */
  async function twoReviews(): Promise<{ older: string; newer: string }> {
    const { path: older } = await saveReview(root, make(source, T1, [pendingHunk]));
    const { path: newer } = await saveReview(root, make(source, T2, [pendingHunk]));
    return { older, newer };
  }

  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    it(`explains ${code} on the review a chapter opens with, read for the first time, and picks no other`, async () => {
      const { newer } = await twoReviews();
      const before = await snapshot();
      const held = hold(newer, code);
      try {
        const err = await failure(loadLatestReview(root, source));
        expect(err).toBeInstanceOf(AppFailure);
        const shown = toAppError(err);
        expect(shown).toMatchObject({
          code: 'io',
          message: explainReadError(
            busy(newer, code),
            `the review file ${path.basename(newer)}`,
            process.platform
          )
        });
        expect(shown.message).not.toMatch(/replace|save again|Nothing was written|Controlled folder access/);
      } finally {
        held.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
      // Released: the chapter opens with it again.
      expect((await loadLatestReview(root, source))?.path).toBe(newer);
    });
  }

  it('explains it when the review was read before and is held since, as when its entry is cached', async () => {
    const { newer } = await twoReviews();
    expect((await loadLatestReview(root, source))?.path).toBe(newer);
    const held = hold(newer);
    try {
      const shown = toAppError(await failure(loadLatestReview(root, source)));
      expect(shown.message).toBe(
        explainReadError(busy(newer), `the review file ${path.basename(newer)}`, process.platform)
      );
    } finally {
      held.mockRestore();
    }
    expect((await loadLatestReview(root, source))?.path).toBe(newer);
  });

  it('explains it when nothing is recorded, rather than open the review last decided in', async () => {
    const { older, newer } = await twoReviews();
    await fs.rm(path.join(folder(), '.last-open.json'));
    const held = hold(newer);
    try {
      const shown = toAppError(await failure(loadLatestReview(root, source)));
      expect(shown.message).toContain(`the review file ${path.basename(newer)}`);
    } finally {
      held.mockRestore();
    }
    // Once read, a file unchanged since is known by its entry, held or not.
    const heldOlder = hold(older);
    try {
      expect((await loadLatestReview(root, source))?.path).toBe(newer);
    } finally {
      heldOlder.mockRestore();
    }
  });

  it('explains an older review held before it was ever read, when nothing is recorded', async () => {
    // Whose it is, and when it was decided in, cannot be told.
    const { path: older } = await saveReview(root, make(source, T1, [pendingHunk]));
    await saveReview(root, make(source, T2, [pendingHunk]));
    await fs.rm(path.join(folder(), '.last-open.json'));
    const held = hold(older);
    try {
      const shown = toAppError(await failure(loadLatestReview(root, source)));
      expect(shown.message).toContain(`the review file ${path.basename(older)}`);
    } finally {
      held.mockRestore();
    }
  });

  it('opens the review recorded as last on screen when only another file cannot be read', async () => {
    const { older, newer } = await twoReviews();
    const held = hold(older);
    try {
      expect((await loadLatestReview(root, source))?.path).toBe(newer);
    } finally {
      held.mockRestore();
    }
  });

  it('explains a chapter folder it cannot list', async () => {
    await twoReviews();
    const refused = Object.assign(new Error(`EBUSY: refused, scandir '${folder()}'`), {
      code: 'EBUSY',
      syscall: 'scandir',
      path: folder()
    });
    const readdir = vi.spyOn(fs, 'readdir').mockRejectedValueOnce(refused);
    try {
      const shown = toAppError(await failure(loadLatestReview(root, source)));
      expect(shown.message).toBe(
        explainReadError(refused, 'the review folder of Chapter 12.md', process.platform)
      );
    } finally {
      readdir.mockRestore();
    }
  });

  it('still skips a file that is not a review, and opens with the one that is', async () => {
    const { newer } = await twoReviews();
    await fs.writeFile(path.join(folder(), 'junk.review.json'), '{ not json');
    await fs.writeFile(path.join(folder(), 'other.review.json'), '{"version":2}');
    await fs.mkdir(path.join(folder(), 'a folder.review.json'));
    await fs.rm(path.join(folder(), '.last-open.json'));
    expect((await loadLatestReview(root, source))?.path).toBe(newer);
  });

  it('is left out of History and the list marks, which still show the rest', async () => {
    const { older, newer } = await twoReviews();
    const held = hold(newer);
    try {
      expect((await listReviews(root, source)).map((s) => s.path)).toEqual([older]);
      expect((await reviewIndex(root, [source]))[source]?.path).toBe(older);
    } finally {
      held.mockRestore();
    }
  });

  it('is never written over unread, nor copied into a new entry that would open in its place', async () => {
    const { newer } = await twoReviews();
    const before = await snapshot();
    const decided = { ...(await loadReviewFile(newer)), decidedAt: '2026-09-09T00:00:00.000Z' };
    const held = hold(newer);
    try {
      const shown = toAppError(await failure(saveReview(root, decided, newer)));
      expect(shown.message).toBe(
        explainReadError(busy(newer), `the review file ${path.basename(newer)}`, process.platform)
      );
    } finally {
      held.mockRestore();
    }
    expect(await snapshot()).toEqual(before);
    // Readable again: written in place, and still the review the chapter opens with.
    expect((await saveReview(root, decided, newer)).path).toBe(newer);
    expect((await loadLatestReview(root, source))?.review.decidedAt).toBe('2026-09-09T00:00:00.000Z');
    expect(await fs.readdir(folder())).toHaveLength(Object.keys(before).length);
  });

  it('is not passed over for the next name when the review is saved again without its path (hardening.8 review)', async () => {
    const review = make(source, T1, [pendingHunk]);
    const { path: saved } = await saveReview(root, review);
    const before = await snapshot();
    const decided = { ...review, decidedAt: '2026-09-09T00:00:00.000Z' };
    const held = hold(saved);
    try {
      const shown = toAppError(await failure(saveReview(root, decided)));
      expect(shown.message).toBe(
        explainReadError(busy(saved), `the review file ${path.basename(saved)}`, process.platform)
      );
    } finally {
      held.mockRestore();
    }
    // No `-2` copy that would open in its place.
    expect(await snapshot()).toEqual(before);
    // Readable again: the review lands on its own entry.
    expect((await saveReview(root, decided)).path).toBe(saved);
    expect(await fs.readdir(folder())).toHaveLength(Object.keys(before).length);
  });
});

/* apply.25: the store's folders are made, never retried and never replacing
   anything, so a refusal says which folder and to try again. */
describe('a review folder that cannot be made (apply.25)', () => {
  const NOT_A_RENAME = /replace|save again|second and a half|even after|the file is as it was/;

  it('says which chapter folder could not be made when a review is saved', async () => {
    const dir = path.join(root, 'chapter-12');
    const refused = Object.assign(new Error(`EPERM: refused, mkdir '${dir}'`), {
      code: 'EPERM',
      syscall: 'mkdir',
      path: dir
    });
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(refused);
    try {
      const err = await saveReview(root, make('C:/vault/Chapter 12.md', T1)).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AppFailure);
      const message = toAppError(err).message;
      expect(message).toBe(
        explainWriteError(refused, 'the review folder of Chapter 12.md', process.platform, 'folder')
      );
      expect(message).toMatch(
        / create the review folder of Chapter 12\.md\. .*try again\. .*Nothing was written\.$/
      );
      expect(message).not.toMatch(NOT_A_RENAME);
    } finally {
      mkdir.mockRestore();
    }
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it('says the reviews folder could not be made, naming where it goes', async () => {
    const folder = path.join(root, 'reviews');
    const refused = Object.assign(new Error(`EACCES: refused, mkdir '${folder}'`), {
      code: 'EACCES',
      syscall: 'mkdir',
      path: folder
    });
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(refused);
    try {
      const err = await makeReviewsFolder(folder).then(
        () => null,
        (e: unknown) => e
      );
      expect(toAppError(err).message).toBe(
        explainWriteError(refused, `the reviews folder ${folder}`, process.platform, 'folder')
      );
    } finally {
      mkdir.mockRestore();
    }
    await makeReviewsFolder(folder);
    expect((await fs.stat(folder)).isDirectory()).toBe(true);
  });

  /* apply.25 review: a reviews folder chosen in Settings on a drive that is
     not connected (a USB, network or cloud drive) stops every chapter
     opening, and Windows reports it as Node 24 does on this machine:
     mkdir('Q:\\Reviews', {recursive: true}) fails with ENOENT and the path
     '\\?'. The card must say what that means, not show the system's text. */
  it('says the reviews folder is on a drive that is not there, and that another can be chosen in Settings', async () => {
    const folder = path.join(root, 'reviews');
    const missingDrive = Object.assign(new Error("ENOENT: no such file or directory, mkdir '\\\\?'"), {
      code: 'ENOENT',
      errno: -4058,
      syscall: 'mkdir',
      path: '\\\\?'
    });
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(missingDrive);
    try {
      const err = await makeReviewsFolder(folder).then(
        () => null,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(AppFailure);
      // What the bridge sends, and what the open's card shows after the chapter's name.
      const shown = toAppError(err);
      expect(shown.code).toBe('io');
      expect(shown.message).toBe(
        `${APP_NAME} could not create the reviews folder ${folder}, because the drive or the folder it goes in is not there. If it is on a network, USB or cloud drive, check that the drive is connected, or choose another reviews folder in Settings, then try again. Nothing was written.`
      );
      expect(shown.message).not.toContain('\\\\?');
      expect(shown.message).not.toContain('ENOENT');
    } finally {
      mkdir.mockRestore();
    }
  });

  it('says a file is in the way of the reviews folder, and that another can be chosen in Settings', async () => {
    const file = path.join(root, 'notes.txt');
    await fs.writeFile(file, 'not a folder');
    const folder = path.join(file, 'Reviews');
    // Not mocked: the system's own answer for a folder under a file.
    const err = await makeReviewsFolder(folder).then(
      () => null,
      (e: unknown) => e
    );
    expect(toAppError(err).message).toBe(
      `${APP_NAME} could not create the reviews folder ${folder}, because a file has the name of one of the folders it goes in. Move or rename that file, or choose another reviews folder in Settings, then try again. Nothing was written.`
    );
    expect(await fs.readFile(file, 'utf8')).toBe('not a folder');
  });

  it("does not offer Settings for a chapter's own review folder, which the author does not choose", async () => {
    const dir = path.join(root, 'chapter-12');
    const missingDrive = Object.assign(new Error("ENOENT: no such file or directory, mkdir '\\\\?'"), {
      code: 'ENOENT',
      syscall: 'mkdir',
      path: '\\\\?'
    });
    const mkdir = vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(missingDrive);
    try {
      const err = await saveReview(root, make('C:/vault/Chapter 12.md', T1)).then(
        () => null,
        (e: unknown) => e
      );
      expect(toAppError(err).message).toBe(
        `${APP_NAME} could not create the review folder of Chapter 12.md, because the drive or the folder it goes in is not there. If it is on a network, USB or cloud drive, check that the drive is connected, then try again. Nothing was written.`
      );
    } finally {
      mkdir.mockRestore();
    }
    await expect(fs.access(dir)).rejects.toThrow();
  });
});
