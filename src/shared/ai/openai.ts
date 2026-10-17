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
 * What the dialog should select when the author has not chosen: the newest
 * `gpt-5*`, falling back to the newest text model of any family.
 */
export function defaultOpenAiModel(models: readonly OpenAiModel[]): string | null {
  const usable = usableModels(models);
  const five = usable.find((model) => model.id.startsWith('gpt-5'));
  return (five ?? usable[0])?.id ?? null;
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
