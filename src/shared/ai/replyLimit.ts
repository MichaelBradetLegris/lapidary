/**
 * What a review says when the chapter or its reply did not fit (files.10, C.77).
 *
 * A review's reply lists every suggestion at once, so it grows with the
 * chapter. When it reaches the model's output limit it is cut off and nothing
 * comes back, and the providers used to say so in a line ("Claude hit its
 * output limit. Try a shorter chapter.") that did not say why or what helps.
 * Both providers now word it here, from what they know of the run: who
 * answered, the limit if they were told it, the chapter's words and the
 * effort. Pure (CLAUDE.md rule 4).
 */

import { REVIEW_SIZE_INFO_WORDS } from '../text/stats';
import type { EffortLevel } from '../types';

/**
 * What ran out: the reply's output limit, the context window the chapter and
 * the reply share, or room for the chapter alone, before any reply.
 */
export type ReplyLimit = 'output' | 'context' | 'input';

export interface ReplyLimitFacts {
  /** who answered: "Claude", or the OpenAI model */
  who: string;
  /** the output limit in tokens, when the provider named it */
  maxTokens?: number;
  /** the chapter's words, as Review with AI counts them (`chapterStats`) */
  words?: number;
  /** the effort the review ran at */
  effort?: EffortLevel;
}

/** 52300 as "52,300". */
export function groupDigits(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const usable = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0;

export const LOWER_EFFORT_ADVICE =
  "The model's thinking counts against the same limit, so a lower effort in Review with AI leaves more of it for the suggestions.";

/**
 * The message for a review that ran out of room. The output and context
 * limits get the same advice: a lower effort, since thinking counts against
 * both, unless the review already ran at low; splitting the chapter, once it
 * is long enough for Review with AI to have said so (12,000 words); and
 * otherwise to try again. A chapter too long to be read at all can only be
 * split.
 */
export function replyLimitMessage(limit: ReplyLimit, facts: ReplyLimitFacts): string {
  const { who } = facts;
  const words = usable(facts.words) ? facts.words : undefined;
  if (limit === 'input') {
    return `The chapter is too long for ${who} to read in one request${
      words ? ` (${groupDigits(words)} words)` : ''
    }, so nothing came back. Split it into shorter files and review each.`;
  }
  const max = usable(facts.maxTokens) ? ` (${groupDigits(facts.maxTokens)} tokens)` : '';
  const parts = [
    limit === 'output'
      ? `${who} reached its output limit${max} before it had written every suggestion, so none came back.`
      : `${who} ran out of room for the chapter and its reply together (its context window) before it had written every suggestion, so none came back.`
  ];
  const canLower = facts.effort !== 'low';
  if (canLower) parts.push(LOWER_EFFORT_ADVICE);
  if (words !== undefined && words >= REVIEW_SIZE_INFO_WORDS) {
    parts.push(
      `At ${groupDigits(words)} words the chapter is long for one review: ${
        canLower ? 'if a lower effort is not enough, ' : ''
      }split it into two files and review each.`
    );
  } else if (!canLower) {
    parts.push('Try again, or choose another model.');
  }
  return parts.join(' ');
}
