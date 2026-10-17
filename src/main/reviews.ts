import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unsavedDecisionCount } from '../shared/diff/compose';
import type { LoadedReview, ReviewSummary } from '../shared/ipc';
import { commonTrailingSegments, pathKey, samePath } from '../shared/paths';
import { chapterSlug, rehomeReview, upgradeLoadedReview } from '../shared/review';
import type { Review } from '../shared/types';
import { atomicWriteFile } from './atomic';
import { fail } from './errors';
import { caseInsensitiveFs } from './files';

/*
 * The review store (PLAN 6.4 and 11.3 g).
 *
 * Invariant: a review file lives in `folderFor(reviewsFolder, review.sourcePath)`.
 * That folder is named after the chapter's file name only, so two chapters with
 * the same name in different folders share it; which chapter a file belongs to
 * is decided by its `sourcePath`, compared as the file system compares paths,
 * never by the folder it sits in (files.1, C.45).
 */

const SUFFIX = '.review.json';

/** Written before reviews follow a renamed chapter, removed once they all have. */
const JOURNAL = '.adoption.json';

/**
 * Rule (b) of adoption trusts an equal hash only for a chapter with at least
 * this much text, so that two empty or near-empty chapters never trade reviews.
 */
export const ADOPT_MIN_LENGTH = 500;

/** The folder used when Settings names none: `<userData>/reviews`. */
export const DEFAULT_REVIEWS_DIRNAME = 'reviews';

export interface StoreOptions {
  /** whether the file system ignores case; Windows and macOS by default */
  ci?: boolean;
  /** whether a chapter file is still there; tests pass their own */
  exists?: (file: string) => Promise<boolean>;
}

/**
 * Where reviews are written. A review must never be lost because the author has
 * not chosen a folder yet (plan 6.4), so an unset setting falls back to a folder
 * inside the app's own data directory. The caller passes userData rather than
 * importing electron, which keeps this module testable.
 */
export function resolveReviewsFolder(configured: string | null | undefined, userDataDir: string): string {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed.length > 0 ? trimmed : path.join(userDataDir, DEFAULT_REVIEWS_DIRNAME);
}

/** True when the folder in use is the fallback rather than the author's choice. */
export function isDefaultReviewsFolder(configured: string | null | undefined): boolean {
  return typeof configured !== 'string' || configured.trim().length === 0;
}

function folderFor(reviewsFolder: string, sourcePath: string): string {
  return path.join(reviewsFolder, chapterSlug(sourcePath));
}

function stampFor(review: Review): string {
  return review.createdAt.replace(/[:.]/g, '-');
}

function caseInsensitive(options: StoreOptions): boolean {
  return options.ci ?? caseInsensitiveFs();
}

/** Only a clear "not there" counts as gone; a file that cannot be checked is kept. */
async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}

function serialize(review: Review): Buffer {
  return Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8');
}

function summarize(file: string, review: Review): ReviewSummary {
  const pending = review.hunks.filter((h) => h.anchor !== 'stale' && h.status === 'pending').length;
  return {
    path: file,
    id: review.id,
    sourcePath: review.sourcePath,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    ...(review.decidedAt ? { decidedAt: review.decidedAt } : {}),
    generatorKind: review.generator.kind,
    ...(review.generator.provider ? { provider: review.generator.provider } : {}),
    ...(review.generator.model ? { model: review.generator.model } : {}),
    hunkCount: review.hunks.length,
    pendingCount: pending,
    unsavedCount: unsavedDecisionCount(review.hunks)
  };
}

function isReview(value: unknown): value is Review {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<Review>;
  return r.version === 1 && typeof r.base === 'object' && Array.isArray(r.hunks) && Array.isArray(r.comments);
}

export async function loadReviewFile(file: string): Promise<Review> {
  const text = await fs.readFile(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (!isReview(parsed)) throw fail('invalid-input', `Not a review file: ${file}`);
  // Reviews written before the Phase 5b rename still say `kind: 'paste'`, and
  // none written before Phase 5c names its provider.
  return upgradeLoadedReview(parsed);
}

/* ------------------------------------------------------------------ */
/* Reading entries, cached by modification time and size                */
/* ------------------------------------------------------------------ */

/** What the store needs to know about one review file without reading it again. */
interface Entry {
  file: string;
  summary: ReviewSummary;
  hash: string;
  length: number;
}

const cache = new Map<string, { mtimeMs: number; size: number; entry: Entry }>();

/** The file's entry, or null when it is missing, unreadable or not a review. */
async function readEntry(file: string): Promise<Entry | null> {
  const key = path.resolve(file);
  try {
    const stat = await fs.stat(file);
    const hit = cache.get(key);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entry;
    const review = await loadReviewFile(file);
    const entry: Entry = {
      file,
      summary: summarize(file, review),
      hash: review.base.hash,
      length: review.base.text.length
    };
    cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
    return entry;
  } catch {
    // A corrupt or foreign json in the folder is skipped, never thrown at the author.
    cache.delete(key);
    return null;
  }
}

async function entriesIn(dir: string): Promise<Entry[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.filter((name) => name.endsWith(SUFFIX)).map((name) => readEntry(path.join(dir, name)))
  );
  return entries.filter((entry): entry is Entry => entry !== null);
}

