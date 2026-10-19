import { execFile } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import type path from 'node:path';
import { isOutdated, parseAuthStatus, parseCliVersion, type AuthStatus } from '../../shared/ai/claudeStatus';

/*
 * Finding the Claude Code the user installed, and the only place in `src`
 * that starts a process (setup.3, PLAN 11.3 q).
 *
 * The app ships no Claude Code (Appendix D 8, C.42), so development and
 * packaged builds look in the same places: where Anthropic's installer puts
 * it, then PATH, then the usual system folders on macOS and Linux. On Windows
 * only `claude.exe` counts: npm's `claude.cmd` is a batch file that cannot be
 * run without a shell. Electron-free, with every system call injected.
 */

/** `spawn`, for the review run in claudeCli.ts: always without a shell, as claudeCli passes it. */
export { spawn } from 'node:child_process';

export interface LocateDeps {
  platform: NodeJS.Platform;
  home: string;
  /** the PATH variable as the app received it */
  pathEnv: string;
  /** `path.win32` or `path.posix`, matching `platform` */
  pathApi: path.PlatformPath;
  /** true when `file` exists and can be run */
  access: (file: string) => Promise<boolean>;
  /** development switch: behave as if Claude Code were not installed */
  noClaudeCode?: boolean;
}

export interface ClaudeCandidate {
  path: string;
  /** where Anthropic's installer puts it, a PATH folder, or a usual system folder */
  source: 'installer' | 'path' | 'system';
}

const SYSTEM_DIRS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin'],
  linux: ['/usr/bin', '/usr/local/bin']
};

function exeName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

function pathDirs(deps: Pick<LocateDeps, 'platform' | 'pathEnv'>): string[] {
  return deps.pathEnv.split(deps.platform === 'win32' ? ';' : ':').filter((dir) => dir.trim() !== '');
}

/**
 * `%LOCALAPPDATA%\Microsoft\WindowsApps`, the folder of Windows' App
 * Execution Aliases, where an older Claude Desktop puts a `Claude.exe` that
 * Windows matches to `claude.exe` (troubleshoot-install; PLAN 5.6 item 1).
 * Left out of the lookup, so that Claude Desktop is never found and run with
 * `--version`. `canRun` refuses such an alias as well, since `fs.stat` cannot
 * follow it (EACCES), and `test/main/claudeBinary.test.ts` pins that on the
 * aliases of the machine it runs on (setup.17).
 */
export function isWindowsAppsDir(dir: string): boolean {
  return /[\\/]Microsoft[\\/]WindowsApps[\\/]*$/i.test(dir.trim());
}

/** Every place Claude Code may be, in the order they are tried, without duplicates. */
export function claudeCandidates(
  deps: Pick<LocateDeps, 'platform' | 'home' | 'pathEnv' | 'pathApi'>
): ClaudeCandidate[] {
  const name = exeName(deps.platform);
  const p = deps.pathApi;
  const dirs = pathDirs(deps).filter((dir) => deps.platform !== 'win32' || !isWindowsAppsDir(dir));
  const list: ClaudeCandidate[] = [
    { path: p.join(deps.home, '.local', 'bin', name), source: 'installer' },
    ...dirs.map((dir) => ({ path: p.join(dir, name), source: 'path' as const })),
    ...(SYSTEM_DIRS[deps.platform] ?? []).map((dir) => ({
      path: p.join(dir, name),
      source: 'system' as const
    }))
  ];
  const seen = new Set<string>();
  return list.filter(({ path: file }) => {
    const key = deps.platform === 'win32' || deps.platform === 'darwin' ? file.toLowerCase() : file;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface LocatedClaude {
  path: string;
  /** a terminal finds `claude` by name, so the short commands work as they are */
  onPath: boolean;
}

/** The first candidate that exists, or null when Claude Code is not installed. */
export async function locateClaudeCode(deps: LocateDeps): Promise<LocatedClaude | null> {
  if (deps.noClaudeCode) return null;
  let found: string | null = null;
  for (const candidate of claudeCandidates(deps)) {
    if (await deps.access(candidate.path)) {
      found = candidate.path;
      break;
    }
  }
  if (!found) return null;
  // Asked of PATH itself: the installer's folder is often on it too.
  const name = exeName(deps.platform);
  let onPath = false;
  for (const dir of pathDirs(deps)) {
    if (await deps.access(deps.pathApi.join(dir, name))) {
      onPath = true;
      break;
    }
  }
  return { path: found, onPath };
}

/** The real check: a file that exists and, off Windows, may be run. */
export async function canRun(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') await fs.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* The two probes                                                      */
/* ------------------------------------------------------------------ */

export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; timeoutMs: number }
) => Promise<{ code: number | null; stdout: string }>;

export interface RunOptions {
  /** never the vault (CLAUDE.md rule 6) */
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  /** tests run Node with a fake Claude Code script here */
  prefixArgs?: readonly string[];
  exec?: ExecFn;
}

const ALLOWED: readonly (readonly string[])[] = [['--version'], ['auth', 'status', '--json']];

function allowed(args: readonly string[]): boolean {
  return ALLOWED.some((ok) => ok.length === args.length && ok.every((arg, i) => arg === args[i]));
}

/** `execFile` without a shell and without a window; the exit code, or null when it never ran. */
export const execNoShell: ExecFn = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024
      },
      (err, stdout) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
        resolve({ code, stdout: typeof stdout === 'string' ? stdout : '' });
      }
    );
  });

/**
 * Run one of the two read-only probes and return its stdout. Nothing else can
 * be run this way: no sign-in, no sign-out, no command from anywhere else.
 * `auth status` exits with 1 when signed out, and that output still counts.
 */
export async function runClaudeCli(
  executable: string,
  args: readonly string[],
  options: RunOptions
): Promise<string | null> {
  if (!allowed(args))
    throw new Error(`runClaudeCli runs only --version and auth status --json, not "${args.join(' ')}"`);
  const exec = options.exec ?? execNoShell;
  const { code, stdout } = await exec(executable, [...(options.prefixArgs ?? []), ...args], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs ?? 20_000
  });
  return code === 0 || code === 1 ? stdout : null;
}

/** The installed version, e.g. "2.1.283", or null when it cannot be read. */
export async function claudeVersion(executable: string, options: RunOptions): Promise<string | null> {
  const out = await runClaudeCli(executable, ['--version'], options);
  return out === null ? null : parseCliVersion(out);
}

/** `claude auth status --json`, reduced to the fields the app may keep. */
export async function claudeAuthStatus(executable: string, options: RunOptions): Promise<AuthStatus | null> {
  const out = await runClaudeCli(executable, ['auth', 'status', '--json'], options);
  return out === null ? null : parseAuthStatus(out);
}

export interface FoundClaude extends LocatedClaude {
  version: string | null;
  /** older than `MIN_CLAUDE_CODE`; the fix is `claude update` */
  outdated: boolean;
}

/** Locate Claude Code and read its version; null when it is not installed. */
export async function discoverClaudeCode(deps: LocateDeps, options: RunOptions): Promise<FoundClaude | null> {
  const located = await locateClaudeCode(deps);
  if (!located) return null;
  const version = await claudeVersion(located.path, options);
  return { ...located, version, outdated: version !== null && isOutdated(version) };
}
