import path from 'node:path';
import type { OpenGuidelinesVia } from '../shared/ipc';
import { fail } from './errors';
import { assertGuidelinesFile } from './guidelines';

/** The parts of Electron's `shell` used here, so tests can stand in for it. */
export interface ShellApi {
  openExternal(url: string): Promise<void>;
  /** resolves to '' on success, or to the reason the OS gave */
  openPath(file: string): Promise<string>;
  showItemInFolder(file: string): void;
}

/** Obsidian's own link for a file: it opens in the vault that holds it. */
export function obsidianOpenUrl(file: string): string {
  return `obsidian://open?path=${encodeURIComponent(file)}`;
}

/**
 * Open the guidelines file in Obsidian, or in whatever app the system uses for
 * the file type (setup.10). When no app is set for it, the file is shown in its
 * folder instead and the author is told why.
 */
export async function openGuidelinesFile(
  file: string,
  via: OpenGuidelinesVia,
  shellApi: ShellApi
): Promise<void> {
  assertGuidelinesFile(file);
  if (via === 'obsidian') {
    await shellApi.openExternal(obsidianOpenUrl(file));
    return;
  }
  const problem = await shellApi.openPath(file);
  if (problem === '') return;
  shellApi.showItemInFolder(file);
  const ext = path.extname(file).toLowerCase();
  throw fail(
    'io',
    `No app is set to open ${ext} files on this computer, so ${path.basename(file)} is shown in its folder instead. Open it with Obsidian or any text editor.`,
    problem
  );
}
