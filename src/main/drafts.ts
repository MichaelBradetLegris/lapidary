import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { formatLocalStamp } from '../shared/backups';
import type { DraftFile, DraftSaveRequest, SetAsideRequest } from '../shared/ipc';
import { pathKey, samePath } from '../shared/paths';
import {
  DRAFT_FILE_VERSION,
  draftSetProblem,
  parseDraftFile,
  setAsideFileName,
  setAsideText
} from '../shared/ui/drafts';
import { fail, readFailure } from './errors';
import { atomicWriteFile } from './atomic';
import { log as appLog, type LogLevel } from './log';

/*
 * Paragraph boxes kept on disk (`apply.16`, PLAN 11.3 j). The boxes left open
 * in a chapter are one json file in `<userData>/drafts`, named by a hash of
 * the chapter's path, written whole each time (temp file, then rename) and
 * deleted when none is open. A box that cannot go back on the page is set
 * aside as a .txt in `drafts/set-aside`, which is never written over. What
 * goes back and what is set aside is decided in `src/shared/ui/drafts.ts`.
 * Nothing here logs the text, the chapter's name or its path (11.3 m). No
 * electron import: main passes the userData folder in, and the tests a temp
 * folder.
 */

/** The drafts folder's name under userData. */
export const DRAFTS_DIRNAME = 'drafts';

/** The set-aside folder's name under the drafts folder. */
export const SET_ASIDE_DIRNAME = 'set-aside';

/** More set-aside files than this in one second means something is wrong; stop rather than loop. */
const MAX_PER_SECOND = 999;

type Log = (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;

/** `<userData>/drafts`. */
export function draftsRootFor(userDataDir: string): string {
  return path.join(userDataDir, DRAFTS_DIRNAME);
}

/** `<userData>/drafts/set-aside`. */
export function setAsideFolderFor(draftsRoot: string): string {
  return path.join(draftsRoot, SET_ASIDE_DIRNAME);
}

/**
 * The chapter's drafts file: the first 16 hex digits of the SHA-256 of its
 * path key, so a path that differs only in case is the same chapter where the
 * file system says so (`ci`), and the name gives nothing of the chapter away.
 */
export function draftFileFor(draftsRoot: string, sourcePath: string, ci: boolean): string {
  const key = pathKey(path.resolve(sourcePath), ci);
  const hash = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
  return path.join(draftsRoot, `${hash}.json`);
}

/** A field of a request from the renderer, which may not be an object at all. */
function fieldOf(request: unknown, field: string): unknown {
  if (typeof request !== 'object' || request === null) {
    throw fail('invalid-input', 'The request about paragraph boxes was empty.');
  }
  return (request as Record<string, unknown>)[field];
}

function requirePath(sourcePath: unknown): string {
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
    throw fail('invalid-input', 'No chapter was named for the paragraph boxes.');
  }
  return sourcePath;
}

/**
 * How a failed read names the drafts file: its own name is a hash, which
 * would tell the author nothing, and the message names no path. The card
 * puts the reason after "could not be read back:", so "they" are the
 * paragraphs left open.
 */
const DRAFTS_FILE_NAME = 'the file they are kept in';

/**
 * The boxes kept for this chapter, or null when there are none. A file that
 * cannot be read as one this app wrote is moved aside within the drafts
 * folder, as `<hash>.unreadable-<time>.json`, so the next write cannot replace
 * whatever it holds, and null is returned. A file that cannot be read at all
 * (locked, or not allowed) is left where it is and the read fails; on Windows
 * a file another program holds open cannot be renamed either. A file that
 * names another chapter, which only a hash collision could cause, is left
 * alone.
 */
export async function loadDrafts(
  draftsRoot: string,
  sourcePath: string,
  ci: boolean,
  options: { now?: Date; log?: Log } = {}
): Promise<DraftFile | null> {
  const file = draftFileFor(draftsRoot, requirePath(sourcePath), ci);
  const log = options.log ?? appLog;
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    // The renderer writes nothing over the file until it can be read (C.53).
    log('warn', 'drafts.read-failed', { code: code ?? null });
    throw readFailure(err, DRAFTS_FILE_NAME);
  }
  let parsed: DraftFile | null;
  try {
    parsed = parseDraftFile(JSON.parse(raw) as unknown);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    const stamp = formatLocalStamp(options.now ?? new Date()).replace(' ', '_');
    const aside = file.replace(/\.json$/, `.unreadable-${stamp}.json`);
    await fs.rename(file, aside).catch(() => undefined);
    log('warn', 'drafts.unreadable', {});
    return null;
  }
  if (!samePath(path.resolve(parsed.sourcePath), path.resolve(sourcePath), ci)) return null;
  return parsed;
}

