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

export function toAppError(err: unknown, platform: NodeJS.Platform = process.platform): AppError {
  if (err instanceof AppFailure) return err.toAppError();
  if (err instanceof Error) {
    const explained = explainWriteError(err, writtenName(err), platform);
    if (explained) return { code: 'io', message: explained, detail: err.stack ?? undefined };
    const code: ErrorCode = isFsError(err) ? 'io' : 'unknown';
    return { code, message: err.message, detail: err.stack ?? undefined };
  }
  return { code: 'unknown', message: String(err) };
}

function isFsError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^(ENOENT|EACCES|EPERM|EBUSY|EISDIR|ENOTDIR|EEXIST)$/.test(code);
}

/**
 * The file a failed write was aimed at. A refused rename names the temp file
 * as `path` and the target as `dest`; a temp file is `.<name>.<hex>.tmp`.
 */
function writtenName(err: Error): string {
  const e = err as NodeJS.ErrnoException & { dest?: string };
  const base = path.basename(e.dest ?? e.path ?? '');
  return /^\.(.+)\.[0-9a-f]{12}\.tmp$/.exec(base)?.[1] ?? (base || 'the file');
}

/**
 * Plain words for the ways Windows and other systems refuse a write (files.4).
 * Every write goes through a temp file and a rename, so when one of these
 * happens the file itself is untouched, and the message says so. Null for any
 * other error.
 */
export function explainWriteError(err: unknown, fileName: string, platform: NodeJS.Platform): string | null {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const unchanged = 'Nothing was written; the file is as it was.';
  switch (code) {
    case 'EPERM':
    case 'EACCES':
    case 'EBUSY':
      return platform === 'win32'
        ? `Windows would not let ${APP_NAME} replace ${fileName}, even after trying for a second and a half. Another program may have it open: close it there, or wait a moment, and save again. If that keeps happening, Windows Security's Controlled folder access may be blocking ${APP_NAME}: allow it under Windows Security > Virus & threat protection > Ransomware protection > Allow an app through Controlled folder access. ${unchanged}`
        : `${APP_NAME} is not allowed to replace ${fileName}. Check that the file and its folder are writable, and that no other program is holding it, then save again. ${unchanged}`;
    case 'ENOSPC':
      return `There is no space left on the disk for ${fileName}. Free some space and save again. ${unchanged}`;
    case 'EROFS':
      return `${fileName} is on a read-only drive, so it cannot be saved there. ${unchanged}`;
    default:
      return null;
  }
}
