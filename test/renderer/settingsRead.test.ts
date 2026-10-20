import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_FILE, createSettingsStore, settingsAnswer } from '../../src/main/settingsStore';
import { PRO_PRESELECT_HINT, proPreselection } from '../../src/shared/ai/claudeModels';
import type { Settings } from '../../src/shared/types';
import { SAVE_HINT_ID } from '../../src/shared/ui/saveHint';
import { welcomeShown } from '../../src/shared/ui/welcome';
import { createHints } from '../../src/renderer/state/hints';
import { readSettings, useSettingsRead, type SettingsReadIo } from '../../src/renderer/state/settingsRead';
import { createSplitWrites } from '../../src/renderer/state/split';
import { useApp } from '../../src/renderer/state/store';
import { reopenWelcome, type WelcomeIo } from '../../src/renderer/state/welcome';

/* hardening.15: while settings.json cannot be read, the page is told so and
   holds no settings. Before, it was handed the defaults: it showed the welcome
   guide with no folder chosen, and once the file could be read again the Pro
   preselection, a hint put away or Show the welcome guide again wrote a model
   or a list of hints built from the defaults over the author's (seen in a
   window by the hardening.12 review fix, PLAN C.86). Here the page's side runs
   in node against main's real settings store over a scratch folder, its reads
   refused with EBUSY while the file is "held"; App's wiring is checked from
   its source at the end, and the card as drawn in
   settingsUnreadable.render.test.ts. */

const AUTHOR = `${JSON.stringify(
  {
    manuscriptFolder: 'C:\\Novel', // check-public: allow
    model: 'opus',
    effort: 'medium',
    onboardingDone: true,
    dismissedHints: [SAVE_HINT_ID]
  },
  null,
  2
)}\n`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  useApp.setState({ settings: null, welcomeClosed: false });
  useSettingsRead.setState({ failed: false, trying: false, failedAgain: false });
});

function busy(): Error {
  return Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
}

/**
 * Main as the page meets it: `settings:get` and `settings:set` over the real
 * store, on a scratch settings.json holding the author's settings, whose
 * reads fail while `held` is true. Every patch the page sends is recorded,
 * whether or not main takes it.
 */
function main(): {
  file: string;
  hold: (on: boolean) => void;
  io: SettingsReadIo & WelcomeIo;
  patches: Partial<Settings>[];
  bytes: () => string;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lapidary-settings-read-'));
  dirs.push(dir);
  const file = path.join(dir, SETTINGS_FILE);
  writeFileSync(file, AUTHOR);
  let held = true;
  const store = createSettingsStore({
    dir,
    sleep: () => Promise.resolve(),
    readFile: (f) => (held ? Promise.reject(busy()) : Promise.resolve(readFileSync(f, 'utf8')))
  });
  const patches: Partial<Settings>[] = [];
  return {
    file,
    hold: (on) => {
      held = on;
    },
    io: {
      getSettings: async () => settingsAnswer(await store.loadChecked()),
      setSettings: (patch) => {
        patches.push(patch);
        return store.save(patch);
      }
    },
    patches,
    bytes: () => readFileSync(file, 'utf8')
  };
}

const state = () => useApp.getState();