/** Every review in every chapter folder, with the folder it was found in. */
async function allEntries(reviewsFolder: string): Promise<{ dir: string; entry: Entry }[]> {
  let dirs;
  try {
    dirs = await fs.readdir(reviewsFolder, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = path.join(reviewsFolder, d.name);
        return (await entriesIn(dir)).map((entry) => ({ dir, entry }));
      })
  );
  return found.flat();
}

function belongs(entry: Entry, sourcePath: string, ci: boolean): boolean {
  return entry.summary.sourcePath !== '' && samePath(entry.summary.sourcePath, sourcePath, ci);
}

function lastDecided(entry: Entry): string {
  return entry.summary.decidedAt ?? entry.summary.createdAt;
}

/**
 * The chapter's current review: the one the author last decided something in,
 * so going back to an older review in History keeps it current. A review nobody
 * has touched counts from its creation.
 */
function currentOf(entries: readonly Entry[]): Entry | null {
  let best: Entry | null = null;
  for (const entry of entries) {
    if (!best) {
      best = entry;
      continue;
    }
    const order =
      lastDecided(entry).localeCompare(lastDecided(best)) ||
      entry.summary.createdAt.localeCompare(best.summary.createdAt);
    if (order > 0) best = entry;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* One store operation at a time                                        */
/* ------------------------------------------------------------------ */

let queue: Promise<unknown> = Promise.resolve();

/** Adoption moves files; nothing may list or move them while it runs. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/* ------------------------------------------------------------------ */
/* Reading                                                               */
/* ------------------------------------------------------------------ */

/** The chapter's history, newest first. Only reviews of this exact file. */
export async function listReviews(
  reviewsFolder: string,
  sourcePath: string,
  options: StoreOptions = {}
): Promise<ReviewSummary[]> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    await finishAdoption(reviewsFolder, ci);
    const own = (await entriesIn(folderFor(reviewsFolder, sourcePath))).filter((e) =>
      belongs(e, sourcePath, ci)
    );
    return own.map((e) => e.summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

/**
 * The review to show when a chapter opens: its current review, or, when none
 * belongs to it, the reviews of the file it used to be (see `findAdoptable`),
 * moved over to it first. `adoptedFrom` names that old path.
 */
export async function loadLatestReview(
  reviewsFolder: string,
  sourcePath: string,
  options: StoreOptions & { hash?: string } = {}
): Promise<LoadedReview | null> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    await finishAdoption(reviewsFolder, ci);
    const own = (await entriesIn(folderFor(reviewsFolder, sourcePath))).filter((e) =>
      belongs(e, sourcePath, ci)
    );
    const chosen = currentOf(own);
    if (chosen) return { path: chosen.file, review: await loadReviewFile(chosen.file) };

    const from = await findAdoptable(reviewsFolder, sourcePath, options);
    if (from === null) return null;
    const moved = currentOf(await adopt(reviewsFolder, from, sourcePath, ci));
    if (!moved) return null;
    return { path: moved.file, review: await loadReviewFile(moved.file), adoptedFrom: from };
  });
}

/**
 * The current review of each chapter, keyed by the chapter paths exactly as
 * passed, for the badges in the file list. One read per chapter folder, and
 * files unchanged since the last call are not parsed again.
 */
export async function reviewIndex(
  reviewsFolder: string,
  chapterPaths: readonly string[],
  options: StoreOptions = {}
): Promise<Record<string, ReviewSummary>> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    await finishAdoption(reviewsFolder, ci);
    const byFolder = new Map<string, string[]>();
    for (const chapter of chapterPaths) {
      const dir = folderFor(reviewsFolder, chapter);
      byFolder.set(dir, [...(byFolder.get(dir) ?? []), chapter]);
    }
    const index: Record<string, ReviewSummary> = {};
    for (const [dir, chapters] of byFolder) {
      const entries = await entriesIn(dir);
      for (const chapter of chapters) {
        const chosen = currentOf(entries.filter((e) => belongs(e, chapter, ci)));
        if (chosen) index[chapter] = chosen.summary;
      }
    }
    return index;
  });
}

