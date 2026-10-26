import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_LINE,
  REPORT_PROMISE,
  REPORT_TITLE,
  cloudHints,
  diagnosticsReport,
  obsidianSyncState,
  reportSections,
  systemName,
  warningLine,
  type DiagnosticsData
} from '../../src/shared/diagnostics/report';
import type { RuntimeStatus } from '../../src/shared/ipc';

/* hardening.5: the text Copy diagnostics puts on the clipboard. It holds
   the versions, settings and last checks, paths with the home folder as ~,
   and never an email address, a key, a token or a status message, whatever
   the facts it is given carry. */

const HOME = 'C:\\Users\\Ann'; // check-public: allow
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const KEY = /sk-[A-Za-z0-9_-]{16,}/;
const DUMMY_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'; // check-public: allow

/** The ChatGPT sign-in as its last check found it (codex.3): a message that must never reach the report. */
const chatGptRuntime: RuntimeStatus = {
  provider: 'chatgpt',
  state: 'ready',
  plan: 'Plus',
  checkedAt: '2026-10-20T08:00:00.000Z',
  message: 'Signed in as ann@example.com with a secret note',
  email: 'ann@example.com'
};

function data(patch: Partial<DiagnosticsData> = {}): DiagnosticsData {
  return {
    madeAt: '2026-10-20T08:30:00.000Z',
    info: {
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
    },
    switches: [],
    dataFolder: `${HOME}\\AppData\\Roaming\\ai-grammar-checker`,
    logWriting: true,
    display: {
      theme: 'system',
      dark: true,
      forcedColors: false,
      zoom: 1,
      scale: 1.5,
      window: { width: 1440, height: 940, maximized: false },
      gpuCompositing: 'enabled'
    },
    settings: { provider: 'claude', model: 'default', chatgptModel: '', effort: 'high' },
    claude: [
      'Claude: ready (subscription)',
      `Claude Code: 2.1.302 at ${HOME}\\.local\\bin\\claude.exe`,
      'Claude Code minimum: 2.1.266',
      'Auth method: claude.ai',
      'Plan: max',
      'Checked: 2026-10-20T08:00:00.000Z',
      'Last failure: none'
    ],
    chatgpt: { runtime: chatGptRuntime, lastFailure: null },
    folders: {
      manuscript: `${HOME}\\OneDrive\\Vault\\Novel`,
      chapters: 12,
      vault: 1,
      git: 0,
      obsidianSync: 'on',
      cloud: ['OneDrive'],
      reviewsFolder: `${HOME}\\AppData\\Roaming\\ai-grammar-checker\\reviews`,
      reviewsDefault: true,
      reviewsInside: false
    },
    guidelines: {
      path: `${HOME}\\OneDrive\\Vault\\Novel\\GUIDELINES.md`,
      chosen: false,
      state: 'present',
      customised: true,
      styleSheet: 'filled',
      chars: 4868
    },
    warnings: [
      '2026-10-20T08:10:00.000Z WARN ipc.failed channel=files:save code=invalid-input message="Not a chapter"'
    ],
    ...patch
  };
}

describe('systemName', () => {
  it('tells Windows 11 from Windows 10 by the build, since both call themselves 10.0', () => {
    expect(systemName('win32', '10.0.26300')).toBe('Windows 11 (10.0.26300)');
    expect(systemName('win32', '10.0.22000')).toBe('Windows 11 (10.0.22000)');
    expect(systemName('win32', '10.0.19045')).toBe('Windows 10 (10.0.19045)');
    expect(systemName('win32', '6.3.9600')).toBe('Windows 6.3.9600');
  });

  it('names macOS by its Darwin release and Linux by its kernel', () => {
    expect(systemName('darwin', '24.1.0')).toBe('macOS (Darwin 24.1.0)');
    expect(systemName('linux', '6.8.0-45-generic')).toBe('Linux 6.8.0-45-generic');
    expect(systemName('freebsd', '14.1')).toBe('freebsd 14.1');
  });
});

