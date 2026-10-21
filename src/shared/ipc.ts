/**
 * The whole main <-> renderer contract. The renderer has no Node access; every
 * file system, watcher, settings and SDK operation crosses this boundary
 * (CLAUDE.md rule 3). Pure types only: no Node or DOM imports.
 */

import type { AppError, EffortLevel, Eol, Provider, Review, ReviewComment, Settings } from './types';
import type { ZoomAction } from './ui/zoom';
import type { StyleSheetStatus } from './prompt/guidelines';
import type { ClaudeCredential } from './ai/claudeStatus';
import type { UpdateStatus } from './updates';

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/* ------------------------------------------------------------------ */
/* Payload shapes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Why settings.json could not be read (hardening.15, PLAN C.86), a fixed word
 * and never the error: `refused`, the read itself failed twice, as when
 * another program holds the file open; `no-copy`, the file is not JSON and no
 * copy of it could be made before starting afresh. The card the page shows
 * then gives each its own advice (`settingsUnreadableCard`).
 */
export type SettingsReadFailure = 'refused' | 'no-copy';

/**
 * `settings:get`'s answer (hardening.15, PLAN C.86): the settings as main read
 * them, or, while settings.json is there but cannot be read, or is not JSON
 * and cannot be copied aside, no settings and `readFailed` with the `reason`,
 * never the error. Handed the defaults, the page would show the welcome guide
 * and write lists built from them over the author's once the file could be
 * read.
 */
export type SettingsAnswer =
  | { readFailed: false; settings: Settings }
  | { readFailed: true; reason: SettingsReadFailure; settings: null };

export interface ChapterFile {
  path: string;
  /** path relative to the manuscript folder, using forward slashes */
  relativePath: string;
  name: string;
  size: number;
  mtimeMs: number;
}

/** Extensions the app lists, reads, writes and creates, without the dot. */
export const CHAPTER_EXTENSIONS = ['md', 'txt'] as const;
export type ChapterExtension = (typeof CHAPTER_EXTENSIONS)[number];

/**
 * The verdict on a name typed into the New chapter dialog. It is a value rather
 * than an error because the dialog asks on every keystroke and half-typed names
 * are normal, not exceptional.
 */
export interface NameCheck {
  valid: boolean;
  /** why not, addressed to the author; empty while the field is simply unfinished */
  problem?: string;
  /** true when a file of that name is already on disk */
  exists: boolean;
  /** where the file would go, when the name is usable */
  path: string | null;
}

export interface CreateChapterRequest {
  name: string;
  extension: ChapterExtension;
  text: string;
}

export interface FileContent {
  path: string;
  /** LF-normalized, BOM stripped */
  text: string;
  hash: string;
  eol: Eol;
  bom: boolean;
  trailingNewline: boolean;
}

export interface SaveRequest {
  path: string;
  /** LF-normalized text to write; EOL/BOM/trailing newline are restored from the flags */
  text: string;
  eol: Eol;
  bom: boolean;
  trailingNewline: boolean;
  /** hash the caller believes is currently on disk */
  expectedHash: string;
}

/**
 * The copy of the chapter made before a save replaced it (`apply.10`, PLAN
 * 6.5). It lies in the chapter's own folder under `<userData>/backups`, which
 * the renderer reaches only through `shell:reveal`, so only the name crosses.
 */
export interface SaveBackup {
  /** the backup's file name, such as `2026-10-14 16.04.33 Chapter 12.md` */
  name: string;
  /** false when the newest backup already held exactly these bytes, so it stands for this save */
  created: boolean;
}

export type SaveResponse =
  /**
   * `unchanged`: the file already held exactly these bytes, so nothing was
   * written, nothing was backed up, and its modified time stays as it was
   * (PLAN 11.3 h, step 3). Otherwise `backup` is the copy of what was replaced.
   */
  | { status: 'written'; hash: string; unchanged?: true; backup?: SaveBackup }
  /** the file changed underneath us; the caller must rebase onto `disk` and retry */
  | { status: 'stale'; disk: FileContent };