/**
 * Keep the boxes open in a chapter now: the whole set replaces the file, and
 * an empty set deletes it. A set this app would not write is refused
 * (`draftSetProblem`), more than 200 boxes or more than 1 MB in one among it.
 */
export async function saveDrafts(
  draftsRoot: string,
  request: DraftSaveRequest,
  ci: boolean,
  now: Date = new Date()
): Promise<void> {
  const sourcePath = requirePath(fieldOf(request, 'sourcePath'));
  if (typeof request.reviewId !== 'string') {
    throw fail('invalid-input', 'The paragraph boxes named no review.');
  }
  const problem = draftSetProblem(request.drafts);
  if (problem) throw fail('invalid-input', problem);
  const file = draftFileFor(draftsRoot, sourcePath, ci);
  if (request.drafts.length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  const kept: DraftFile = {
    version: DRAFT_FILE_VERSION,
    sourcePath: path.resolve(sourcePath),
    reviewId: request.reviewId,
    savedAt: now.toISOString(),
    drafts: request.drafts.map((d) => ({
      key: d.key,
      paragraphs: [...d.paragraphs],
      initial: d.initial,
      text: d.text
    }))
  };
  await fs.mkdir(draftsRoot, { recursive: true });
  await atomicWriteFile(file, Buffer.from(`${JSON.stringify(kept, null, 2)}\n`, 'utf8'));
}

export interface SetAsideResult {
  /** the file name, as the card shows it and `shell:reveal` takes it back */
  name: string;
  file: string;
}

/**
 * Write boxes that cannot go back to a new .txt in `drafts/set-aside`
 * (`setAsideFileName`, `setAsideText`), with the platform's line endings. A
 * name is never reused: each file is created exclusively, and a second in
 * the same second becomes `-2`. A write that fails part way removes what it
 * wrote.
 */
export async function setAsideDrafts(
  draftsRoot: string,
  request: SetAsideRequest,
  options: { now?: Date; platform?: NodeJS.Platform; log?: Log } = {}
): Promise<SetAsideResult> {
  const sourcePath = requirePath(fieldOf(request, 'sourcePath'));
  const problem = draftSetProblem(request.drafts);
  if (problem) throw fail('invalid-input', problem);
  if (request.drafts.length === 0) throw fail('invalid-input', 'There was nothing to set aside.');
  const now = options.now ?? new Date();
  const platform = options.platform ?? process.platform;
  const log = options.log ?? appLog;
  const text = setAsideText(sourcePath, request.drafts, now);
  const bytes = Buffer.from(platform === 'win32' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
  const folder = setAsideFolderFor(draftsRoot);
  await fs.mkdir(folder, { recursive: true });
  for (let seq = 1; seq <= MAX_PER_SECOND; seq += 1) {
    const name = setAsideFileName(sourcePath, now, seq);
    const file = path.join(folder, name);
    try {
      await fs.writeFile(file, bytes, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      await fs.rm(file, { force: true }).catch(() => undefined);
      throw err;
    }
    log('info', 'drafts.set-aside', { boxes: request.drafts.length });
    return { name, file };
  }
  throw fail('io', `there are already ${MAX_PER_SECOND} set-aside files from this second in ${folder}.`);
}

/**
 * The set-aside file called `name`, or null when there is no such file: the
 * name must be a bare .txt file name, with no folder in it, of a file in
 * `drafts/set-aside`. This is how `shell:reveal` opens a card's file without
 * the renderer ever naming a path.
 */
export async function setAsideFile(draftsRoot: string, name: unknown): Promise<string | null> {
  if (typeof name !== 'string' || !name.toLowerCase().endsWith('.txt')) return null;
  if (name !== path.basename(name) || /[\\/]/.test(name) || name === '.' || name === '..') return null;
  const file = path.join(setAsideFolderFor(draftsRoot), name);
  try {
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}
