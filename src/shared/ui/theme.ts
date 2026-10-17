/**
 * The Appearance setting (PLAN 11.3 d and e). `system` follows the computer's
 * light or dark mode; the other two pin one. The setting itself landed with the
 * settings module (`hardening.3a`) so every 1.0 key is normalised in one place;
 * `theme.2` added the labels and the window backgrounds.
 */

export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/** What the window is painted in once a theme has been resolved against the computer's mode. */
export type ColorScheme = 'light' | 'dark';

/** The names the Appearance row shows (`theme.7`), in the order of `THEMES`. */
export const THEME_LABELS: Readonly<Record<Theme, string>> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark'
};

/**
 * The colour Electron paints a window before the page has drawn anything, one
 * per scheme. Each must equal that scheme's `--bg` in `src/renderer/styles/app.css`,
 * so no frame of the wrong colour shows while the window opens.
 */
export const WINDOW_BACKGROUND: Readonly<Record<ColorScheme, string>> = {
  light: '#f7f5f1',
  dark: '#1c1a17'
};

export function normalizeTheme(value: unknown): Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
    ? (value as Theme)
    : 'system';
}

/**
 * The window background for a theme. `systemPrefersDark` is whether the
 * computer is in dark mode; only `system` reads it. In the main process,
 * Electron's `nativeTheme.shouldUseDarkColors` gives the same answer for every
 * theme once `themeSource` is set, so it can be passed here as it is.
 */
export function windowBackground(theme: Theme, systemPrefersDark: boolean): string {
  const scheme: ColorScheme = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;
  return WINDOW_BACKGROUND[scheme];
}