export interface ReviewSummary {
  /** absolute path of the review json */
  path: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  generatorKind: Review['generator']['kind'];
  /** which service answered, for the history badge; absent on a manual review */
  provider?: Provider;
  /** model that answered, for the history badge */
  model?: string;
  hunkCount: number;
  pendingCount: number;
  /** the chapter the review belongs to */
  sourcePath: string;
  decidedAt?: string;
  /** decisions the chapter file does not contain yet */
  unsavedCount: number;
}

export interface LoadedReview {
  path: string;
  review: Review;
  /**
   * Set when this chapter had no review of its own and one was adopted from
   * the path the chapter used to have: a vault that moved, or a chapter renamed
   * or moved in Obsidian (files.1, C.45).
   */
  adoptedFrom?: string;
}

/* ------------------------------------------------------------------ */
/* AI providers                                                        */
/* ------------------------------------------------------------------ */

/**
 * 'missing-binary' and 'not-signed-in' are Claude's words for "install it" and
 * "sign in". The OpenAI provider reuses 'not-signed-in' for "no API key yet",
 * which is the same thing from the UI's point of view: the provider cannot run
 * until the author does something in Setup or Settings.
 */
export type RuntimeState = 'ready' | 'missing-binary' | 'not-signed-in' | 'error';

export interface RuntimeStatus {
  provider: Provider;
  state: RuntimeState;
  /** absolute path of the Claude Code executable that will be used, when found */
  executablePath?: string;
  /** Claude: the installed Claude Code's version, e.g. "2.1.283" */
  cliVersion?: string;
  /** Claude: the oldest Claude Code the app works with, for the Setup screen */
  minCliVersion?: string;
  /** Claude: what Claude Code signs in with (setup.2) */
  credential?: ClaudeCredential;
  /** Claude: `authMethod` from `claude auth status`, such as `claude.ai` */
  authMethod?: string;
  /** Claude: set when the plan cannot run Claude Code */
  planWarning?: string;
  /** when this status was checked, ISO time */
  checkedAt?: string;
  email?: string;
  subscriptionType?: string;
  apiKeySource?: string;
  message?: string;
  /** OpenAI: where the key in use came from */
  keySource?: OpenAiKeySource;
  /** OpenAI: last four characters of the key, never the key itself */
  keyLast4?: string;
}

export interface ModelInfo {
  value: string;
  label: string;
  description?: string;
  /** the model used when the author has not chosen one */
  isDefault?: boolean;
}

/**
 * Where the OpenAI key in use comes from. 'stored' is the encrypted file beside
 * settings.json; 'environment' is OPENAI_API_KEY, which wins nothing: it is only
 * consulted when nothing is stored.
 */
export type OpenAiKeySource = 'stored' | 'environment' | 'none';

/**
 * Everything the renderer is ever told about the key. The key itself never
 * crosses this boundary and is never written to settings.json (CLAUDE.md rule 2).
 */
export interface OpenAiKeyStatus {
  configured: boolean;
  source: OpenAiKeySource;
  /** last four characters, for recognising which key is in use */
  last4: string;
  /** false when safeStorage cannot encrypt on this machine, so nothing may be stored */
  encryptionAvailable: boolean;
}

export interface ReviewRequest {
  requestId: string;
  provider: Provider;
  /** absolute chapter path, used only for the file="" attribute in the prompt */
  sourcePath: string;
  /** LF-normalized chapter text */
  text: string;
  /** empty means "the provider's own default", which OpenAI resolves from its model list */
  model: string;
  effort: EffortLevel;
  /** full text of GUIDELINES.md */
  guidelines: string;
}

export interface ReviewResponse {
  provider: Provider;
  /** parsed structured output, already validated against the zod schema */
  changes: RawChange[];
  comments: RawComment[];
  /** untouched structured output for Review.raw */
  raw: unknown;
  model?: string;
  costUsd?: number;
  /** true when costUsd is this app's arithmetic from a price table, not the provider's figure */
  costEstimated?: boolean;
  usage?: unknown;
  durationMs?: number;
  sessionId?: string;
  fallbackNote?: string;
  rateLimit?: RateLimitInfo;
}

export interface RawChange {
  paragraph: number;
  before: string;
  after: string;
  category: string;
  reason: string;
}

export interface RawComment {
  paragraph: number | null;
  quote?: string;
  category: string;
  text: string;
}

