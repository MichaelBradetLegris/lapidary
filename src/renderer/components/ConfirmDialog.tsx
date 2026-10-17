import { useEffect, useRef } from 'react';
import { bodyLines, confirmButtons, focusedChoice, type ConfirmChoice } from '../../shared/ui/confirm';
import { useApp } from '../state/store';

/**
 * The in-app confirmation (item 8): bulk actions, replacing or leaving what is
 * on screen, and from apply.6 the three-way questions before leaving a chapter
 * or closing the window. Not window.confirm: that blocks the renderer, cannot
 * be styled, and on Windows shows the app's own title in a way that reads like
 * a crash dialog. The buttons run Cancel, then the middle choice if there is
 * one, then the blue confirm; the question's default takes the focus, confirm
 * unless it names another, so Enter picks it. Escape cancels.
 */
export function ConfirmDialog(): React.JSX.Element | null {
  const spec = useApp((s) => s.confirmSpec);
  const answer = useApp((s) => s.answerChoice);
  const buttonRefs = useRef<Partial<Record<ConfirmChoice, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!spec) return;
    buttonRefs.current[focusedChoice(spec)]?.focus();
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

  if (!spec) return null;

  // A question with a middle choice has longer labels, so its dialog is wider.
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={spec.title}>
      <div className={spec.altLabel ? 'modal modal--narrow modal--choice' : 'modal modal--narrow'}>
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
