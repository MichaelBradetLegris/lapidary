import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  backupFileName,
  backupsToPrune,
  compareBackups,
  parseBackupFileName,
  type BackupName
} from '../shared/backups';
import { APP_NAME } from '../shared/branding';
import { loggableErrorFields } from '../shared/diagnostics/redact';
import type { SaveBackup } from '../shared/ipc';
import { isInsidePath, pathKey, samePath } from '../shared/paths';
import { chapterSlug } from '../shared/review';
import { AppFailure, fail, readFailure } from './errors';
import type { WriteHooks } from './files';
import { log as appLog, type LogLevel } from './log';

/*
 * Backups before Save to chapter (`apply.10`, PLAN 6.5 and 11.3 h). Before a
 * save replaces a chapter file, the bytes it replaces are copied, exactly,
 * into `<userData>/backups/<chapter slug>-<8 hex>/`; no backup, no save. After
 * the write, that folder is pruned to the newest 20 plus the first backup of
 * each day for 30 days (`backupsToPrune`). Show backups opens that folder
 * (`chapterBackups`, apply.11). No electron import: main passes the userData
 * folder in, and the tests a temp folder.
 */

/** The backups root's name under userData. */
export const BACKUPS_DIRNAME = 'backups';

/** Written once in each chapter's backup folder: which file the backups are of. */
export const CHAPTER_INFO_FILE = 'chapter.json';

/** More backups than this in one second means something is wrong; stop rather than loop. */
const MAX_PER_SECOND = 999;

/** `<userData>/backups`. */
export function backupsRootFor(userDataDir: string): string {
  return path.join(userDataDir, BACKUPS_DIRNAME);
}

/**
 * The chapter's own backup folder: its slug, as the reviews folder names it,
 * then the first 8 hex digits of the SHA-256 of its path key. The hash keeps
 * two chapters with the same file name in different folders apart (the slug
 * alone would put them together), and `ci` makes a path that differs only in
 * case the same chapter where the file system says so.
 */
export function backupFolderFor(backupsRoot: string, sourcePath: string, ci: boolean): string {
  const key = pathKey(path.resolve(sourcePath), ci);
  const hash = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
  return path.join(backupsRoot, `${chapterSlug(sourcePath)}-${hash}`);
}

/**
 * Throws unless the backups root lies outside every folder given: the
 * manuscript folder, and the folder of the chapter being saved. A backup in
 * there would be listed as a chapter, indexed by Obsidian and synced, which
 * is what keeping them in the app's data folder avoids. It can only happen
 * when the manuscript folder contains the app's data folder, or a development
 * userData override points into the vault.
 */
export function assertOutside(
  backupsRoot: string,
  folders: readonly (string | null | undefined)[],
  ci: boolean
): void {
  const root = path.resolve(backupsRoot);
  for (const folder of folders) {
    if (!folder) continue;
    const resolved = path.resolve(folder);
    if (samePath(root, resolved, ci) || isInsidePath(resolved, root, ci)) {
      throw fail(
        'invalid-input',
        `the backups folder, ${root}, lies inside ${resolved}, which holds your chapters, and backups never go where Obsidian or a sync tool would pick them up. Choose a manuscript folder in Settings that does not contain ${APP_NAME}'s data folder.`
      );
    }
  }
}

/**
 * Throws unless `folder` is a chapter's own folder directly under the
 * backups root: the only kind of folder Show backups opens (apply.11).
 * `backupFolderFor` makes nothing else; this holds whatever it is handed.
 */
export function assertChapterBackupFolder(backupsRoot: string, folder: string, ci: boolean): void {
  const root = path.resolve(backupsRoot);
  const resolved = path.resolve(folder);
  if (!isInsidePath(root, resolved, ci) || !samePath(path.dirname(resolved), root, ci)) {
    throw fail('invalid-input', `${resolved} is not a chapter's folder in ${root}.`);
  }
}

