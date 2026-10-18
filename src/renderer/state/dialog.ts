import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { dialogTakesEscape, focusReturnTarget } from '../../shared/ui/dialog';
import { useApp } from './store';

/**
 * What a dialog needs to behave as one (ui.1): Escape closes it, and the focus
 * goes into it as it opens and back where it was when it closes. The rules are
 * in `src/shared/ui/dialog.ts`. The page's own keys already do nothing behind
 * a dialog (`reviewKeysActive`, `isModalOpen`).
 */

/** Whether the key was pressed inside a `role="dialog"` other than the one holding `box`. */
function pressedInOtherDialog(event: KeyboardEvent, box: HTMLElement | null): boolean {
  const owner = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
  return owner !== null && !(box !== null && owner.contains(box));
}

/**
 * Escape closes the dialog whose `.modal` box is `box`, wherever the focus is
 * but in another dialog (`dialogTakesEscape`). The listener is on the window
 * in the capture phase and stops the key there, so the find bar and the
 * suggestion editor behind the dialog never see it (keyboard.ts). It is added
 * once, when the dialog opens, and calls the latest `onClose`, so a re-render
 * cannot move it after a question's listener.
 */
export function useDialogEscape(box: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const questionOpen = useApp.getState().confirmSpec !== null;
      if (!dialogTakesEscape(event, questionOpen, pressedInOtherDialog(event, box.current))) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [box]);
}

/**
 * The focus goes into the dialog as it opens, on `box` (give it
 * `tabIndex={-1}`), so Tab starts inside it and the arrow keys scroll it. When
 * it closes, the focus goes back where it was, or to what `fallbackSelector`
 * finds (`focusReturnTarget`).
 */
export function useDialogFocus(box: RefObject<HTMLElement | null>, fallbackSelector: string): void {
  const returnTo = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const active = document.activeElement;
    returnTo.current = active instanceof HTMLElement ? active : null;
    box.current?.focus({ preventScroll: true });
  }, [box]);

  /* After the commit that removed the dialog, so the page is as it will
     stay when the focus lands. */
  useEffect(
    () => () => {
      const fallback = document.querySelector<HTMLElement>(fallbackSelector);
      focusReturnTarget(returnTo.current, document.body, fallback)?.focus({ preventScroll: true });
      returnTo.current = null;
    },
    [fallbackSelector]
  );
}