/**
 * A Claude plan's usage, as Claude Code's `rate_limit_event` reports it
 * (`readRateLimit` in `src/main/providers/claudeResult.ts`, setup.9). The
 * status bar words it with `describeRateLimit` (`src/shared/ui/usage.ts`).
 */
export interface RateLimitInfo {
  /** `allowed`, `allowed_warning` or `rejected` */
  status?: string;
  /** when the limit resets, as an ISO time */
  resetsAt?: string;
  /** which limit: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, ... (Claude Code's `rateLimitType`) */
  kind?: string;
  /**
   * the share of that limit used, 0 to 1, and past 1 when usage runs over
   * (Claude Code's `utilization`); Claude Code 2.1.302 sends it only with
   * `allowed_warning`, never with `allowed` or `rejected` (C.64)
   */
  utilization?: number;
  /**
   * the plan's limit is used up and extra usage, which may be billed, is
   * paying (Claude Code's `isUsingOverage`); 2.1.302 sets it on a `rejected`
   * notice only
   */
  usingOverage?: boolean;
}

/**
 * What Test the connection found (setup.8, PLAN 5.6): one very small request,
 * which went through or did not. A failure is an answer, not a thrown error,
 * so the page always learns how long the test took.
 */
export interface ConnectionTestResult {
  ok: boolean;
  /** the model that answered, as the provider names it */
  model?: string;
  /** from the request to the answer, as the app measured it, starting the provider's program included */
  durationMs: number;
  /** why the test did not go through; set exactly when `ok` is false */
  error?: AppError;
  /** the provider's rate-limit notice, when it sent one */
  rateLimit?: RateLimitInfo;
}

/**
 * The Claude Code the last lookup found (setup.3, `installedCli` in
 * `src/main/providers/claude.ts`). Reading it runs nothing: before the first
 * check of the run there is nothing to say.
 */
export type ClaudeCodeInfo =
  | { state: 'not-checked' }
  | { state: 'not-installed' }
  | {
      state: 'found';
      /** what `claude --version` said, or null when it said nothing readable */
      version: string | null;
      /** a terminal finds `claude` by name, so the short commands work as they are */
      onPath: boolean;
    };

/**
 * The versions that matter when something goes wrong (`app:info`,
 * hardening.5), all read while the app runs, none written in at build time:
 * `src/main/appInfo.ts`. No path, so nothing here names the user.
 */
export interface AppInfo {
  /** `APP_NAME` */
  name: string;
  /** the app's own version, from its package.json */
  version: string;
  /** an installed build, not a development run */
  packaged: boolean;
  electron: string;
  chromium: string;
  node: string;
  /** `process.platform`: `win32`, `darwin` or `linux` */
  platform: string;
  arch: string;
  /** the system's own version number, as `os.release()` gives it: `10.0.26300` on Windows 11 */
  osRelease: string;
  /** the `openai` package's version, from its package.json; null when it cannot be read */
  openai: string | null;
  /** the user's Claude Code, as the last lookup found it */
  claudeCode: ClaudeCodeInfo;
  /** the oldest Claude Code the app works with (`MIN_CLAUDE_CODE`) */
  claudeCodeMin: string;
}

/**
 * What Copy diagnostics puts on the clipboard (`app:diagnostics`,
 * hardening.5): plain text, made in main by `diagnosticsReport`
 * (`src/shared/diagnostics/report.ts`), with the home folder written `~` and
 * no chapter text, email address, key or last four characters of one.
 */
export interface DiagnosticsReport {
  text: string;
}

/** Which kind of error the page did not expect (`log:renderer`, hardening.4). */
export type RendererErrorKind =
  /** an error nothing caught: a window `error` event */
  | 'error'
  /** a promise rejected with no handler: a window `unhandledrejection` event */
  | 'rejection'
  /** drawing the page failed and the error boundary caught it, so the window shows its fallback */
  | 'render'
  /** drawing the page failed past the error boundary (React's `onUncaughtError`) */
  | 'render-uncaught';

/**
 * One line the page asks main to log (`log:renderer`, hardening.4): what
 * kind of error, and its loggable fields (`pageErrorFields`), scalars only.
 * Main keeps only the fields in `RENDERER_LOG_FIELDS`, scrubs them as it
 * writes them, and writes at most 30 such lines a minute.
 */
export interface RendererLogLine {
  kind: RendererErrorKind;
  fields: Record<string, string | number | boolean | null>;
}

