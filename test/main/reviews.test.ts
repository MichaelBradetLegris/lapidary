import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADOPT_MIN_LENGTH,
  findAdoptable,
  isDefaultReviewsFolder,
  listReviews,
  loadLatestReview,
  loadReviewFile,
  resolveReviewsFolder,
  reviewIndex,
  saveReview
} from '../../src/main/reviews';
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

describe('the current review', () => {
  it('is the one last decided in, while History stays in creation order', async () => {
    const source = 'C:/vault/Chapter 12.md';
    await saveReview(root, { ...make(source, T1, [pendingHunk]), decidedAt: '2026-09-09T00:00:00.000Z' });
    await saveReview(root, make(source, T2));
    expect((await loadLatestReview(root, source))?.review.createdAt).toBe(T1);
    expect((await listReviews(root, source)).map((s) => s.createdAt)).toEqual([T2, T1]);
    expect((await reviewIndex(root, [source]))[source]?.createdAt).toBe(T1);
  });

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
