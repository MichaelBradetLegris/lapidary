import { BrowserWindow } from 'electron';
import type { AppNotice } from '../shared/ipc';

/**
 * Ask every window to show a card (`app:notice`, setup.7a). The renderer shows
 * it under the key `main-notice`, so a newer notice replaces an older one rather
 * than stacking. For things only main knows about: an error it survived, an
 * update, a backup that could not be written.
 */
export function sendNotice(notice: AppNotice): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app:notice', notice);
  }
}
