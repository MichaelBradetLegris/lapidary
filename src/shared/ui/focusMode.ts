import {
  escapeLeavesFullScreen,
  fullScreenToggle,
  type EscapeTakers,
  type FullScreenKey
} from './fullScreen';

/**
 * Focus mode (focus.1, PLAN section 7, Focus mode, and Appendix C "What focus
 * mode settled where the plan left it open"): a barrier to leaving full
 * screen, for writing and editing without distraction. With the Focus mode
 * box ticked in Settings' App section, going full screen (polish.23) puts the
 * window in focus mode: main makes it a kiosk window kept on top and brings it
 * back to the front when it loses the focus, which is all the app can do about
 * Alt+Tab. Leaving full screen, or closing the window, then takes holding F11
 * or Escape for the time set (15, 30 or 60 seconds). The page shows the hold:
 * an overlay above everything with a count in a filling ring, and the words
 * below; letting go early, any other key or a click closes it, and the count
 * starts over next time. While it shows, no key reaches the page.
 *
 * Pure (CLAUDE.md rule 4).
 */

/** The hold times Settings offers, in seconds. */
export const FOCUS_HOLD_SECONDS = [15, 30, 60] as const;

export type FocusHoldSeconds = (typeof FOCUS_HOLD_SECONDS)[number];

export const DEFAULT_FOCUS_HOLD_SECONDS: FocusHoldSeconds = 30;

/** A hold time a settings.json names, or the default for anything else. */
export function normalizeFocusHold(value: unknown): FocusHoldSeconds {
  return typeof value === 'number' && (FOCUS_HOLD_SECONDS as readonly number[]).includes(value)
    ? (value as FocusHoldSeconds)
    : DEFAULT_FOCUS_HOLD_SECONDS;
}

/** The hold time as the Settings list names it: "30 seconds". */
export function focusHoldLabel(seconds: FocusHoldSeconds): string {
  return `${seconds} seconds`;
}

/**
 * Focus mode as main says it stands (`window:full-screen`): null when the
 * window is not in it, else the hold time it was entered with. A change in
 * Settings takes effect the next time the window goes full screen, so a hold
 * under way keeps its time.
 */
export interface FocusModeState {
  holdSeconds: FocusHoldSeconds;
}

/** The two keys that leave focus mode when held, as `KeyboardEvent.key` names them. */
export type HoldKey = 'F11' | 'Escape';

/* ---------- The words ---------- */

/** The overlay's heading. */
export const FOCUS_OVERLAY_TITLE = "You're in focus mode.";

/**
 * The overlay's lines under the heading, in the task's words (focus.1): with
 * the heading they read "You're in focus mode. Are you sure you want to exit?
 * Hold F11 or Esc for 30 seconds to exit. Press any other key or click to
 * resume."
 */
export function focusOverlayLines(seconds: FocusHoldSeconds): string[] {
  return [
    'Are you sure you want to exit?',
    `Hold F11 or Esc for ${seconds} seconds to exit.`,
    'Press any other key or click to resume.'
  ];
}

/** The ring's name for a screen reader, which gives its value as `focusCountSpoken`. */
export const FOCUS_RING_LABEL = 'Time held';

/** The count in the ring: whole seconds held, of the time set, "12 / 30 s". */
export function focusCount(elapsedMs: number, seconds: FocusHoldSeconds): string {
  const held = Math.min(seconds, Math.max(0, Math.floor(elapsedMs / 1000)));
  return `${held} / ${seconds} s`;
}

/** How far the ring has filled, from 0 to 1. */
export function holdProgress(elapsedMs: number, seconds: FocusHoldSeconds): number {
  return Math.min(1, Math.max(0, elapsedMs / (seconds * 1000)));
}

/** What a screen reader gives for the ring: "12 of 30 seconds held". */
export function focusCountSpoken(elapsedMs: number, seconds: FocusHoldSeconds): string {
  const held = Math.min(seconds, Math.max(0, Math.floor(elapsedMs / 1000)));
  return `${held} of ${seconds} seconds held`;
}

/* ---------- The keys ---------- */

/** F11 or Escape alone, with no Ctrl, Alt, Shift or Windows key and no IME composition; else null. */
export function holdKeyOf(event: FullScreenKey): HoldKey | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing) return null;
  return event.key === 'F11' || event.key === 'Escape' ? event.key : null;
}

/**
 * What a key does in focus mode while the overlay is closed:
 * - `hold`: F11 alone, or Escape alone when nothing else on the page takes
 *   it (`escapeLeavesFullScreen`), pressed afresh: the overlay opens and the
 *   count starts from this press;
 * - `swallow`: either of them held down from before, which the page leaves
 *   alone, so a hold starts only on a fresh press (a held F11 that has just
 *   entered full screen never starts one);
 * - `pass`: every other key, and Escape while something else takes it, which
 *   closes that first, one thing at a time, as outside focus mode.
 */
export function focusModeKey(event: FullScreenKey, over: EscapeTakers): 'hold' | 'swallow' | 'pass' {
  const hold = holdKeyOf(event);
  if (hold === 'F11') return fullScreenToggle(event) === 'toggle' ? 'hold' : 'swallow';
  if (hold === 'Escape' && escapeLeavesFullScreen(event, true, over)) {
    return event.repeat ? 'swallow' : 'hold';
  }
  return 'pass';
}

/**
 * What a key does while the overlay shows, every one of which it keeps from
 * the page:
 * - `hold`: F11 or Escape alone, pressed afresh while the overlay waits for
 *   one (the toolbar's button, a close request or a key held from before
 *   opened it): the count starts;
 * - `keep`: the key being held, repeating, or the other of the two pressed
 *   with it, and a hold key still held from before while it waits: nothing
 *   changes;
 * - `resume`: any other key: the overlay closes and the count starts over
 *   next time.
 */
export function overlayKey(event: FullScreenKey, holding: HoldKey | null): 'hold' | 'keep' | 'resume' {
  const hold = holdKeyOf(event);
  if (hold === null) return 'resume';
  if (holding !== null || event.repeat) return 'keep';
  return 'hold';
}
