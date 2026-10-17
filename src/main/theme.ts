import { BrowserWindow, nativeTheme } from 'electron';
import { normalizeTheme, windowBackground, type Theme } from '../shared/ui/theme';

/**
 * The Appearance setting in the main process (PLAN 11.3 e, `theme.5`).
 *
 * Electron's `nativeTheme.themeSource` decides three things at once: the
 * renderer's `prefers-color-scheme`, which picks app.css's token block; whether
 * Windows draws the title bar dark; and `shouldUseDarkColors`, which picks the
 * window's own background below. So the theme is set here and nowhere else
 * (PLAN Appendix C, "The theme rides on nativeTheme, not on a data attribute").
 */

/** Paint every window in the background of the theme now in effect. */
function repaintWindows(): void {
  const background = currentWindowBackground();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(background);
  }
}

/**
 * Follow the setting: `system` follows the computer's light or dark mode, the
 * other two pin one. Called before the first window exists, so it opens in the
 * right colours, and after every settings change; a theme already in effect is
 * left alone.
 */
export function applyTheme(theme: Theme): void {
  if (nativeTheme.themeSource === theme) return;
  nativeTheme.themeSource = theme;
  repaintWindows();
}

/**
 * The colour a window is painted before the page draws, for the theme in
 * effect: `--bg` of the light or the dark block of app.css.
 * `shouldUseDarkColors` already follows `themeSource`, and the computer's mode
 * under `system`, so it is the answer `windowBackground` needs.
 */
export function currentWindowBackground(): string {
  return windowBackground(normalizeTheme(nativeTheme.themeSource), nativeTheme.shouldUseDarkColors);
}

let installed = false;

/**
 * Repaint every window when the theme in effect changes, which with `system`
 * means the computer switched between light and dark. Installing twice adds
 * no second listener.
 */
export function installTheme(): void {
  if (installed) return;
  installed = true;
  nativeTheme.on('updated', repaintWindows);
}
