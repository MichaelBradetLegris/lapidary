import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  REPORT_WARNINGS,
  cloudHints,
  obsidianSyncState,
  type DiagnosticsData,
  type DisplayFacts,
  type FolderFacts,
  type GuidelinesFacts
} from '../shared/diagnostics/report';
import type { AppInfo, RuntimeStatus } from '../shared/ipc';
import { isInsidePath } from '../shared/paths';
import { styleSheetStatus } from '../shared/prompt/guidelines';
import type { Provider, Settings } from '../shared/types';
import type { LastFailure } from '../shared/ui/setup';
import type { DevSwitches } from './devSwitches';
import { listChapters, readTextFile } from './files';
import { guidelinesPathFor } from './guidelines';
import { claudeDiagnostics } from './providers/claudeRuntime';
import { isDefaultReviewsFolder, resolveReviewsFolder } from './reviews';

/*
 * The facts behind Copy diagnostics (hardening.5), gathered for
 * `diagnosticsReport` (src/shared/diagnostics/report.ts), which writes them
 * out and scrubs them.
 *
 * It never runs a check of Claude or OpenAI: it reads what the last check
 * found (`lastRuntime`, `lastFailure`), the Claude Code the last lookup found
 * (`installedCli`, through `info`) and Setup's own Claude lines
 * (`claudeDiagnostics`), so opening the report costs nothing and logs no
 * `ai.runtime`. Of the manuscript folder it reads only names: whether
 * `.obsidian`, `.git` or Syncthing's `.stfolder` lie in it or above it, the
 * vault's `core-plugins.json` for Obsidian Sync, and how many chapters the
 * list would show; of the guidelines file only whether it is the template
 * and its length. Never a chapter, a draft, a backup or a review.
 * Electron-free: ipc.ts hands in what only Electron knows.
 */

export interface DiagnosticsDeps {
  now: () => Date;
  info: () => Promise<AppInfo>;
  settings: () => Promise<Settings>;
  /** what the last runtime check of a provider found, without running one (`lastRuntime`) */
  lastRuntime: (id: Provider) => RuntimeStatus | null;
  lastFailure: (id: Provider) => LastFailure | null;
  /** the window, the theme and the display, for the settings in force */
  display: (settings: Settings) => DisplayFacts;
  /** the app's data folder (userData) */
  userData: string;
  switches: DevSwitches;
  /** false once the log stopped after a failed write */
  logWriting: () => boolean;
  /** the log's last `n` lines at warn or error, from this run */
  warnings: (n: number) => string[];
  /** the shipped guidelines template, to tell a customised file from it */
  guidelinesTemplate: string;
  /** whether paths compare without case (`caseInsensitiveFs`) */
  ci: boolean;
}

/** The development switches in effect, in words. */
export function switchWords(switches: DevSwitches): string[] {
  return [
    ...(switches.userDataDir ? ['isolated user data'] : []),
    ...(switches.openAiBaseUrl ? ['OpenAI base URL'] : []),
    ...(switches.noClaudeCode ? ['no Claude Code'] : []),
    ...(switches.fakeUpdate ? [`fake update ${switches.fakeUpdate}`] : []),
    ...(switches.quietWindow ? ['quiet window'] : []),
    ...(switches.shellStub ? ['shell stub'] : []),
    ...(switches.verbose ? ['verbose'] : []),
    ...(switches.ignored.length > 0 ? [`ignored ${switches.ignored.join(', ')}`] : [])
  ];
}

/** The `code` of a file system or app error, such as `ENOENT` or `io`. */
function errorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}

/** How deep a folder may sit below the marker it is looked for under. */
const MAX_MARKER_DEPTH = 32;

/**
 * The nearest folder at or above `start` that holds `name`, and how many
 * folders up it is. `folder` asks for a folder; otherwise a file counts too,
 * as the `.git` file of a worktree does.
 */
