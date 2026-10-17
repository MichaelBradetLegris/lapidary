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
