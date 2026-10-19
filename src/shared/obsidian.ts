/**
 * Obsidian's own link for a file, for Open in Obsidian (setup.10b, PLAN 10).
 *
 * The link is `obsidian://open?path=<the file's full path>`. Obsidian looks
 * through the vaults it knows for the most specific one that holds the path
 * and opens the file there, so the link names no vault: the manuscript folder
 * can be a vault or any folder inside one, and two vaults whose folders have
 * the same name are never mixed up. A file in no vault Obsidian knows gets
 * Obsidian's own message that it cannot find a vault for the link.
 *
 * Obsidian asks for every value in a link to be percent-encoded, slashes and
 * spaces included. Here every character but A-Z, a-z, 0-9 and `-._~` is, as
 * UTF-8, so a Windows path keeps its backslashes as %5C (the form Obsidian's
 * forum reports working on Windows), a space is %20 and never `+`, and `&`,
 * `#`, `?`, `=`, `+` and `%` in a folder or file name cannot end the value or
 * be read as something else. Accented letters and other scripts are encoded
 * as their UTF-8 bytes and come back unchanged, in whichever Unicode form the
 * system gave them.
 *
 * Pure (CLAUDE.md rule 4). Main hands the system nothing but a link
 * `isObsidianOpenUrl` accepts (src/main/openGuidelines.ts).
 */

/** Everything before the path in the link. */
export const OBSIDIAN_OPEN_PREFIX = 'obsidian://open?path=';

/**
 * Obsidian opens Markdown notes. A `.txt` guidelines file, which the app
 * otherwise accepts, is not one it shows, so it gets Open only.
 */
export function obsidianOpensFile(file: string): boolean {
  return /\.md$/i.test(file);
}

/**
 * A full path: from a drive (`C:\` or `C:/`), a network share (`\\server\share`,
 * or `\\?\` before either) or the root (`/`). The `path` Obsidian is given has
 * to be one, since it has no folder to start a relative path from.
 */
export function isFullPath(file: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(file) || /^\\\\[^\\]/.test(file) || file.startsWith('/');
}

/** `!'()*` as well as what `encodeURIComponent` encodes; null for text no link can carry (a lone surrogate). */
export function encodeLinkValue(value: string): string | null {
  try {
    return encodeURIComponent(value).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    );
  } catch {
    return null;
  }
}

/**
 * Obsidian's link for `file`, or null when there can be none: a path that is
 * not a full one, a file that is not `.md`, or a name no link can carry.
 */
export function obsidianOpenUrl(file: string): string | null {
  if (!isFullPath(file) || !obsidianOpensFile(file)) return null;
  const value = encodeLinkValue(file);
  return value === null ? null : `${OBSIDIAN_OPEN_PREFIX}${value}`;
}

/**
 * The path in a link `obsidianOpenUrl` made, or null for anything else: the
 * value decoded must encode back to exactly the same link.
 */
export function obsidianLinkPath(url: string): string | null {
  if (!url.startsWith(OBSIDIAN_OPEN_PREFIX)) return null;
  let file: string;
  try {
    file = decodeURIComponent(url.slice(OBSIDIAN_OPEN_PREFIX.length));
  } catch {
    return null;
  }
  return obsidianOpenUrl(file) === url ? file : null;
}

/**
 * Exactly a link `obsidianOpenUrl` makes: the `open` action with one `path`,
 * a full path to a `.md` file, encoded as above. Nothing else goes to the
 * system as an Obsidian link.
 */
export function isObsidianOpenUrl(url: string): boolean {
  return obsidianLinkPath(url) !== null;
}