/** How "Open" opens the guidelines file: in Obsidian, or in the system's app for .md (setup.10). */
export type OpenGuidelinesVia = 'obsidian' | 'default';

/** Where the guidelines file is and whether its style sheet is filled in; read-only (setup.10). */
export interface GuidelinesStatus {
  /** null until a manuscript folder or a guidelines file is chosen */
  path: string | null;
  exists: boolean;
  styleSheet: StyleSheetStatus;
}

export interface GuidelinesInfo {
  path: string;
  text: string;
  /** true when the file was just created from resources/GUIDELINES.default.md */
  created: boolean;
}

/**
 * The paths the app will actually use, after defaults are applied. Settings
 * itself keeps storing null for "not chosen", so the renderer asks for this to
 * show the author where reviews are really going (plan 6.4).
 */
export interface EffectivePaths {
  manuscriptFolder: string | null;
  reviewsFolder: string;
  /** true when reviewsFolder is the fallback inside the app's data directory */
  reviewsFolderIsDefault: boolean;
  guidelinesPath: string | null;
  /**
   * `<userData>/backups`, where every chapter has a backup folder of its own
   * (PLAN 6.5), for the Backups row in Settings (apply.11)
   */
  backupsFolder: string;
}

/**
 * The only places the renderer may ask the shell to open or reveal: what "show
 * in folder" can point at. The last five live under userData, the folders
 * created on demand: `data` is the folder itself, `settings` selects
 * settings.json, or the data folder once the file is gone (the card shown
 * while it cannot be read, hardening.15), `logs` selects main.log, `backups`
 * the backups root, and `drafts` the folder of set-aside paragraph text
 * (setup.7a), or, given the `name` of one set-aside file, that file, opened
 * in the computer's app for .txt files (apply.16). Given a chapter's
 * `sourcePath`, `backups` opens that chapter's own backup folder instead,
 * with the newest backup selected: main works the folder out from the path
 * and refuses one outside the backups root, and a chapter with no backups yet
 * is answered `not-found` (apply.11).
 */
export type RevealTarget =
  'manuscript' | 'reviews' | 'guidelines' | 'data' | 'settings' | 'logs' | 'backups' | 'drafts';

/**
 * One paragraph box as it is kept on disk (apply.16, PLAN 11.3 j): the
 * renderer's `ParagraphDraft` without the selection it opened with.
 */
export interface StoredDraft {
  /** the first paragraph index of the block the box covers, which is its key */
  key: number;
  /** every paragraph index the block covers; usually just `key` */
  paragraphs: number[];
  /** what the page read over the block when the box opened */
  initial: string;
  /** what the box holds */
  text: string;
}

/**
 * `<userData>/drafts/<16 hex>.json`: the paragraph boxes left open in one
 * chapter, as last written. The name is the first 16 hex digits of the
 * SHA-256 of the chapter's path key, so no chapter text or name is in it.
 */
export interface DraftFile {
  version: 1;
  /** the chapter the boxes are in */
  sourcePath: string;
  /** the review on screen when they were written; placing them goes by the page's text */
  reviewId: string;
  /** ISO time of the write */
  savedAt: string;
  drafts: StoredDraft[];
}

/** `drafts:save`: the boxes open in a chapter now; none deletes its file. */
export interface DraftSaveRequest {
  sourcePath: string;
  reviewId: string;
  drafts: StoredDraft[];
}

/** `drafts:set-aside`: boxes that cannot be put back, written to a .txt of their own. */
export interface SetAsideRequest {
  sourcePath: string;
  drafts: StoredDraft[];
}

/**
 * A button a notification card may carry, named rather than a callback so the
 * card stays plain data (renderer store) and main can ask for one too
 * (`app:notice`). App maps each name to what it does.
 */
export type NotificationAction =
  | 'open-settings'
  | 'open-setup'
  | 'show-diagnostics'
  | 'reveal-drafts'
  | 'reveal-backups'
  | 'reveal-all-backups'
  | 'update-download'
  | 'update-restart'
  | 'update-open-page';

/** A card that main asks the window to show, under the key `main-notice`. */
export interface AppNotice {
  tone: 'info' | 'warn' | 'error';
  message: string;
  action?: NotificationAction;
}

