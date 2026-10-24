import type { Provider } from '../types';

/**
 * Review with AI's words for a model list that could not be fetched (codex.3
 * review, PLAN 5.5): said under its Model row with Try again, and beside
 * Start while no model is there to send. A list that failed is not kept as
 * an empty one: it is asked for again by Try again and when the dialog next
 * opens, so one failure does not leave a provider without models for the
 * rest of the run.
 */

/** The button beside a model list that failed, or that came back empty. */
export const LIST_MODELS_AGAIN = 'Try again';

/** Whose models each provider lists, as the line under the Model row names them. */
const LISTED: Record<Provider, string> = {
  claude: "Claude Code's models",
  chatgpt: 'The models on your ChatGPT plan'
};

/** What failed, then main's own words for why. */
export function modelListFailedText(provider: Provider, message: string): string {
  const why = message.trim();
  return `${LISTED[provider]} could not be listed.${why ? ` ${why}` : ''}`;
}

/** Said beside Start review while the provider has no model to send: none chosen, and none listed. */
export const NO_MODEL_BLOCKER = 'The review cannot start until a model is listed.';
