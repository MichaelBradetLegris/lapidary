import { describe, expect, it } from 'vitest';
import {
  THEMES,
  THEME_LABELS,
  WINDOW_BACKGROUND,
  normalizeTheme,
  windowBackground
} from '../../src/shared/ui/theme';
import { APP_CSS, SCHEMES, tokenBlocks } from '../helpers/themeTokens';

/* theme.2: the Appearance setting's values, labels and window backgrounds (PLAN 11.3 d and e). */

const BLOCKS = tokenBlocks(APP_CSS);

describe('THEMES', () => {
  it('lists system, light and dark, with the default first', () => {
    expect(THEMES).toEqual(['system', 'light', 'dark']);
  });
});

describe('THEME_LABELS', () => {
  it('names each theme as the Appearance row shows it', () => {
    expect(THEME_LABELS).toEqual({ system: 'Match system', light: 'Light', dark: 'Dark' });
  });

  it('has a label for every theme and no others', () => {
    expect(Object.keys(THEME_LABELS).sort()).toEqual([...THEMES].sort());
  });
});

describe('WINDOW_BACKGROUND', () => {
  it('holds the two backgrounds as #rrggbb, the form Electron takes', () => {
    expect(WINDOW_BACKGROUND).toEqual({ light: '#f7f5f1', dark: '#1c1a17' });
    for (const value of Object.values(WINDOW_BACKGROUND)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("paints each window in its theme's --bg, so no other colour shows before the page (theme.5)", () => {
    for (const scheme of SCHEMES) expect(BLOCKS[scheme].tokens.get('--bg')).toBe(WINDOW_BACKGROUND[scheme]);
  });
});

describe('normalizeTheme', () => {
  it('keeps each of the three themes', () => {
    for (const theme of THEMES) expect(normalizeTheme(theme)).toBe(theme);
  });

  it('turns anything else into system', () => {
    for (const value of [undefined, null, '', 'Dark', ' dark', 'auto', 'toString', 1, true, {}, ['dark']]) {
      expect(normalizeTheme(value)).toBe('system');
    }
  });
});

describe('windowBackground', () => {
  it('follows the computer for system', () => {
    expect(windowBackground('system', false)).toBe(WINDOW_BACKGROUND.light);
    expect(windowBackground('system', true)).toBe(WINDOW_BACKGROUND.dark);
  });

  it('ignores the computer when a theme is pinned', () => {
    for (const systemPrefersDark of [false, true]) {
      expect(windowBackground('light', systemPrefersDark)).toBe(WINDOW_BACKGROUND.light);
      expect(windowBackground('dark', systemPrefersDark)).toBe(WINDOW_BACKGROUND.dark);
    }
  });
});
