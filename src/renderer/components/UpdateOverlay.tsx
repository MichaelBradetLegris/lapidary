import { useLayoutEffect, useRef } from 'react';
import { updateOverlayText } from '../../shared/ui/update';
import type { UpdateStatus } from '../../shared/updates';

interface Props {
  update: UpdateStatus | null;
}

/**
 * Restart now's overlay (`release.9`, PLAN 11.3 n): over the whole window
 * from the moment the page has agreed to go, after the close question, until
 * the installer closes the app, so nothing more can be decided or typed that
 * the install would lose. App makes the page and the dialogs inert under it
 * (`shellInert`), and the page's keys do nothing (`isModalOpen`); it has no
 * button, and Escape does nothing. It takes the focus as it shows, so a
 * screen reader reads it. An install that fails takes it away, and the update
 * card says why.
 */
export function UpdateOverlay({ update }: Props): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const { title, body } = updateOverlayText(update);

  useLayoutEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      className="modal-backdrop modal-backdrop--overlay"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal modal--narrow update-overlay" ref={boxRef} tabIndex={-1} aria-busy="true">
        <div className="update-overlay__head">
          <span className="lock-card__spinner" aria-hidden="true" />
          <h2>{title}</h2>
        </div>
        <p className="modal__hint">{body}</p>
      </div>
    </div>
  );
}
