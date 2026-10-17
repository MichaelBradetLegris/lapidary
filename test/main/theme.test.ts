import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, currentWindowBackground, installTheme } from '../../src/main/theme';
import { WINDOW_BACKGROUND } from '../../src/shared/ui/theme';

/* theme.5: the main process sets the theme through Electron's nativeTheme and
   paints every window in the matching --bg (PLAN 11.3 e). Electron is replaced
   by a fake with the same rule as the real one: `shouldUseDarkColors` follows
   `themeSource`, and the computer's mode when the source is `system`. vi.mock
   is hoisted above the imports, so the real Electron module is never loaded. */

const fake = vi.hoisted(() => {
  const listeners: Record<string, (() => void)[]> = {};
  const state = { source: 'system', computerIsDark: false };
  const nativeTheme = {
    get themeSource(): string {
      return state.source;
    },
    set themeSource(value: string) {
      state.source = value;
    },
    get shouldUseDarkColors(): boolean {
      return state.source === 'dark' || (state.source === 'system' && state.computerIsDark);
    },
    on(event: string, listener: () => void): void {
      (listeners[event] ??= []).push(listener);
    }
  };
  const windows: { setBackgroundColor: (colour: string) => void; isDestroyed: () => boolean }[] = [];
  /** The computer switches between light and dark, as Windows' colour setting would. */
  const switchComputer = (dark: boolean): void => {
    state.computerIsDark = dark;
    for (const listener of listeners['updated'] ?? []) listener();
  };
  return { listeners, state, nativeTheme, windows, switchComputer };
});

vi.mock('electron', () => ({
  nativeTheme: fake.nativeTheme,
  BrowserWindow: { getAllWindows: () => fake.windows }
}));

function addWindow(destroyed = false): { painted: string[] } {
  const painted: string[] = [];
  fake.windows.push({ setBackgroundColor: (colour) => painted.push(colour), isDestroyed: () => destroyed });
  return { painted };
}

beforeEach(() => {
  fake.state.source = 'system';
  fake.state.computerIsDark = false;
  fake.windows.length = 0;
});

describe('applyTheme', () => {
  it('sets nativeTheme.themeSource to the setting', () => {
    for (const theme of ['dark', 'light', 'system'] as const) {
      applyTheme(theme);
      expect(fake.nativeTheme.themeSource).toBe(theme);
    }
  });

  it('repaints every open window in the new background, and skips a destroyed one', () => {
    const open = addWindow();
    const gone = addWindow(true);
    applyTheme('dark');
    applyTheme('light');
    expect(open.painted).toEqual([WINDOW_BACKGROUND.dark, WINDOW_BACKGROUND.light]);
    expect(gone.painted).toEqual([]);
  });

  it('leaves a theme already in effect alone, so saving any other setting repaints nothing', () => {
    applyTheme('dark');
    const win = addWindow();
    applyTheme('dark');
    expect(win.painted).toEqual([]);
  });
});

describe('currentWindowBackground', () => {
  it('is the dark --bg when dark is in effect and the light one otherwise', () => {
    applyTheme('dark');
    expect(currentWindowBackground()).toBe(WINDOW_BACKGROUND.dark);
    applyTheme('light');
    fake.state.computerIsDark = true;
    expect(currentWindowBackground()).toBe(WINDOW_BACKGROUND.light);
  });

  it("follows the computer's mode under system", () => {
    applyTheme('system');
    expect(currentWindowBackground()).toBe(WINDOW_BACKGROUND.light);
    fake.state.computerIsDark = true;
    expect(currentWindowBackground()).toBe(WINDOW_BACKGROUND.dark);
  });
});

describe('installTheme', () => {
  it('repaints every window when the computer switches mode, with one listener however often it is installed', () => {
    installTheme();
    installTheme();
    expect(fake.listeners['updated']).toHaveLength(1);
    applyTheme('system');
    const win = addWindow();
    fake.switchComputer(true);
    fake.switchComputer(false);
    expect(win.painted).toEqual([WINDOW_BACKGROUND.dark, WINDOW_BACKGROUND.light]);
  });
});