/**
 * What closing the window now would put at risk (PLAN 11.3 i). The renderer
 * pushes it whenever it changes (`app:guard-state`), so main can close at once
 * when nothing is at risk and ask the page only when something is
 * (`needsAttention` and `closePrompt` in `src/shared/ui/save.ts`, the close
 * guard in `src/main/closeGuard.ts`). Counts and flags only: no chapter text
 * and no typed text crosses for this.
 */
export interface CloseGuardState {
  /** absolute path of the open chapter, or null when none is open */
  chapter: string | null;
  /** decisions the chapter file does not contain yet (`unsavedDecisionCount`) */
  unsavedDecisions: number;
  /** paragraph boxes whose text differs from what they opened with */
  changedParagraphs: number;
  /** a review of the open chapter is running, so its page is read-only */
  locked: boolean;
  /** a review is running, for the open chapter or another */
  reviewRunning: boolean;
  /**
   * a review or draft write is waiting, under way, held, or failed and not
   * made since, or a Save to chapter is under way (apply.9)
   */
  writesPending: boolean;
  /** a dialog holds text the author typed: New chapter, Submit manual review or the edit popover */
  dialogText: boolean;
}

/**
 * How far the page has got with a close request (`app:close-status`, PLAN 7.7).
 * Main gives it 3 s to say `received` and 10 s more to say `prompting`, then
 * offers its native box (`src/main/closeGuard.ts`).
 */
export type CloseStatus =
  /** the page has the request and is finishing its writes before it asks */
  | 'received'
  /** a question is on screen, its close prompt or its "Still writing your decisions" */
  | 'prompting';

/** Why main asks the page to write everything it holds at once (`app:flush`). */
export type FlushReason =
  /** Windows asks whether the session may end; the app never says no */
  | 'query-session-end'
  /** the session is ending: shutdown, restart or sign-out */
  | 'session-end';

/* ------------------------------------------------------------------ */
/* Request map                                                         */
/* ------------------------------------------------------------------ */

