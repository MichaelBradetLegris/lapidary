import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  dialogTakesEscape,
  firstFound,
  focusBeforeOpening,
  focusReturnTarget,
  inOtherDialog
} from '../../shared/ui/dialog';
import { selectListOpen } from './selectList';
import { useApp } from './store';

/**
 * What a dialog needs to behave as one (ui.1): Escape closes it, and the focus
 * goes into it as it opens and back where it was when it closes. The rules are
 * in `src/shared/ui/dialog.ts`. The page's own keys already do nothing behind
 * a dialog (`reviewKeysActive`, `isModalOpen`), and App makes the page inert
 * under it, so Tab stays inside it (`shellInert`, ui.4).
 */

/** Whether the key was pressed inside a `role="dialog"` other than the one holding `box` (`inOtherDialog`). */
function pressedInOtherDialog(event: KeyboardEvent, box: HTMLElement | null): boolean {
  const owner = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
  return inOtherDialog(owner, box);
}

/**
 * Escape closes the dialog whose `.modal` box is `box`, wherever the focus is
 * but in another dialog, such as a question over it, and never while Restart
 * now's overlay covers it (`dialogTakesEscape`, release.9 review).
 * The listener is on the window in the capture phase and stops the key there,
 * so the find bar behind the dialog never sees it (keyboard.ts); the
 * suggestion editor, if open, is under the dialog and inert (EditPopover). It
 * is added once, when the dialog opens, and calls the latest `onClose`, so a
 * re-render cannot move it after a question's listener.
 */
export function useDialogEscape(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // A select's open list takes Escape and closes on it by itself (theme.13).
      if (event.key === 'Escape' && selectListOpen()) return;
      const { confirmSpec, updateOverlay } = useApp.getState();
      const over = { question: confirmSpec !== null, overlay: updateOverlay };
      if (!dialogTakesEscape(event, over, pressedInOtherDialog(event, box.current))) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [box]);
}

/**
 * The focus goes into the dialog as it opens, on `first` when it is given,
 * such as New chapter's name field, else on `box` (give it `tabIndex={-1}`),
 * so Tab starts inside it and the arrow keys scroll it. Where it was is read
 * in the commit that makes the page inert under the dialog, before the
 * browser takes the focus off it (ui.4), unless the focus is in the dialog
 * already, as when a development run's StrictMode opens it a second time
 * (`focusBeforeOpening`). When the dialog closes, the focus goes back there,
 * or to what `fallbackSelector` finds (`focusReturnTarget`); given several,
 * the first of them found, in their order (`firstFound`). A list is a
 * constant, such as `UPDATE_OVERLAY_FOCUS_FALLBACK`: a new one at each render
 * would run the cleanup with the dialog still open.
 */
export function useDialogFocus(
  box: RefObject<HTMLElement | null>,
  fallbackSelector: string | readonly string[],
  first?: RefObject<HTMLElement | null>
): void {
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inDialog = active !== null && (box.current?.contains(active) ?? false);
    returnTo.current = focusBeforeOpening(active, inDialog, returnTo.current);
    (first?.current ?? box.current)?.focus({ preventScroll: true });
  }, [box, first]);

  /* After the commit that removed the dialog, so the page is as it will
     stay when the focus lands. StrictMode's pretend close runs this too,
     with the dialog still up and what is behind it inert, so the focus it
     hands back goes nowhere, and where it was is kept for the real close. */
  useEffect(
    () => () => {
      const fallback = firstFound(fallbackSelector, (s) => document.querySelector<HTMLElement>(s));
      focusReturnTarget(returnTo.current, document.body, fallback)?.focus({ preventScroll: true });
    },
    [fallbackSelector]
  );
}
