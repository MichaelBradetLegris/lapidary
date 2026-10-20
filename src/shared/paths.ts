/**
 * Comparing file paths as the file system does (PLAN `files.1a`).
 *
 * Reviews are bound to their chapter by path, and Save may only write inside the
 * manuscript folder, so "is this the same file?" and "is this file inside that
 * folder?" have to be answered exactly. A string comparison gets them wrong:
 *
 * - case: Windows and macOS ignore it;
 * - separators: backslashes and forward slashes mean the same thing;
 * - Unicode: an accented name can be stored composed (NFC) or decomposed (NFD);
 * - prefixes: `C:/Book` is not inside `C:/Booklet`.
 *
 * `ci` says whether the file system ignores case. Main passes `path.resolve`d
 * strings and `ci = platform is win32 or darwin`. Pure (CLAUDE.md rule 4).
 */

const DRIVE_ROOT = /^[A-Za-z]:\/?$/;
const UNC_ROOT = /^\/\/[^/]+\/[^/]+\/?$/;

/**
 * A key for comparing paths: forward slashes, NFC, repeated slashes collapsed
 * (except the two that start a UNC path), no trailing slash except on a root,
 * and lower case when the file system ignores case. Roots come out as `/`,
 * `d:/` and `//srv/share/`.
 */
export function pathKey(p: string, ci: boolean): string {
  let key = p.replace(/\\/g, '/').normalize('NFC');
  const unc = key.startsWith('//');
  key = key.replace(/\/{2,}/g, '/');
  if (unc) key = `/${key}`;
  if (DRIVE_ROOT.test(key)) key = `${key.slice(0, 2)}/`;
  else if (UNC_ROOT.test(key)) key = key.endsWith('/') ? key : `${key}/`;
  else if (key.length > 1 && key.endsWith('/')) key = key.slice(0, -1);
  return ci ? key.toLowerCase() : key;
}

export function samePath(a: string, b: string, ci: boolean): boolean {
  return pathKey(a, ci) === pathKey(b, ci);
}

/** True when `file` lies somewhere under `root`. A path is not inside itself. */
export function isInsidePath(root: string, file: string, ci: boolean): boolean {
  const rootKey = pathKey(root, ci);
  const fileKey = pathKey(file, ci);
  if (rootKey === fileKey) return false;
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`;
  return fileKey.startsWith(prefix);
}

/**
 * True when `p` starts from a root: a drive letter and a separator (`C:\`,
 * `C:/`), a UNC share (`\\srv\share`), or a slash or backslash. This is
 * Windows' rule (`path.win32.isAbsolute`), which takes POSIX's absolute paths
 * too, and it does not ask which system it runs on, so a settings file reads
 * the same in a test on Linux (hardening.8). `Novel`, `.\Novel`, `~/Novel` and
 * `C:Novel`, which Windows reads from the drive's current folder, are not.
 */
export function isAbsolutePath(p: string): boolean {
  return /^(?:[A-Za-z]:)?[\\/]/.test(p);
}

/** True when `p` holds a NUL character, which no file system takes in a path (hardening.8). */
export function hasNul(p: string): boolean {
  return p.includes('\u0000');
}

/**
 * The extension of the last segment of `p` as `path.extname` reads it, lower
 * case: `.md` for `Notes.MD`, and nothing for `.md` alone, a dot-file with
 * no extension, or for `..`. Either separator ends a segment, and a path that
 * ends in one names a folder, so it has none (where `path.extname` would read
 * the segment before it).
 */
export function extensionOf(p: string): string {
  const name = p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && name !== '..' ? name.slice(dot).toLowerCase() : '';
}

/**
 * How many path segments the two paths share at their end, compared by key:
 * `C:/Old/Novel/Ch 1.md` and `D:/New/Novel/Ch 1.md` share 2. Used to recognise a
 * vault that moved (PLAN 11.3 g).
 */
export function commonTrailingSegments(a: string, b: string, ci: boolean): number {
  const left = pathKey(a, ci).split('/').filter(Boolean);
  const right = pathKey(b, ci).split('/').filter(Boolean);
  let n = 0;
  while (n < left.length && n < right.length && left[left.length - 1 - n] === right[right.length - 1 - n]) {
    n += 1;
  }
  return n;
}
