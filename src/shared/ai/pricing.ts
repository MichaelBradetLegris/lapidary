/**
 * A small price table so the status bar can put a number on a review.
 *
 * Prices are USD per million tokens, standard tier, copied 2026-09-11 from
 * https://developers.openai.com/api/docs/pricing. They are not part of the API,
 * so an id this table does not know gets no cost at all rather than a wrong one,
 * and anything it does know is labelled an estimate everywhere it is shown.
 * Priority, flex and batch tiers, and long-context surcharges, are not modelled.
 */

export interface TokenPrice {
  /** USD per million input tokens */
  input: number;
  /** USD per million cached input tokens, when the family has a cached rate */
  cachedInput?: number;
  /** USD per million output tokens */
  output: number;
}

/**
 * Matched by the longest key that is the whole id or is followed by a dash, so
 * `gpt-5-mini-2026-01-01` finds `gpt-5-mini` while `gpt-5.5` finds nothing:
 * a point release is a different model with its own price, and guessing it
 * would be worse than showing none.
 */
export const OPENAI_PRICES: Record<string, TokenPrice> = {
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.5-pro': { input: 30, output: 180 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-4.1': { input: 2, cachedInput: 0.5, output: 8 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 }
};

export function priceFor(model: string): TokenPrice | null {
  let best: { key: string; price: TokenPrice } | null = null;
  for (const [key, price] of Object.entries(OPENAI_PRICES)) {
    if (model !== key && !model.startsWith(`${key}-`)) continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best?.price ?? null;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * USD for one call, or null when the model is not in the table. Cached input is
 * billed at its own rate where the family has one, so it is subtracted from the
 * plain input count rather than charged twice.
 */
export function estimateCostUsd(model: string, counts: TokenCounts): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const cached = Math.min(counts.cachedInputTokens ?? 0, counts.inputTokens);
  const fresh = counts.inputTokens - cached;
  const cachedRate = price.cachedInput ?? price.input;
  const usd = (fresh * price.input + cached * cachedRate + counts.outputTokens * price.output) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
