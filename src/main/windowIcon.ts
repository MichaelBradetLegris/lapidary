import path from 'node:path';

/**
 * The window's icon (PLAN `brand.5`, C.92).
 *
 * - Packaged on Windows: none. The window then takes the executable's own
 *   icon, which electron-builder embeds from resources/icon/icon.ico with all
 *   its frames, so the title bar, the taskbar and Alt+Tab each get the frame
 *   drawn for their size. Electron documents leaving `icon` unset for this.
 * - A dev run on Windows: resources/icon/icon.ico from the repository, since
 *   electron.exe's own icon is Electron's. Electron loads an .ico at the
 *   small and the large icon size Windows asks for, so each comes from its own
 *   frame; a PNG would be one bitmap for Windows to shrink.
 * - Anywhere else: no build is made for macOS or Linux (`release.16`,
 *   `release.17`). A packaged copy gets none, as macOS draws the bundle's icon
 *   and ignores the option, and a dev run gets icon-256.png.
 *
 * No electron import, so the rules are unit-tested directly.
 */

export interface WindowIconContext {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** Folders that may be the repository in a dev run; the first that holds the file wins. */
  roots: readonly string[];
  exists: (file: string) => boolean;
}

export function windowIconPath(context: WindowIconContext): string | undefined {
  if (context.packaged) return undefined;
  const file = context.platform === 'win32' ? 'icon.ico' : 'icon-256.png';
  return context.roots
    .map((root) => path.join(root, 'resources', 'icon', file))
    .find((candidate) => context.exists(candidate));
}
