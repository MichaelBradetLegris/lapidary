/**
 * The text Copy diagnostics puts on the clipboard (hardening.5, PLAN 11.3 m
 * and Appendix C "What Copy diagnostics holds").
 *
 * Main gathers the facts (`collectDiagnostics` in `src/main/diagnostics.ts`)
 * and this module writes them out, as plain text an author can paste into a
 * message or a GitHub issue: a section per subject, a line per fact. What it
 * may hold is what Appendix D question 17 allows: versions, settings, the
 * state of the last checks, folder paths with the home folder written `~`,
 * the number of chapters, and the log's warnings, each reduced to what
 * failed (`warningLine`). Never chapter text or chapter names, the
 * guidelines' words, the account's email address, a key or its last four
 * characters, a status message (it can carry what a probe said), drafts or
 * backups. Every line is scrubbed on the way out as the log's are
 * (`scrub`), so an email address or a key shape that slipped into a value
 * would still come out as `[email]` or `[key]`.
 *
 * Pure and dependency-free (CLAUDE.md rule 4).
 */

import { APP_NAME } from '../branding';
import type { AppInfo, ClaudeCodeInfo, RuntimeStatus } from '../ipc';
import type { StyleSheetStatus } from '../prompt/guidelines';
import { PROVIDER_NAMES, type Settings } from '../types';
import type { LastFailure } from '../ui/setup';
import { THEME_LABELS, type Theme } from '../ui/theme';
import { scrub, truncate, type ScrubContext } from './redact';

/** Longest a line of the report may be, so a long log line cannot swamp it. */
export const MAX_REPORT_LINE = 500;

/** How many of the log's warnings and errors the report carries. */
export const REPORT_WARNINGS = 10;

/** The report's first line. */
export const REPORT_TITLE = `${APP_NAME} diagnostics`;

/** Its second: what it leaves out, so whoever pastes it knows before they do. */
export const REPORT_PROMISE =
  'No chapter text, chapter names, email address or key is included, and your user folder is written as ~.';

/* ------------------------------------------------------------------ */
/* The facts                                                           */
/* ------------------------------------------------------------------ */

/** Whether the vault's Obsidian Sync core plugin is turned on. */
export type ObsidianSync = 'on' | 'off' | 'unknown';

/** What the window and the system say about how the app is drawn. */
export interface DisplayFacts {
  /** the Appearance setting */
  theme: Theme;
  /** the dark colours are in use (`nativeTheme.shouldUseDarkColors`) */
  dark: boolean;
  /** Windows' contrast themes are on (`nativeTheme.inForcedColorsMode`) */
  forcedColors: boolean;
  /** the window's zoom factor, 1 for 100% */
  zoom: number;
  /** the scale factor of the display the window is on, 1.5 for 150%; null with no window */
  scale: number | null;
  /** the window's inside in device-independent pixels; null with no window */
  window: { width: number; height: number; maximized: boolean } | null;
  /** Chromium's GPU compositing status, such as `enabled` or `disabled_software` */
  gpuCompositing: string | null;
}

/** What the manuscript folder is and what it sits in. */
export interface FolderFacts {
  /** the manuscript folder, or null when none is chosen */
  manuscript: string | null;
  /** the chapters the list would show; null with no folder or when the read failed */
  chapters: number | null;
  /** the error code of a list read that failed */
  chaptersError?: string;
  /**
   * how many folders up from the manuscript folder an `.obsidian` folder is:
   * 0 in the folder itself, 1 in the one above; null when none was found
   */
  vault: number | null;
  /** the same for `.git`, a folder or the file a worktree has */
  git: number | null;
  /** the Sync core plugin in the vault's `core-plugins.json` (`obsidianSyncState`) */
  obsidianSync: ObsidianSync;
  /** sync tools the folder lies in, by their usual folder names or markers (`cloudHints`) */
  cloud: string[];
  /** the reviews folder in use */
  reviewsFolder: string;
  /** it is the default, in the app's data folder */
  reviewsDefault: boolean;
  /** it lies inside the manuscript folder (PLAN 6.1) */
  reviewsInside: boolean;
}

/** The guidelines file: where it is and whether it is still the template. */
export interface GuidelinesFacts {
  /** null until a manuscript folder or a guidelines file is chosen */
  path: string | null;
  /** chosen in Settings, rather than GUIDELINES.md in the manuscript folder */
  chosen: boolean;
  /** `missing`: not made yet; `unreadable`: the read failed; `present`: read */
  state: 'not-chosen' | 'missing' | 'unreadable' | 'present';
  /**
   * when read: its text differs from the template the app copies in (section
   * 10); null when the template could not be read to compare
   */
  customised?: boolean | null;
  styleSheet?: StyleSheetStatus;
  /** its length in characters, never its words */
  chars?: number;
  /** the error code of a read that failed */
  error?: string;
}