describe('obsidianSyncState', () => {
  it('reads the object Obsidian 1.4 and later writes, every core plugin with whether it is on', () => {
    expect(obsidianSyncState('{"file-explorer": true, "sync": true}')).toBe('on');
    expect(obsidianSyncState('{"file-explorer": true, "sync": false}')).toBe('off');
  });

  it('reads the list of plugins that are on that earlier versions wrote', () => {
    expect(obsidianSyncState('["file-explorer", "sync"]')).toBe('on');
    expect(obsidianSyncState('["file-explorer", "search"]')).toBe('off');
  });

  it('says unknown with no file, a file that is not JSON, or an object without the key', () => {
    expect(obsidianSyncState(null)).toBe('unknown');
    expect(obsidianSyncState('{"sync": tru')).toBe('unknown');
    expect(obsidianSyncState('{"file-explorer": true}')).toBe('unknown');
    expect(obsidianSyncState('{"sync": "yes"}')).toBe('unknown');
    expect(obsidianSyncState('42')).toBe('unknown');
  });
});

describe('cloudHints', () => {
  it('finds the folders sync tools make, in any part of the path and either slash', () => {
    expect(cloudHints('C:\\Users\\Ann\\OneDrive\\Vault')).toEqual(['OneDrive']); // check-public: allow
    expect(cloudHints('C:\\Users\\Ann\\OneDrive - Contoso\\Novel')).toEqual(['OneDrive']); // check-public: allow
    expect(cloudHints('C:/Users/Ann/Dropbox (Personal)/Novel')).toEqual(['Dropbox']); // check-public: allow
    expect(cloudHints('C:\\Users\\Ann\\iCloudDrive\\Novel')).toEqual(['iCloud Drive']); // check-public: allow
    const mac = '/Users/ann/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault'; // check-public: allow
    expect(cloudHints(mac)).toEqual(['iCloud Drive']);
    expect(cloudHints('G:\\My Drive\\Novel')).toEqual(['Google Drive']);
    expect(cloudHints('C:\\Users\\Ann\\Box\\Novel')).toEqual(['Box']); // check-public: allow
    expect(cloudHints('/home/ann/Nextcloud/Novel')).toEqual(['Nextcloud']); // check-public: allow
  });

  it('matches whole folder names only, and names each tool once, in a fixed order', () => {
    expect(cloudHints('D:\\Novels\\OneDriveNotes\\Dropboxes')).toEqual([]);
    expect(cloudHints('D:\\Dropbox\\OneDrive\\Dropbox')).toEqual(['OneDrive', 'Dropbox']);
    expect(cloudHints('')).toEqual([]);
  });
});

