/**
 * The provider-independent half of the OpenAI path that the window also needs:
 * key wording, the effort mapping, the model list rules and the progress
 * estimate. Deliberately free of zod, so importing it does not pull the schema
 * into the renderer bundle; the reply handling lives in `openaiReply.ts`. Pure
 * TypeScript and unit-tested (CLAUDE.md rule 4).
 */

import type { OpenAiKeyStatus } from '../ipc';
import type { EffortLevel } from '../types';

/* ------------------------------------------------------------------ */
/* Key status wording                                                  */
/* ------------------------------------------------------------------ */

/**
 * One line saying which key will be used, for the review dialog and Settings.
 * It works from the status alone: the renderer never has the key to describe.
 */
export function openAiKeyLine(status: OpenAiKeyStatus | null): string {
  if (!status) return 'checking…';
  if (status.source === 'stored') return `saved in Settings, encrypted (ends ${status.last4})`;
  if (status.source === 'environment') return `from OPENAI_API_KEY in the environment (ends ${status.last4})`;
  return 'missing: add one in Settings';
}

/* ------------------------------------------------------------------ */
/* Reasoning effort                                                    */
/* ------------------------------------------------------------------ */

/**
 * The values `reasoning.effort` accepts, from the installed SDK's own types
 * (`node_modules/openai/resources/shared.d.ts`), which CLAUDE.md makes
 * authoritative over memory.
 */
export const OPENAI_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type OpenAiEffort = (typeof OPENAI_EFFORTS)[number];

/**
 * The app's effort setting as an OpenAI reasoning effort.
 *
 * The brief for Phase 5c expected to fold `xhigh` and `max` down to the highest
 * value the API accepts. The installed SDK's types show that the API accepts
 * both, so the highest accepted value is the value itself and the table is the
 * identity. It is written out as a table anyway so that a new app effort level
 * fails to compile here until someone decides what it means to OpenAI. Not every
 * model accepts every level; the review dialog says so and the provider maps the
 * resulting 400 to a message that suggests a lower effort.
 */
export const OPENAI_EFFORT_FOR: Record<EffortLevel, OpenAiEffort> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max'
};

export function toOpenAiEffort(effort: EffortLevel): OpenAiEffort {
  return OPENAI_EFFORT_FOR[effort];
}

/* ------------------------------------------------------------------ */
/* Models                                                              */
/* ------------------------------------------------------------------ */

export interface OpenAiModel {
  id: string;
  /** unix seconds, as the models endpoint reports it */
  created?: number;
}

/**
 * Ids that are not text generation. The list endpoint returns everything the key
 * can see, including embeddings, speech, images and moderation, none of which
 * can answer a copyedit request.
 */
const NOT_TEXT =
  /(embedding|whisper|tts|audio|realtime|transcribe|speech|image|dall-e|sora|moderation|guard|rerank|similarity|search|codex-mini|computer-use)/i;

/** Prefixes that do answer text, in the families this app can use. */
const TEXT_FAMILIES = /^(gpt-|o1|o3|o4|chatgpt-)/i;

export function isTextModel(id: string): boolean {
  if (!TEXT_FAMILIES.test(id)) return false;
  if (NOT_TEXT.test(id)) return false;
  // Fine-tunes are `ft:<base>:...`; the base model is listed separately.
  return !id.startsWith('ft:');
}

/**
 * Text models, newest first. `created` is the only ordering the endpoint gives;
 * ids are compared as a tie-break so the order is stable rather than accidental.
 */
export function usableModels(models: readonly OpenAiModel[]): OpenAiModel[] {
  return models
    .filter((model) => isTextModel(model.id))
    .slice()
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id));
}

/**
 * Models that are not the default while the list has any other text model
 * (hardening.10), though they stay in the list for an author who picks one: a
 * `-pro` model costs several times as much and is slow to answer, a `-codex`
 * model is tuned for writing code, a `-deep-research` model expects web
 * search, which a review does not offer (`isTextModel` already leaves those
 * out, as search models), and a `-chat` model or a `chat-latest` alias is the
 * model ChatGPT runs, which moves without notice. Every OpenAI id holding
 * `chat-latest` is a `-chat-latest`, which `-chat-` names already (C.82).
 */