/* ------------------------------------------------------------------ */
/* Writing                                                               */
/* ------------------------------------------------------------------ */

/**
 * Write a review. Passing `file` overwrites that history entry, which is how
 * decisions are saved back into the review they came from; omitting it starts a
 * new entry named after the review's creation time.
 *
 * `file` is honoured only when it is a review file directly in the folder this
 * review belongs in and holds no other chapter's review. Anything else (a path
 * from before a reviews-folder change, a `..` path, another chapter's entry)
 * gets a new entry in the right folder instead, so a save never fails, and
 * never lands somewhere else, for a reason that has to do with the path.
 */
export async function saveReview(
  reviewsFolder: string,
  review: Review,
  file?: string,
  options: StoreOptions = {}
): Promise<{ path: string }> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    const dir = folderFor(reviewsFolder, review.sourcePath);
    await fs.mkdir(dir, { recursive: true });
    const target =
      file !== undefined && (await mayOverwrite(file, dir, review.sourcePath, ci))
        ? file
        : await newEntryPath(dir, review, ci);
    await atomicWriteFile(target, serialize(review));
    cache.delete(path.resolve(target));
    return { path: target };
  });
}

async function mayOverwrite(file: string, dir: string, sourcePath: string, ci: boolean): Promise<boolean> {
  if (!file.endsWith(SUFFIX)) return false;
  if (!samePath(path.dirname(path.resolve(file)), path.resolve(dir), ci)) return false;
  if (!(await fileExists(file))) return true;
  const entry = await readEntry(file);
  return entry !== null && belongs(entry, sourcePath, ci);
}

/**
 * `<stamp>.review.json`, or `<stamp>-2.review.json` and so on when that name is
 * taken by another chapter's review. The same review saved again without a
 * path still lands on its own entry.
 */
async function newEntryPath(dir: string, review: Review, ci: boolean): Promise<string> {
  const stamp = stampFor(review);
  for (let n = 1; ; n += 1) {
    const candidate = path.join(dir, `${stamp}${n === 1 ? '' : `-${n}`}${SUFFIX}`);
    if (!(await fileExists(candidate))) return candidate;
    const entry = await readEntry(candidate);
    if (entry && entry.summary.id === review.id && belongs(entry, review.sourcePath, ci)) return candidate;
  }
}

/* ------------------------------------------------------------------ */
/* Following a renamed or moved chapter                                 */
/* ------------------------------------------------------------------ */

interface Candidate {
  source: string;
  hashMatch: boolean;
  segments: number;
}

/**
 * The old path whose reviews this chapter should take over, or null. Used only
 * when no review belongs to the chapter, and only for an old path whose file is
 * gone. Either of two things marks it as the same chapter:
 *
 * (a) the vault moved: the paths share at least their last two segments (the
 *     file name and its folder) and the reviews sit in this chapter's folder;
 * (b) the chapter was renamed or moved in Obsidian: one of its reviews was made
 *     of exactly the text the chapter has now (equal hash), and that text is at
 *     least `ADOPT_MIN_LENGTH` characters.
 *
 * A hash match outranks a path match, and more shared segments outrank fewer.
 * When the best two old paths are equal on both, it cannot be told which one
 * this chapter was, and nothing is adopted.
 */
export async function findAdoptable(
  reviewsFolder: string,
  sourcePath: string,
  options: StoreOptions & { hash?: string } = {}
): Promise<string | null> {
  const ci = caseInsensitive(options);
  const exists = options.exists ?? fileExists;
  const home = folderFor(reviewsFolder, sourcePath);

  const groups = new Map<string, { source: string; entries: Entry[]; inHome: boolean }>();
  for (const { dir, entry } of await allEntries(reviewsFolder)) {
    const source = entry.summary.sourcePath;
    if (source === '' || samePath(source, sourcePath, ci)) continue;
    const key = pathKey(source, ci);
    const group = groups.get(key) ?? { source, entries: [], inHome: false };
    group.entries.push(entry);
    group.inHome ||= samePath(dir, home, ci);
    groups.set(key, group);
  }

  const candidates: Candidate[] = [];
  for (const group of groups.values()) {
    const segments = commonTrailingSegments(group.source, sourcePath, ci);
    const byPath = group.inHome && segments >= 2;
    const byHash =
      options.hash !== undefined &&
      group.entries.some((e) => e.hash === options.hash && e.length >= ADOPT_MIN_LENGTH);
    if (!byPath && !byHash) continue;
    if (await exists(group.source)) continue;
    candidates.push({ source: group.source, hashMatch: byHash, segments });
  }

  candidates.sort((a, b) => Number(b.hashMatch) - Number(a.hashMatch) || b.segments - a.segments);
  const [first, second] = candidates;
  if (!first) return null;
  if (second && second.hashMatch === first.hashMatch && second.segments === first.segments) return null;
  return first.source;
}