/** Everything the report is written from. */
export interface DiagnosticsData {
  /** when the facts were gathered, ISO time */
  madeAt: string;
  info: AppInfo;
  /** development switches in effect, in words; empty in an installed build */
  switches: string[];
  /** the app's data folder */
  dataFolder: string;
  /** false once a write to the log file failed, so the log stopped */
  logWriting: boolean;
  display: DisplayFacts;
  settings: Pick<Settings, 'provider' | 'model' | 'openaiModel' | 'effort'>;
  /** what the last check of Claude found, as `claudeDiagnostics` words it */
  claude: readonly string[];
  /** what the last check of OpenAI found, and its last failure */
  openai: { runtime: RuntimeStatus | null; lastFailure: LastFailure | null };
  folders: FolderFacts;
  guidelines: GuidelinesFacts;
  /** the log's last warnings and errors of this run, as written; the report keeps `warningLine` of each */
  warnings: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Readings                                                            */
/* ------------------------------------------------------------------ */

/**
 * The system in words. Windows 11 still calls itself 10.0, so the build
 * number decides: 22000 and later is Windows 11.
 */
export function systemName(platform: string, release: string): string {
  if (platform === 'win32') {
    const [major, , build] = release.split('.');
    if (major === '10') return `${Number(build) >= 22000 ? 'Windows 11' : 'Windows 10'} (${release})`;
    return `Windows ${release}`;
  }
  if (platform === 'darwin') return `macOS (Darwin ${release})`;
  if (platform === 'linux') return `Linux ${release}`;
  return `${platform} ${release}`;
}

/**
 * Whether the vault's Sync core plugin is on, from the text of
 * `.obsidian/core-plugins.json`: an object of every core plugin and whether
 * it is on (Obsidian 1.4 and later), or a list of the ones that are on
 * (earlier). The plugin's id is `sync`. On means the plugin is enabled, not
 * that the vault is connected to a remote one. No file, a file that is not
 * JSON, or an object without the key, is `unknown`.
 */
export function obsidianSyncState(coreJson: string | null): ObsidianSync {
  if (coreJson === null) return 'unknown';
  let parsed: unknown;
  try {
    parsed = JSON.parse(coreJson);
  } catch {
    return 'unknown';
  }
  if (Array.isArray(parsed)) return parsed.includes('sync') ? 'on' : 'off';
  if (typeof parsed === 'object' && parsed !== null) {
    const value = (parsed as Record<string, unknown>)['sync'];
    if (value === true) return 'on';
    if (value === false) return 'off';
  }
  return 'unknown';
}

/**
 * Sync tools by the folder names they make, tested against each part of a
 * path. A hint, not a finding: a folder of the same name made by hand reads
 * the same. Syncthing names no folder of its own; main adds it when it finds
 * the `.stfolder` marker Syncthing leaves at the top of a synced folder.
 */
const CLOUD_FOLDERS: ReadonlyArray<{ tool: string; part: RegExp }> = [
  // `OneDrive`, `OneDrive - Contoso` for a work account
  { tool: 'OneDrive', part: /^onedrive( - .+)?$/i },
  // `Dropbox`, `Dropbox (Personal)`, `Dropbox (Team)`
  { tool: 'Dropbox', part: /^dropbox( \(.+\))?$/i },
  // Windows' `iCloudDrive`; on a Mac `Mobile Documents`, and Obsidian's own iCloud folder
  {
    tool: 'iCloud Drive',
    part: /^(icloud ?drive|mobile documents|com~apple~clouddocs|icloud~md~obsidian)$/i
  },
  // Google Drive for desktop's `My Drive` and `Shared drives`, or an older `Google Drive` folder
  { tool: 'Google Drive', part: /^(google ?drive|my drive|shared drives)$/i },
  { tool: 'Box', part: /^box( sync| drive)?$/i },
  { tool: 'pCloud', part: /^pcloud ?drive$/i },
  { tool: 'MEGA', part: /^mega$/i },
  { tool: 'Proton Drive', part: /^proton ?drive$/i },
  { tool: 'Nextcloud', part: /^nextcloud$/i },
  { tool: 'ownCloud', part: /^owncloud$/i }
];

/** The sync tools a folder's path suggests, each once, in the order above. */
export function cloudHints(folder: string): string[] {
  const parts = folder.split(/[\\/]+/).filter((part) => part !== '');
  return CLOUD_FOLDERS.filter(({ part }) => parts.some((p) => part.test(p))).map(({ tool }) => tool);
}

/**
 * The fields of a log line the report keeps: what failed and where, never
 * the words (hardening.5 review). An app error's `message` is the sentence
 * the page shows, which names the chapter ("Chapter 07.md is saved as
 * UTF-16"), its review file or its backup folder, and `frames` and `error`
 * can hold anything, so they stay in the log file only. A field not listed
 * here is left out, so one a later event adds stays out until it is listed.
 */
export const REPORT_WARNING_FIELDS: ReadonlySet<string> = new Set([
  'channel',
  'code',
  'name',
  'errno',
  'syscall',
  'provider',
  'stage',
  'quitting',
  'stopped',
  'kept',
  'names',
  'durationMs'
]);

/** A log line's time, level and event, as `createLogger` (src/main/log.ts) writes them. */
const LOG_LINE_START = /^\S+ (?:DEBUG|INFO|WARN|ERROR) [A-Za-z][\w.-]*(?= |$)/;

/** One ` key=value` after them: a bare value, or a JSON string with its escapes (`formatFields`). */
const LOG_FIELD = / ([A-Za-z][\w.]*)=("(?:[^"\\]|\\.)*"|[^\s"]+)/y;