export const NOT_DEFAULT_MODEL = /-(pro|codex|deep-research|chat)(-|$)|chat-latest/i;

/** A `-pro` model, the dearest of those: the default only when the list holds nothing else. */
const PRO_MODEL = /-pro(-|$)/i;

/** The date a snapshot's id ends with, as in `gpt-5-2025-08-07`. */
const SNAPSHOT_DATE = /-\d{4}-\d{2}-\d{2}$/;

/**
 * The order the default is looked for in, each tier newest first, an id
 * matched without its snapshot date: a full gpt-5 (`gpt-5`, `gpt-5.5`), then a
 * gpt-5 mini, then a gpt-5 nano, then any other gpt-5; with no gpt-5 at all,
 * as for a project limited to older models, a model of another family that is
 * neither a mini nor a nano, then a mini, then a nano. A copyedit wants the
 * largest model that is not one of the kinds `NOT_DEFAULT_MODEL` names.
 */
const DEFAULT_TIERS: readonly RegExp[] = [
  /^gpt-5(\.\d+)?$/i,
  /^gpt-5(\.\d+)?-mini$/i,
  /^gpt-5(\.\d+)?-nano$/i,
  /^gpt-5/i,
  /^(?!.*-(mini|nano)$)/i,
  /^(?!.*-nano$)/i,
  /^/
];

/**
 * What the dialog should select when the author has not chosen, and what main
 * sends for an empty model setting (hardening.10): the newest full gpt-5, else
 * the newest gpt-5 mini, else nano, else the first tier of `DEFAULT_TIERS`
 * that has a model, among the models `NOT_DEFAULT_MODEL` does not name. Only
 * when every text model listed is one it names does the default come from
 * those, by the same tiers, a codex or chat model before a `-pro` one, which
 * the newest-first list would otherwise put first (C.82). A dated snapshot
 * gives way to its undated alias when the list has both, so the default
 * follows the alias as OpenAI moves it. Null only when no text model is
 * listed.
 */
export function defaultOpenAiModel(models: readonly OpenAiModel[]): string | null {
  const usable = usableModels(models);
  const named = (model: OpenAiModel): boolean => NOT_DEFAULT_MODEL.test(model.id);
  const pro = (model: OpenAiModel): boolean => PRO_MODEL.test(model.id);
  return (
    newestByTier(usable.filter((model) => !named(model))) ??
    newestByTier(usable.filter((model) => named(model) && !pro(model))) ??
    newestByTier(usable.filter(pro))
  );
}

/** The newest model of the first tier of `DEFAULT_TIERS` that has one, as its alias when listed. */
function newestByTier(candidates: readonly OpenAiModel[]): string | null {
  const undated = (id: string): string => id.replace(SNAPSHOT_DATE, '');
  for (const tier of DEFAULT_TIERS) {
    const newest = candidates.find((model) => tier.test(undated(model.id)));
    if (!newest) continue;
    const alias = undated(newest.id);
    return candidates.some((model) => model.id === alias) ? alias : newest.id;
  }
  return null;
}

/** What main sends when the list cannot be read: a guess, since a key that cannot list models can often still answer. */
export const OPENAI_FALLBACK_MODEL = 'gpt-5';

/**
 * The model a review or a connection test sends (hardening.10): the author's
 * choice, else the list's default, which the review dialog's select shows
 * marked "(default)", so what the dialog shows is what is sent (C.28); else
 * `gpt-5`, when the list could not be read (`models` is null) or holds no
 * text model.
 */
export function openAiModelToSend(requested: string, models: readonly OpenAiModel[] | null): string {
  const chosen = requested.trim();
  if (chosen.length > 0) return chosen;
  if (!models) return OPENAI_FALLBACK_MODEL;
  return defaultOpenAiModel(models) ?? OPENAI_FALLBACK_MODEL;
}

/* ------------------------------------------------------------------ */
/* Progress                                                           */
/* ------------------------------------------------------------------ */

/**
 * A rough token count for the progress label while text is still streaming. The
 * exact figure arrives with the final response and replaces this one; until then
 * four characters per token is close enough for a counter that only has to move.
 */
export function estimateTokens(characters: number): number {
  return Math.ceil(characters / 4);
}
