import path from 'node:path';
import { APP_NAME } from '../shared/branding';
import type { AppError, ErrorCode } from '../shared/types';

export class AppFailure extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AppFailure';
    this.code = code;
    this.detail = detail;
  }

  toAppError(): AppError {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

export function fail(code: ErrorCode, message: string, detail?: string): AppFailure {
  return new AppFailure(code, message, detail);
}

/** What the app was doing with a file when the error came (apply.24). */
export type FileOperation = 'read' | 'write';

/**
 * What a write was making (apply.25). `replace` is a file written whole
 * through a temp file and a rename (`atomicWriteFile`): a refused rename is
 * retried for about a second and a half, and a temp file that cannot be
 * created is not. The others are never retried and replace nothing: `create`
 * a new file made with the exclusive-create flag (a new chapter, set-aside
 * text), `copy` a file copied from a template that way (the guidelines file),
 * `folder` a folder made before writing in it.
 */
export type WriteKind = 'replace' | 'create' | 'copy' | 'folder';

export interface ErrorContext {
  /**
   * `write` unless said otherwise: an error that reaches the IPC bridge
   * unexplained is taken to come from a write. Every read path in main says
   * `read`, through `readFailure`, before its error gets that far.
   */
  operation?: FileOperation;
  /**
   * For a write, what it was making: `replace` unless said otherwise. Every
   * write that makes something new says so, through `writeFailure`, before
   * its error gets to the IPC bridge (apply.25).
   */
  write?: WriteKind;
  /** how the message names the file; by default its name in the error */
  name?: string;
  /**
   * The file is a chapter, which the author opens from the list: a read that
   * finds nothing adds that a renamed or moved chapter is opened again from
   * where it is now. A review file, the drafts file, the guidelines file or a
   * backup folder cannot be opened that way, so they never get those words.
   */
  reopen?: boolean;
  platform?: NodeJS.Platform;
}

/**
 * What the page is told about a failure. An error from the file system is
 * explained in plain words for what the app was doing: a refused read as a
 * read (`explainReadError`), anything else as a write (`explainWriteError`).
 */
export function toAppError(err: unknown, context: ErrorContext = {}): AppError {
  if (err instanceof AppFailure) return err.toAppError();
  if (err instanceof Error) {
    const platform = context.platform ?? process.platform;
    const name = context.name ?? fileNameOf(err);
    const explained =
      context.operation === 'read'
        ? explainReadError(err, name, platform, context.reopen ?? false)
        : explainWriteError(err, name, platform, context.write ?? 'replace');
    if (explained) return { code: 'io', message: explained, detail: err.stack ?? undefined };
    const code: ErrorCode = isFsError(err) ? 'io' : 'unknown';
    return { code, message: err.message, detail: err.stack ?? undefined };
  }
  return { code: 'unknown', message: String(err) };
}

/** How `readFailure` words a read: `reopen` and `platform` as in `ErrorContext`. */
export type ReadFailureOptions = Pick<ErrorContext, 'reopen' | 'platform'>;

/**
 * A failed read, as an error that keeps its words all the way to the page:
 * the read wording of `toAppError`, naming the file as `name` (by default its
 * own name). Every read path in main throws this, so a file another program
 * holds open is never reported as a failed save (apply.24). An error that is
 * not the file system's, such as a refusal already in words or a parse
 * error, is left as it is.
 */
export function readFailure(err: unknown, name?: string, options: ReadFailureOptions = {}): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  if (err instanceof AppFailure || systemCode(err) === undefined) return err;
  const explained = toAppError(err, {
    operation: 'read',
    ...(name === undefined ? {} : { name }),
    ...options
  });
  return new AppFailure(explained.code, explained.message, explained.detail);
}

/** A write that makes something new: what `writeFailure` takes. */
export type MakeKind = Exclude<WriteKind, 'replace'>;

/**
 * A failed write that was making something new (apply.25), as an error that
 * keeps its words all the way to the page: what was being made, that nothing
 * was retried and nothing replaced, and "try again". `name` is how the
 * message names it (by default its own name). An error with no such words
 * (an `ENOENT`, say), and one that is not the file system's, is left as it
 * is, so a caller can still test its code, and the IPC bridge words it as
 * before.
 */
