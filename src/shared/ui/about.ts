/**
 * The About dialog's words (`release.9`): the version line, the versions of
 * what the app runs on, the Claude Code line, the What's new link and the
 * Setup screen's footer. The versions come from `app:info` (hardening.5), the
 * Claude Code line from Claude's live `RuntimeStatus`, which a check updates.
 *
 * Pure (CLAUDE.md rule 4), tested in test/shared/about.test.ts.
 */

import { APP_NAME, APP_REPOSITORY } from '../branding';
import type { AppInfo, ClaudeCodeInfo, RuntimeStatus } from '../ipc';
import { releasePageUrl } from '../updates';

export const ABOUT_TITLE = `About ${APP_NAME}`;

/** Settings' button that opens it. */
export const ABOUT_BUTTON = 'About';

export const WHATS_NEW = "What's new";
export const NOTICES_BUTTON = 'Licences and notices';
export const OPEN_LOG_FOLDER = 'Open log folder';
export const OPEN_DATA_FOLDER = 'Open data folder';

/** "Version 1.0.0", and a development run says so; "Version …" until `app:info` answers. */
export function aboutVersionLine(info: AppInfo | null): string {
  if (!info) return 'Version …';
  return info.packaged ? `Version ${info.version}` : `Version ${info.version}, a development run`;
}

/**
 * The Claude Code line: "Claude Code 2.1.283, installed at <path>" from the
 * live status, which each check of Claude updates, or "Claude Code: not
 * installed". Before the first check of the run has an answer, the last
 * lookup `app:info` read (`found`), which knows no path.
 */
export function claudeCodeLine(runtime: RuntimeStatus | null, found: ClaudeCodeInfo | null): string {
  if (runtime && runtime.provider === 'claude') {
    if (runtime.state === 'missing-binary') return 'Claude Code: not installed';
    if (runtime.cliVersion || runtime.executablePath) {
      const named = runtime.cliVersion
        ? `Claude Code ${runtime.cliVersion}`
        : 'Claude Code, version not known';
      return runtime.executablePath ? `${named}, installed at ${runtime.executablePath}` : named;
    }
  }
  if (found?.state === 'not-installed') return 'Claude Code: not installed';
  if (found?.state === 'found') {
    return found.version ? `Claude Code ${found.version}` : 'Claude Code, version not known';
  }
  return 'Claude Code: not checked yet';
}

/**
 * What the app runs on, a line each: Electron, Chromium and Node.js inside
 * it, the OpenAI library and the user's own Claude Code (`claudeCodeLine`).
 * Nothing until `app:info` answers.
 */
export function componentLines(info: AppInfo | null, runtime: RuntimeStatus | null): string[] {
  if (!info) return [];
  return [
    `Electron ${info.electron}`,
    `Chromium ${info.chromium}`,
    `Node.js ${info.node}`,
    `OpenAI library ${info.openai ?? 'not found'}`,
    claudeCodeLine(runtime, info.claudeCode)
  ];
}

/**
 * What's new: the release page of the version running, which holds that
 * version's part of the changelog (the release notes, `release.6b`).
 */
export function whatsNewUrl(version: string): string {
  return releasePageUrl(APP_REPOSITORY, version);
}

/** The Setup screen's last line: the name and the version, as in "<name> 1.0.0". */
export function setupFooterText(version: string): string {
  return `${APP_NAME} ${version}`;
}