describe('diagnosticsReport', () => {
  const text = diagnosticsReport(data(), { home: HOME });

  it('starts with the title, what it leaves out and when it was made, then the sections in order', () => {
    const lines = text.split('\n');
    expect(lines.slice(0, 3)).toEqual([REPORT_TITLE, REPORT_PROMISE, 'Made: 2026-10-20T08:30:00.000Z']);
    const titles = ['App', 'Display', 'Reviews', 'Claude', 'ChatGPT', 'Manuscript folder', 'Recent warnings'];
    expect(reportSections(data()).map((s) => s.title)).toEqual(titles);
    let at = 0;
    for (const title of titles) {
      const next = lines.indexOf(title, at);
      expect(next, title).toBeGreaterThan(at);
      expect(lines[next - 1], `a blank line before ${title}`).toBe('');
      at = next;
    }
    expect(text.endsWith('\n')).toBe(true);
  });

  it('holds the versions: the app, Electron, the openai package and the Claude Code found', () => {
    expect(text).toContain('  Lapidary: 0.1.0, development run');
    expect(text).toContain('  Electron: 44.3.0 (Chromium 140.0.7339.80, Node 22.19.0)');
    expect(text).toContain('  OpenAI package: 7.15.0');
    expect(text).toContain('  Claude Code: 2.1.302, found by name in a terminal');
    expect(text).toContain('  System: Windows 11 (10.0.26300), x64');
  });

  it('writes the home folder as ~ wherever a path holds it', () => {
    expect(text).not.toMatch(/C:\\Users\\Ann/i); // check-public: allow
    expect(text).toContain('  Data folder: ~\\AppData\\Roaming\\ai-grammar-checker');
    expect(text).toContain('  Claude Code: 2.1.302 at ~\\.local\\bin\\claude.exe');
    expect(text).toContain('  Folder: ~\\OneDrive\\Vault\\Novel');
    expect(text).toContain('  Guidelines file: ~\\OneDrive\\Vault\\Novel\\GUIDELINES.md');
  });

  it("never holds the account's email or a status message", () => {
    expect(text).not.toMatch(EMAIL);
    expect(text).not.toContain('secret note');
    expect(text).toContain('  ChatGPT: ready');
    expect(text).toContain('  Plan: Plus');
  });

  it('has no part for an OpenAI API key, the provider codex.6 took out', () => {
    expect(text.split('\n')).not.toContain('OpenAI');
    expect(text).not.toContain('Key:');
    expect(text).not.toContain('OpenAI model');
    // The package ChatGPT's reviews go through is still named.
    expect(text).toContain('  OpenAI package: 7.15.0');
  });

  it('scrubs an email address or a key shape that reached a line, as the log does', () => {
    const leaky = diagnosticsReport(
      data({
        claude: ['Claude: ready (subscription)', 'Plan: max for ann@example.com'],
        warnings: [`2026-10-20T08:10:00.000Z WARN odd.event code=${DUMMY_KEY} name=ann@example.com`]
      }),
      { home: HOME }
    );
    expect(leaky).not.toMatch(EMAIL);
    expect(leaky).not.toMatch(KEY);
    expect(leaky).toContain('Plan: max for [email]');
    expect(leaky).toContain('WARN odd.event code=[key] name=[email]');
  });

  it('cuts a line that runs too long', () => {
    const long = diagnosticsReport(data({ claude: [`Claude Code: ${'y'.repeat(2000)}`] }));
    for (const line of long.split('\n')) expect(line.length).toBeLessThanOrEqual(MAX_REPORT_LINE);
    expect(long).toContain('…');
  });

  it('says how the window is drawn: theme, contrast, zoom, scale, size and GPU', () => {
    expect(text).toContain('  Appearance: Match system, dark colours in use');
    expect(text).toContain('  Contrast theme: off');
    expect(text).toContain('  Zoom: 100%');
    expect(text).toContain('  Display scale: 150%');
    expect(text).toContain('  Window: 1440 x 940 inside');
    expect(text).toContain('  GPU compositing: enabled');
    const zoomed = diagnosticsReport(
      data({
        display: {
          theme: 'light',
          dark: false,
          forcedColors: true,
          zoom: 1.25,
          scale: null,
          window: { width: 1000, height: 800, maximized: true },
          gpuCompositing: null
        }
      })
    );
    expect(zoomed).toContain('  Appearance: Light, light colours in use');
    expect(zoomed).toContain('  Contrast theme: on');
    expect(zoomed).toContain('  Zoom: 125%');
    expect(zoomed).toContain('  Display scale: unknown');
    expect(zoomed).toContain('  Window: 1000 x 800 inside, 800 x 640 at this zoom, maximised');
    expect(zoomed).toContain('  GPU compositing: unknown');
    expect(diagnosticsReport(data({ display: { ...data().display, window: null } }))).toContain(
      '  Window: none open'
    );
  });

  it('gives the review settings and the switches in effect', () => {
    expect(text).toContain('  Provider: Claude');
    expect(text).toContain('  Claude model: default');
    expect(text).toContain('  ChatGPT model: the default');
    expect(text).toContain('  Effort: high');
    expect(text).toContain('  Development switches: none');
    expect(text).toContain('  Log file: writing');
    const other = diagnosticsReport(
      data({
        settings: {
          provider: 'chatgpt',
          model: 'opus',
          chatgptModel: 'gpt-5.5',
          effort: 'low'
        },
        switches: ['isolated user data', 'quiet window'],
        logWriting: false,
        info: { ...data().info, packaged: true }
      })
    );
    expect(other).toContain('  Provider: ChatGPT');
    expect(other).toContain('  ChatGPT model: gpt-5.5');
    expect(other).toContain('  Development switches: isolated user data, quiet window');
    expect(other).toContain('  Log file: stopped after a write failed');
    expect(other).toContain('  Lapidary: 0.1.0, installed');
  });

  it('says what the manuscript folder is in: chapters, vault, Sync, git and cloud', () => {
    expect(text).toContain('  Chapters: 12');
    expect(text).toContain('  Obsidian vault: yes, in the folder above it');
    expect(text).toContain('  Obsidian Sync: on');
    expect(text).toContain('  Git: yes, in the manuscript folder');
    expect(text).toContain('  Cloud folder: OneDrive');
    expect(text).toContain(
      '  Reviews folder: ~\\AppData\\Roaming\\ai-grammar-checker\\reviews (the default)'
    );
    expect(text).toContain('  Guidelines: changed from the template, 4868 characters');
    expect(text).toContain('  Style sheet: filled in');
    const elsewhere = diagnosticsReport(
      data({
        folders: {
          ...data().folders,
          chapters: null,
          chaptersError: 'EPERM',
          vault: null,
          git: 3,
          cloud: [],
          reviewsFolder: 'D:\\Novel\\Reviews',
          reviewsDefault: false,
          reviewsInside: true
        },
        guidelines: { path: 'D:\\Style.md', chosen: true, state: 'unreadable', error: 'ENCODING' }
      })
    );
    expect(elsewhere).toContain('  Chapters: could not be listed (EPERM)');
    expect(elsewhere).toContain('  Obsidian vault: no');
    expect(elsewhere).toContain('  Obsidian Sync: no vault');
    expect(elsewhere).toContain('  Git: yes, 3 folders up');
    expect(elsewhere).toContain('  Cloud folder: none recognised');
    expect(elsewhere).toContain('  Reviews folder: D:\\Novel\\Reviews (inside the manuscript folder)');
    expect(elsewhere).toContain('  Guidelines file: D:\\Style.md (chosen in Settings)');
    expect(elsewhere).toContain('  Guidelines: could not be read (ENCODING)');
  });

  it('words each state of the guidelines file', () => {
    const say = (guidelines: DiagnosticsData['guidelines']): string =>
      diagnosticsReport(data({ guidelines }));
    const file = 'D:\\Novel\\GUIDELINES.md';
    expect(say({ path: file, chosen: false, state: 'missing' })).toContain('  Guidelines: not made yet');
    expect(
      say({ path: file, chosen: false, state: 'present', customised: false, styleSheet: 'blank', chars: 10 })
    ).toMatch(/ {2}Guidelines: unchanged from the template, 10 characters\n {2}Style sheet: still empty/);
    expect(
      say({ path: file, chosen: false, state: 'present', customised: null, styleSheet: 'missing' })
    ).toMatch(
      / {2}Guidelines: not compared with the template, which could not be read\n {2}Style sheet: no Style sheet section/
    );
  });

  it('with no folder chosen, says so and lists no folder facts', () => {
    const none = diagnosticsReport(
      data({
        folders: { ...data().folders, manuscript: null, chapters: null, vault: null, git: null, cloud: [] },
        guidelines: { path: null, chosen: false, state: 'not-chosen' }
      })
    );
    expect(none).toContain('  Folder: none chosen');
    expect(none).not.toContain('Chapters:');
    expect(none).not.toContain('Obsidian vault:');
    expect(none).not.toContain('Guidelines');
  });

  it('says when nothing has been checked or found yet, and when the log has no warnings', () => {
    const early = diagnosticsReport(
      data({
        info: { ...data().info, openai: null, claudeCode: { state: 'not-checked' } },
        claude: ['Claude: not checked yet'],
        chatgpt: { runtime: null, lastFailure: null },
        warnings: []
      })
    );
    expect(early).toContain('  OpenAI package: unknown version');
    expect(early).toContain('  Claude Code: not looked for yet');
    expect(early).toContain('  Claude: not checked yet');
    expect(early).toContain('  ChatGPT: not checked yet');
    expect(early).toContain('  Last failure: none');
    expect(early).toMatch(/Recent warnings\n {2}none in this run\n$/);
    const missing = diagnosticsReport(
      data({
        info: { ...data().info, claudeCode: { state: 'not-installed' } },
        chatgpt: { runtime: chatGptRuntime, lastFailure: { code: 'chatgpt-usage-limit' } }
      })
    );
    expect(missing).toContain('  Claude Code: not found');
    expect(missing).toContain('  Last failure: chatgpt-usage-limit');
    const unread = diagnosticsReport(
      data({ info: { ...data().info, claudeCode: { state: 'found', version: null, onPath: false } } })
    );
    expect(unread).toContain('  Claude Code: unknown version, not found by name in a terminal');
  });

  it("carries each warning's time, level, event and what failed, never its message (hardening.5 review)", () => {
    expect(text).toContain(
      '  2026-10-20T08:10:00.000Z WARN ipc.failed channel=files:save code=invalid-input\n'
    );
    expect(text).not.toContain('Not a chapter');
    // The page's own sentences, as runHandler logs them, name the chapter, its review and its path.
    const named = diagnosticsReport(
      data({
        warnings: [
          '2026-10-20T08:10:00.000Z WARN ipc.failed channel=files:read code=not-utf8 message="Chapter 07 - Heron.md is saved as UTF-16, and the app reads only UTF-8."',
          `2026-10-20T08:11:00.000Z WARN ipc.failed channel=files:save code=not-found message="The chapter is no longer at ${HOME.replace(/\\/g, '\\\\')}\\\\OneDrive\\\\Vault\\\\Novel\\\\Heron.md."`,
          '2026-10-20T08:12:00.000Z WARN ipc.failed channel=reviews:load code=io message="Lapidary could not find the review file Heron.review.json."',
          '2026-10-20T08:13:00.000Z WARN backups.failed name=Error message="EPERM in ~\\\\backups\\\\heron-3f2a" frames="at copyChapter (file:///D:/app/out/main/index.js:12:3)"',
          '2026-10-20T08:14:00.000Z ERROR ipc.failed channel=files:read error="Heron"'
        ]
      }),
      { home: HOME }
    );
    const warnings = named.slice(named.indexOf('Recent warnings\n'));
    expect(warnings).toBe(
      [
        'Recent warnings',
        '  2026-10-20T08:10:00.000Z WARN ipc.failed channel=files:read code=not-utf8',
        '  2026-10-20T08:11:00.000Z WARN ipc.failed channel=files:save code=not-found',
        '  2026-10-20T08:12:00.000Z WARN ipc.failed channel=reviews:load code=io',
        '  2026-10-20T08:13:00.000Z WARN backups.failed name=Error',
        '  2026-10-20T08:14:00.000Z ERROR ipc.failed channel=files:read',
        ''
      ].join('\n')
    );
    expect(named).not.toMatch(/heron|Chapter 07/i);
    expect(warnings).not.toMatch(/~|file:|D:/);
  });
});

