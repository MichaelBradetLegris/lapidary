import type { ModelInfo, RateLimitInfo, ReviewRequest, RuntimeStatus } from '../../shared/ipc';
import type { ReviewOutput } from '../../shared/prompt/schema';
import type { Provider } from '../../shared/types';

/**
 * What a service has to be able to do to answer "Review with AI".
 *
 * Everything above this line is provider-neutral: one set of IPC channels, one
 * review dialog, one anchoring and hunk model. Everything below it is the
 * particular service's business, including how it authenticates and how it is
 * billed.
 */

export interface ProviderHooks {
  /** progress for the toolbar label; `outputTokens` climbs while text streams */
  onProgress: (phase: ProgressPhase, outputTokens?: number) => void;
  /** subscription rate-limit notices, which only Claude reports today */
  onRateLimit?: (info: RateLimitInfo) => void;
  /** aborted when the author presses Cancel */
  signal: AbortSignal;
}

export type ProgressPhase = 'starting' | 'thinking' | 'streaming' | 'parsing' | 'done';

export interface ProviderResult {
  /** parsed and validated against the shared zod schema */
  output: ReviewOutput;
  /** the untouched structured output, for Review.raw */
  raw: unknown;
  /** the model that actually answered, which need not be the one requested */
  model?: string;
  usage?: unknown;
  costUsd?: number;
  /** true when costUsd came from this app's price table rather than the provider */
  costEstimated?: boolean;
  durationMs?: number;
  sessionId?: string;
  fallbackNote?: string;
  rateLimit?: RateLimitInfo;
}

/** What a connection test is handed: the signal that ends it, and where rate-limit notices go. */
export type ProviderTestHooks = Pick<ProviderHooks, 'signal' | 'onRateLimit'>;

/** A connection test that went through. One that did not throws, as a review does. */
export interface ProviderTestResult {
  /** the model that answered */
  model?: string;
}

export interface ReviewProvider {
  readonly id: Provider;
  readonly label: string;
  /** can this provider run right now, and under whose account */
  runtime(): Promise<RuntimeStatus>;
  /** models the author may choose, in the order the dialog should show them */
  models(): Promise<ModelInfo[]>;
  review(request: ReviewRequest, hooks: ProviderHooks): Promise<ProviderResult>;
  /**
   * Send one very small request and say whether it went through (setup.8).
   * Optional: a provider without one answers Test the connection with "has no
   * connection test" (`testConnection`, connectionTest.ts). Aborted through
   * `hooks.signal` when the test runs out of time or the app quits.
   */
  test?(hooks: ProviderTestHooks): Promise<ProviderTestResult>;
}
