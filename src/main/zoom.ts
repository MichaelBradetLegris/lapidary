import { BrowserWindow } from 'electron';
import { nextZoom, type ZoomAction } from '../shared/ui/zoom';
import { loggableErrorFields } from '../shared/diagnostics/redact';
import { log } from './log';
import { loadSettings, saveSettings } from './settings';

/**
 * Window zoom (round 5). The main process is the one place that decides it:
 * the status bar buttons, Ctrl+plus / minus / 0 and Ctrl+wheel all come here,
 * the level is kept in settings, and it is put back after every load.
 *
 * The keys are caught before the page sees them, so they work wherever the
 * focus is, including inside a paragraph editor. Ctrl+wheel reaches us as
 * Electron's `zoom-changed` event, which Electron reports but does not act on.
 */

/** Step or reset the zoom, remember it, apply it everywhere, and tell the page. */
export async function changeZoom(action: ZoomAction): Promise<number> {
  const settings = await loadSettings();
  const zoom = nextZoom(settings.zoom, action);
  // A zoom that cannot be remembered still applies to this session.
  if (zoom !== settings.zoom) {
    await saveSettings({ zoom }).catch((err: unknown) => {
      log('warn', 'zoom.save-failed', loggableErrorFields(err));
    });
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.setZoomFactor(zoom);
    win.webContents.send('view:zoom-changed', { zoom });
  }
  return zoom;
}

function actionForKey(key: string): ZoomAction | null {
  if (key === '=' || key === '+') return 'in';
  if (key === '-' || key === '_') return 'out';
  if (key === '0') return 'reset';
  return null;
}

export function installZoom(win: BrowserWindow): void {
  const contents = win.webContents;

  // A reload (Ctrl+R in development) or the first load starts at normal size.
  contents.on('did-finish-load', () => {
    void loadSettings().then((settings) => {
      if (!contents.isDestroyed()) contents.setZoomFactor(settings.zoom);
    });
  });

  contents.on('zoom-changed', (_event, direction) => {
    void changeZoom(direction === 'in' ? 'in' : 'out');
  });

  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || !(input.control || input.meta)) return;
    const action = actionForKey(input.key);
    if (!action) return;
    event.preventDefault();
    void changeZoom(action);
  });
}
