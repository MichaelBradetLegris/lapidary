import { promises as fs } from 'node:fs';
import path from 'node:path';
import { APP_NAME } from '../shared/branding';
import { unsavedDecisionCount } from '../shared/diff/compose';
import type { LoadedReview, ReviewSummary } from '../shared/ipc';
import { loggableErrorFields } from '../shared/diagnostics/redact';
import { commonTrailingSegments, pathKey, samePath } from '../shared/paths';
import { chapterSlug, rehomeReview, upgradeLoadedReview } from '../shared/review';
import type { Review } from '../shared/types';
import { atomicWriteFile } from './atomic';
import { fail, readFailure, writeFailure } from './errors';
import { caseInsensitiveFs } from './files';
import { log } from './log';

/*
 * The review store (PLAN 6.4 and 11.3 g).
 *
 * Invariant: a review file lives in `folderFor(reviewsFolder, review.sourcePath)`.
 * That folder is named after the chapter's file name only, so two chapters with
 * the same name in different folders share it; which chapter a file belongs to
 * is decided by its `sourcePath`, compared as the file system compares paths,
 * never by the folder it sits in (files.1, C.45).
 *
 * The review a chapter opens with is the one last on screen for it (apply.26),
 * recorded in the folder's `.last-open.json` when a review comes on screen and
 * when a new one arrives, without touching the review file or its times.
 */

const SUFFIX = '.review.json';

/** Written before reviews follow a renamed chapter, removed once they all have. */
const JOURNAL = '.adoption.json';

/**
 * Which review of each chapter in the folder was last on screen (apply.26). One
 * file per chapter folder, keyed by the chapter's path, since same-named
 * chapters in different folders share the folder.
 */
const LAST_OPEN = '.last-open.json';

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

/**
 * A new entry's name, before `.review.json`: the review's `createdAt` with
 * its colons and dots made dashes. A review the app makes has
 * `toISOString()`'s time; one whose time holds a `/` or `\`, which only a
 * review file edited by hand could have, would name a subfolder of the
 * chapter's folder, so it is refused with `invalid-input` (hardening.15,
 * PLAN C.85). The words name the field, never the value.
 */
function stampFor(review: Review): string {
  if (/[\\/]/.test(review.createdAt)) {
    throw fail(
      'invalid-input',
      `This review could not be saved: its time (createdAt) holds a / or \\, which a file name cannot hold. A review ${APP_NAME} makes never has one, so the review file may have been edited by hand.`
    );
  }
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
    return !isGone(err);
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

/** How a message names a review file: "the review file 2026-10-17T12-00-00-000Z.review.json". */
function reviewFileName(file: string): string {
  return `the review file ${path.basename(file)}`;
}

/** The chapter's file name, however its path is spelled. */
function chapterFileName(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).pop() || sourcePath;
}

/** How a message names a chapter's review folder: "the review folder of Chapter 12.md". */
function reviewFolderName(sourcePath: string): string {
  return `the review folder of ${chapterFileName(sourcePath)}`;
}

/** Only a clear "not there" means a file or folder is gone. */
function isGone(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Make a folder the store writes in. Nothing is retried or replaced, so a
 * refusal says which folder was being made and to try again (apply.25).
 */
async function makeFolder(dir: string, name: string, setting?: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    throw writeFailure(err, 'folder', name, setting === undefined ? {} : { setting });
  }
}

/**
 * Make the reviews folder if it is not there yet (6.4), as every review
 * operation does first; a refusal says so (apply.25). The author chooses it
 * in Settings, and it may be on a drive that is not connected, so a folder
 * that cannot be made there says to connect the drive or choose another
 * (apply.25 review).
 */
export async function makeReviewsFolder(folder: string): Promise<void> {
  await makeFolder(folder, `the reviews folder ${path.resolve(folder)}`, 'reviews folder');
}

