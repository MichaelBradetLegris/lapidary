import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_SWITCH_NAMES,
  NO_DEV_SWITCHES,
  getDevSwitches,
  httpUrl,
  readDevSwitches,
  setDevSwitches
} from '../../src/main/devSwitches';
import {
  OCCLUSION_FEATURE,
  backgroundThrottling,
  bringForward,
  chromiumSwitches,
  showWindow,
  type FrontWindow
} from '../../src/main/foreground';

/* hardening.1: development switches are honoured only by development builds. */

const EVERY_SWITCH = {
  MANUSCRIPT_REVIEW_USER_DATA: 'C:/scratch/userdata',
  MANUSCRIPT_REVIEW_OPENAI_BASE_URL: 'http://127.0.0.1:4599/v1',
  MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL: 'http://127.0.0.1:4600',
  MANUSCRIPT_REVIEW_DEV_NO_CLAUDE_CODE: '1',
  MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE: '1.0.1',
  MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW: '1',
  MANUSCRIPT_REVIEW_DEV_SHELL_STUB: '1',
  MREV_VERBOSE: '1'
};

describe('readDevSwitches in a development build', () => {
  it('honours every switch', () => {
    expect(readDevSwitches({ env: EVERY_SWITCH, packaged: false, isolatedUserData: null })).toEqual({
      packaged: false,
      userDataDir: 'C:/scratch/userdata',
      openAiBaseUrl: 'http://127.0.0.1:4599/v1',
      chatGptAuthUrl: 'http://127.0.0.1:4600',
      noClaudeCode: true,
      fakeUpdate: '1.0.1',
      quietWindow: true,
      shellStub: true,
      verbose: true,
      ignored: []
    });
  });

  it('turns everything off when nothing is set', () => {
    expect(readDevSwitches({ env: {}, packaged: false, isolatedUserData: null })).toEqual({
      ...NO_DEV_SWITCHES,
      packaged: false
    });
  });

  it('lets the command-line flag win over the variable', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: false, isolatedUserData: 'D:/flag' });
    expect(s.userDataDir).toBe('D:/flag');
  });

  it('reads "0", "false", "no" and "off" as off, and blank values as unset', () => {
    for (const off of ['0', 'false', 'No', 'OFF', '', '   ']) {
      const s = readDevSwitches({
        env: {
          MREV_VERBOSE: off,
          MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW: off,
          MANUSCRIPT_REVIEW_DEV_SHELL_STUB: off
        },
        packaged: false,
        isolatedUserData: null
      });
      expect(s.verbose).toBe(false);
      expect(s.quietWindow).toBe(false);
      expect(s.shellStub).toBe(false);
    }
    const blank = readDevSwitches({
      env: { MANUSCRIPT_REVIEW_USER_DATA: '  ', MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE: '' },
      packaged: false,
      isolatedUserData: '  '
    });
    expect(blank.userDataDir).toBeNull();
    expect(blank.fakeUpdate).toBeNull();
  });
});

describe('readDevSwitches in a packaged build', () => {
  it('ignores every variable and names the ones it saw', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: true, isolatedUserData: null });
    expect(s).toEqual({ ...NO_DEV_SWITCHES, packaged: true, ignored: [...DEV_SWITCH_NAMES] });
  });

  it('still honours --isolated-user-data', () => {
    const s = readDevSwitches({ env: EVERY_SWITCH, packaged: true, isolatedUserData: 'C:/test-run' });
    expect(s.userDataDir).toBe('C:/test-run');
    expect(s.openAiBaseUrl).toBeNull();
    // A sign-in kept by an installed build always goes to OpenAI's own sign-in server (codex.2).
    expect(s.chatGptAuthUrl).toBeNull();
  });

  it('does not list a variable that is set but blank', () => {
    const s = readDevSwitches({ env: { MREV_VERBOSE: ' ' }, packaged: true, isolatedUserData: null });
    expect(s.ignored).toEqual([]);
  });
});

describe('the ChatGPT sign-in URL switch (codex.2)', () => {
  it('is read as the OpenAI base URL is: http or https only', () => {
    const read = (value: string): string | null =>
      readDevSwitches({
        env: { MANUSCRIPT_REVIEW_CHATGPT_AUTH_URL: value },
        packaged: false,
        isolatedUserData: null
      }).chatGptAuthUrl;
    expect(read(' http://127.0.0.1:4600 ')).toBe('http://127.0.0.1:4600');
    expect(read('file:///C:/x')).toBeNull();
    expect(read('auth.openai.com')).toBeNull();
  });
});

describe('the OpenAI base URL switch', () => {
  it('accepts only absolute http and https URLs', () => {
    expect(httpUrl(' https://example.test/v1 ')).toBe('https://example.test/v1');
    expect(httpUrl('http://127.0.0.1:4599/v1')).toBe('http://127.0.0.1:4599/v1');
    expect(httpUrl('ftp://example.test')).toBeNull();
    expect(httpUrl('file:///C:/x')).toBeNull();
    expect(httpUrl('127.0.0.1:4599')).toBeNull();
    expect(httpUrl('not a url')).toBeNull();
    expect(httpUrl(undefined)).toBeNull();
  });
});

describe('the current switches', () => {
  it('are all off until startup sets them', () => {
    setDevSwitches(NO_DEV_SWITCHES);
    expect(getDevSwitches()).toEqual(NO_DEV_SWITCHES);
    expect(getDevSwitches().packaged).toBe(true);
    const dev = readDevSwitches({ env: { MREV_VERBOSE: '1' }, packaged: false, isolatedUserData: null });
    setDevSwitches(dev);
    expect(getDevSwitches().verbose).toBe(true);
    setDevSwitches(NO_DEV_SWITCHES);
  });
});

