import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectDiagnostics, findUp, switchWords, type DiagnosticsDeps } from '../../src/main/diagnostics';
import { NO_DEV_SWITCHES } from '../../src/main/devSwitches';
import { readChapter } from '../../src/main/files';
import { runHandler } from '../../src/main/ipcEnvelope';
import { createLogger } from '../../src/main/log';
import { withLogging } from '../../src/main/providers/logged';
import { loadReviewFile } from '../../src/main/reviews';
import type { ReviewProvider } from '../../src/main/providers/types';
import { diagnosticsReport, type DisplayFacts } from '../../src/shared/diagnostics/report';
import type { AppInfo, RuntimeStatus } from '../../src/shared/ipc';
import { normalizeSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';

/* hardening.5: what Copy diagnostics is made from. It reads the last checks
   and never runs one, so opening it logs no ai.runtime; of the manuscript
   folder it reads names and counts: the markers in it or above it, the
   vault's core-plugins.json, how many chapters the list would show, and
   whether the guidelines file is still the template. */

const TEMPLATE = path.resolve(__dirname, '..', '..', 'resources', 'GUIDELINES.default.md');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

let root: string;
let manuscript: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'mrev-diagnostics-'));
  // <root>/OneDrive/Vault/.obsidian, <root>/OneDrive/Vault/.git, and the chapters in Vault/Novel
  const vault = path.join(root, 'OneDrive', 'Vault');
  manuscript = path.join(vault, 'Novel');
  await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await fs.mkdir(path.join(vault, '.git'), { recursive: true });
  await fs.mkdir(path.join(manuscript, 'Part Two'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.obsidian', 'core-plugins.json'),
    '{"file-explorer": true, "sync": true}'
  );
  await fs.writeFile(path.join(manuscript, 'Chapter 01.md'), 'It rained.\n');
  await fs.writeFile(path.join(manuscript, 'Part Two', 'Chapter 02.txt'), 'It stopped.\n');
  await fs.writeFile(path.join(manuscript, 'Drawing.excalidraw.md'), 'not prose\n');
  await fs.writeFile(
    path.join(manuscript, 'GUIDELINES.md'),
    '# My rules\n\n## Style sheet\n\n- Spelling: British\n'
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const display: DisplayFacts = {
  theme: 'system',
  dark: false,
  forcedColors: false,
  zoom: 1,
  scale: 1,
  window: { width: 1440, height: 940, maximized: false },
  gpuCompositing: 'enabled'
};

const info: AppInfo = {
  name: 'Lapidary',
  version: '0.1.0',
  packaged: false,
  electron: '44.3.0',
  chromium: '140.0.7339.80',
  node: '22.19.0',
  platform: 'win32',
  arch: 'x64',
  osRelease: '10.0.26300',
  openai: '7.15.0',
  claudeCode: { state: 'found', version: '2.1.302', onPath: true },
  claudeCodeMin: '2.1.266'
};

function deps(patch: Partial<Settings> = {}, more: Partial<DiagnosticsDeps> = {}): DiagnosticsDeps {
  const settings = normalizeSettings({ manuscriptFolder: manuscript, ...patch });
  return {
    now: () => new Date('2026-10-20T08:30:00.000Z'),
    info: () => Promise.resolve(info),
    settings: () => Promise.resolve(settings),
    lastRuntime: () => null,
    lastFailure: () => null,
    display: () => display,
    userData: path.join(root, 'userdata'),
    switches: NO_DEV_SWITCHES,
    logWriting: () => true,
    warnings: () => [],
    guidelinesTemplate: TEMPLATE,
    ci: process.platform === 'win32',
    ...more
  };
}

describe('collectDiagnostics: the manuscript folder', () => {
  it('counts the chapters the list would show, finds the vault, git and Sync above it, and the cloud folder', async () => {
    const data = await collectDiagnostics(deps());
    expect(data.folders).toMatchObject({
      manuscript,
      // Chapter 01.md and Part Two/Chapter 02.txt; not the drawing or the guidelines file
      chapters: 2,
      vault: 1,
      git: 1,
      obsidianSync: 'on',
      reviewsFolder: path.join(root, 'userdata', 'reviews'),
      reviewsDefault: true,
      reviewsInside: false
    });
    expect(data.folders.cloud).toContain('OneDrive');
    expect(data.folders.chaptersError).toBeUndefined();
  });

  it('finds a marker in the manuscript folder itself, a .git file as a worktree has, and Syncthing by its .stfolder', async () => {
    await fs.mkdir(path.join(manuscript, '.obsidian'));
    await fs.writeFile(path.join(manuscript, '.git'), 'gitdir: ../somewhere\n');
    await fs.mkdir(path.join(root, 'OneDrive', '.stfolder'));
    const data = await collectDiagnostics(deps());
    expect(data.folders.vault).toBe(0);
    expect(data.folders.git).toBe(0);
    // This vault has no core-plugins.json of its own.
    expect(data.folders.obsidianSync).toBe('unknown');
    expect(data.folders.cloud).toEqual(expect.arrayContaining(['OneDrive', 'Syncthing']));
  });

  it('takes a vault only from an .obsidian folder, never a file of that name', async () => {
    await fs.writeFile(path.join(manuscript, '.obsidian'), 'not a config folder');
    const data = await collectDiagnostics(deps());
    expect(data.folders.vault).toBe(1);
    expect(data.folders.obsidianSync).toBe('on');
  });

  it('says a reviews folder chosen inside the manuscript folder is there', async () => {
    const reviews = path.join(manuscript, '.reviews');
    const data = await collectDiagnostics(deps({ reviewsFolder: reviews }));
    expect(data.folders).toMatchObject({
      reviewsFolder: reviews,
      reviewsDefault: false,
      reviewsInside: true
    });
  });

  it("gives the folder's own refusal when the list cannot be read", async () => {
    const gone = path.join(root, 'OneDrive', 'Vault', 'Missing');
    const data = await collectDiagnostics(deps({ manuscriptFolder: gone }));
    expect(data.folders.chapters).toBeNull();
    expect(data.folders.chaptersError).toBe('ENOENT');
  });

  it('with no folder chosen reads nothing of one', async () => {
    const data = await collectDiagnostics(deps({ manuscriptFolder: null }));
    expect(data.folders).toMatchObject({
      manuscript: null,
      chapters: null,
      vault: null,
      git: null,
      cloud: []
    });
    expect(data.guidelines).toEqual({ path: null, chosen: false, state: 'not-chosen' });
  });
});

describe('collectDiagnostics: the guidelines file', () => {
  it('says a file changed from the template is customised, with its length and style sheet', async () => {
    const data = await collectDiagnostics(deps());
    expect(data.guidelines).toEqual({
      path: path.join(manuscript, 'GUIDELINES.md'),
      chosen: false,
      state: 'present',
      customised: true,
      styleSheet: 'filled',
      // the text as the app reads it, the final line break recorded apart (4.6)
      chars: '# My rules\n\n## Style sheet\n\n- Spelling: British'.length
    });
  });

  it('says the template copied in, line endings and blank lines at the ends aside, is not customised', async () => {
    const template = await fs.readFile(TEMPLATE, 'utf8');
    await fs.writeFile(
      path.join(manuscript, 'GUIDELINES.md'),
      `\n${template.replace(/\r?\n/g, '\r\n')}\r\n\r\n`
    );
    const data = await collectDiagnostics(deps());
    expect(data.guidelines).toMatchObject({ state: 'present', customised: false });
  });

  it('tells a file not made yet from one chosen in Settings, and one it could not compare', async () => {
    await fs.rm(path.join(manuscript, 'GUIDELINES.md'));
    expect((await collectDiagnostics(deps())).guidelines).toEqual({
      path: path.join(manuscript, 'GUIDELINES.md'),
      chosen: false,
      state: 'missing'
    });
    const chosen = path.join(root, 'Style.md');
    await fs.writeFile(chosen, 'Rules\n');
    const data = await collectDiagnostics(
      deps({ guidelinesPath: chosen }, { guidelinesTemplate: path.join(root, 'none.md') })
    );
    expect(data.guidelines).toMatchObject({ path: chosen, chosen: true, state: 'present', customised: null });
  });

  it('gives the code of a file it cannot read as UTF-8', async () => {
    await fs.writeFile(
      path.join(manuscript, 'GUIDELINES.md'),
      Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
    );
    const data = await collectDiagnostics(deps());
    expect(data.guidelines.state).toBe('unreadable');
    expect(data.guidelines.error).toEqual(expect.any(String));
  });
});

describe('collectDiagnostics: the last checks, never a new one', () => {
  function fakeClaude(): { provider: ReviewProvider; runs: () => number } {
    let runs = 0;
    const status: RuntimeStatus = {
      provider: 'claude',
      state: 'ready',
      credential: 'subscription',
      executablePath: path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
      cliVersion: '2.1.302',
      minCliVersion: '2.1.266',
      authMethod: 'claude.ai',
      subscriptionType: 'max',
      email: 'ann@example.com',
      message: 'Signed in as ann@example.com',
      checkedAt: '2026-10-20T08:00:00.000Z'
    };
    return {
      runs: () => runs,
      provider: {
        id: 'claude',
        label: 'Claude',
        runtime: () => {
          runs += 1;
          return Promise.resolve(status);
        },
        models: () => Promise.resolve([]),
        review: () => Promise.reject(new Error('no reviews here'))
      }
    };
  }

  it('reads what the last check found, logs no ai.runtime, and the report holds the version but not the email', async () => {
    const events: string[] = [];
    const fake = fakeClaude();
    const logged = withLogging(fake.provider, { log: (_level, event) => events.push(event) });
    await logged.runtime();
    expect(events).toEqual(['ai.runtime']);

    const data = await collectDiagnostics(
      deps(
        {},
        { lastRuntime: (id) => (id === 'claude' ? logged.lastRuntime() : null), lastFailure: () => null }
      )
    );
    const text = diagnosticsReport(data, { home: os.homedir() });
    expect(fake.runs()).toBe(1);
    expect(events).toEqual(['ai.runtime']);
    expect(data.claude).toContain('Claude: ready (subscription)');
    expect(text).toContain('  Claude Code: 2.1.302 at ~');
    expect(text).toContain('  OpenAI package: 7.15.0');
    expect(text).not.toMatch(EMAIL);
    expect(text).not.toContain('Signed in as');
  });

  it('takes the settings, the display, the switches, the log and its warnings as they are', async () => {
    let asked = 0;
    const data = await collectDiagnostics(
      deps(
        { provider: 'chatgpt', chatgptModel: 'gpt-5-mini', effort: 'low' },
        {
          switches: { ...NO_DEV_SWITCHES, packaged: false, quietWindow: true, noClaudeCode: true },
          logWriting: () => false,
          warnings: (n) => {
            asked = n;
            return ['2026-10-20T08:10:00.000Z WARN ipc.failed channel=files:save code=invalid-input'];
          }
        }
      )
    );
    expect(data).toMatchObject({
      madeAt: '2026-10-20T08:30:00.000Z',
      info,
      dataFolder: path.join(root, 'userdata'),
      logWriting: false,
      display,
      settings: { provider: 'chatgpt', model: 'default', chatgptModel: 'gpt-5-mini', effort: 'low' },
      switches: ['no Claude Code', 'quiet window'],
      claude: ['Claude: not checked yet'],
      chatgpt: { runtime: null, lastFailure: null }
    });
    // The OpenAI API key's part went with that provider (codex.6).
    expect(data).not.toHaveProperty('openai');
    expect(data.settings).not.toHaveProperty('openaiModel');
    expect(asked).toBe(10);
    expect(data.warnings).toHaveLength(1);
  });

  it('names no chapter when a read, a save or a review load has failed, though the log does (hardening.5 review)', async () => {
    // A chapter saved as UTF-16, and one renamed in Obsidian since the list was read.
    const utf16 = path.join(manuscript, 'Chapter 07 - The Secret Title.md');
    await fs.writeFile(utf16, Buffer.from('﻿The secret chapter.\r\n', 'utf16le'));
    const renamed = path.join(manuscript, 'Secret Heron Chapter.md');
    const review = path.join(
      root,
      'userdata',
      'reviews',
      'secret-heron-chapter',
      'Secret Heron Chapter.review.json'
    );
    const logger = createLogger({
      dir: path.join(root, 'logs'),
      home: os.homedir(),
      schedule: () => undefined
    });
    const log = (...args: Parameters<typeof logger.log>): void => logger.log(...args);
    const failed = [
      await runHandler('files:read', { path: utf16 }, () => readChapter(utf16), log),
      await runHandler('files:read', { path: renamed }, () => readChapter(renamed), log),
      await runHandler('reviews:load', { path: review }, () => loadReviewFile(review), log)
    ];
    expect(failed.map((r) => (r.ok ? 'ok' : r.error.code))).toEqual(['not-utf8', 'io', 'io']);
    const data = await collectDiagnostics(deps({}, { warnings: (n) => logger.tail(n, 'warn') }));
    // The log holds the page's sentences, which name them.
    expect(data.warnings.join('\n')).toContain('Chapter 07 - The Secret Title.md is saved as UTF-16');
    expect(data.warnings.join('\n')).toContain('Secret Heron Chapter');
    const text = diagnosticsReport(data, { home: os.homedir() });
    expect(text).toMatch(/ WARN ipc\.failed channel=files:read code=not-utf8\n/);
    expect(text).toMatch(/ WARN ipc\.failed channel=reviews:load code=io\n/);
    expect(text).not.toMatch(/Secret|Heron|Chapter 0|UTF-16/i);
  });
});

describe('switchWords', () => {
  it('names each switch in effect, and none in an installed build without the flag', () => {
    expect(switchWords(NO_DEV_SWITCHES)).toEqual([]);
    expect(
      switchWords({
        packaged: false,
        userDataDir: 'D:\\scratch',
        openAiBaseUrl: 'http://127.0.0.1:4599/v1',
        chatGptAuthUrl: 'http://127.0.0.1:4600',
        noClaudeCode: true,
        fakeUpdate: '1.0.1',
        quietWindow: true,
        shellStub: true,
        verbose: true,
        ignored: []
      })
    ).toEqual([
      'isolated user data',
      'OpenAI base URL',
      'ChatGPT sign-in URL',
      'no Claude Code',
      'fake update 1.0.1',
      'quiet window',
      'shell stub',
      'verbose'
    ]);
    expect(
      switchWords({ ...NO_DEV_SWITCHES, ignored: ['MANUSCRIPT_REVIEW_USER_DATA', 'MREV_VERBOSE'] })
    ).toEqual(['ignored MANUSCRIPT_REVIEW_USER_DATA, MREV_VERBOSE']);
  });
});

describe('findUp', () => {
  it('counts folders up from the start, and asks for a folder when told to', async () => {
    const deep = path.join(manuscript, 'Part Two');
    expect(await findUp(deep, '.obsidian', true)).toEqual({
      depth: 2,
      dir: path.join(root, 'OneDrive', 'Vault')
    });
    await fs.writeFile(path.join(manuscript, '.obsidian'), 'a file, not the config folder');
    expect((await findUp(deep, '.obsidian', true))?.depth).toBe(2);
    expect((await findUp(deep, '.obsidian', false))?.depth).toBe(1);
  });

  it('finds nothing in the tree when nothing is there', async () => {
    const found = await findUp(manuscript, '.no-such-marker-anywhere', false);
    expect(found).toBeNull();
  });
});