/** The review in a file's text; throws for text that is not one. */
function parseReview(text: string, file: string): Review {
  const parsed: unknown = JSON.parse(text);
  if (!isReview(parsed)) throw fail('invalid-input', `Not a review file: ${file}`);
  // Reviews written before the Phase 5b rename still say `kind: 'paste'`, and
  // none written before Phase 5c names its provider.
  return upgradeLoadedReview(parsed);
}

/**
 * One review file. A read the system refuses is explained as a read, naming
 * the file (`readFailure`, apply.24).
 */
export async function loadReviewFile(file: string): Promise<Review> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw readFailure(err, reviewFileName(file));
  }
  return parseReview(text, file);
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

/**
 * A review file that is there but could not be read: another program holds
 * it open, or the system will not let the app read it (apply.25). Whose
 * review it is cannot be told without reading it.
 */
interface Unread {
  unread: true;
  file: string;
  error: unknown;
}

function isEntry(value: Entry | Unread | null): value is Entry {
  return value !== null && !('unread' in value);
}

function isUnread(value: Entry | Unread | null): value is Unread {
  return value !== null && 'unread' in value;
}

/**
 * The file's entry; null when it is gone, not a file, or not a review (a
 * corrupt or foreign json in the folder is skipped, never thrown at the
 * author); `Unread` when it is there and the system refused to read it
 * (apply.25). An entry is cached by modification time and size, so a file
 * read before is not read again until it changes.
 */
async function readEntry(file: string): Promise<Entry | Unread | null> {
  const key = path.resolve(file);
  let stat;
  let text: string;
  try {
    stat = await fs.stat(file);
    if (!stat.isFile()) {
      cache.delete(key);
      return null;
    }
    const hit = cache.get(key);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.entry;
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    cache.delete(key);
    return isGone(err) ? null : { unread: true, file, error: err };
  }
  let review: Review;
  try {
    review = parseReview(text, file);
  } catch {
    cache.delete(key);
    return null;
  }
  const entry: Entry = {
    file,
    summary: summarize(file, review),
    hash: review.base.hash,
    length: review.base.text.length
  };
  cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, entry });
  return entry;
}

/**
 * The review files in a chapter folder: those read, and those that are there
 * but could not be read. A folder that is not there holds none; one that
 * cannot be listed holds none either, unless `strict`, when its error is
 * thrown.
 */
async function folderEntries(dir: string, strict = false): Promise<{ entries: Entry[]; unread: Unread[] }> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (strict && !isGone(err)) throw err;
    return { entries: [], unread: [] };
  }
  const read = await Promise.all(
    names.filter((name) => name.endsWith(SUFFIX)).map((name) => readEntry(path.join(dir, name)))
  );
  return { entries: read.filter(isEntry), unread: read.filter(isUnread) };
}

/**
 * The reviews in a chapter folder that could be read. History, the list's
 * marks and adoption leave out a file they cannot read, as they leave out
 * one that is not a review; only the review a chapter opens with must be
 * read (`loadLatestReview`, apply.25).
 */
