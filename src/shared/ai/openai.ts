/**
 * The provider-independent half of OpenAI's Responses API that the window also
 * needs, for the ChatGPT provider (codex.3), OpenAI's one route since codex.6
 * took out the API key: the effort mapping, the models the default passes
 * over, and the progress estimate. Deliberately free of zod, so importing it
 * does not pull the schema into the renderer bundle; the reply handling lives
 * in `openaiReply.ts`. Pure TypeScript and unit-tested (CLAUDE.md rule 4).
 */

import type { EffortLevel } from '../types';

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

/**
 * Models that are not the default while the list has any other model
 * (hardening.10, for the API key's list then; `defaultChatGptModel` since
 * codex.3), though they stay in the list for an author who picks one: a
 * `-pro` model is slow to answer, a `-codex` model is tuned for writing code,
 * a `-deep-research` model expects web search, which a review does not
 * offer, and a `-chat` model or a `chat-latest` alias is the model ChatGPT's
 * own conversations run, which moves without notice. Every OpenAI id holding
 * `chat-latest` is a `-chat-latest`, which `-chat-` names already (C.82).
 */
export const NOT_DEFAULT_MODEL = /-(pro|codex|deep-research|chat)(-|$)|chat-latest/i;

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
