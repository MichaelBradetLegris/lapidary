import { create } from 'zustand';
import type { FocusModeState, HoldKey } from '../../shared/ui/focusMode';
import type { EscapeTakers, FullScreenAction, FullScreenState } from '../../shared/ui/fullScreen';
import { selectListOpen } from './selectList';
import { call, errorMessage } from './client';
import { popupTakesEscape, useDrawer } from './columns';
import { currentMode, isModalOpen, useApp, type AppState } from './store';

/**
 * Where the window stands (polish.23, PLAN section 7, Full screen), as main
 * last said: the toolbar's button and the page's class read it, and so does
 * focus mode (focus.1): `focus` is null outside it, else the hold time it was
 * entered with. Main decides (`src/main/fullScreen.ts`); the page only asks,
 * through `window:full-screen`, and follows `window:full-screen-changed`, so
 * a change the page did not ask for, or one made before a reload, is followed
 * too. Its own store, so the keyboard bindings read it without the app's.
 */
export const useFullScreen = create<{ on: boolean; focus: FocusModeState | null }>(() => ({
  on: false,
  focus: null
}));

/**
 * Focus mode's overlay (focus.1, `FocusOverlay`): shown over everything while
 * the author holds F11 or Escape to leave, or while it waits for one, opened
 * by the toolbar's button, a close request or Restart now. `holding` is the
 * key held and `since` when it was pressed, both null while it waits;
 * `leaving` once the hold has run its time and main has been asked to leave.
 * `state/focusMode.ts` drives it from the keys, the clock and main's answers.
 */
export interface FocusOverlayState {
  open: boolean;
  holding: HoldKey | null;
  /** the physical key held (`KeyboardEvent.code`), whose release ends the hold early */
  heldCode: string | null;
  since: number | null;
  leaving: boolean;
}

export const FOCUS_OVERLAY_CLOSED: FocusOverlayState = Object.freeze({
  open: false,
  holding: null,
  heldCode: null,
  since: null,
  leaving: false
});

export const useFocusOverlay = create<FocusOverlayState>(() => ({ ...FOCUS_OVERLAY_CLOSED }));

/**
 * Show focus mode's overlay, waiting for F11 or Escape to be held, when the
 * window is in focus mode and it is not up already. The toolbar's button,
 * Escape with a modifier and a leave main kept all come here (focus.1).
 */
export function showFocusOverlay(): void {
  if (useFullScreen.getState().focus === null || useFocusOverlay.getState().open) return;
  useFocusOverlay.setState({ ...FOCUS_OVERLAY_CLOSED, open: true });
}

/** The card's key when full screen could not be changed, so a newer card replaces the last. */
export const FULL_SCREEN_CARD = 'full-screen';

/** Follow what main says, from an answer or an event. */
export function followFullScreen(state: FullScreenState): void {
  useFullScreen.setState({ on: state.fullScreen, focus: state.focus });
}

function ask(action: FullScreenAction): void {
  const out = action === 'leave' || (action === 'toggle' && useFullScreen.getState().on);
  void call('window:full-screen', { action })
    .then((state) => {
      followFullScreen(state);
      // Asked to leave, main kept the window in focus mode, which the page had
      // not heard of yet: the hold is the way out (focus.1).
      if (out && state.focus !== null && state.fullScreen) showFocusOverlay();
    })
    .catch((err: unknown) => {
      useApp
        .getState()
        .notify('error', `Full screen could not be changed: ${errorMessage(err)}`, FULL_SCREEN_CARD);
    });
}

/** F11 and the toolbar's button; in focus mode, the hold's overlay (focus.1). */
export function toggleFullScreen(): void {
  if (useFullScreen.getState().focus !== null) {
    showFocusOverlay();
    return;
  }
  ask('toggle');
}

/** Escape, when nothing else takes it (`fullScreenKey`); in focus mode, the hold's overlay (focus.1). */
export function leaveFullScreen(): void {
  if (useFullScreen.getState().focus !== null) {
    showFocusOverlay();
    return;
  }
  ask('leave');
}

/**
 * Follow main's word on full screen, and ask where the window stands now, for
 * a page that has just loaded, after a reload in full screen too. A change
 * main made in focus mode to put the window back in full screen (`kept`)
 * shows the hold, as F11 would. Returns the unsubscribe. Outside the app
 * window there is no bridge, and nothing to do.
 */
export function installFullScreen(): () => void {
  if (typeof window.api?.on !== 'function') return () => undefined;
  const off = window.api.on('window:full-screen-changed', (change) => {
    followFullScreen(change);
    if (change.kept === true) showFocusOverlay();
  });
  // A start is never full screen, so a read that fails leaves the page as it began.
  void call('window:full-screen', { action: 'current' })
    .then(followFullScreen)
    .catch(() => undefined);
  return off;
}

/**
 * What on the page takes Escape before full screen does (`escapeLeavesFullScreen`):
 * a dialog, a question, Settings, the Setup screen, the welcome guide or
 * Restart now's overlay; a toolbar menu, a chip's menu or the legend; a
 * suggestion's hover card; the find bar; the suggestion editor; a paragraph
 * box open in Main, or Full edit open or waiting to open; a drawer open from
 * a folded column. A paragraph box kept behind Preview is not drawn, so it
 * takes nothing there. Read as the key comes, with the page's own menus and
 * legend found in the page, as `popupTakesEscape` finds them.
 */
export function escapeTakers(state: AppState): EscapeTakers {
  const mode = currentMode(state);
  return {
    modal: isModalOpen(state),
    popup: popupTakesEscape(),
    hoverCard: state.hoveredHunkId !== null,
    find: state.find.open,
    editor: state.editor !== null,
    boxes: mode === 'edit' || (mode === 'main' && Object.keys(state.drafts).length > 0),
    drawer: useDrawer.getState().open !== null,
    list: selectListOpen()
  };
}
