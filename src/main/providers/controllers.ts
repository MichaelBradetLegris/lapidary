/**
 * Every AbortController that work in flight holds: reviews, the Claude runtime
 * check and the model list. Quitting aborts them all at once (`will-quit` in
 * src/main/index.ts), so no Claude Code process or OpenAI request outlives the
 * app.
 *
 * A controller leaves the set when it aborts or when its owner releases it, so
 * finished work is never aborted late. No electron import.
 */

const live = new Set<AbortController>();

/** Track `controller` until it aborts; call the returned function when the work ends normally. */
export function registerController(controller: AbortController): () => void {
  const release = (): void => {
    live.delete(controller);
  };
  if (controller.signal.aborted) return release;
  live.add(controller);
  controller.signal.addEventListener('abort', release, { once: true });
  return release;
}

/** Abort everything still in flight. Synchronous, so it is safe in `will-quit`. Returns how many it aborted. */
export function abortAll(): number {
  const all = [...live];
  live.clear();
  for (const controller of all) controller.abort();
  return all.length;
}

/** How many controllers are being tracked, for tests. */
export function liveControllerCount(): number {
  return live.size;
}
