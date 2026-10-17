import { useEffect, useState } from 'react';
import { PROGRESS_TICK_MS, progressLabel } from '../../shared/ui/progress';

/**
 * The label beside the cancel button while Claude works (item 2). A review takes
 * a minute or more, so the indicator has to prove it is alive: the dots move
 * every half second, the elapsed time counts up, and the moment output tokens
 * start arriving it says so.
 *
 * `startedAt` comes from the caller that kicked the request off, so the clock is
 * never restarted by a re-render.
 */
export function useProgressLabel(
  running: boolean,
  startedAt: number,
  outputTokens: number | undefined
): string {
  const [now, setNow] = useState(startedAt);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!running) return '';
  const elapsedMs = Math.max(0, now - startedAt);
  return progressLabel({
    tick: Math.floor(elapsedMs / PROGRESS_TICK_MS),
    outputTokens,
    elapsedMs
  });
}
