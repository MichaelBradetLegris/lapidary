/**
 * Labels for the "Review with Claude" progress indicator (plan 7, item 2).
 * Pure string work so the animation can be driven by a timer in the renderer and
 * still be tested here.
 */

/** How often the dot animation advances. */
export const PROGRESS_TICK_MS = 500;

/** "9s", "1m 12s", "1h 3m 5s". Always at least "0s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export interface ProgressLabelInput {
  /** tick counter, incremented every PROGRESS_TICK_MS */
  tick: number;
  /** output tokens seen so far; undefined or 0 means Claude is still thinking */
  outputTokens?: number | undefined;
  elapsedMs: number;
}

/**
 * "Thinking.. (1m 12s)" while nothing has come back yet, then
 * "Writing suggestions (240 tokens) (1m 12s)" once output tokens arrive.
 */
export function progressLabel({ tick, outputTokens, elapsedMs }: ProgressLabelInput): string {
  const elapsed = `(${formatElapsed(elapsedMs)})`;
  if (outputTokens && outputTokens > 0) {
    return `Writing suggestions (${outputTokens} token${outputTokens === 1 ? '' : 's'}) ${elapsed}`;
  }
  const dots = '.'.repeat(((tick % 4) + 4) % 4);
  return `Thinking${dots} ${elapsed}`;
}
