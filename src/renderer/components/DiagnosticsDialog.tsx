import { useRef } from 'react';
import { DIAGNOSTICS_LINK_SELECTOR, DIAGNOSTICS_TITLE } from '../../shared/ui/diagnostics';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
import { useDiagnosticsReport } from '../state/diagnosticsReport';
import { DiagnosticsPanel } from './DiagnosticsPanel';

interface Props {
  /**
   * copy the report as soon as it is in: Setup's Copy diagnostics, which says
   * what it does; a card's Show diagnostics only shows it
   */
  copyOnOpen: boolean;
  onClose: () => void;
}

/**
 * Diagnostics (hardening.5), a modal like Settings (ui.1, ui.4): Escape and
 * Close close it, the focus goes to its Copy as it opens and back where it
 * was, Setup's link as a rule, when it closes, and the page is inert behind
 * it. It asks main for the report once as it opens (`app:diagnostics`,
 * `useDiagnosticsReport`), which runs no check of Claude or OpenAI, and puts
 * the text on the clipboard when Copy is pressed, or at once when opened by
 * Copy diagnostics.
 */
export function DiagnosticsDialog({ copyOnOpen, onClose }: Props): React.JSX.Element {
  const report = useDiagnosticsReport(copyOnOpen);
  const boxRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, DIAGNOSTICS_LINK_SELECTOR, copyRef);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={DIAGNOSTICS_TITLE}>
      <div className="modal modal--diagnostics" ref={boxRef} tabIndex={-1}>
        <h2>{DIAGNOSTICS_TITLE}</h2>
        <DiagnosticsPanel
          text={report.text}
          error={report.error}
          copyState={report.copyState}
          onCopy={report.copy}
          onRetry={report.retry}
          copyRef={copyRef}
        />
        <div className="modal__actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
