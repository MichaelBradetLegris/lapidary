import { useEffect, useLayoutEffect, useRef } from 'react';
import { setupTakesEscape } from '../../shared/ui/setup';
import { popupTakesEscape } from './columns';
import { useApp } from './store';

/**
 * Escape leaves the Setup screen, as its Close and Done do (setup.19), unless
 * something over it takes the key first (`setupTakesEscape`): a dialog, which
 * closes on it in its own listener (`useDialogEscape`) or, for New chapter
 * and Submit manual review, ignores it; a question; Restart now's overlay; or
 * a toolbar menu or the status bar's legend, which close on it in listeners
 * of their own that may run after this one (`popupTakesEscape`). The listener
 * is on the window in the bubble phase, after the dialogs' and the
 * question's, which run in the capture phase and stop the key there. It is
 * added once, as the screen is drawn, and calls the latest `onLeave`.
 */
export function useSetupEscape(onLeave: () => void): void {
  const leave = useRef(onLeave);
  useLayoutEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useApp.getState();
      const over = {
        dialog:
          state.newChapterOpen ||
          state.manualReviewOpen ||
          state.reviewDialogOpen ||
          state.settingsOpen ||
          state.diagnosticsOpen !== null ||
          state.aboutOpen,
        question: state.confirmSpec !== null,
        overlay: state.updateOverlay,
        popup: popupTakesEscape()
      };
      if (!setupTakesEscape(event, over)) return;
      event.preventDefault();
      leave.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
