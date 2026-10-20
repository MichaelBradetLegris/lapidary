import type { Ref } from 'react';
import {
  COPY_DIAGNOSTICS,
  DIAGNOSTICS_INTRO,
  DIAGNOSTICS_LOADING,
  diagnosticsCopyLine,
  type DiagnosticsCopyState
} from '../../shared/ui/diagnostics';
import { heldButton } from '../state/heldButton';

interface Props {
  /** the report as main wrote it, or null while it is gathered */
  text: string | null;
  /** why it could not be gathered */
  error: string | null;
  copyState: DiagnosticsCopyState;
  onCopy: () => void;
  onRetry: () => void;
  /** the Copy button, which the dialog focuses as it opens */
  copyRef?: Ref<HTMLButtonElement>;
  /**
   * Copy is the blue button, as in the Diagnostics dialog; false on the page
   * shown after a crash, where Reload window is (hardening.4)
   */
  copyPrimary?: boolean;
}

/**
 * The diagnostics report and its Copy (hardening.5): what it holds and what
 * it never does, Copy diagnostics with a line saying how the copy went, and
 * the text itself, exactly what Copy puts on the clipboard, so the author
 * sees what they will paste. Copy is held, not disabled, while the report is
 * gathered, so the focus the dialog gives it stays (`heldButton`). Plain: the
 * Diagnostics dialog holds the state.
 */
export function DiagnosticsPanel({
  text,
  error,
  copyState,
  onCopy,
  onRetry,
  copyRef,
  copyPrimary = true
}: Props): React.JSX.Element {
  const line = diagnosticsCopyLine(copyState);
  return (
    <div className="diagnostics">
      <p className="modal__hint">{DIAGNOSTICS_INTRO}</p>
      <div className="diagnostics__copy">
        <button
          type="button"
          {...(copyPrimary ? { className: 'primary' } : {})}
          ref={copyRef}
          {...heldButton(text === null, onCopy)}
        >
          {COPY_DIAGNOSTICS}
        </button>
        <span
          className={`diagnostics__copied${copyState === 'failed' ? ' diagnostics__copied--failed' : ''}`}
          role="status"
        >
          {line}
        </span>
      </div>
      {error !== null ? (
        <p className="modal__hint modal__hint--error">
          {error}{' '}
          <button type="button" className="link" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : (
        <pre className="diagnostics__text" tabIndex={0} aria-label="Diagnostics text">
          {text ?? DIAGNOSTICS_LOADING}
        </pre>
      )}
    </div>
  );
}
