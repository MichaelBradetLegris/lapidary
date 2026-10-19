import type { ClaudeUpdateAdvice } from '../../shared/ai/claudeStatus';
import { Command } from './Command';

interface Props {
  advice: ClaudeUpdateAdvice;
  /** the review dialog's Check again; the Setup screen has its own in the status card */
  onCheckAgain?: () => void;
  checking?: boolean;
}

/**
 * "Claude Code 2.1.266 is out of date": an installed Claude Code older than the
 * one the app was last checked with may not offer the newest models (setup.6).
 * The review dialog shows it beside the model list, and the Setup screen under
 * its status card (setup.7).
 */
export function UpdateNote({ advice, onCheckAgain, checking = false }: Props): React.JSX.Element {
  return (
    <div className="modal__warn modal__warn--stack" role="note" data-testid="claude-update-note">
      <span>
        Claude Code {advice.installed} is out of date, so it may not offer the newest models. Version{' '}
        {advice.recommended} or newer is recommended. To update it, run this in a terminal, then check again:
      </span>
      <Command text={advice.command} />
      {advice.fullPathCommand ? (
        <>
          <span className="modal__note">
            If the terminal does not recognise <code>claude</code>, use this instead:
          </span>
          <Command text={advice.fullPathCommand} />
        </>
      ) : null}
      {onCheckAgain ? (
        <span className="modal__buttons">
          <button type="button" disabled={checking} onClick={onCheckAgain}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </span>
      ) : null}
    </div>
  );
}