/** A chapter's backups as Show backups finds them. */
export interface ChapterBackups {
  /** the chapter's own backup folder */
  folder: string;
  /** its newest backup, which Explorer selects, or null when it holds none */
  newest: string | null;
}

/**
 * What Show backups shows for a chapter (apply.11): its own folder, worked
 * out here from the chapter's path rather than taken from the page, and the
 * newest backup in it. Null when the chapter has no folder at this path: until
 * a Save to chapter first changes the file there, and so also after the
 * chapter, its folder or the vault was renamed or moved, since the folder is
 * named by the path and the backups made before stay in the old path's folder.
 * A folder the system will not let the app read is explained as a read
 * (`readFailure`, apply.24).
 */
export async function chapterBackups(
  backupsRoot: string,
  sourcePath: string,
  ci: boolean
): Promise<ChapterBackups | null> {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw fail('invalid-input', 'Show backups needs the full path of a chapter.');
  }
  const folder = backupFolderFor(backupsRoot, sourcePath, ci);
  assertChapterBackupFolder(backupsRoot, folder, ci);
  const name = `the backup folder of ${path.basename(sourcePath)}`;
  try {
    if (!(await fs.stat(folder)).isDirectory()) return null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw readFailure(err, name);
  }
  try {
    return { folder, newest: (await listBackups(folder))[0]?.file ?? null };
  } catch (err) {
    throw readFailure(err, name);
  }
}

/** A backup on disk, from `listBackups`. */
export interface BackupEntry extends BackupName {
  file: string;
}

/** The chapter's backups, newest first. Anything that is not a backup is left out. */
export async function listBackups(folder: string): Promise<BackupEntry[]> {
  const names = await fileNames(folder);
  return names
    .map(parseBackupFileName)
    .filter((b): b is BackupName => b !== null)
    .sort((a, b) => compareBackups(b, a))
    .map((b) => ({ ...b, file: path.join(folder, b.name) }));
}

