/**
 * The updater's rules and words, decided without Electron (`release.8b`, PLAN
 * 11.3 n): which way this copy of the app updates itself, what an updater
 * error means for the author, what card an update state shows, and when a
 * download the author agreed to goes on without asking again.
 *
 * Main's controller (`src/main/updates.ts`) keeps the state and pushes it to
 * the page as `update:state`; the page draws the card from `updateCardFor`
 * and About's status line from `updateStatusLine` (`release.9`). Nothing here
 * names a file or holds anything of the author's: versions, sizes and counts
 * only.
 *
 * Pure (CLAUDE.md rule 4), so every rule has a test (test/shared/updates.test.ts).
 */

import { APP_NAME } from './branding';
import type { NotificationAction } from './ipc';

/* ------------------------------------------------------------------ */
/* Mode                                                                */
/* ------------------------------------------------------------------ */

/**
 * How this copy of the app updates itself (PLAN 11.1, Updates):
 *
 * - `off`: a development run, which has no installer to update, or a build
 *   with no update feed (a `package:dir` build has no `app-update.yml`, C.88).
 *   Nothing is checked and no request leaves.
 * - `auto`: Windows. A check offers the new version; it is downloaded only
 *   when the author presses Download, and installed only by Restart now.
 * - `notify`: macOS and Linux. A check says a new version is out and points at
 *   its release page; nothing is downloaded.
 */
export type UpdateMode = 'off' | 'auto' | 'notify';

/** Why updates are off. */
export type UpdateOffReason =
  /** not an installed build */
  | 'development'
  /** an installed build with no `resources/app-update.yml`, such as a `package:dir` build (C.88) */
  | 'no-feed';

/** Development `off`, Windows `auto`, anything else `notify` (PLAN 11.3 n). */
export function updateModeFor(packaged: boolean, platform: string): UpdateMode {
  if (!packaged) return 'off';
  return platform === 'win32' ? 'auto' : 'notify';
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * What an updater error means for the author:
 *
 * - `no-releases`: the repository has no published release the updater can
 *   read yet (drafts are invisible to it), or is not public: not a fault, and
 *   no card says anything about it;
 * - `offline`: GitHub could not be reached;
 * - `no-feed`: the build's `app-update.yml` is missing;
 * - `failed`: anything else, which the log has.
 */
export type UpdateErrorKind = 'no-releases' | 'offline' | 'no-feed' | 'failed';

/** The error codes electron-updater gives when the repository has no release it can read (PLAN `release.8b`). */
const NO_RELEASE_CODES: ReadonlySet<string> = new Set([
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'
]);

/** Node's codes for a connection that could not be made or was lost. */
const OFFLINE_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH'
]);

interface ErrorFacts {
  code?: unknown;
  message?: unknown;
  statusCode?: unknown;
}

/**
 * The kind of an error electron-updater gave (PLAN `release.8b`).
 * `ERR_UPDATER_NO_PUBLISHED_VERSIONS`, `ERR_XML_MISSED_ELEMENT` with "No
 * published versions" (an empty releases feed), `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`
 * and an HTTP 404 (a repository that is missing or not public) are
 * `no-releases`. Electron's `net::ERR_...` failures and Node's connection
 * codes are `offline`. A missing `app-update.yml` is `no-feed`.
 */