describe('while settings.json cannot be read (hardening.15)', () => {
  it('the page holds no settings, so the welcome guide does not show and the card does', async () => {
    const m = main();
    expect(await readSettings(m.io)).toBe(false);
    expect(state().settings).toBeNull();
    expect(useSettingsRead.getState()).toEqual({ failed: true, trying: false, failedAgain: false });
    expect(welcomeShown(state().settings, state().welcomeClosed)).toBe(false);
    expect(m.bytes()).toBe(AUTHOR);
  });

  it('a hint put away, the split and Show the welcome guide again send nothing', async () => {
    const m = main();
    await readSettings(m.io);
    const hints = createHints();
    await hints.dismiss(SAVE_HINT_ID, m.io);
    await hints.dismiss(PRO_PRESELECT_HINT, m.io);
    await createSplitWrites().save(0.4, m.io);
    await reopenWelcome(m.io);
    expect(m.patches).toEqual([]);
    expect(state().settings).toBeNull();
    // Even once the file can be read again, nothing is left waiting to go over it.
    m.hold(false);
    await hints.flush();
    expect(m.patches).toEqual([]);
    expect(m.bytes()).toBe(AUTHOR);
  });

  it('Try again says the file still cannot be read, and is held while it reads', async () => {
    const m = main();
    await readSettings(m.io);
    const again = readSettings(m.io, true);
    expect(useSettingsRead.getState().trying).toBe(true);
    expect(await again).toBe(false);
    expect(useSettingsRead.getState()).toEqual({ failed: true, trying: false, failedAgain: true });
    expect(state().settings).toBeNull();
  });

  it('the first read, even twice as StrictMode runs the effect, never says "still"', async () => {
    const m = main();
    await Promise.all([readSettings(m.io), readSettings(m.io)]);
    expect(useSettingsRead.getState()).toEqual({ failed: true, trying: false, failedAgain: false });
  });

  it("once it can be read, Try again gives the page the author's settings, and nothing is written", async () => {
    const m = main();
    await readSettings(m.io);
    await readSettings(m.io, true);
    m.hold(false);
    expect(await readSettings(m.io, true)).toBe(true);
    expect(useSettingsRead.getState()).toEqual({ failed: false, trying: false, failedAgain: false });
    const settings = state().settings!;
    expect(settings).toMatchObject({
      manuscriptFolder: 'C:\\Novel', // check-public: allow
      model: 'opus',
      effort: 'medium',
      onboardingDone: true,
      dismissedHints: [SAVE_HINT_ID]
    });
    // No first run: no guide, so a check that finds Claude ready on Pro preselects nothing.
    const guide = welcomeShown(settings, state().welcomeClosed);
    expect(guide).toBe(false);
    expect(proPreselection(settings, 'pro', guide)).toBeNull();
    expect(m.patches).toEqual([]);
    expect(m.bytes()).toBe(AUTHOR);
  });

  it("a hint put away after that adds to the author's list, keeping the model", async () => {
    const m = main();
    await readSettings(m.io);
    m.hold(false);
    await readSettings(m.io, true);
    await createHints().dismiss(PRO_PRESELECT_HINT, m.io);
    expect(m.patches).toEqual([{ dismissedHints: [SAVE_HINT_ID, PRO_PRESELECT_HINT] }]);
    expect(JSON.parse(m.bytes())).toMatchObject({
      model: 'opus',
      effort: 'medium',
      dismissedHints: [SAVE_HINT_ID, PRO_PRESELECT_HINT]
    });
  });

  it('a settings file that reads gives the page its settings at once, with no card', async () => {
    const m = main();
    m.hold(false);
    expect(await readSettings(m.io)).toBe(true);
    expect(state().settings?.model).toBe('opus');
    expect(useSettingsRead.getState().failed).toBe(false);
  });

  it('a request that fails changes nothing, and lets Try again be pressed again', async () => {
    const m = main();
    await readSettings(m.io);
    const failing: SettingsReadIo = { getSettings: () => Promise.reject(new Error('no answer')) };
    await expect(readSettings(failing, true)).rejects.toThrow('no answer');
    expect(useSettingsRead.getState()).toEqual({ failed: true, trying: false, failedAgain: false });
    expect(state().settings).toBeNull();
  });
});

/* The wiring, from the source, as the tests run without a DOM. */
describe("App's and main's wiring (hardening.15)", () => {
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const APP = withoutComments(readFileSync(path.join(__dirname, '../../src/renderer/App.tsx'), 'utf8'));
  const IPC = withoutComments(readFileSync(path.join(__dirname, '../../src/main/ipc.ts'), 'utf8'));

  it('asks for the settings only through readSettings, as the page loads and from Try again', () => {
    expect(APP.match(/call\('settings:get'/g)).toHaveLength(1);
    expect(APP).toMatch(
      /const SETTINGS_READ_IO: SettingsReadIo = \{\s*getSettings: \(\) => call\('settings:get', undefined\)\s*\};/
    );
    expect(APP).toMatch(
      /void readSettings\(SETTINGS_READ_IO, again\)\s*\.then\(\(read\) => \{\s*if \(read\) refreshFiles\(\);\s*\}\)\s*\.catch\(fail\);/
    );
    expect(APP).toMatch(/useEffect\(\(\) => \{\s*loadSettings\(false\);\s*\}, \[loadSettings\]\);/);
    expect(APP).toContain('onTryAgain={() => loadSettings(true)}');
  });

  it('shows the card in place of every other layout while there are no settings', () => {
    const card = APP.indexOf('if (settingsReadFailed && settings === null) {');
    expect(card).toBeGreaterThan(APP.indexOf('const inert = shellInert('));
    expect(card).toBeLessThan(APP.indexOf('if (singleScreen) {'));
    const layout = APP.slice(card, APP.indexOf('if (singleScreen) {'));
    expect(layout).toMatch(
      /<SettingsUnreadable\s+trying=\{settingsTrying\}\s+failedAgain=\{settingsFailedAgain\}\s+onTryAgain=/
    );
    for (const absent of ['<Toolbar', '{toolbar}', '<StatusBar', '<WelcomeScreen', '<FileList', 'Dialog}']) {
      expect(layout).not.toContain(absent);
    }
  });

  it('makes the Pro preselection only with settings in', () => {
    expect(APP).toContain("if (!settings || claudeRuntime?.state !== 'ready') return;");
  });

  it("main answers settings:get with settingsAnswer, starting the watcher and the author's theme and zoom only after a read that worked", () => {
    const handler = IPC.slice(IPC.indexOf("handle('settings:get'"), IPC.indexOf("handle('settings:set'"));
    expect(handler).toMatch(
      /const read = await loadSettingsChecked\(\);\s*if \(!read\.readFailed\) \{\s*startWatching\(read\.settings\.manuscriptFolder\);\s*applyTheme\(read\.settings\.theme\);\s*applyZoom\(read\.settings\.zoom\);\s*\}\s*return settingsAnswer\(read\);/
    );
  });
});
