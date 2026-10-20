/**
 * Core data model. Pure types plus the constant lists that back them.
 * This module must not import Node or DOM APIs (CLAUDE.md rule 4).
 */

import { openAiProviderLabel } from './ai/openai';
import type { SyntaxKind } from './text/obsidian';
import type { Theme } from './ui/theme';

export const CHANGE_CATEGORIES = [
  'spelling',
  'typo',
  'homophone',
  'grammar',
  'agreement',
  'tense',
  'punctuation',
  'word-choice',
  'redundancy',
  'awkward',
  'consistency',
  'formatting',
  'other'
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export const COMMENT_CATEGORIES = [
  'consistency',
  'plot',
  'flow',
  'pacing',
  'clarity',
  'repetition',
  'pov',
  'style',
  'suggestion',
  'other'
] as const;

export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export type HunkStatus = 'pending' | 'accepted' | 'dismissed';
export type AnchorQuality = 'exact' | 'fuzzy' | 'ambiguous' | 'stale';
export type HunkSource = 'claude' | 'diff' | 'manual';
export type BaseSide = 'original' | 'replacement';

/**
 * Why the guard kept a model's suggestion out of the text (`files.7`, PLAN
 * 11.3 k): the kind of Obsidian syntax it would change; `paragraph-break`
 * for one that crosses a blank line, or would add or remove a paragraph; `markup`
 * for one whose words hold a character of `MARKUP_CHARS`; `combined` for one
 * that starts where the suggestion before it on the line ends, so the two
 * could make syntax together. `keptOutNote` words each for the side panel.
 */
export type KeptOutReason = SyntaxKind | 'paragraph-break' | 'markup' | 'combined';

export interface Hunk {
  id: string;
  /** char offset into review.base.text (LF-normalized, BOM stripped) */
  start: number;
  /** exclusive end offset */
  end: number;
  /** which of the two texts currently occupies [start,end) in base.text */
  baseSide: BaseSide;
  /** '' for a pure insertion */
  original: string;
  /** '' for a pure deletion */
  replacement: string;
  /** paragraph index at anchor time, for display and navigation */
  paragraph: number;
  category?: ChangeCategory;
  reason?: string;
  source: HunkSource;
  status: HunkStatus;
  /** 'stale' hunks are listed in the side panel, never inline */
  anchor: AnchorQuality;
  /**
   * The replacement text was written by the author rather than the model.
   * `source: 'manual'` hunks are the author's from the start; this flag marks a
   * model suggestion whose wording the author rewrote (item 3a).
   */
  edited?: boolean;
  /**
   * Id of the manual hunk whose span swallowed this one (item 3b). Such a hunk
   * stays unanchored and dismissed: rebase must not re-anchor it on top of the
   * edit that replaced it.
   */
  supersededBy?: string;
  /**
   * Set when the guard kept this model suggestion out of the text, because it
   * would change Obsidian syntax (`files.7`, PLAN 11.3 k). Such a hunk is
   * `stale` at offset 0 and listed under Unanchored with `keptOutNote`; its
   * `reason` stays the model's own. Absent on every other hunk.
   */
  keptOut?: KeptOutReason;
}

export interface ReviewComment {
  id: string;
  /** null when Claude gave no usable anchor, or when the comment's paragraph left the file */
  paragraph: number | null;
  /**
   * The paragraph a comment had when a change to the file on disk took that
   * paragraph away (`rebaseReview`); `paragraph` is then null. The side panel
   * reads it as "unanchored (was paragraph 12)" and lists the comment by it
   * (`ui.7`). Absent on a comment about the whole chapter, and on comments
   * that lost their paragraph before 1.0, which read as about the chapter.
   */
  wasParagraph?: number;
  /** short excerpt Claude referenced, if any */
  quote?: string;
  category: CommentCategory;
  text: string;
  status: 'open' | 'resolved';
}

export type Eol = 'lf' | 'crlf';

export interface ReviewBase {
  /** file content normalized to LF with the BOM removed; all hunk offsets refer to this */
  text: string;
  /** sha256 of the bytes on disk when the base was captured */
  hash: string;
  eol: Eol;
  bom: boolean;
  trailingNewline: boolean;
}

/**
 * Where a review came from. 'manual' was called 'paste' until Phase 5b; reviews
 * written before the rename are migrated on load by `migrateReview`. For a review
 * a model wrote, the kind is the provider's id, and `generator.provider` carries
 * the same value explicitly (Phase 5c).
 */
export type GeneratorKind = 'claude' | 'openai' | 'manual' | 'file';

export interface ReviewGenerator {
  kind: GeneratorKind;
  /**
   * Which service answered. Absent on every review written before Phase 5c, so
   * `migrateReview` fills in 'claude' on load.
   */
  provider?: Provider;
  /** model that actually answered, as the provider reported it */
  model?: string;
  effort?: string;
  guidelinesHash?: string;
  /** provider estimate, informational only */
  costUsd?: number;
  /** true when the cost is this app's arithmetic rather than the provider's own figure */
  costEstimated?: boolean;
  /** token usage exactly as the provider reported it */
  usage?: unknown;
  durationMs?: number;
  sessionId?: string;
  /** set when a safety classifier moved the request to a fallback model */
  fallbackNote?: string;
  /**
   * The number the prompt gave the first paragraph, which is what the paragraph
   * numbers in `raw` count from. Reviews from Phase 5d on record 1; older model
   * reviews, whose prompt counted from 0, have no value. Hunks and comments are
   * always stored 0-based either way.
   */
  paragraphBase?: 0 | 1;
}

export interface Review {
  version: 1;
  /** <chapter-slug>--<ISO timestamp> */
  id: string;
  /**
   * Absolute path of the chapter, or '' for paste mode. A review belongs to this
   * exact file, compared as the file system compares paths (files.1, C.45).
   */
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When the author last decided something in this review: a suggestion, a
   * comment, a save. The chapter's current review is the one with the latest
   * `decidedAt ?? createdAt`, so an older review the author went back to stays
   * current. Optional, so reviews written before 1.0 load unchanged.
   */
  decidedAt?: string;
  base: ReviewBase;
  generator: ReviewGenerator;
  /** untouched structured_output from Claude, never edited */
  raw?: unknown;
  hunks: Hunk[];
  comments: ReviewComment[];
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/**
 * Which service answers "Review with AI". Claude runs through the Claude Code
 * the user installed, signed in with their own Claude plan or API key; OpenAI
 * runs on an API key the author pastes into Settings and is billed per token.
 */
export const PROVIDERS = ['claude', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * How the provider select names each one. Claude's label is the plain name of
 * the service, since Claude Code may run on a plan or on an API key
 * (opensource.6); OpenAI's also says how it is paid for and, while
 * `OPENAI_MATURITY` says so, that it is experimental (hardening.11).
 */
export const PROVIDER_LABELS: Record<Provider, string> = {
  claude: 'Claude',
  openai: openAiProviderLabel()
};

/** The short name, for the status bar and the history badges. */
export const PROVIDER_NAMES: Record<Provider, string> = { claude: 'Claude', openai: 'OpenAI' };

export interface Settings {
  manuscriptFolder: string | null;
  reviewsFolder: string | null;
  /** defaults to <manuscriptFolder>/GUIDELINES.md when null */
  guidelinesPath: string | null;
  provider: Provider;
  /**
   * The Claude model, an alias such as `opus`. Named `model` rather than
   * `claudeModel` because that is what every settings.json on disk already says.
   */
  model: string;
  /**
   * The OpenAI model id. Empty means "whichever model the list defaults to",
   * which is the newest full gpt-5 the key can see, then a mini, then a nano,
   * and a -pro, -codex or -chat model only when the key can see no other text
   * model, a -pro one last (`defaultOpenAiModel`, hardening.10).
   */
  openaiModel: string;
  /** shared by both providers; the OpenAI provider maps it to a reasoning effort */
  effort: EffortLevel;
  /** window zoom, one of ZOOM_STEPS in shared/ui/zoom.ts; 1 is normal size (round 5) */
  zoom: number;
  /** Appearance: follow the computer, or pin light or dark (PLAN 11.3 d) */
  theme: Theme;
  /** the welcome guide has been finished or skipped; settings from before 1.0 count as done when a folder is set */
  onboardingDone: boolean;
  /** one-time hints the author has dismissed, by id */
  dismissedHints: string[];
  /** look for a new release at start-up and daily */
  checkForUpdates: boolean;
  /** the version the author agreed to download, so a restart resumes it without asking again */
  updateDownloadConsent: string | null;
  /**
   * The side panel's split (ui.6): the suggestions list's share of the height
   * it, the handle and the region below share, strictly between 0 and 1; null
   * is the usual split (shared/ui/split.ts)
   */
  sideSplit: number | null;
}

/**
 * Settings for a first run. `model` is `default`, the account's own default in
 * Claude Code, rather than a fixed family (PLAN 11.1); a settings file that names
 * a model keeps it. The normaliser in shared/settings.ts fills every key from here.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  manuscriptFolder: null,
  reviewsFolder: null,
  guidelinesPath: null,
  provider: 'claude',
  model: 'default',
  openaiModel: '',
  effort: 'high',
  zoom: 1,
  theme: 'system',
  onboardingDone: false,
  dismissedHints: Object.freeze([]) as unknown as string[],
  checkForUpdates: true,
  updateDownloadConsent: null,
  sideSplit: null
});

/** The model setting that belongs to a provider. */
export function modelFor(settings: Settings, provider: Provider): string {
  return provider === 'openai' ? settings.openaiModel : settings.model;
}

/** The settings patch that changes the model of one provider. */
export function modelPatch(provider: Provider, model: string): Partial<Settings> {
  return provider === 'openai' ? { openaiModel: model } : { model };
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type ErrorCode =
  | 'unknown'
  | 'io'
  | 'not-configured'
  | 'not-found'
  /* files.3: the file is not UTF-8 (UTF-16, an older encoding, damaged or binary) */
  | 'not-utf8'
  | 'invalid-input'
  | 'cancelled'
  | 'claude-missing-binary'
  | 'claude-not-signed-in'
  /* setup.2: the sign-in ended (expired or revoked), and Claude Code too old for the request */
  | 'claude-login-expired'
  | 'claude-outdated'
  | 'claude-rate-limit'
  | 'claude-usage-limit'
  | 'claude-billing'
  | 'claude-refusal'
  | 'claude-invalid-output'
  | 'claude-failed'
  /* OpenAI. 'openai-no-key' and 'openai-invalid-key' are the two the renderer
     turns into a pointer at Settings. */
  | 'openai-no-key'
  | 'openai-invalid-key'
  | 'openai-rate-limit'
  | 'openai-server'
  | 'openai-invalid-output'
  | 'openai-failed';

export interface AppError {
  code: ErrorCode;
  message: string;
  detail?: string;
}
