import path from 'node:path';
import type { Settings } from '../shared/types';
import { fail } from './errors';
import { assertGuidelinesFile, ensureGuidelinesFile } from './guidelines';
import type { ShellApi } from './shellApi';

/**
 * Open the guidelines file in whatever app the system uses for its type
 * (setup.10, polish.3): Obsidian, when the author has made it the app for
 * `.md` files. When no app is set for the type, the file is shown in its
 * folder instead and the author is told why. Only a `.md` or `.txt` file is
 * handed to the system.
 */
export async function openGuidelinesFile(file: string, shellApi: ShellApi): Promise<void> {
  assertGuidelinesFile(file);
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
 * the shipped template's path and `systemShell()`. The file is the one the
 * settings name, never a path from the page. `ensureGuidelinesFile` refuses
 * one that is not `.md` or `.txt` before it makes a folder or copies the
 * template, so a refused open makes nothing; otherwise the file is created
 * when it is missing and then opened (setup.10b, polish.3).
 */
export async function openGuidelines(
  settings: Settings,
  template: string,
  shellApi: ShellApi
): Promise<{ path: string; created: boolean }> {
  const info = await ensureGuidelinesFile(settings, template);
  await openGuidelinesFile(info.path, shellApi);
  return info;
}