/**
 * A warning as the report writes it: its time, level and event, and of its
 * fields only `REPORT_WARNING_FIELDS`, as the log wrote them. A line that
 * does not read as the log's own is left out whole, and so is whatever
 * follows a field that does not.
 */
export function warningLine(line: string): string {
  const start = LOG_LINE_START.exec(line);
  if (!start) return 'a line the report could not read';
  const kept = [start[0]];
  const field = new RegExp(LOG_FIELD.source, 'y');
  field.lastIndex = start[0].length;
  for (let m = field.exec(line); m; m = field.exec(line)) {
    const [, key = '', value = ''] = m;
    if (REPORT_WARNING_FIELDS.has(key)) kept.push(`${key}=${value}`);
  }
  return kept.join(' ');
}

/* ------------------------------------------------------------------ */
/* Writing it out                                                      */
/* ------------------------------------------------------------------ */

function percent(factor: number): string {
  return `${Math.round(factor * 100)}%`;
}

/** Where a marker was found, counted from the manuscript folder. */
function foundAt(depth: number | null): string {
  if (depth === null) return 'no';
  if (depth === 0) return 'yes, in the manuscript folder';
  if (depth === 1) return 'yes, in the folder above it';
  return `yes, ${depth} folders up`;
}

function claudeCodeLine(code: ClaudeCodeInfo): string {
  if (code.state === 'not-checked') return 'not looked for yet';
  if (code.state === 'not-installed') return 'not found';
  return `${code.version ?? 'unknown version'}, ${code.onPath ? 'found' : 'not found'} by name in a terminal`;
}

/** The OpenAI part: the state and where the key comes from; never its last four characters or a message. */
function openAiLines(openai: DiagnosticsData['openai']): string[] {
  const runtime = openai.runtime;
  return [
    `OpenAI: ${runtime ? runtime.state : 'not checked yet'}`,
    ...(runtime?.keySource ? [`Key: ${KEY_SOURCES[runtime.keySource]}`] : []),
    ...(runtime?.checkedAt ? [`Checked: ${runtime.checkedAt}`] : []),
    `Last failure: ${openai.lastFailure?.code ?? 'none'}`
  ];
}

const KEY_SOURCES: Record<NonNullable<RuntimeStatus['keySource']>, string> = {
  stored: 'saved in the app, encrypted',
  environment: 'OPENAI_API_KEY from the environment',
  none: 'none'
};

function windowLine(display: DisplayFacts): string {
  if (!display.window) return 'none open';
  const { width, height, maximized } = display.window;
  const css =
    display.zoom === 1
      ? ''
      : `, ${Math.round(width / display.zoom)} x ${Math.round(height / display.zoom)} at this zoom`;
  return `${width} x ${height} inside${css}${maximized ? ', maximised' : ''}`;
}

function chaptersLine(folders: FolderFacts): string {
  if (folders.chapters !== null) return String(folders.chapters);
  return folders.chaptersError ? `could not be listed (${folders.chaptersError})` : 'none';
}

function reviewsLine(folders: FolderFacts): string {
  if (folders.reviewsDefault) return `${folders.reviewsFolder} (the default)`;
  return `${folders.reviewsFolder}${folders.reviewsInside ? ' (inside the manuscript folder)' : ''}`;
}

