import { useEffect, useRef } from 'react';
import { useApp } from '../state/store';

/**
 * The in-app confirmation for bulk actions (item 8). Not window.confirm: that
 * blocks the renderer, cannot be styled, and on Windows shows the app's own
 * title in a way that reads like a crash dialog. Escape cancels; the confirm
 * button takes focus so Enter accepts.
 */
export function ConfirmDialog(): React.JSX.Element | null {
  const spec = useApp((s) => s.confirmSpec);
  const answer = useApp((s) => s.answerConfirm);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!spec) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        answer(false);
      }
    };
    // Capture, so the review pane's own Escape handling never sees it first.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [spec, answer]);

  if (!spec) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={spec.title}>
      <div className="modal modal--narrow">
        <h2>{spec.title}</h2>
        <p className="modal__hint">{spec.body}</p>
        <div className="modal__actions">
          <span className="spacer" />
          <button type="button" onClick={() => answer(false)}>
            Cancel
          </button>
          <button type="button" className="primary" ref={confirmRef} onClick={() => answer(true)}>
            {spec.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
