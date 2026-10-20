import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { MIN_CLAUDE_CODE } from '../shared/ai/claudeStatus';
import { APP_NAME } from '../shared/branding';
import type { AppInfo, ClaudeCodeInfo } from '../shared/ipc';
import type { InstalledCli } from './providers/claudeBinary';

/*
 * The versions `app:info` and the diagnostics report give (hardening.5), all
 * read while the app runs: nothing is written in at build time, so a version
 * shown is the one that is there. The `openai` package's version comes from
 * its own package.json, found from where Node resolves the package; the
 * user's Claude Code version from the last lookup and `--version` of the
 * launch check (setup.3, `installedCli`), never from a new one. No electron
 * import: ipc.ts hands in what only Electron knows.
 */

export interface PackageVersionDeps {
  /** where Node resolves a package's entry point (`require.resolve`) */
  resolve: (id: string) => string;
  readFile: (file: string) => Promise<string>;
}

/** How far up from a package's entry point its package.json is looked for. */
const MAX_PACKAGE_DEPTH = 8;

/**
 * The version in package `name`'s own package.json, or null when the package
 * cannot be resolved or no package.json of that name is found. It walks up
 * from the entry point Node resolves, and skips any package.json of another
 * name on the way, such as the `{"type": "module"}` one a package may keep
 * beside its built files. The package's `exports` need not list its
 * package.json, as `openai`'s does not.
 */
export async function readPackageVersion(name: string, deps: PackageVersionDeps): Promise<string | null> {
  let dir: string;
  try {
    dir = path.dirname(deps.resolve(name));
  } catch {
    return null;
  }
  for (let i = 0; i < MAX_PACKAGE_DEPTH; i += 1) {
    try {
      const parsed: unknown = JSON.parse(await deps.readFile(path.join(dir, 'package.json')));
      if (typeof parsed === 'object' && parsed !== null) {
        const pkg = parsed as { name?: unknown; version?: unknown };
        if (pkg.name === name && typeof pkg.version === 'string') return pkg.version;
      }
    } catch {
      /* no package.json here, or not JSON: look further up */
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** Node's resolution from this module, as the built main process runs it. */
const nodeResolve = (id: string): string => createRequire(import.meta.url).resolve(id);

let openAiVersion: Promise<string | null> | null = null;

/** The installed `openai` package's version, read once and remembered. */
export function openAiPackageVersion(): Promise<string | null> {
  openAiVersion ??= readPackageVersion('openai', {
    resolve: nodeResolve,
    readFile: (file) => fs.readFile(file, 'utf8')
  });
  return openAiVersion;
}

/** The last lookup's record in `app:info`'s terms; no path. */
export function claudeCodeInfo(found: InstalledCli | null | undefined): ClaudeCodeInfo {
  if (found === undefined) return { state: 'not-checked' };
  if (found === null) return { state: 'not-installed' };
  return { state: 'found', version: found.version, onPath: found.onPath };
}

/** What only Electron and the process know, handed in by ipc.ts. */
export interface AppInfoDeps {
  version: string;
  packaged: boolean;
  versions: Readonly<Partial<Record<'electron' | 'chrome' | 'node', string>>>;
  platform: string;
  arch: string;
  osRelease: string;
  openAiVersion: () => Promise<string | null>;
  installedCli: () => InstalledCli | null | undefined;
}

export async function collectAppInfo(deps: AppInfoDeps): Promise<AppInfo> {
  return {
    name: APP_NAME,
    version: deps.version,
    packaged: deps.packaged,
    electron: deps.versions.electron ?? 'unknown',
    chromium: deps.versions.chrome ?? 'unknown',
    node: deps.versions.node ?? 'unknown',
    platform: deps.platform,
    arch: deps.arch,
    osRelease: deps.osRelease,
    openai: await deps.openAiVersion(),
    claudeCode: claudeCodeInfo(deps.installedCli()),
    claudeCodeMin: MIN_CLAUDE_CODE
  };
}