describe('warningLine', () => {
  it('keeps the fields that say what failed, as the log wrote them, and drops the rest', () => {
    expect(
      warningLine(
        '2026-10-20T08:10:00.000Z WARN watcher.error folder="D:\\\\Novel" name=Error code=EPERM errno=-4048 syscall=watch stopped=true'
      )
    ).toBe(
      '2026-10-20T08:10:00.000Z WARN watcher.error name=Error code=EPERM errno=-4048 syscall=watch stopped=true'
    );
    expect(
      warningLine(
        '2026-10-20T08:10:00.000Z WARN ai.review.failed provider=chatgpt code=chatgpt-server message="x" durationMs=60012'
      )
    ).toBe(
      '2026-10-20T08:10:00.000Z WARN ai.review.failed provider=chatgpt code=chatgpt-server durationMs=60012'
    );
    expect(warningLine('2026-10-20T08:10:00.000Z WARN drafts.unreadable')).toBe(
      '2026-10-20T08:10:00.000Z WARN drafts.unreadable'
    );
  });

  it("keeps what a crash line says went (hardening.4), never the error's words or frames", () => {
    expect(
      warningLine(
        '2026-10-20T08:10:00.000Z WARN renderer.gone reason=crashed exitCode=-1073741819 outcome=offer'
      )
    ).toBe('2026-10-20T08:10:00.000Z WARN renderer.gone reason=crashed exitCode=-1073741819 outcome=offer');
    expect(
      warningLine(
        '2026-10-20T08:10:00.000Z ERROR renderer.render-failed name=TypeError message="Heron.md" frames="at StatusBar (file:///D:/app.js:1:2)" components="StatusBar < App < ErrorBoundary"'
      )
    ).toBe(
      '2026-10-20T08:10:00.000Z ERROR renderer.render-failed name=TypeError components="StatusBar < App < ErrorBoundary"'
    );
  });

  it('reads a quoted value to its end, so a field named inside a message is not taken for one', () => {
    expect(
      warningLine(
        '2026-10-20T08:10:00.000Z WARN ipc.failed message="He said \\"code=leak channel=Heron\\" twice" code=io channel=files:read'
      )
    ).toBe('2026-10-20T08:10:00.000Z WARN ipc.failed code=io channel=files:read');
  });

  it("leaves out a line that is not the log's own, and whatever follows a field it cannot read", () => {
    expect(warningLine('Heron.md could not be read')).toBe('a line the report could not read');
    expect(warningLine('2026-10-20T08:10:00.000Z NOTE odd.event code=io')).toBe(
      'a line the report could not read'
    );
    expect(warningLine('2026-10-20T08:10:00.000Z WARN ipc.failed code=io message="Heron.md, cut off')).toBe(
      '2026-10-20T08:10:00.000Z WARN ipc.failed code=io'
    );
    expect(warningLine('2026-10-20T08:10:00.000Z WARN ipc.failed code=io  name=Heron')).toBe(
      '2026-10-20T08:10:00.000Z WARN ipc.failed code=io'
    );
  });
});
