import { focusModeKey, holdKeyOf, overlayKey, type HoldKey } from '../../shared/ui/focusMode';
import type { EscapeTakers, FullScreenKey, FullScreenState } from '../../shared/ui/fullScreen';
import { call, errorMessage } from './client';
import {
  FOCUS_OVERLAY_CLOSED,
  escapeTakers,
  followFullScreen,
  showFocusOverlay,
  useFocusOverlay,
  useFullScreen
} from './fullScreen';
import { useApp } from './store';

/*
 * Focus mode, the page's half (focus.1, PLAN section 7, Focus mode). Main
 * holds the window in focus mode (`src/main/fullScreen.ts`); the page shows
 * the hold that leaves it and sends the one word main takes to leave,
 * `release`, once F11 or Escape has been held for the time set.
 *
 * - The keys are caught on the window in the capture phase, before anything
 *   else on the page sees them. In focus mode, a fresh press of F11, or of
 *   Escape when nothing else takes it, opens the overlay and starts the
 *   count from that press (`focusModeKey`). While the overlay shows, every
 *   key is kept from the page, so nothing is typed into a box and no
 *   shortcut runs (`overlayKey`): F11 or Escape alone starts the count while
 *   it waits, letting go of the key held before the time is up closes it, and
 *   so does any other key. A key the overlay took keeps its repeats and its
 *   release from the page until it is let go, so an Escape held past the end
 *   of the hold never closes a box.
 * - A click anywhere closes it (`resumeFocus`, from `FocusOverlay`), and so
 *   does the window losing the focus, after which a key's release would never
 *   be heard. The count starts over next time.
 * - When the time is up, main is asked to `release`; once it says focus mode
 *   has been left, the overlay goes. Main can also leave on its own (a page
 *   that stopped answering, a crash, a quit), which closes the overlay too.
 * - A close request or Restart now waits on the hold (`holdToLeave`, from
 *   the close guard): the overlay opens, and they go on only once the hold has
 *   taken the window out of focus mode, or stop when it is closed.
 */

/** The parts of a key event focus mode reads, and how it keeps one from the page. */
export interface FocusKeyEvent extends FullScreenKey {
  /** the physical key, so a release is matched whatever Shift did to `key` */
  code: string;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}

/** Where focus mode listens: the window. */
export interface FocusTarget {
  addEventListener(type: string, listener: (event: Event) => void, options?: { capture: boolean }): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: { capture: boolean }): void;
}

/** The capture phase, as an options object, which every EventTarget takes the same way on removal too. */
const CAPTURE = { capture: true };

export interface FocusModeDeps {
  /** what else on the page takes Escape (`escapeTakers`), read as Escape comes */
  escapeTakers(): EscapeTakers;
  /** main's word to leave focus mode and full screen: `window:full-screen` with `release` */
  release(): Promise<FullScreenState>;
  /** the clock the count runs on, in ms */
  now(): number;
  /** a card when main could not be asked */
  notify(message: string): void;
}

/** The card's key when focus mode could not be left. */
export const FOCUS_CARD = 'focus-mode';

const PAGE_DEPS: FocusModeDeps = {
  escapeTakers: () => escapeTakers(useApp.getState()),
  release: () => call('window:full-screen', { action: 'release' }),
  now: () => performance.now(),
  notify: (message) => useApp.getState().notify('error', message, FOCUS_CARD)
};

const NOTHING_TAKES_ESCAPE: EscapeTakers = Object.freeze({
  modal: false,
  popup: false,
  hoverCard: false,
  find: false,
  editor: false,
  boxes: false,
  drawer: false
});

let deps: FocusModeDeps = PAGE_DEPS;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
/** keys whose press the overlay took: their repeats and release are its too, until let go */
const draining = new Set<string>();
/** a close or Restart now waiting on the hold: true once focus mode is left, false when the overlay closes */
let waiters: ((left: boolean) => void)[] = [];