export async function findUp(
  start: string,
  name: string,
  folder: boolean
): Promise<{ depth: number; dir: string } | null> {
  let dir = path.resolve(start);
  for (let depth = 0; depth <= MAX_MARKER_DEPTH; depth += 1) {
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (stat && (!folder || stat.isDirectory())) return { depth, dir };
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

async function readOrNull(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch(() => null);
}

async function folderFacts(settings: Settings, deps: DiagnosticsDeps): Promise<FolderFacts> {
  const reviewsFolder = resolveReviewsFolder(settings.reviewsFolder, deps.userData);
  const manuscript = settings.manuscriptFolder;
  const reviews = {
    reviewsFolder,
    reviewsDefault: isDefaultReviewsFolder(settings.reviewsFolder),
    reviewsInside: manuscript !== null && isInsidePath(manuscript, reviewsFolder, deps.ci)
  };
  if (manuscript === null) {
    return {
      manuscript: null,
      chapters: null,
      vault: null,
      git: null,
      obsidianSync: 'unknown',
      cloud: [],
      ...reviews
    };
  }

  const guidelines = guidelinesPathFor(settings);
  let chapters: number | null = null;
  let chaptersError: string | undefined;
  try {
    // The list the page shows, without starting the watcher as a list read does (files.21).
    chapters = (await listChapters(manuscript, settings.reviewsFolder, guidelines ? [guidelines] : []))
      .length;
  } catch (err) {
    // listChapters words the failure for the page; the folder's own refusal names its cause.
    chaptersError = await fs.readdir(manuscript).then(
      () => errorCode(err),
      (refusal: unknown) => errorCode(refusal)
    );
  }

  const [vault, git, syncthing] = await Promise.all([
    findUp(manuscript, '.obsidian', true),
    findUp(manuscript, '.git', false),
    findUp(manuscript, '.stfolder', true)
  ]);
  const corePlugins = vault ? await readOrNull(path.join(vault.dir, '.obsidian', 'core-plugins.json')) : null;
  return {
    manuscript,
    chapters,
    ...(chaptersError === undefined ? {} : { chaptersError }),
    vault: vault?.depth ?? null,
    git: git?.depth ?? null,
    obsidianSync: obsidianSyncState(corePlugins),
    cloud: [...cloudHints(manuscript), ...(syncthing ? ['Syncthing'] : [])],
    ...reviews
  };
}

async function guidelinesFacts(settings: Settings, template: string): Promise<GuidelinesFacts> {
  const file = guidelinesPathFor(settings);
  if (!file) return { path: null, chosen: false, state: 'not-chosen' };
  const chosen = settings.guidelinesPath !== null;
  let text: string;
  try {
    text = await readTextFile(file);
  } catch (err) {
    const code = errorCode(err);
    return code === 'ENOENT'
      ? { path: file, chosen, state: 'missing' }
      : { path: file, chosen, state: 'unreadable', error: code };
  }
  const original = await readTextFile(template).catch(() => null);
  return {
    path: file,
    chosen,
    state: 'present',
    customised: original === null ? null : text.trim() !== original.trim(),
    styleSheet: styleSheetStatus(text),
    chars: text.length
  };
}

/** Everything the report says, read now; no check of Claude or OpenAI is run. */
export async function collectDiagnostics(deps: DiagnosticsDeps): Promise<DiagnosticsData> {
  const settings = await deps.settings();
  const [info, folders, guidelines] = await Promise.all([
    deps.info(),
    folderFacts(settings, deps),
    guidelinesFacts(settings, deps.guidelinesTemplate)
  ]);
  return {
    madeAt: deps.now().toISOString(),
    info,
    switches: switchWords(deps.switches),
    dataFolder: deps.userData,
    logWriting: deps.logWriting(),
    display: deps.display(settings),
    settings: {
      provider: settings.provider,
      model: settings.model,
      openaiModel: settings.openaiModel,
      effort: settings.effort
    },
    claude: claudeDiagnostics(deps.lastRuntime('claude'), deps.lastFailure('claude')),
    openai: { runtime: deps.lastRuntime('openai'), lastFailure: deps.lastFailure('openai') },
    folders,
    guidelines,
    warnings: deps.warnings(REPORT_WARNINGS)
  };
}
