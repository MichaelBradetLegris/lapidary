import { create } from 'zustand';
import type { EscapeTakers, FullScreenAction } from '../../shared/ui/fullScreen';
import { call, errorMessage } from './client';
import { popupTakesEscape, useDrawer } from './columns';
import { currentMode, isModalOpen, useApp, type AppState } from './store';

/**
 * Where the window stands (polish.23, PLAN section 7, Full screen), as main
 * last said: the toolbar's button and the page's class read it. Main decides
 * (`src/main/fullScreen.ts`); the page only asks, through
 * `window:full-screen`, and follows `window:full-screen-changed`, so a change
 * the page did not ask for, or one made before a reload, is followed too.
 * Its own store, so the keyboard bindings read it without the app's.
 */
export const useFullScreen = create<{ on: boolean }>(() => ({ on: false }));

/** The card's key when full screen could not be changed, so a newer card replaces the last. */
export const FULL_SCREEN_CARD = 'full-screen';

function ask(action: FullScreenAction): void {
  void call('window:full-screen', { action })
    .then(({ fullScreen }) => useFullScreen.setState({ on: fullScreen }))
    .catch((err: unknown) => {
      useApp
        .getState()
        .notify('error', `Full screen could not be changed: ${errorMessage(err)}`, FULL_SCREEN_CARD);
    });
}

/** F11 and the toolbar's button. */
export function toggleFullScreen(): void {
  ask('toggle');
}

/** Escape, when nothing else takes it (`fullScreenKey`). */
export function leaveFullScreen(): void {
  ask('leave');
}

/**
 * Follow main's word on full screen, and ask where the window stands now, for
 * a page that has just loaded, after a reload in full screen too. Returns the
 * unsubscribe. Outside the app window there is no bridge, and nothing to do.
 */
export function installFullScreen(): () => void {
  if (typeof window.api?.on !== 'function') return () => undefined;
  const off = window.api.on('window:full-screen-changed', ({ fullScreen }) =>
    useFullScreen.setState({ on: fullScreen })
  );
  // A start is never full screen, so a read that fails leaves the page as it began.
  void call('window:full-screen', { action: 'current' })
    .then(({ fullScreen }) => useFullScreen.setState({ on: fullScreen }))
    .catch(() => undefined);
  return off;
}

/**
 * What on the page takes Escape before full screen does (`escapeLeavesFullScreen`):
 * a dialog, a question, Settings, the Setup screen, the welcome guide or
 * Restart now's overlay; a toolbar menu, a chip's menu or the legend; a
 * suggestion's hover card; the find bar; the suggestion editor; a paragraph
 * box, or Full edit open or waiting to open; a drawer open from a folded
 * column. Read as the key comes, with the page's own menus and legend found
 * in the page, as `popupTakesEscape` finds them.
 */
export function escapeTakers(state: AppState): EscapeTakers {
  return {
    modal: isModalOpen(state),
    popup: popupTakesEscape(),
    hoverCard: state.hoveredHunkId !== null,
    find: state.find.open,
    editor: state.editor !== null,
    boxes: Object.keys(state.drafts).length > 0 || currentMode(state) === 'edit',
    drawer: useDrawer.getState().open !== null
  };
}
