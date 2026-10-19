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

/* The global timers, not window's, so the module is tested without a DOM
   (test/renderer/hover.test.ts); in the page they are the same functions. */
let timer: ReturnType<typeof setTimeout> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (soon !== null) clearTimeout(soon);
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
  soon = setTimeout(() => {
    soon = null;
    hoverOn(id);
  }, TOOLTIP_DELAY_MS);
}

/** The pointer's part in one margin mark's card: what its element hands React. */
export interface MarkHover {
  enter: () => void;
  leave: () => void;
  /** The mark's element has gone, whether or not the pointer left it first. */
  gone: () => void;
}

/**
 * Hover for a margin mark (11.7, small.8), whose element can go away under a
 * resting pointer: a bar goes once its change is decided, and every mark is
 * made again when Save to chapter re-renders the paragraphs. React fires no
 * leave for an element that has gone, so a card the mark opened, or was about
 * to open, stayed over the prose with nothing to close it (small review). The
 * mark calls `gone` as it unmounts, and while the pointer was on it that closes
 * the card as a leave would. Once the pointer has left, `gone` does nothing, so
 * it never closes a card something else has opened since.
 */
export function markHover(id: string): MarkHover {
  let over = false;
  return {
    enter: () => {
      over = true;
      hoverSoon(id);
    },
    leave: () => {
      over = false;
      hoverOff();
    },
    gone: () => {
      if (!over) return;
      over = false;
      hoverOff();
    }
  };
}

/** Keep the current tooltip open: the pointer moved into the card itself. */
export function hoverHold(): void {
  clearTimer();
}

export function hoverOff(): void {
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    useApp.getState().setHoveredHunk(null);
  }, LEAVE_GRACE_MS);
}

/** Close it now, with no grace period: used when something else takes over. */
export function hoverCancel(): void {
  clearTimer();
  useApp.getState().setHoveredHunk(null);
}