async function fileNames(folder: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export interface BackupInput {
  backupsRoot: string;
  /** the chapter file whose bytes these are */
  sourcePath: string;
  /** the exact bytes about to be replaced */
  bytes: Buffer;
  now?: Date;
  ci: boolean;
}

export interface BackupResult extends SaveBackup {
  folder: string;
  file: string;
}

/**
 * Copy `bytes` into the chapter's backup folder, under the time and the
 * chapter's file name. Byte for byte: whatever the bytes are, BOM, line
 * endings and encoding included. When the newest backup already holds exactly
 * these bytes, nothing is added and that one is returned (`created: false`).
 * A name is never reused: each file is created exclusively, and a second
 * backup in the same second becomes `-2`. Failures come back as an
 * `AppFailure` whose message is a plain reason, for the save's error card.
 */
export async function writeBackup(input: BackupInput): Promise<BackupResult> {
  const folder = backupFolderFor(input.backupsRoot, input.sourcePath, input.ci);
  try {
    await fs.mkdir(folder, { recursive: true });
    await writeChapterInfo(folder, input.sourcePath);
    const newest = (await listBackups(folder))[0];
    if (newest && (await holds(newest.file, input.bytes))) {
      return { folder, file: newest.file, name: newest.name, created: false };
    }
    const now = input.now ?? new Date();
    for (let seq = 1; seq <= MAX_PER_SECOND; seq += 1) {
      const name = backupFileName(now, path.basename(input.sourcePath), seq);
      const file = path.join(folder, name);
      if (await createWith(file, input.bytes)) return { folder, file, name, created: true };
    }
    throw fail('io', `there are already ${MAX_PER_SECOND} backups from this second in ${folder}.`);
  } catch (err) {
    throw backupFailure(err, folder);
  }
}

/** `chapter.json`, written the first time only and never replaced. */
async function writeChapterInfo(folder: string, sourcePath: string): Promise<void> {
  const text = `${JSON.stringify({ sourcePath: path.resolve(sourcePath) }, null, 2)}\n`;
  try {
    await fs.writeFile(path.join(folder, CHAPTER_INFO_FILE), text, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

/** Whether the file holds exactly these bytes; a file that cannot be read does not. */
async function holds(file: string, bytes: Buffer): Promise<boolean> {
  try {
    return (await fs.readFile(file)).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * Create `file` with `bytes`, or return false when that name is taken. A
 * write that fails part way removes what it wrote, so a short copy is never
 * left looking like a backup.
 */
async function createWith(file: string, bytes: Buffer): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await fs.open(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    return true;
  } catch (err) {
    await handle.close().catch(() => undefined);
    await fs.rm(file, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** A plain reason for a failed backup, to follow "Could not back up the chapter before saving, so nothing was written:". */
function backupFailure(err: unknown, folder: string): AppFailure {
  if (err instanceof AppFailure) return err;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case 'ENOSPC':
      return fail(
        'io',
        `there is no space left on the disk for a copy in ${folder}. Free some space and save again.`
      );
    case 'EROFS':
      return fail('io', `${folder} is on a read-only drive.`);
    case 'EPERM':
    case 'EACCES':
    case 'EBUSY':
      return fail(
        'io',
        `${APP_NAME} is not allowed to write in ${folder}. Check that the folder is writable and that no other program is holding it, then save again.`
      );
    case 'ENOTDIR':
    case 'EEXIST':
      return fail('io', `${folder} cannot be made, because a file stands where a folder should be.`);
    default:
      return fail('io', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Delete the backups `backupsToPrune` lets go from one chapter's folder, and
 * return their names. Every one is tried; if any could not be deleted, the
 * first error is thrown after the rest. Nothing that is not a backup's name,
 * `chapter.json` included, is ever deleted.
 */
export async function pruneBackups(folder: string, now: Date = new Date()): Promise<string[]> {
  const removed: string[] = [];
  let failure: Error | null = null;
  for (const name of backupsToPrune(await fileNames(folder), now)) {
    try {
      await fs.rm(path.join(folder, name), { force: true });
      removed.push(name);
    } catch (err) {
      failure ??= err instanceof Error ? err : new Error(String(err));
    }
  }
  if (failure !== null) throw failure;
  return removed;
}

export interface ChapterBackupOptions {
  /** `<userData>/backups` */
  backupsRoot: string;
  /** the manuscript folder from Settings, which the backups root must lie outside */
  manuscriptFolder: string | null;
  ci: boolean;
  now?: () => Date;
  log?: (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * The backup steps of a save, as `writeChapter` hooks (PLAN 11.3 h). Step 4,
 * `beforeReplace`: refuse a backups root inside the manuscript folder or the
 * chapter's own folder, then copy the bytes about to be replaced; a failure
 * stops the save before anything is written. Step 8, `afterWrite`: prune the
 * chapter's backups, best effort, since the chapter is already saved by then;
 * a failure is logged and nothing else.
 */
export function chapterBackupHooks(
  options: ChapterBackupOptions
): Required<Pick<WriteHooks, 'beforeReplace' | 'afterWrite'>> {
  const now = options.now ?? ((): Date => new Date());
  const log = options.log ?? appLog;
  return {
    beforeReplace: async (file, bytes) => {
      try {
        assertOutside(
          options.backupsRoot,
          [options.manuscriptFolder, path.dirname(path.resolve(file))],
          options.ci
        );
        const { name, created } = await writeBackup({
          backupsRoot: options.backupsRoot,
          sourcePath: file,
          bytes,
          now: now(),
          ci: options.ci
        });
        return { name, created };
      } catch (err) {
        log('warn', 'backups.failed', loggableErrorFields(err));
        throw err;
      }
    },
    afterWrite: async (file) => {
      try {
        await pruneBackups(backupFolderFor(options.backupsRoot, file, options.ci), now());
      } catch (err) {
        log('warn', 'backups.prune-failed', loggableErrorFields(err));
      }
    }
  };
}
