/**
 * Hover bookkeeping for the suggestion tooltip.
 *
 * The tooltip used to be inert, so it could vanish the instant the pointer left
 * the words. It now carries a pencil (item 3a), which means the pointer has to
 * be able to travel into it. Leaving a suggestion therefore schedules the
 * tooltip's removal rather than doing it at once, and entering the tooltip
 * cancels that.
 *
 * Hover still never moves focus and never scrolls (plan 7, item 3).
 */

import { TOOLTIP_DELAY_MS } from '../../shared/ui/tooltip';
import { useApp } from './store';

/** Long enough to cross the gap between the words and the card below them. */
const LEAVE_GRACE_MS = 160;

let timer: number | null = null;
let soon: number | null = null;

function clearTimer(): void {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
  if (soon !== null) window.clearTimeout(soon);
  soon = null;
}

export function hoverOn(id: string): void {
  clearTimer();
  useApp.getState().setHoveredHunk(id);
}

/**
 * Open the tooltip after the usual short delay, as the words themselves do:
 * for a margin mark (11.7, small.8), whose suggestion's card shows under the
 * change, for reading. Leaving before the delay is up opens nothing.
 */
export function hoverSoon(id: string): void {
  clearTimer();
  soon = window.setTimeout(() => {
    soon = null;
    hoverOn(id);
  }, TOOLTIP_DELAY_MS);
}

/** Keep the current tooltip open: the pointer moved into the card itself. */
export function hoverHold(): void {
  clearTimer();
}

export function hoverOff(): void {
  clearTimer();
  timer = window.setTimeout(() => {
    timer = null;
    useApp.getState().setHoveredHunk(null);
  }, LEAVE_GRACE_MS);
}

/** Close it now, with no grace period: used when something else takes over. */
export function hoverCancel(): void {
  clearTimer();
  useApp.getState().setHoveredHunk(null);
}