function guidelinesLines(g: GuidelinesFacts): string[] {
  if (g.state === 'not-chosen' || g.path === null) return ['Guidelines file: none until a folder is chosen'];
  const where = `${g.path}${g.chosen ? ' (chosen in Settings)' : ''}`;
  const state =
    g.state === 'missing'
      ? 'not made yet'
      : g.state === 'unreadable'
        ? `could not be read${g.error ? ` (${g.error})` : ''}`
        : g.customised === true
          ? 'changed from the template'
          : g.customised === false
            ? 'unchanged from the template'
            : 'not compared with the template, which could not be read';
  return [
    `Guidelines file: ${where}`,
    `Guidelines: ${state}${g.chars === undefined ? '' : `, ${g.chars} characters`}`,
    ...(g.styleSheet ? [`Style sheet: ${STYLE_SHEET_WORDS[g.styleSheet]}`] : [])
  ];
}

const STYLE_SHEET_WORDS: Record<StyleSheetStatus, string> = {
  filled: 'filled in',
  blank: 'still empty',
  missing: 'no Style sheet section'
};

/** The report's sections, before scrubbing, as title and lines. */
export function reportSections(data: DiagnosticsData): Array<{ title: string; lines: string[] }> {
  const { info, display, settings, folders } = data;
  return [
    {
      title: 'App',
      lines: [
        `${info.name}: ${info.version}, ${info.packaged ? 'installed' : 'development run'}`,
        `Electron: ${info.electron} (Chromium ${info.chromium}, Node ${info.node})`,
        `OpenAI package: ${info.openai ?? 'unknown version'}`,
        `Claude Code: ${claudeCodeLine(info.claudeCode)}`,
        `System: ${systemName(info.platform, info.osRelease)}, ${info.arch}`,
        `Data folder: ${data.dataFolder}`,
        `Log file: ${data.logWriting ? 'writing' : 'stopped after a write failed'}`,
        `Development switches: ${data.switches.length > 0 ? data.switches.join(', ') : 'none'}`
      ]
    },
    {
      title: 'Display',
      lines: [
        `Appearance: ${THEME_LABELS[display.theme]}, ${display.dark ? 'dark' : 'light'} colours in use`,
        `Contrast theme: ${display.forcedColors ? 'on' : 'off'}`,
        `Zoom: ${percent(display.zoom)}`,
        `Display scale: ${display.scale === null ? 'unknown' : percent(display.scale)}`,
        `Window: ${windowLine(display)}`,
        `GPU compositing: ${display.gpuCompositing ?? 'unknown'}`
      ]
    },
    {
      title: 'Reviews',
      lines: [
        `Provider: ${PROVIDER_NAMES[settings.provider]}`,
        `Claude model: ${settings.model}`,
        `OpenAI model: ${settings.openaiModel || 'the default'}`,
        `Effort: ${settings.effort}`
      ]
    },
    { title: 'Claude', lines: [...data.claude] },
    { title: 'OpenAI', lines: openAiLines(data.openai) },
    {
      title: 'Manuscript folder',
      lines:
        folders.manuscript === null
          ? ['Folder: none chosen', `Reviews folder: ${reviewsLine(folders)}`]
          : [
              `Folder: ${folders.manuscript}`,
              `Chapters: ${chaptersLine(folders)}`,
              `Obsidian vault: ${foundAt(folders.vault)}`,
              `Obsidian Sync: ${folders.vault === null ? 'no vault' : folders.obsidianSync}`,
              `Git: ${foundAt(folders.git)}`,
              `Cloud folder: ${folders.cloud.length > 0 ? folders.cloud.join(', ') : 'none recognised'}`,
              `Reviews folder: ${reviewsLine(folders)}`,
              ...guidelinesLines(data.guidelines)
            ]
    },
    {
      title: 'Recent warnings',
      lines: data.warnings.length > 0 ? data.warnings.map(warningLine) : ['none in this run']
    }
  ];
}

/**
 * The report as Copy diagnostics puts it on the clipboard: a title, what it
 * leaves out, when it was made, then the sections. Every line is scrubbed
 * (`scrub`, with the home folder from `ctx`) and cut at `MAX_REPORT_LINE`.
 */
export function diagnosticsReport(data: DiagnosticsData, ctx: ScrubContext = {}): string {
  const clean = (line: string): string => truncate(scrub(line, ctx), MAX_REPORT_LINE);
  const out = [REPORT_TITLE, REPORT_PROMISE, `Made: ${data.madeAt}`];
  for (const section of reportSections(data)) {
    out.push('', section.title, ...section.lines.map((line) => `  ${line}`));
  }
  return `${out.map(clean).join('\n')}\n`;
}
