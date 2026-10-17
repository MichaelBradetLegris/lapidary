/**
 * The whole main <-> renderer contract. The renderer has no Node access; every
 * file system, watcher, settings and SDK operation crosses this boundary
 * (CLAUDE.md rule 3). Pure types only: no Node or DOM imports.
 */

import type { AppError, EffortLevel, Eol, Provider, Review, ReviewComment, Settings } from './types';
import type { ZoomAction } from './ui/zoom';
import type { StyleSheetStatus } from './prompt/guidelines';
import type { ClaudeCredential } from './ai/claudeStatus';

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

/* ------------------------------------------------------------------ */
/* Payload shapes                                                      */
/* ------------------------------------------------------------------ */

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

export type SaveResponse =
  | { status: 'written'; hash: string }
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

export interface RateLimitInfo {
  status?: string;
  resetsAt?: string;
  message?: string;
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
}

/** The only places the renderer may ask the shell to open or reveal. */
/**
 * What "show in folder" can point at. The last four live under userData and are
 * created on demand: `data` is the folder itself, `logs` selects main.log,
 * `backups` the chapter's own backup folder when a source path is given, and
 * `drafts` the set-aside paragraph text (setup.7a).
 */
export type RevealTarget = 'manuscript' | 'reviews' | 'guidelines' | 'data' | 'logs' | 'backups' | 'drafts';

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
 * pushes it whenever it changes, so main can close at once when nothing is at
 * risk and ask the page only when something is (`needsAttention` and
 * `closePrompt` in `src/shared/ui/save.ts`). Counts and flags only: no chapter
 * text and no typed text crosses for this.
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
  /** a review or draft write is waiting or under way */
  writesPending: boolean;
  /** a dialog holds text the author typed: New chapter, Submit manual review or the edit popover */
  dialogText: boolean;
}

/* ------------------------------------------------------------------ */
/* Request map                                                         */
/* ------------------------------------------------------------------ */

export interface ApiRequestMap {
  'settings:get': { request: void; response: Settings };
  'settings:set': { request: Partial<Settings>; response: Settings };
  'settings:effective': { request: void; response: EffectivePaths };
  'dialog:pick-folder': { request: { title: string; defaultPath?: string }; response: string | null };
  'dialog:pick-file': {
    request: { title: string; defaultPath?: string; extensions?: string[] };
    response: string | null;
  };
  'files:list': { request: void; response: ChapterFile[] };
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
  'reviews:index': { request: void; response: Record<string, ReviewSummary> };
  'guidelines:ensure': { request: void; response: GuidelinesInfo };
  /** create the guidelines file if missing, then open it in Obsidian or the OS editor */
  'guidelines:open': { request: { via: OpenGuidelinesVia }; response: { path: string; created: boolean } };
  'guidelines:status': { request: void; response: GuidelinesStatus };
  /** select one of the app's own folders or files in Explorer */
  'shell:reveal': { request: { target: RevealTarget; sourcePath?: string }; response: { path: string } };
  /* One set of channels for every provider; the payload names which one. */
  'ai:runtime': { request: { provider: Provider }; response: RuntimeStatus };
  'ai:models': { request: { provider: Provider }; response: ModelInfo[] };
  'ai:review': { request: ReviewRequest; response: ReviewResponse };
  'ai:cancel': { request: { requestId: string }; response: void };
  /* The key itself only ever travels renderer -> main. Nothing sends it back. */
  'secrets:openai-status': { request: void; response: OpenAiKeyStatus };
  'secrets:openai-set': { request: { key: string }; response: OpenAiKeyStatus };
  'secrets:openai-clear': { request: void; response: OpenAiKeyStatus };
  /** step or reset the window zoom; answers with the level now in use (round 5) */
  'view:zoom': { request: { action: ZoomAction }; response: { zoom: number } };
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
  'files:read': true,
  'files:save': true,
  'files:check-name': true,
  'files:create': true,
  'reviews:list': true,
  'reviews:load': true,
  'reviews:load-latest': true,
  'reviews:save': true,
  'reviews:index': true,
  'guidelines:ensure': true,
  'guidelines:open': true,
  'guidelines:status': true,
  'shell:reveal': true,
  'ai:runtime': true,
  'ai:models': true,
  'ai:review': true,
  'ai:cancel': true,
  'secrets:openai-status': true,
  'secrets:openai-set': true,
  'secrets:openai-clear': true,
  'view:zoom': true
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
  'ai:progress': AiProgressEvent;
  'ai:rate-limit': RateLimitInfo;
  /** the zoom changed from outside the renderer's own controls: Ctrl+wheel or a shortcut */
  'view:zoom-changed': { zoom: number };
  /** a card main wants shown: a crash it survived, an update, a backup problem */
  'app:notice': AppNotice;
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
  'ai:progress': true,
  'ai:rate-limit': true,
  'view:zoom-changed': true,
  'app:notice': true
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
