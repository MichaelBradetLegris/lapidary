import { useEffect, useLayoutEffect, useRef } from 'react';
import { bodyLines, confirmButtons, focusedChoice, type ConfirmChoice } from '../../shared/ui/confirm';
import { useApp } from '../state/store';

/**
 * Focus that always shows its ring. Chromium leaves the ring off a button that
 * code focuses straight after a mouse click, so a question opened by a click
 * would hide which button Enter answers; in a three-way question that is not
 * the blue one. `focusVisible` is Chromium's (Electron 44), not yet in
 * TypeScript's DOM types.
 */
const FOCUS_WITH_RING: FocusOptions & { focusVisible: boolean } = { focusVisible: true };

/**
 * The in-app confirmation (item 8): bulk actions, replacing or leaving what is
 * on screen, and from apply.6 the three-way questions before leaving a chapter
 * or closing the window. Not window.confirm: that blocks the renderer, cannot
 * be styled, and on Windows shows the app's own title in a way that reads like
 * a crash dialog. The buttons run Cancel, then the middle choice if there is
 * one, then the blue confirm; the question's default takes the focus, confirm
 * unless it names another, so Enter picks it, and shows its focus ring however
 * the question was opened. Escape cancels.
 *
 * A question can be asked from inside another dialog or with the suggestion
 * editor open, so it sits above every other surface: its backdrop has a layer
 * of its own (`.modal-backdrop--confirm`), and App renders it last.
 *
 * It holds the keyboard too: while it is open App makes the rest of the window
 * inert, so Tab cannot reach the toolbar, the chapter list or History behind
 * it (apply.7 review). When it closes, the focus goes back to where it was
 * when it opened, a list row or a paragraph box, if that is still there.
 *
 * Only focus mode's overlay stands over it (focus.1), and App makes it inert
 * while that shows (`inert`, `shellInert`'s `over`), so nothing reaches its
 * buttons under the hold, a screen reader's cursor included (focus.1 review).
 */
export function ConfirmDialog({ inert = false }: { inert?: boolean }): React.JSX.Element | null {
  const spec = useApp((s) => s.confirmSpec);
  const answer = useApp((s) => s.answerChoice);
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Partial<Record<ConfirmChoice, HTMLButtonElement | null>>>({});
  const open = spec !== null;
  const returnTo = useRef<Element | null>(null);

  /* Where the focus is as the question opens, read in the commit that makes
     the page behind it inert, before the browser takes the focus off it. A
     question that replaces another keeps the first one's. */
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    if (open) return;
    const back = returnTo.current;
    returnTo.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!spec) return;
    buttonRefs.current[focusedChoice(spec)]?.focus(FOCUS_WITH_RING);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        answer('cancel');
      }
    };
    // Capture, so the review pane's own Escape handling never sees it first.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [spec, answer]);

  /* A question asked while focus mode's overlay covered it could not take the
     focus, being inert then: its default takes it as the overlay goes, unless
     the overlay has handed it back to one of its buttons (focus.1 review). */
  useEffect(() => {
    if (!spec || inert || boxRef.current?.contains(document.activeElement)) return;
    buttonRefs.current[focusedChoice(spec)]?.focus(FOCUS_WITH_RING);
  }, [spec, inert]);

  if (!spec) return null;

  // A question with a middle choice has longer labels, so its dialog is wider.
  return (
    <div
      className="modal-backdrop modal-backdrop--confirm"
      role="dialog"
      aria-modal="true"
      aria-label={spec.title}
      inert={inert}
    >
      <div
        className={spec.altLabel ? 'modal modal--narrow modal--choice' : 'modal modal--narrow'}
        ref={boxRef}
      >
        <h2>{spec.title}</h2>
        {bodyLines(spec.body).map((line, i) => (
          <p key={i} className="modal__hint">
            {line}
          </p>
        ))}
        <div className="modal__actions modal__actions--confirm">
          <span className="spacer" />
          {confirmButtons(spec).map((button) => (
            <button
              key={button.choice}
              type="button"
              className={button.primary ? 'primary' : undefined}
              ref={(el) => {
                buttonRefs.current[button.choice] = el;
              }}
              onClick={() => answer(button.choice)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
