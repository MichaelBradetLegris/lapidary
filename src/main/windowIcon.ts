import path from 'node:path';

/**
 * The window's icon (PLAN `brand.5`, C.92).
 *
 * On Windows the window is always given icon.ico, from which Electron loads
 * the frame for the small icon size (the title bar, 16 px at 100%) and the
 * one for the large size (32 px at 100%). A window given no icon keeps the
 * class icons Electron registers, the executable's icon loaded once at the
 * large size for both, so its title bar would show the 32 px frame shrunk to
 * 16 px, and a PNG would likewise be one bitmap for Windows to shrink.
 *
 * - Packaged on Windows: resources/icon.ico beside the asar, which
 *   electron-builder copies there (`extraResources`). The executable embeds
 *   the same file for File Explorer, the Start menu and the shortcuts.
 * - A dev run on Windows: resources/icon/icon.ico from the repository.
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
  /** `process.resourcesPath`: the folder beside the executable that holds the asar. */
  resourcesPath: string;
  exists: (file: string) => boolean;
}

/** The file name `extraResources` gives the .ico beside the asar (electron-builder.config.cjs). */
export const PACKAGED_ICON = 'icon.ico';

export function windowIconPath(context: WindowIconContext): string | undefined {
  if (context.packaged) {
    if (context.platform !== 'win32') return undefined;
    const file = path.join(context.resourcesPath, PACKAGED_ICON);
    return context.exists(file) ? file : undefined;
  }
  const file = context.platform === 'win32' ? 'icon.ico' : 'icon-256.png';
  return context.roots
    .map((root) => path.join(root, 'resources', 'icon', file))
    .find((candidate) => context.exists(candidate));
}