/* dev.1: a quiet test window never takes the foreground and keeps rendering
   while it is covered (src/main/foreground.ts, PLAN Appendix C "Quiet test
   windows"). The window check is in PLAN; these pin the rules and the wiring. */

class FakeWindow implements FrontWindow {
  minimized = false;
  readonly calls: string[] = [];
  isMinimized(): boolean {
    return this.minimized;
  }
  restore(): void {
    this.calls.push('restore');
    this.minimized = false;
  }
  show(): void {
    this.calls.push('show');
  }
  /** As Windows' SW_SHOWNOACTIVATE: restores a minimised window, and leaves the focus where it was. */
  showInactive(): void {
    this.calls.push('show inactive');
    this.minimized = false;
  }
  focus(): void {
    this.calls.push('focus');
  }
}

const QUIET = readDevSwitches({
  env: { MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW: '1' },
  packaged: false,
  isolatedUserData: null
});
const USUAL = readDevSwitches({ env: {}, packaged: false, isolatedUserData: null });

describe('the quiet window switch', () => {
  it('is read from MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW in a development build', () => {
    expect(QUIET.quietWindow).toBe(true);
    expect(USUAL.quietWindow).toBe(false);
    expect(DEV_SWITCH_NAMES).toContain('MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW');
  });

  it('is ignored by a packaged build, which names it in the log', () => {
    const s = readDevSwitches({
      env: { MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW: '1' },
      packaged: true,
      isolatedUserData: null
    });
    expect(s.quietWindow).toBe(false);
    expect(s.ignored).toEqual(['MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW']);
    expect(chromiumSwitches(s)).toEqual([]);
    expect(backgroundThrottling(s)).toBe(true);
  });

  it('turns off native occlusion and background throttling only for a quiet window', () => {
    expect(OCCLUSION_FEATURE).toBe('CalculateNativeWinOcclusion');
    expect(chromiumSwitches(QUIET)).toEqual([['disable-features', 'CalculateNativeWinOcclusion']]);
    expect(chromiumSwitches(USUAL)).toEqual([]);
    expect(backgroundThrottling(QUIET)).toBe(false);
    expect(backgroundThrottling(USUAL)).toBe(true);
  });

  it('shows a quiet window without activating it, and the usual one as before', () => {
    const quiet = new FakeWindow();
    showWindow(quiet, true);
    expect(quiet.calls).toEqual(['show inactive']);
    const usual = new FakeWindow();
    showWindow(usual, false);
    expect(usual.calls).toEqual(['show']);
  });

  it('shows a quiet window without the focus and leaves a minimised one minimised; the usual one is restored and focused', () => {
    const quiet = new FakeWindow();
    bringForward(quiet, true);
    expect(quiet.calls).toEqual(['show inactive']);

    // Restoring it, even without activating it, sometimes raised it and once
    // gave it the foreground after a second launch (PLAN C.61).
    const minimised = new FakeWindow();
    minimised.minimized = true;
    bringForward(minimised, true);
    expect(minimised.calls).toEqual([]);
    expect(minimised.minimized).toBe(true);

    const usual = new FakeWindow();
    usual.minimized = true;
    bringForward(usual, false);
    expect(usual.calls).toEqual(['restore', 'show', 'focus']);
    const shown = new FakeWindow();
    bringForward(shown, false);
    expect(shown.calls).toEqual(['show', 'focus']);
  });
});

describe('the quiet window wiring (dev.1)', () => {
  const MAIN = path.join(__dirname, '../../src/main');
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const read = (file: string): string => withoutComments(readFileSync(path.join(MAIN, file), 'utf8'));
  const INDEX = read('index.ts');
  const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    expect(start, from).toBeGreaterThanOrEqual(0);
    return text.slice(start, text.indexOf(to, start));
  };

  it('puts the Chromium switches on the command line at module scope, before ready', () => {
    const append = INDEX.indexOf(
      'for (const [name, value] of chromiumSwitches(switches)) app.commandLine.appendSwitch(name, value);'
    );
    expect(append).toBeGreaterThan(INDEX.indexOf('setDevSwitches(switches);'));
    expect(append).toBeLessThan(INDEX.indexOf('function createWindow('));
    expect(append).toBeLessThan(INDEX.indexOf('function start('));
    expect(append).toBeLessThan(INDEX.indexOf('app.whenReady()'));
  });

  it('builds the window with the switch, and shows it through showWindow', () => {
    const create = between(INDEX, 'function createWindow(): BrowserWindow {', '\n}\n');
    expect(create).toContain('backgroundThrottling: backgroundThrottling(switches)');
    expect(create).toContain('showWindow(win, switches.quietWindow);');
  });

  it('brings the window forward on a second launch through bringForward', () => {
    const handler = between(INDEX, "app.on('second-instance'", '});');
    expect(handler).toContain('bringForward(win, switches.quietWindow);');
  });

  it('shows, restores and focuses the window nowhere but src/main/foreground.ts', () => {
    const files = readdirSync(MAIN, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    const callers = files.filter((f) => /\.(show|showInactive|restore|focus|moveTop)\(\)/.test(read(f)));
    expect(callers).toEqual(['foreground.ts']);
  });

  it('maps dev:clean --quiet to the switch', () => {
    const script = readFileSync(path.join(__dirname, '../../scripts/dev-clean.cjs'), 'utf8');
    expect(script).toMatch(/'--quiet'/);
    expect(script).toContain("env.MANUSCRIPT_REVIEW_DEV_QUIET_WINDOW = '1';");
  });
});