export function writeFailure(
  err: unknown,
  kind: MakeKind,
  name?: string,
  options: Pick<ErrorContext, 'platform'> = {}
): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  if (err instanceof AppFailure || systemCode(err) === undefined) return err;
  const explained = explainWriteError(
    err,
    name ?? fileNameOf(err),
    options.platform ?? process.platform,
    kind
  );
  return explained === null ? err : new AppFailure('io', explained, err.stack ?? undefined);
}

function errnoCode(err: unknown): string | undefined {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The code of an error the system gave (`EBUSY`, `ENOENT`, `UNKNOWN` for one
 * libuv has no name for), not of one Node raised about its own arguments
 * (`ERR_INVALID_ARG_TYPE`).
 */
function systemCode(err: unknown): string | undefined {
  const code = errnoCode(err);
  return code !== undefined && (/^E[A-Z0-9]+$/.test(code) || code === 'UNKNOWN') ? code : undefined;
}

function isFsError(err: Error): boolean {
  const code = errnoCode(err);
  return code !== undefined && /^(ENOENT|EACCES|EPERM|EBUSY|EISDIR|ENOTDIR|EEXIST)$/.test(code);
}

/** The temp file `atomicWriteFile` writes beside its target: `.<name>.<12 hex>.tmp`. */
const TEMP_FILE = /^\.(.+)\.[0-9a-f]{12}\.tmp$/;

/**
 * The file a failed read or write was aimed at. A refused rename names the
 * temp file as `path` and the target as `dest`; a temp file is
 * `.<name>.<hex>.tmp`.
 */
function fileNameOf(err: Error): string {
  const e = err as NodeJS.ErrnoException & { dest?: string };
  const base = path.basename(e.dest ?? e.path ?? '');
  return TEMP_FILE.exec(base)?.[1] ?? (base || 'the file');
}

/**
 * Whether the error is about the temp file itself, which could not be
 * created, rather than the rename that replaces the target (that one names
 * the target as `dest`). Only the rename is retried (apply.25).
 */
function isTempFileError(err: unknown): boolean {
  const e = err as (NodeJS.ErrnoException & { dest?: string }) | null;
  return typeof e?.path === 'string' && e.dest === undefined && TEMP_FILE.test(path.basename(e.path));
}

/** The way out when Windows Security blocks the app; it blocks creating files as well as changing them. */
const CONTROLLED_FOLDER_ACCESS = `If that keeps happening, Windows Security's Controlled folder access may be blocking ${APP_NAME}: allow it under Windows Security > Virus & threat protection > Ransomware protection > Allow an app through Controlled folder access.`;

/**
 * Plain words for the ways Windows and other systems refuse a write (files.4),
 * saying what the write was making (`kind`, apply.25). A file is replaced
 * through a temp file and a rename, so when one of these happens the file
 * itself is untouched, and the message says so; only a refused rename was
 * retried, so only it says so. A new file, a copy or a folder replaces
 * nothing and was never retried; its words say what was being made and to
 * try again, since only Save to chapter is saved again. Null for any other
 * error.
 */
export function explainWriteError(
  err: unknown,
  fileName: string,
  platform: NodeJS.Platform,
  kind: WriteKind = 'replace'
): string | null {
  if (kind !== 'replace') return explainMakeError(err, fileName, platform, kind);
  const code = errnoCode(err);
  const unchanged = 'Nothing was written; the file is as it was.';
  switch (code) {
    case 'EPERM':
    case 'EACCES':
    case 'EBUSY':
      if (isTempFileError(err)) {
        return platform === 'win32'
          ? `Windows would not let ${APP_NAME} write the new version of ${fileName} into its folder. Another program may be holding the folder, or your Windows account may not be allowed to add files to it. Wait a moment and save again. ${CONTROLLED_FOLDER_ACCESS} ${unchanged}`
          : `${APP_NAME} is not allowed to write the new version of ${fileName} into its folder. Check that the folder is writable, then save again. ${unchanged}`;
      }
      return platform === 'win32'
        ? `Windows would not let ${APP_NAME} replace ${fileName}, even after trying for a second and a half. Another program may have it open: close it there, or wait a moment, and save again. ${CONTROLLED_FOLDER_ACCESS} ${unchanged}`
        : `${APP_NAME} is not allowed to replace ${fileName}. Check that the file and its folder are writable, and that no other program is holding it, then save again. ${unchanged}`;
    case 'ENOSPC':
      return `There is no space left on the disk for ${fileName}. Free some space and save again. ${unchanged}`;
    case 'EROFS':
      return `${fileName} is on a read-only drive, so it cannot be saved there. ${unchanged}`;
    default:
      return null;
  }
}

/**
 * The words for a write that was making something new (apply.25): `name` is
 * the file or, for a folder, words that say which folder it is ("the review
 * folder of Chapter 12.md"). It never starts a sentence. A disk that filled
 * up part way may have left part of a new file, so that one does not say
 * nothing was written.
 */
function explainMakeError(
  err: unknown,
  name: string,
  platform: NodeJS.Platform,
  kind: MakeKind
): string | null {
  const made = kind === 'copy' ? `${name} from the template` : name;
  const nothing = 'Nothing was written.';
  switch (errnoCode(err)) {
    case 'EPERM':
    case 'EACCES':
    case 'EBUSY':
      if (platform === 'win32') {
        const why =
          kind === 'folder'
            ? 'Another program may be holding the folder it goes in, or your Windows account may not be allowed to add folders there.'
            : 'Another program may be holding its folder, or your Windows account may not be allowed to add files to it.';
        return `Windows would not let ${APP_NAME} create ${made}. ${why} Wait a moment and try again. ${CONTROLLED_FOLDER_ACCESS} ${nothing}`;
      }
      return `${APP_NAME} is not allowed to create ${made}. Check that ${
        kind === 'folder' ? 'the folder it goes in' : 'its folder'
      } is writable, then try again. ${nothing}`;
    case 'ENOSPC':
      return `There is no space left on the disk for ${name}. Free some space and try again.`;
    case 'EROFS':
      return `${APP_NAME} cannot create ${name}, because the drive is read-only. ${nothing}`;
    default:
      return null;
  }
}

/**
 * Plain words for a read the system refused or could not make (apply.24):
 * what may be holding the file, what to try, and that the app changed
 * nothing, since reading never changes a file. Controlled folder access
 * blocks only changes, so it is not mentioned here. Any other error code
 * gets general words with the code in them; null for an error that is not
 * the file system's. The name never starts a sentence, so a file name is
 * shown exactly as it is. Only a chapter (`reopen`) is told, when it cannot
 * be found, to be opened again from where it is now.
 */
export function explainReadError(
  err: unknown,
  fileName: string,
  platform: NodeJS.Platform,
  reopen = false
): string | null {
  const code = systemCode(err);
  if (code === undefined) return null;
  const unchanged = `${APP_NAME} has not changed anything.`;
  switch (code) {
    case 'EPERM':
    case 'EACCES':
    case 'EBUSY':
      return platform === 'win32'
        ? `Windows would not let ${APP_NAME} read ${fileName}. Another program may have it open, such as a sync, backup or antivirus tool, or your Windows account may not be allowed to read it. Close it there, or wait a moment, and try again. ${unchanged}`
        : `${APP_NAME} is not allowed to read ${fileName}. Check that the file and its folder can be read, and that no other program is holding it, then try again. ${unchanged}`;
    case 'ENOENT':
    case 'ENOTDIR':
      return reopen
        ? `${APP_NAME} could not find ${fileName}. It may have been renamed, moved or deleted; if it was renamed or moved, open it again from where it is now. ${unchanged}`
        : `${APP_NAME} could not find ${fileName}. It may have been renamed, moved or deleted. ${unchanged}`;
    case 'EISDIR':
      return `${APP_NAME} could not read ${fileName}, because it is a folder, not a file. ${unchanged}`;
    default:
      return `${APP_NAME} could not read ${fileName} (${code}). If it is on a network, USB or cloud drive, check that the drive is connected, then try again. ${unchanged}`;
  }
}