export function classifyUpdateError(err: unknown): UpdateErrorKind {
  if (typeof err !== 'object' || err === null) return 'failed';
  const e = err as ErrorFacts;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  if (NO_RELEASE_CODES.has(code)) return 'no-releases';
  if (code === 'ERR_XML_MISSED_ELEMENT' && message.includes('No published versions')) return 'no-releases';
  if (e.statusCode === 404 || code === 'HTTP_ERROR_404') return 'no-releases';
  if (code === 'ENOENT' && message.includes('app-update.yml')) return 'no-feed';
  if (OFFLINE_CODES.has(code) || /\bnet::ERR_[A-Z_]+/.test(message)) return 'offline';
  return 'failed';
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** Which step an update failed at. */
export type UpdateStage = 'check' | 'download' | 'install';

/** Where the updater is. Main keeps it; the page only draws it. */
export type UpdateState =
  /** nothing checked yet in this run, or updates are off */
  | { phase: 'idle' }
  /** `manual` when Check for updates asked, not the timer */
  | { phase: 'checking'; manual: boolean }
  | { phase: 'up-to-date'; manual: boolean }
  /** `auto`: a newer version is out, waiting for Download; `size` is the installer's, in bytes */
  | { phase: 'available'; version: string; size: number | null }
  | { phase: 'downloading'; version: string; percent: number; transferred: number; total: number }
  /** downloaded and checked, waiting for Restart now */
  | { phase: 'downloaded'; version: string }
  /** Restart now is under way: the app is about to quit and the installer to start */
  | { phase: 'installing'; version: string }
  /** `notify`: a newer version is out, on its release page */
  | { phase: 'notify'; version: string }
  | {
      phase: 'failed';
      stage: UpdateStage;
      kind: UpdateErrorKind;
      /** a check the author asked for */
      manual: boolean;
      /** the version being downloaded or installed; null for a check */
      version: string | null;
    };

/** What `update:get` answers and `update:state` pushes. */
export interface UpdateStatus {
  mode: UpdateMode;
  /** set exactly when `mode` is `off` */
  offReason: UpdateOffReason | null;
  /** the version running now */
  current: string;
  state: UpdateState;
  /** when the last check ended, as an ISO time; null before the first */
  checkedAt: string | null;
  /** the release page of the version on offer, or the list of releases when none is */
  releaseUrl: string;
}

/** The first state of a run. */
export const IDLE: UpdateState = Object.freeze({ phase: 'idle' });

/** "1.0.1" for "v1.0.1" or " 1.0.1 ": versions compare as the updater writes them. */
export function plainVersion(version: string): string {
  return version.trim().replace(/^v(?=\d)/i, '');
}

/** A version as the release workflow tags it: x.y.z, with an optional pre-release part. */
export function isVersion(text: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(plainVersion(text));
}

/**
 * The release page on GitHub: a version's own, `.../releases/tag/v1.0.1` as the
 * release workflow tags it (`release.7`), or the list of releases.
 */
export function releasePageUrl(repository: string, version: string | null): string {
  const base = `https://github.com/${repository}/releases`;
  return version ? `${base}/tag/v${plainVersion(version)}` : base;
}

/* ------------------------------------------------------------------ */
/* Consent                                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether a version a check has just found is downloaded without asking: only
 * on Windows, and only the very version the author pressed Download for
 * (`updateDownloadConsent`), so a download cut short by a restart, or done
 * and not yet installed, goes on (from the updater's cache, when it is
 * there) without a second press. A newer version asks again (PLAN 11.3 n).
 */
export function shouldAutoResumeDownload(input: {
  mode: UpdateMode;
  consent: string | null;
  version: string;
}): boolean {
  return (
    input.mode === 'auto' &&
    input.consent !== null &&
    plainVersion(input.consent) === plainVersion(input.version)
  );
}

/**
 * The consent to keep once a check has ended: kept while the version it names
 * is still the one on offer, dropped once another is, or none (the update was
 * installed, or withdrawn). A check that failed keeps it, as it learned nothing.
 */
export function keptConsent(consent: string | null, available: string | null): string | null {
  if (consent === null || available === null) return null;
  return plainVersion(consent) === plainVersion(available) ? consent : null;
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** "108.7 MB": mebibytes, one decimal, as Windows shows a file's size. */
export function formatDownloadSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return '0.1 MB';
  return `${mb.toFixed(1)} MB`;
}

/** A card in the message stack, under the key `update` (`upsertNotification`, release.9). */
export interface UpdateCard {
  tone: 'info' | 'warn' | 'error';
  text: string;
  action?: Extract<NotificationAction, 'update-download' | 'update-restart' | 'update-open-page'>;
}

function availableLine(version: string, size: number | null): string {
  const of = size !== null && size > 0 ? `: a download of up to ${formatDownloadSize(size)}` : '';
  return `${APP_NAME} ${version} is available${of}.`;
}

function downloadingLine(version: string, percent: number): string {
  return `Downloading ${APP_NAME} ${version}: ${Math.max(0, Math.min(100, Math.floor(percent)))}%.`;
}

function failedLine(state: Extract<UpdateState, { phase: 'failed' }>): string {
  const version = state.version ? `${APP_NAME} ${state.version}` : 'The update';
  if (state.stage === 'check') {
    if (state.kind === 'no-releases') return 'No release has been published yet.';
    if (state.kind === 'offline')
      return 'GitHub could not be reached. Check the internet connection and try again.';
    if (state.kind === 'no-feed')
      return `This copy of ${APP_NAME} cannot update itself: it has no update feed.`;
    return 'The check for updates failed. The log has the details.';
  }
  if (state.stage === 'download') {
    return state.kind === 'offline'
      ? `${version} could not be downloaded: GitHub could not be reached. Check the internet connection, then press Download to try again.`
      : `${version} could not be downloaded. Press Download to try again; the log has the details.`;
  }
  return `${version} could not be installed, and ${APP_NAME} is still running as it was. Press Restart now to try again, or install it from the release page.`;
}

/**
 * The card an update state shows in the window, or null for none. A check
 * says nothing there, whatever it found: the timer's every day would be noise,
 * and a check the author asked for answers in About's status line. So the
 * cards are an update on offer, its download, an update ready to install, and
 * a download or an install that failed. While Restart now runs, the page's
 * overlay speaks instead.
 */
export function updateCardFor(status: UpdateStatus): UpdateCard | null {
  const state = status.state;
  switch (state.phase) {
    case 'available':
      return { tone: 'info', text: availableLine(state.version, state.size), action: 'update-download' };
    case 'downloading':
      return { tone: 'info', text: downloadingLine(state.version, state.percent) };
    case 'downloaded':
      return {
        tone: 'info',
        text: `${APP_NAME} ${state.version} is ready to install. Restart now closes ${APP_NAME}, installs it and opens ${APP_NAME} again.`,
        action: 'update-restart'
      };
    case 'notify':
      return {
        tone: 'info',
        text: `${APP_NAME} ${state.version} is available. Its release page has the download.`,
        action: 'update-open-page'
      };
    case 'failed':
      if (state.stage === 'download')
        return { tone: 'warn', text: failedLine(state), action: 'update-download' };
      if (state.stage === 'install')
        return { tone: 'error', text: failedLine(state), action: 'update-restart' };
      return null;
    default:
      return null;
  }
}

/** About's status line beside Check for updates (`release.9`): where the updater is, in a sentence. */
export function updateStatusLine(status: UpdateStatus): string {
  if (status.mode === 'off') {
    return status.offReason === 'no-feed'
      ? `This copy of ${APP_NAME} cannot update itself: it has no update feed.`
      : 'Updates are off in a development run.';
  }
  const state = status.state;
  switch (state.phase) {
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Up to date';
    case 'available':
      return availableLine(state.version, state.size);
    case 'downloading':
      return downloadingLine(state.version, state.percent);
    case 'downloaded':
      return `${APP_NAME} ${state.version} is ready to install.`;
    case 'installing':
      return `Installing ${APP_NAME} ${state.version}…`;
    case 'notify':
      return `${APP_NAME} ${state.version} is available on its release page.`;
    case 'failed':
      return failedLine(state);
  }
}

/* ------------------------------------------------------------------ */
/* The development fake                                                */
/* ------------------------------------------------------------------ */

/** What the fake update (`MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`) plays out. */
export type FakeUpdateOutcome =
  /** the version is found, downloads and installs */
  | 'available'
  /** the version is found, and its download breaks off */
  | 'download-fails'
  /** the version is found and downloads, and its installer cannot be started */
  | 'install-fails'
  /** the check finds nothing newer */
  | 'up-to-date'
  /** the repository has no published release */
  | 'no-releases'
  /** GitHub cannot be reached */
  | 'offline';

export interface FakeUpdatePlan {
  /** the version on offer; null when the check finds none */
  version: string | null;
  outcome: FakeUpdateOutcome;
}

/**
 * The dev switch's value read as a plan: a version, such as `1.0.1`, which
 * the check finds and which downloads and installs; the version and
 * `download-fails` or `install-fails`, such as `1.0.1 install-fails`; or one
 * of `up-to-date`, `no-releases` and `offline` alone. Anything else is null,
 * and the fake is off.
 */
export function parseFakeUpdate(text: string | null): FakeUpdatePlan | null {
  if (text === null) return null;
  const words = text.trim().split(/\s+/);
  const [first = '', second, ...rest] = words;
  if (rest.length > 0) return null;
  if (second === undefined && (first === 'up-to-date' || first === 'no-releases' || first === 'offline')) {
    return { version: null, outcome: first };
  }
  if (!isVersion(first)) return null;
  const version = plainVersion(first);
  if (second === undefined) return { version, outcome: 'available' };
  if (second === 'download-fails' || second === 'install-fails') return { version, outcome: second };
  return null;
}
