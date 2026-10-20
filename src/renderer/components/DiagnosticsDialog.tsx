import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DIAGNOSTICS_LINK_SELECTOR,
  DIAGNOSTICS_TITLE,
  type DiagnosticsCopyState
} from '../../shared/ui/diagnostics';
import { call, errorMessage } from '../state/client';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
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
 * it. It asks main for the report once as it opens (`app:diagnostics`),
 * which runs no check of Claude or OpenAI, and puts the text on the
 * clipboard when Copy is pressed, or at once when opened by Copy
 * diagnostics.
 */
export function DiagnosticsDialog({ copyOnOpen, onClose }: Props): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<DiagnosticsCopyState>('idle');
  const boxRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const copiedOnOpen = useRef(false);
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, DIAGNOSTICS_LINK_SELECTOR, copyRef);

  /* Only the latest request's answer is shown, so the text on screen is the
     text copied: each report has its own time, and a development run's
     StrictMode asks twice as the dialog opens. */
  const latest = useRef(0);
  const fetchReport = useCallback(() => {
    const request = ++latest.current;
    call('app:diagnostics', undefined)
      .then((report) => {
        if (request === latest.current) setText(report.text);
      })
      .catch((err: unknown) => {
        if (request === latest.current) setError(errorMessage(err));
      });
  }, []);

  useEffect(() => {
    fetchReport();
    return () => {
      latest.current += 1;
    };
  }, [fetchReport]);

  const retry = (): void => {
    setError(null);
    setText(null);
    fetchReport();
  };

  const copy = useCallback((report: string) => {
    setCopyState('idle');
    navigator.clipboard.writeText(report).then(
      () => setCopyState('copied'),
      () => setCopyState('failed')
    );
  }, []);

  /* Copy diagnostics on Setup copies once, when the report first comes in. */
  useEffect(() => {
    if (!copyOnOpen || text === null || copiedOnOpen.current) return;
    copiedOnOpen.current = true;
    copy(text);
  }, [copyOnOpen, text, copy]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={DIAGNOSTICS_TITLE}>
      <div className="modal modal--diagnostics" ref={boxRef} tabIndex={-1}>
        <h2>{DIAGNOSTICS_TITLE}</h2>
        <DiagnosticsPanel
          text={text}
          error={error}
          copyState={copyState}
          onCopy={() => {
            if (text !== null) copy(text);
          }}
          onRetry={retry}
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
