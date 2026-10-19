import path from 'node:path';
import type { OpenGuidelinesVia } from '../shared/ipc';
import { isObsidianOpenUrl, obsidianOpenUrl, obsidianOpensFile } from '../shared/obsidian';
import type { Settings } from '../shared/types';
import { fail } from './errors';
import { assertGuidelinesFile, ensureGuidelinesFile, guidelinesPathFor } from './guidelines';
import type { ShellApi } from './shellApi';

/**
 * The guidelines file has to be `.md` or `.txt`, and Open in Obsidian is for a
 * `.md` one only, since Obsidian does not show a `.txt` file. `guidelines:open`
 * checks this before the file is created from the template, so a refused open
 * makes nothing (setup.10b).
 */
export function assertCanOpen(file: string, via: OpenGuidelinesVia): void {
  assertGuidelinesFile(file);
  if (via === 'obsidian' && !obsidianOpensFile(file)) {
    throw fail(
      'invalid-input',
      `Obsidian opens .md files, and ${path.basename(file)} is not one. Use Open to open it in another app.`
    );
  }
}

/**
 * Hand Obsidian its own link for the file (setup.10b). The link is built in
 * `src/shared/obsidian.ts` from the path main already holds, and the shell is
 * given nothing but a link `isObsidianOpenUrl` accepts: `obsidian://open` with
 * one full path to a `.md` file. Whether Obsidian then finds a vault that
 * holds it is Obsidian's to say, in its own window.
 */
export async function openInObsidian(file: string, shellApi: ShellApi): Promise<void> {
  assertCanOpen(file, 'obsidian');
  const url = obsidianOpenUrl(file);
  if (url === null || !isObsidianOpenUrl(url)) {
    throw fail(
      'invalid-input',
      `There is no Obsidian link for ${file}: it is not a full path, or its name holds a character a link cannot carry. Use Open instead.`
    );
  }
  try {
    await shellApi.openExternal(url);
  } catch (err) {
    throw fail(
      'io',
      `Obsidian could not be started to open ${path.basename(file)}. Check that Obsidian is installed, or use Open to open the file in another app.`,
      err instanceof Error ? err.message : String(err)
    );
  }
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
  assertCanOpen(file, via);
  if (via === 'obsidian') {
    await openInObsidian(file, shellApi);
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

/**
 * What `guidelines:open` does, without Electron: ipc.ts passes the settings,
 * the shipped template's path and `systemShell()`. A file that cannot be
 * opened this way (not `.md` or `.txt`, or a `.txt` one for Obsidian) is
 * refused before `ensureGuidelinesFile` could create it from the template, so
 * a refused open makes nothing; otherwise the file is created when it is
 * missing and then opened (setup.10b).
 */
export async function openGuidelines(
  settings: Settings,
  via: OpenGuidelinesVia,
  template: string,
  shellApi: ShellApi
): Promise<{ path: string; created: boolean }> {
  const target = guidelinesPathFor(settings);
  if (target) assertCanOpen(target, via);
  const info = await ensureGuidelinesFile(settings, template);
  await openGuidelinesFile(info.path, via, shellApi);
  return info;
}