function keep(event: FocusKeyEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

const codeOf = (event: FocusKeyEvent): string => event.code || event.key;

function clearHold(): void {
  if (holdTimer !== null) clearTimeout(holdTimer);
  holdTimer = null;
}

function settle(left: boolean): void {
  const waiting = waiters;
  waiters = [];
  for (const resolve of waiting) resolve(left);
}

/** Close the overlay; `left` when focus mode has been left, which lets what waited on the hold go on. */
function closeOverlay(left: boolean): void {
  clearHold();
  if (useFocusOverlay.getState().open) useFocusOverlay.setState(FOCUS_OVERLAY_CLOSED);
  settle(left);
}

/**
 * Back to the chapter: a click, any other key, or the window losing the focus
 * closes the overlay, and the count starts over next time. A key still held
 * keeps its repeats and its release from the page.
 */
export function resumeFocus(): void {
  const overlay = useFocusOverlay.getState();
  if (!overlay.open || overlay.leaving) return;
  if (overlay.heldCode !== null) draining.add(overlay.heldCode);
  closeOverlay(false);
}

/** The time is up: ask main to leave, and close the overlay once it has. */
function complete(): void {
  holdTimer = null;
  const overlay = useFocusOverlay.getState();
  if (!overlay.open || overlay.holding === null) return;
  // The key is still down: its repeats and its release are not the page's.
  if (overlay.heldCode !== null) draining.add(overlay.heldCode);
  useFocusOverlay.setState({ leaving: true });
  deps.release().then(
    (state) => {
      // Main says focus mode has gone, which closes the overlay (installFocusMode).
      followFullScreen(state);
      if (useFocusOverlay.getState().open) closeOverlay(state.focus === null);
    },
    (err: unknown) => {
      deps.notify(`Focus mode could not be left: ${errorMessage(err)}`);
      closeOverlay(false);
    }
  );
}

function startHold(key: HoldKey, code: string): void {
  const focus = useFullScreen.getState().focus;
  if (focus === null) return;
  clearHold();
  useFocusOverlay.setState({ open: true, holding: key, heldCode: code, since: deps.now(), leaving: false });
  holdTimer = setTimeout(complete, focus.holdSeconds * 1000);
}

/** A key pressed: the overlay's while it shows, the hold's when it starts one, else the page's. */
export function focusKeyDown(event: FocusKeyEvent): void {
  const code = codeOf(event);
  if (draining.has(code)) {
    if (event.repeat) {
      keep(event);
      return;
    }
    // Pressed afresh: it was let go where the page did not hear it.
    draining.delete(code);
  }
  const overlay = useFocusOverlay.getState();
  if (overlay.open) {
    keep(event);
    if (overlay.leaving) return;
    const action = overlayKey(event, overlay.holding);
    const hold = holdKeyOf(event);
    if (action === 'hold' && hold !== null) {
      startHold(hold, code);
    } else if (action === 'resume') {
      draining.add(code);
      resumeFocus();
    }
    return;
  }
  if (useFullScreen.getState().focus === null) return;
  const over = event.key === 'Escape' ? deps.escapeTakers() : NOTHING_TAKES_ESCAPE;
  const action = focusModeKey(event, over);
  if (action === 'pass') return;
  keep(event);
  const hold = holdKeyOf(event);
  if (action === 'hold' && hold !== null) {
    showFocusOverlay();
    startHold(hold, code);
  }
}

/** A key let go: the end of a hold before its time, or one the overlay took. */
export function focusKeyUp(event: FocusKeyEvent): void {
  const code = codeOf(event);
  if (draining.delete(code)) {
    keep(event);
    return;
  }
  const overlay = useFocusOverlay.getState();
  if (!overlay.open) return;
  keep(event);
  if (!overlay.leaving && overlay.heldCode === code) closeOverlay(false);
}

/** The window lost the focus: a key's release would not be heard, so the overlay closes. */
export function focusWindowBlur(): void {
  draining.clear();
  const overlay = useFocusOverlay.getState();
  if (overlay.open && !overlay.leaving) closeOverlay(false);
}

/**
 * For a close request and Restart now (the close guard's `focusHold`): null
 * outside focus mode, else the overlay opens, or stays, and the promise says
 * true once the hold has taken the window out of focus mode, or false when
 * the overlay closes first.
 */
export function holdToLeave(): Promise<boolean> | null {
  if (useFullScreen.getState().focus === null) return null;
  showFocusOverlay();
  return new Promise<boolean>((resolve) => {
    waiters.push(resolve);
  });
}

/**
 * Listen for the keys and the window's blur (App, once; a development run's
 * StrictMode installs twice, and the second replaces the first). Returns the
 * uninstall, which closes an overlay left open.
 */
export function installFocusMode(target: FocusTarget = window, given: FocusModeDeps = PAGE_DEPS): () => void {
  deps = given;
  const onKeyDown = (event: Event): void => focusKeyDown(event as unknown as FocusKeyEvent);
  const onKeyUp = (event: Event): void => focusKeyUp(event as unknown as FocusKeyEvent);
  const onBlur = (): void => focusWindowBlur();
  target.addEventListener('keydown', onKeyDown, CAPTURE);
  target.addEventListener('keyup', onKeyUp, CAPTURE);
  target.addEventListener('blur', onBlur);
  // Main left focus mode, on the hold's word or its own: the overlay goes, and what waited goes on.
  const off = useFullScreen.subscribe((now, before) => {
    if (before.focus !== null && now.focus === null) closeOverlay(true);
  });
  return () => {
    target.removeEventListener('keydown', onKeyDown, CAPTURE);
    target.removeEventListener('keyup', onKeyUp, CAPTURE);
    target.removeEventListener('blur', onBlur);
    off();
    draining.clear();
    closeOverlay(false);
    deps = PAGE_DEPS;
  };
}
