import path from 'node:path';
import { APP_NAME } from '../shared/branding';
import { fail } from './errors';
import type { ShellApi } from './shellApi';

/*
 * About's Licences and notices (`release.9`, `app:open-notices`). The notices
 * that `npm run notices` writes (scripts/third-party-notices.ts, opensource.5)
 * list every package the app ships with its licence, and point at the app's
 * own LICENSE.txt beside them. An installed build has them beside the asar,
 * where electron-builder's `extraResources` copies them; a development run
 * has them in `out/` once `npm run notices` has run, and not before.
 *
 * The file is opened with the shell's `openPath`, in the system's app for .txt
 * files, and shown in its folder when no app is set for them, as Show the
 * text does for a set-aside draft. Under `dev:clean --shell-stub` nothing is
 * opened (`systemShell`, setup.10b). No electron import, so
 * test/main/notices.test.ts drives it.
 */

/** The file's name, beside the asar and in `out/`. electron-builder.config.cjs copies it under this name. */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

export interface NoticesPlace {
  packaged: boolean;
  /** `process.resourcesPath` */
  resourcesPath: string;
  /** `app.getAppPath()`: the project folder in a development run */
  appPath: string;
}

/** Where the notices are: beside the asar once installed, in `out/` in a development run. */
export function noticesPath(place: NoticesPlace): string {
  return place.packaged
    ? path.join(place.resourcesPath, NOTICES_FILE)
    : path.join(place.appPath, 'out', NOTICES_FILE);
}

export interface OpenNoticesDeps extends NoticesPlace {
  exists: (file: string) => boolean;
  shell: ShellApi;
}

/**
 * Open the notices, or show them in their folder when no app opens .txt
 * files. A missing file is `not-found`, in words that say how to get it back.
 */
export async function openNotices(deps: OpenNoticesDeps): Promise<{ path: string }> {
  const file = noticesPath(deps);
  if (!deps.exists(file)) {
    throw fail(
      'not-found',
      deps.packaged
        ? `${NOTICES_FILE} is missing from ${APP_NAME}'s folder. Installing ${APP_NAME} again puts it back.`
        : `This development run has no ${NOTICES_FILE} yet: npm run notices writes it into the out folder.`
    );
  }
  const problem = await deps.shell.openPath(file);
  if (problem) deps.shell.showItemInFolder(file);
  return { path: file };
}