export interface ApiRequestMap {
  'settings:get': { request: void; response: SettingsAnswer };
  'settings:set': { request: Partial<Settings>; response: Settings };
  'settings:effective': { request: void; response: EffectivePaths };
  'dialog:pick-folder': { request: { title: string; defaultPath?: string }; response: string | null };
  'dialog:pick-file': {
    request: { title: string; defaultPath?: string; extensions?: string[] };
    response: string | null;
  };
  'files:list': { request: void; response: ChapterFile[] };
  /**
   * whether main watches the manuscript folder: false with none chosen, or
   * after a start the folder refused, until a list read works (files.21)
   */
  'files:watching': { request: void; response: { watching: boolean } };
  'files:read': { request: { path: string }; response: FileContent };
  'files:save': { request: SaveRequest; response: SaveResponse };
  /** live "can I use this name?" for the New chapter dialog */
  'files:check-name': {
    request: { name: string; extension: ChapterExtension };
    response: NameCheck;
  };
  /** create a chapter with the exclusive-create flag; never overwrites */
  'files:create': { request: CreateChapterRequest; response: ChapterFile };
  'reviews:list': { request: { sourcePath: string }; response: ReviewSummary[] };
  'reviews:load': { request: { path: string }; response: LoadedReview };
  /** `hash` is the chapter file's current hash, which lets a renamed chapter find its reviews */
  'reviews:load-latest': { request: { sourcePath: string; hash?: string }; response: LoadedReview | null };
  'reviews:save': { request: { review: Review; path?: string }; response: { path: string } };
  /** the page shows this review of the chapter, so the chapter opens with it next time (apply.26) */
  'reviews:shown': { request: { sourcePath: string; path: string }; response: void };
  'reviews:index': { request: void; response: Record<string, ReviewSummary> };
  'guidelines:ensure': { request: void; response: GuidelinesInfo };
  /** create the guidelines file if missing, then open it in Obsidian or the OS editor */
  'guidelines:open': { request: { via: OpenGuidelinesVia }; response: { path: string; created: boolean } };
  'guidelines:status': { request: void; response: GuidelinesStatus };
  /**
   * select one of the app's own folders or files in Explorer; `name` opens one
   * set-aside file from `drafts/set-aside` instead (apply.16), and
   * `sourcePath` opens that chapter's backup folder (apply.11)
   */
  'shell:reveal': {
    request: { target: RevealTarget; sourcePath?: string; name?: string };
    response: { path: string };
  };
  /* Paragraph boxes kept on disk, per chapter (apply.16, PLAN 11.3 j). */
  'drafts:load': { request: { sourcePath: string }; response: DraftFile | null };
  'drafts:save': { request: DraftSaveRequest; response: void };
  /** answers with the file name in `drafts/set-aside`, for the card's Show the text */
  'drafts:set-aside': { request: SetAsideRequest; response: { name: string } };
  /* One set of channels for every provider; the payload names which one. */
  'ai:runtime': { request: { provider: Provider }; response: RuntimeStatus };
  'ai:models': { request: { provider: Provider }; response: ModelInfo[] };
  'ai:review': { request: ReviewRequest; response: ReviewResponse };
  'ai:cancel': { request: { requestId: string }; response: void };
  /** one very small request, only when the author asks (setup.8); never throws for a failed test */
  'ai:test': { request: { provider: Provider }; response: ConnectionTestResult };
  /* The key itself only ever travels renderer -> main. Nothing sends it back. */
  'secrets:openai-status': { request: void; response: OpenAiKeyStatus };
  'secrets:openai-set': { request: { key: string }; response: OpenAiKeyStatus };
  'secrets:openai-clear': { request: void; response: OpenAiKeyStatus };
  /** step or reset the window zoom; answers with the level now in use (round 5) */
  'view:zoom': { request: { action: ZoomAction }; response: { zoom: number } };
  /* The close guard (apply.8, PLAN 7.7 and 11.3 i): the page tells main what a
     close would put at risk, how far it has got with a close request, and what
     the author decided. */
  'app:guard-state': { request: CloseGuardState; response: void };
  'app:close-status': { request: { status: CloseStatus }; response: void };
  /** true closes the window, or goes on quitting; false keeps it open */
  'app:close-decision': { request: { close: boolean }; response: void };
  /** the versions, read without running anything (hardening.5) */
  'app:info': { request: void; response: AppInfo };
  /**
   * the diagnostics report (hardening.5): what the last checks found, never a
   * new check of Claude or OpenAI, and nothing of the chapters but their count
   */
  'app:diagnostics': { request: void; response: DiagnosticsReport };
  /**
   * About's Licences and notices (release.9): `THIRD_PARTY_NOTICES.txt` beside
   * the installed app, opened in the system's app for .txt files, or shown in
   * its folder when none is set; answers with the file's path. The page names
   * no file, so it cannot ask for any other.
   */
  'app:open-notices': { request: void; response: { path: string } };
  /** an error the page did not expect, for the log (hardening.4); main writes at most 30 a minute */
  'log:renderer': { request: RendererLogLine; response: void };
  /* The updater (release.8b, PLAN 11.3 n): where it is, and what the author
     asks of it. Every change also comes as the `update:state` event. */
  /** where the updater is now, for a page that has just loaded */
  'update:get': { request: void; response: UpdateStatus };
  /** check now, whatever the setting says; answers once the check has ended */
  'update:check': { request: void; response: UpdateStatus };
  /** download the version on offer, which must be `version`, and remember the consent (Windows only) */
  'update:download': { request: { version: string }; response: UpdateStatus };
  /**
   * Restart now: main lets its writes end, then starts the installer and
   * quits; the page has already asked its close question
   * (`prepareToLeaveApp('update')`). Answers `installing` when the installer
   * is starting, or `failed` at the install stage when it could not, as
   * `update:state` also says.
   */
  'update:install': { request: void; response: UpdateStatus };
}

export type RequestChannel = keyof ApiRequestMap;
export type RequestPayload<C extends RequestChannel> = ApiRequestMap[C]['request'];
export type ResponsePayload<C extends RequestChannel> = ApiRequestMap[C]['response'];

/**
 * Every request channel, written as a map so the compiler insists on all
 * of them: a channel added to the map type but not here fails the typecheck,
 * and the preload bridge would otherwise refuse it at run time (release.8a).
 */
