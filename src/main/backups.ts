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
import type { Settings } from '../shared/types';
import {
  backupsFolderInManuscript,
  backupsFolderMissing,
  manuscriptHoldsBackups
} from '../shared/ui/backups';
import { AppFailure, fail, readFailure } from './errors';
import type { WriteHooks } from './files';
import { log as appLog, type LogLevel } from './log';

/*
 * Backups before Save to chapter (`apply.10`, PLAN 6.5 and 11.3 h). Before a
 * save replaces a chapter file, the bytes it replaces are copied, exactly,
 * into `<backups folder>/<chapter slug>-<8 hex>/`; no backup, no save. The
 * backups folder is `<userData>/backups` unless Settings names another
 * (`backupsFolder`, setup.18), which may never be the manuscript folder or
 * inside it (`assertBackupsFolderSetting`). After the write, that folder is
 * pruned to the newest 20 plus the first backup of each day for 30 days
 * (`backupsToPrune`). Show backups opens that folder (`chapterBackups`,
 * apply.11). No electron import: main passes the userData folder in, and the
 * tests a temp folder.
 */

/** The backups root's name under userData. */
export const BACKUPS_DIRNAME = 'backups';

/** Written once in each chapter's backup folder: which file the backups are of. */
export const CHAPTER_INFO_FILE = 'chapter.json';

/** More backups than this in one second means something is wrong; stop rather than loop. */
const MAX_PER_SECOND = 999;

/** `<userData>/backups`, the backups folder when Settings names none. */
export function backupsRootFor(userDataDir: string): string {
  return path.join(userDataDir, BACKUPS_DIRNAME);
}

/**
 * The backups folder in use (setup.18): the one Settings names, or
 * `<userData>/backups`, as `resolveReviewsFolder` does for reviews.
 */
export function resolveBackupsFolder(configured: string | null | undefined, userDataDir: string): string {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  return trimmed.length > 0 ? trimmed : backupsRootFor(userDataDir);
}

/** True when the backups folder in use is the one in the app's data folder, not the author's choice. */
export function isDefaultBackupsFolder(configured: string | null | undefined): boolean {
  return typeof configured !== 'string' || configured.trim().length === 0;
}

/** How a message names the backups folder in use, for `writeFailure` and `readFailure` (setup.18). */
export function backupsFolderName(folder: string): string {
  return `the backups folder ${path.resolve(folder)}`;
}

/**
 * Throws an `invalid-input` failure when the backups folder chosen in
 * Settings would be the manuscript folder or a folder inside it (setup.18,
 * CLAUDE.md rule 1): backups there would be listed as chapters, indexed by
 * Obsidian and synced. Checked on the settings as a save would leave them,
 * when that save names either folder: `changed` is the one it names, which
 * decides the words. Null, the backups folder in the data folder, passes, as
 * does any backups folder while no manuscript folder is chosen; the folders
 * are resolved first, so `..` in either cannot hide one inside the other. A
 * chapter's own folder lies in the manuscript folder; one opened from a
 * folder chosen before is refused at the save (`assertOutside`).
 */
export function assertBackupsFolderSetting(
  next: Pick<Settings, 'manuscriptFolder' | 'backupsFolder'>,
  changed: 'manuscriptFolder' | 'backupsFolder',
  ci: boolean
): void {
  if (!next.manuscriptFolder || !next.backupsFolder) return;
  const manuscript = path.resolve(next.manuscriptFolder);
  const backups = path.resolve(next.backupsFolder);
  const same = samePath(manuscript, backups, ci);
  if (!same && !isInsidePath(manuscript, backups, ci)) return;
  throw fail(
    'invalid-input',
    changed === 'backupsFolder'
      ? backupsFolderInManuscript(manuscript)
      : manuscriptHoldsBackups(manuscript, backups, same)
  );
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
 * is what keeping them outside avoids. With the data folder's root it can
 * only happen when the manuscript folder contains the app's data folder, or a
 * development userData override points into the vault; with a root chosen in
 * Settings (`chosen`, setup.18), which main refuses there as well
 * (`assertBackupsFolderSetting`), when settings.json was edited by hand, or a
 * chapter opened from a manuscript folder chosen before is saved. The words
 * say which folder to choose again.
 */
export function assertOutside(
  backupsRoot: string,
  folders: readonly (string | null | undefined)[],
  ci: boolean,
  chosen = false
): void {
  const root = path.resolve(backupsRoot);
  for (const folder of folders) {
    if (!folder) continue;
    const resolved = path.resolve(folder);
    if (samePath(root, resolved, ci) || isInsidePath(resolved, root, ci)) {
      const way = chosen
        ? 'Choose another backups folder in Settings.'
        : `Choose a manuscript folder in Settings that does not contain ${APP_NAME}'s data folder.`;
      throw fail(
        'invalid-input',
        `the backups folder, ${root}, lies inside ${resolved}, which holds your chapters, and backups never go where Obsidian or a sync tool would pick them up. ${way}`
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
 * (`readFailure`, apply.24). A backups folder chosen in Settings (`chosen`,
 * setup.18) that is not there at all, as when its drive is not connected, is
 * said to be missing, rather than to hold nothing for the chapter.
 */
export async function chapterBackups(
  backupsRoot: string,
  sourcePath: string,
  ci: boolean,
  options: { chosen?: boolean } = {}
): Promise<ChapterBackups | null> {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw fail('invalid-input', 'Show backups needs the full path of a chapter.');
  }
  const folder = backupFolderFor(backupsRoot, sourcePath, ci);
  assertChapterBackupFolder(backupsRoot, folder, ci);
  if (options.chosen === true) await assertRootThere(backupsRoot);
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

/**
 * Throws, in `backupsFolderMissing`'s words, when a backups folder chosen in
 * Settings is not there, or is a file; a folder that cannot be looked at is
 * explained as a read.
 */
async function assertRootThere(backupsRoot: string): Promise<void> {
  const root = path.resolve(backupsRoot);
  let isFolder: boolean;
  try {
    isFolder = (await fs.stat(root)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw readFailure(err, backupsFolderName(root));
    isFolder = false;
  }
  if (!isFolder) throw fail('io', backupsFolderMissing(root));
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
    case 'ENOENT':
      // A folder is made with everything on its path, so its drive, or the
      // share it is on, is not there: a backups folder chosen on a USB,
      // network or cloud drive that is not connected (setup.18).
      return fail(
        'io',
        `${folder} cannot be made, because its drive, or the folder it goes in, is not there. If the backups folder is on a network, USB or cloud drive, check that the drive is connected, or choose another backups folder in Settings, then save again.`
      );
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
  /** the backups folder in use: `<userData>/backups`, or the one Settings names (`resolveBackupsFolder`) */
  backupsRoot: string;
  /** the backups folder is the one Settings names, not the data folder's (setup.18), for the words of a refusal */
  chosen?: boolean;
  /** the manuscript folder from Settings, which the backups root must lie outside */
  manuscriptFolder: string | null;
  ci: boolean;
  now?: () => Date;
  log?: (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;
}

/**
 * The backup steps of a save, as `writeChapter` hooks (PLAN 11.3 h). Step 4,
 * `beforeReplace`: refuse a backups root inside the manuscript folder or the
 * chapter's own folder, then copy the bytes about to be replaced; a failure,
 * a chosen backups folder that cannot be made or written among them, stops
 * the save before anything is written. Step 8, `afterWrite`: prune the
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
          options.ci,
          options.chosen === true
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