interface Journal {
  version: 1;
  /** the chapter path the reviews are taken over by */
  to: string;
  moves: { from: string; to: string }[];
}

function isJournal(value: unknown): value is Journal {
  if (typeof value !== 'object' || value === null) return false;
  const j = value as Partial<Journal>;
  return (
    j.version === 1 &&
    typeof j.to === 'string' &&
    Array.isArray(j.moves) &&
    j.moves.every((m) => typeof m?.from === 'string' && typeof m.to === 'string')
  );
}

/**
 * Move every review of `fromSource` to `toSource`: each history file is
 * rewritten into the new chapter's folder with the new `sourcePath`, and the old
 * file is removed only after its copy is on disk. The plan is written to a
 * journal first, so a crash part way through is completed by the next store
 * call rather than leaving a chapter's history split in two.
 */
export async function adoptReviews(
  reviewsFolder: string,
  fromSource: string,
  toSource: string,
  options: StoreOptions = {}
): Promise<ReviewSummary[]> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    await finishAdoption(reviewsFolder, ci);
    return (await adopt(reviewsFolder, fromSource, toSource, ci)).map((e) => e.summary);
  });
}

async function adopt(
  reviewsFolder: string,
  fromSource: string,
  toSource: string,
  ci: boolean
): Promise<Entry[]> {
  const home = folderFor(reviewsFolder, toSource);
  await fs.mkdir(home, { recursive: true });
  const taken = new Set((await fs.readdir(home)).map((name) => pathKey(name, ci)));

  const moves: Journal['moves'] = [];
  for (const { dir, entry } of await allEntries(reviewsFolder)) {
    if (!belongs(entry, fromSource, ci)) continue;
    if (samePath(dir, home, ci)) {
      moves.push({ from: entry.file, to: entry.file });
      continue;
    }
    const stem = path.basename(entry.file).slice(0, -SUFFIX.length);
    let name = `${stem}${SUFFIX}`;
    for (let n = 2; taken.has(pathKey(name, ci)); n += 1) name = `${stem}-${n}${SUFFIX}`;
    taken.add(pathKey(name, ci));
    moves.push({ from: entry.file, to: path.join(home, name) });
  }
  if (moves.length === 0) return [];

  const journal: Journal = { version: 1, to: toSource, moves };
  await atomicWriteFile(
    path.join(reviewsFolder, JOURNAL),
    Buffer.from(`${JSON.stringify(journal, null, 2)}\n`)
  );
  await runJournal(reviewsFolder, journal, ci);
  const moved = await Promise.all(moves.map((m) => readEntry(m.to)));
  return moved.filter((entry): entry is Entry => entry !== null);
}

/** Complete an adoption a crash interrupted. Cheap when there is none. */
async function finishAdoption(reviewsFolder: string, ci: boolean): Promise<void> {
  const file = path.join(reviewsFolder, JOURNAL);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    // Written atomically, so an unreadable journal is not one this app wrote.
    await fs.rm(file, { force: true });
    return;
  }
  if (!isJournal(parsed)) {
    await fs.rm(file, { force: true });
    return;
  }
  await runJournal(reviewsFolder, parsed, ci);
}

/** Idempotent: a move whose old file is gone was finished before. */
async function runJournal(reviewsFolder: string, journal: Journal, ci: boolean): Promise<void> {
  const emptied = new Set<string>();
  for (const move of journal.moves) {
    if (!(await fileExists(move.from))) continue;
    let review: Review;
    try {
      review = await loadReviewFile(move.from);
    } catch {
      continue;
    }
    await fs.mkdir(path.dirname(move.to), { recursive: true });
    await atomicWriteFile(move.to, serialize(rehomeReview(review, journal.to)));
    cache.delete(path.resolve(move.to));
    if (samePath(move.from, move.to, ci)) continue;
    await fs.rm(move.from, { force: true });
    cache.delete(path.resolve(move.from));
    emptied.add(path.dirname(move.from));
  }
  for (const dir of emptied) {
    // Only an empty folder is removed; one still holding another chapter's reviews stays.
    await fs.rmdir(dir).catch(() => undefined);
  }
  await fs.rm(path.join(reviewsFolder, JOURNAL), { force: true });
}