const REQUEST_CHANNEL_FLAGS = {
  'settings:get': true,
  'settings:set': true,
  'settings:effective': true,
  'dialog:pick-folder': true,
  'dialog:pick-file': true,
  'files:list': true,
  'files:watching': true,
  'files:read': true,
  'files:save': true,
  'files:check-name': true,
  'files:create': true,
  'reviews:list': true,
  'reviews:load': true,
  'reviews:load-latest': true,
  'reviews:save': true,
  'reviews:shown': true,
  'reviews:index': true,
  'guidelines:ensure': true,
  'guidelines:open': true,
  'guidelines:status': true,
  'shell:reveal': true,
  'drafts:load': true,
  'drafts:save': true,
  'drafts:set-aside': true,
  'ai:runtime': true,
  'ai:models': true,
  'ai:review': true,
  'ai:cancel': true,
  'ai:test': true,
  'secrets:openai-status': true,
  'secrets:openai-set': true,
  'secrets:openai-clear': true,
  'view:zoom': true,
  'app:guard-state': true,
  'app:close-status': true,
  'app:close-decision': true,
  'app:info': true,
  'app:diagnostics': true,
  'app:open-notices': true,
  'log:renderer': true,
  'update:get': true,
  'update:check': true,
  'update:download': true,
  'update:install': true
} as const satisfies Record<RequestChannel, true>;

export const REQUEST_CHANNELS: readonly RequestChannel[] = Object.keys(
  REQUEST_CHANNEL_FLAGS
) as RequestChannel[];

/* ------------------------------------------------------------------ */
/* Events (main -> renderer)                                           */
/* ------------------------------------------------------------------ */

export interface FileChangedEvent {
  path: string;
  hash: string;
  kind: 'change' | 'unlink';
}

export interface AiProgressEvent {
  requestId: string;
  provider: Provider;
  phase: 'starting' | 'thinking' | 'streaming' | 'parsing' | 'done';
  outputTokens?: number;
  note?: string;
}

export interface ApiEventMap {
  'file:changed': FileChangedEvent;
  'files:invalidated': { folder: string };
  /** main started or stopped watching the manuscript folder, as `files:watching` answers (files.21) */
  'files:watching-changed': { watching: boolean };
  'ai:progress': AiProgressEvent;
  'ai:rate-limit': RateLimitInfo;
  /** the zoom changed from outside the renderer's own controls: Ctrl+wheel or a shortcut */
  'view:zoom-changed': { zoom: number };
  /** a card main wants shown: a crash it survived, an update, a backup problem */
  'app:notice': AppNotice;
  /**
   * the window was asked to close while the page holds something at risk
   * (apply.8): answer with `app:close-status`, then `app:close-decision`.
   * `quitting` when the whole app was asked to quit, not only the window.
   */
  'app:close-requested': { quitting: boolean };
  /** write every waiting review and drafts write now; nothing is asked (shutdown, PLAN 7.7) */
  'app:flush': { reason: FlushReason };
  /** the updater moved (release.8b): the page draws its card from this (`updateCardFor`) */
  'update:state': UpdateStatus;
}

export type EventChannel = keyof ApiEventMap;

/**
 * Every event channel, written as a map so the compiler insists on all
 * of them: a channel added to the map type but not here fails the typecheck,
 * and the preload bridge would otherwise refuse it at run time (release.8a).
 */
const EVENT_CHANNEL_FLAGS = {
  'file:changed': true,
  'files:invalidated': true,
  'files:watching-changed': true,
  'ai:progress': true,
  'ai:rate-limit': true,
  'view:zoom-changed': true,
  'app:notice': true,
  'app:close-requested': true,
  'app:flush': true,
  'update:state': true
} as const satisfies Record<EventChannel, true>;

export const EVENT_CHANNELS: readonly EventChannel[] = Object.keys(EVENT_CHANNEL_FLAGS) as EventChannel[];

/* ------------------------------------------------------------------ */
/* The object the preload script exposes on window.api                 */
/* ------------------------------------------------------------------ */

export interface RendererApi {
  invoke<C extends RequestChannel>(
    channel: C,
    payload: RequestPayload<C>
  ): Promise<IpcResult<ResponsePayload<C>>>;
  on<E extends EventChannel>(event: E, listener: (payload: ApiEventMap[E]) => void): () => void;
}

/** Helper used by both sides to keep comment identity stable. */
export type CommentPatch = Pick<ReviewComment, 'id' | 'status'>;