async function entriesIn(dir: string): Promise<Entry[]> {
  return (await folderEntries(dir)).entries;
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
 * The review a chapter opens with (apply.26): the one last on screen for it,
 * `lastOpen` naming its file in the chapter's folder. A new review counts as
 * on screen when it arrives, so this is almost always the newest. When nothing
 * is recorded, or the file recorded is gone or no longer this chapter's, it is
 * the review last decided in, a review nobody has touched counting from its
 * creation: a decision is made only on screen, so that is the one last on
 * screen as far as the files can tell, and it is the review every chapter
 * opened with before anything was recorded.
 */
function currentOf(entries: readonly Entry[], lastOpen: string | null, ci: boolean): Entry | null {
  return shownOf(entries, lastOpen, ci) ?? lastDecidedOf(entries);
}

/** The entry `lastOpen` names, when it is among these. */
function shownOf(entries: readonly Entry[], lastOpen: string | null, ci: boolean): Entry | null {
  if (lastOpen === null) return null;
  const key = pathKey(lastOpen, ci);
  return entries.find((entry) => pathKey(path.basename(entry.file), ci) === key) ?? null;
}

/** The review last decided in, or created when none has been decided in. */
function lastDecidedOf(entries: readonly Entry[]): Entry | null {
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
/* The review last on screen (apply.26)                                  */
/* ------------------------------------------------------------------ */

/** One chapter's record: the name of a review file in the same folder. */
interface LastOpen {
  sourcePath: string;
  file: string;
}

function isLastOpen(value: unknown): value is LastOpen {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<LastOpen>;
  return (
    typeof v.sourcePath === 'string' &&
    v.sourcePath !== '' &&
    typeof v.file === 'string' &&
    v.file.endsWith(SUFFIX) &&
    path.basename(v.file) === v.file
  );
}

/** The folder's records; none when the file is missing or not one this app wrote. */
async function readLastOpen(dir: string): Promise<LastOpen[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(dir, LAST_OPEN), 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const { version, chapters } = parsed as { version?: unknown; chapters?: unknown };
  if (version !== 1 || !Array.isArray(chapters)) return [];
  return chapters.filter(isLastOpen);
}

/** Write the folder's records, or remove the file when there are none, so an emptied folder can go. */
async function writeLastOpen(dir: string, chapters: readonly LastOpen[]): Promise<void> {
  const file = path.join(dir, LAST_OPEN);
  if (chapters.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify({ version: 1, chapters }, null, 2)}\n`, 'utf8'));
}

function lastOpenOf(chapters: readonly LastOpen[], sourcePath: string, ci: boolean): string | null {
  return chapters.find((c) => samePath(c.sourcePath, sourcePath, ci))?.file ?? null;
}

/** Record `name` for the chapter; writes nothing when that is already what is recorded. */
async function setLastOpen(dir: string, sourcePath: string, name: string, ci: boolean): Promise<void> {
  const chapters = await readLastOpen(dir);
  const others = chapters.filter((c) => !samePath(c.sourcePath, sourcePath, ci));
  const same = chapters.filter((c) => samePath(c.sourcePath, sourcePath, ci));
  if (same.length === 1 && same[0]?.sourcePath === sourcePath && same[0].file === name) return;
  await writeLastOpen(dir, [...others, { sourcePath, file: name }]);
}

/**
 * `setLastOpen`, for a caller whose own work is done: a record that cannot be
 * written is logged and otherwise ignored, since the chapter then opens with
 * the review last decided in, and nothing the author decided is lost.
 */
async function markLastOpen(dir: string, sourcePath: string, name: string, ci: boolean): Promise<boolean> {
  try {
    await setLastOpen(dir, sourcePath, name, ci);
    return true;
  } catch (err) {
    log('warn', 'reviews.last-open-failed', loggableErrorFields(err));
    return false;
  }
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
 * The review to show when a chapter opens: the one it opens with
 * (`currentOf`), or, when none belongs to it, the reviews of the file it used
 * to be (see `findAdoptable`), moved over to it first. `adoptedFrom` names
 * that old path. When a review file in the chapter's folder is there but
 * cannot be read, and no review that could be read is recorded as the one
 * last on screen, the read is explained (`readFailure`, apply.25), as it is
 * for the chapter's folder and for the review chosen; nothing is chosen or
 * adopted in its place.
 */
export async function loadLatestReview(
  reviewsFolder: string,
  sourcePath: string,
  options: StoreOptions & { hash?: string } = {}
): Promise<LoadedReview | null> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    await finishAdoption(reviewsFolder, ci);
    const dir = folderFor(reviewsFolder, sourcePath);
    let found: { entries: Entry[]; unread: Unread[] };
    try {
      found = await folderEntries(dir, true);
    } catch (err) {
      throw readFailure(err, reviewFolderName(sourcePath));
    }
    const own = found.entries.filter((e) => belongs(e, sourcePath, ci));
    const lastOpen = lastOpenOf(await readLastOpen(dir), sourcePath, ci);
    // A review file the system will not let the app read may be this
    // chapter's, and the one it opens with: whose it is cannot be told
    // without reading it. Opening another review, or a blank one, would let
    // the next decision write a new review that becomes current over it, so
    // the chapter does not open, and the page says why (apply.25). Only a
    // record naming a review that could be read settles it.
    const shown = shownOf(own, lastOpen, ci);
    const [unread] = found.unread;
    if (!shown && unread) throw readFailure(unread.error, reviewFileName(unread.file));
    const chosen = shown ?? lastDecidedOf(own);
    if (chosen) return { path: chosen.file, review: await loadReviewFile(chosen.file) };

    const from = await findAdoptable(reviewsFolder, sourcePath, options);
    if (from === null) return null;
    const adopted = await adopt(reviewsFolder, from, sourcePath, ci);
    const moved = currentOf(adopted, lastOpenOf(await readLastOpen(dir), sourcePath, ci), ci);
    if (!moved) return null;
    return { path: moved.file, review: await loadReviewFile(moved.file), adoptedFrom: from };
  });
}

/**
 * Record `file` as the review of `sourcePath` last on screen, so the chapter
 * opens with it next time (apply.26). The page says so whenever it shows a
 * review of the open chapter other than by opening the chapter: from History
 * or the review selector. Only a review file directly in the chapter's folder
 * that belongs to the chapter is recorded; anything else is ignored. The
 * review file is not touched, so its times stay what the author's decisions
 * made them. True when the record says `file`.
 */
export async function recordShown(
  reviewsFolder: string,
  sourcePath: string,
  file: string,
  options: StoreOptions = {}
): Promise<boolean> {
  const ci = caseInsensitive(options);
  return serialized(async () => {
    const dir = folderFor(reviewsFolder, sourcePath);
    if (!file.endsWith(SUFFIX)) return false;
    if (!samePath(path.dirname(path.resolve(file)), path.resolve(dir), ci)) return false;
    const entry = await readEntry(file);
    if (!isEntry(entry) || !belongs(entry, sourcePath, ci)) return false;
    return markLastOpen(dir, sourcePath, path.basename(file), ci);
  });
}

/**
 * The review each chapter opens with (`currentOf`), keyed by the chapter paths
 * exactly as passed, for the badges in the file list. One read per chapter
 * folder, and files unchanged since the last call are not parsed again.
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
      const lastOpen = await readLastOpen(dir);
      for (const chapter of chapters) {
        const own = entries.filter((e) => belongs(e, chapter, ci));
        const chosen = currentOf(own, lastOpenOf(lastOpen, chapter, ci), ci);
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
 * A new entry whose time holds a separator is refused before anything is
 * made or written (`stampFor`, hardening.15).
 *
 * A new entry becomes the review the chapter opens with (apply.26): it is the
 * review on screen, or one that finished while the author was in another
 * chapter, which is what opens there next.
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
    const inPlace =
      file !== undefined && (await mayOverwrite(file, dir, review.sourcePath, ci)) ? file : null;
    let target: string;
    if (inPlace !== null) {
      await makeFolder(dir, reviewFolderName(review.sourcePath));
      target = inPlace;
    } else {
      // A time that cannot name a new entry is refused before the folder is
      // made or anything is written (hardening.15).
      const stamp = stampFor(review);
      await makeFolder(dir, reviewFolderName(review.sourcePath));
      target = await newEntryPath(dir, stamp, review, ci);
    }
    await atomicWriteFile(target, serialize(review));
    cache.delete(path.resolve(target));
    if (inPlace === null) await markLastOpen(dir, review.sourcePath, path.basename(target), ci);
    return { path: target };
  });
}

/**
 * Whether `file` may be written over with this chapter's review. A file that
 * is there but cannot be read may be this very review, so it is neither
 * written over nor left for a new entry, which would become the review the
 * chapter opens with in its place: the write fails, saying why, and the
 * review on screen is written there once it can be read (apply.25).
 */
async function mayOverwrite(file: string, dir: string, sourcePath: string, ci: boolean): Promise<boolean> {
  if (!file.endsWith(SUFFIX)) return false;
  if (!samePath(path.dirname(path.resolve(file)), path.resolve(dir), ci)) return false;
  if (!(await fileExists(file))) return true;
  const entry = await readEntry(file);
  if (isUnread(entry)) throw readFailure(entry.error, reviewFileName(file));
  return isEntry(entry) && belongs(entry, sourcePath, ci);
}

/**
 * `<stamp>.review.json`, or `<stamp>-2.review.json` and so on when that name is
 * taken by another chapter's review, `stamp` being `stampFor`'s. The same
 * review saved again without a path still lands on its own entry.
 *
 * A name that is there but cannot be read may be this very review, so, as in
 * `mayOverwrite`, the save fails saying why rather than go on to the next
 * name, which would make a copy that opens in its place (apply.25). It also
 * ends the search when no name can be read at all, as when the review's time
 * holds a NUL: every look then fails before touching the disk, so the next
 * name would be tried for ever without the event loop getting a turn
 * (hardening.8 review).
 */
async function newEntryPath(dir: string, stamp: string, review: Review, ci: boolean): Promise<string> {
  for (let n = 1; ; n += 1) {
    const candidate = path.join(dir, `${stamp}${n === 1 ? '' : `-${n}`}${SUFFIX}`);
    if (!(await fileExists(candidate))) return candidate;
    const entry = await readEntry(candidate);
    if (isUnread(entry)) throw readFailure(entry.error, reviewFileName(candidate));
    if (isEntry(entry) && entry.summary.id === review.id && belongs(entry, review.sourcePath, ci)) {
      return candidate;
    }
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
  await makeFolder(home, reviewFolderName(toSource));
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
  return moved.filter(isEntry);
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
    await makeFolder(path.dirname(move.to), reviewFolderName(journal.to));
    await atomicWriteFile(move.to, serialize(rehomeReview(review, journal.to)));
    cache.delete(path.resolve(move.to));
    if (samePath(move.from, move.to, ci)) continue;
    await fs.rm(move.from, { force: true });
    cache.delete(path.resolve(move.from));
    emptied.add(path.dirname(move.from));
  }
  await carryLastOpen(journal, ci);
  for (const dir of emptied) {
    // Only an empty folder is removed; one still holding another chapter's reviews stays.
    await fs.rmdir(dir).catch(() => undefined);
  }
  await fs.rm(path.join(reviewsFolder, JOURNAL), { force: true });
}

/**
 * The review last on screen for the old path is the new path's too (apply.26):
 * a record naming a moved file follows it to the new folder, and records whose
 * file is gone are dropped, so a folder the move emptied holds no record and
 * is removed. Idempotent, like the moves, since the old records are read
 * after them. A record that cannot be carried is logged, and the chapter then
 * opens with the review last decided in.
 */
async function carryLastOpen(journal: Journal, ci: boolean): Promise<void> {
  const moved = new Map(journal.moves.map((m) => [pathKey(m.from, ci), m.to]));
  const dirs = new Map(journal.moves.map((m) => [pathKey(path.dirname(m.from), ci), path.dirname(m.from)]));
  try {
    let carried: string | null = null;
    for (const dir of dirs.values()) {
      const chapters = await readLastOpen(dir);
      const kept: LastOpen[] = [];
      for (const record of chapters) {
        const file = path.join(dir, record.file);
        const to = moved.get(pathKey(file, ci));
        if (to !== undefined) carried = to;
        else if (await fileExists(file)) kept.push(record);
      }
      if (kept.length !== chapters.length) await writeLastOpen(dir, kept);
    }
    if (carried !== null) await setLastOpen(path.dirname(carried), journal.to, path.basename(carried), ci);
  } catch (err) {
    log('warn', 'reviews.last-open-failed', loggableErrorFields(err));
  }
}
