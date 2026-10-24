import { useEffect, useRef } from 'react';
import type { ChatGptStatus } from '../../shared/ipc';
import { setupFooterText } from '../../shared/ui/about';
import {
  ANOTHER_ACCOUNT_BUTTON,
  CANCEL_SIGN_IN_BUTTON,
  CHATGPT_PRIVACY_FOOTER,
  SIGN_IN_BUTTON,
  SIGN_OUT_BUTTON,
  chatGptSetupStatus
} from '../../shared/ui/chatgpt';
import type { ChatGptOutcome } from '../state/chatgpt';
import { heldButton } from '../state/heldButton';
import { DataSettingsWarning } from './DataSettingsWarning';

interface Props {
  /** null until main has answered */
  status: ChatGptStatus | null;
  /** a sign-in is waiting for the browser */
  waiting: boolean;
  /** a sign-out is under way */
  busy: boolean;
  /** how the last sign-in or sign-out went, under the buttons */
  outcome: ChatGptOutcome | null;
  onSignIn: (another: boolean) => void;
  onCancelSignIn: () => void;
  onSignOut: () => void;
  onConfirmDataSettings: (confirmed: boolean) => void;
  onOpenDataControls: () => void;
  onClose: () => void;
  /** the app's version, for the last line, as Claude's view has it (release.9) */
  version?: string | null;
}

/**
 * The Setup screen's ChatGPT view (codex.2, PLAN 5.7), in the Setup screen's
 * layout (5.6 item 5): "Set up ChatGPT" with Close; a status card that says
 * whether a sign-in is kept and the plan it named, with Sign in with ChatGPT,
 * which opens OpenAI's page in the browser and waits for its answer, or Sign
 * out, and Use another account once an earlier sign-in registered the app;
 * the training warning with its button and its box, always, as a reminder;
 * the privacy footer and the version. Unlike Claude's view, this one signs
 * in: OpenAI documents this sign-in for open-source apps, where Anthropic's
 * policy forbids one (5.6 item 7, CLAUDE.md rule 2). Its words are in
 * `src/shared/ui/chatgpt.ts`.
 */
export function ChatGptSetup({
  status,
  waiting,
  busy,
  outcome,
  onSignIn,
  onCancelSignIn,
  onSignOut,
  onConfirmDataSettings,
  onOpenDataControls,
  onClose,
  version = null
}: Props): React.JSX.Element {
  const card = chatGptSetupStatus(status, waiting);
  const signedIn = status?.signedIn === true;
  const canSignIn = status?.encryptionAvailable !== false;
  const accountButton = useRef<HTMLButtonElement>(null);

  /* Cancel goes once the wait ends; a focus left on nothing goes back to the
     account button, so the keyboard carries on from the card. */
  const wasWaiting = useRef(waiting);
  useEffect(() => {
    if (wasWaiting.current && !waiting && document.activeElement === document.body) {
      accountButton.current?.focus();
    }
    wasWaiting.current = waiting;
  }, [waiting]);

  return (
    <div
      className="setup"
      data-view={`chatgpt-${signedIn ? 'signed-in' : waiting ? 'waiting' : 'signed-out'}`}
    >
      <div className="setup__page">
        <div className="setup__head">
          <h1>Set up ChatGPT</h1>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <section
          className={`setup__status setup__status--${card.tone}`}
          role="status"
          aria-live="polite"
          aria-label="ChatGPT status"
        >
          <div className="setup__status-text">
            <h2>{card.title}</h2>
            {card.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="setup__status-actions">
            {/* One button, Sign in or Sign out, so the focus stays on it as
                the sign-in comes and goes; held, not disabled, while it
                waits or signs out (heldButton). */}
            {signedIn ? (
              <button type="button" ref={accountButton} {...heldButton(busy, onSignOut)}>
                {SIGN_OUT_BUTTON}
              </button>
            ) : (
              <button
                type="button"
                ref={accountButton}
                className="primary"
                disabled={!canSignIn}
                {...heldButton(waiting || status === null, () => onSignIn(false))}
              >
                {SIGN_IN_BUTTON}
              </button>
            )}
            {waiting ? (
              <button type="button" onClick={onCancelSignIn}>
                {CANCEL_SIGN_IN_BUTTON}
              </button>
            ) : !signedIn && status?.registered && canSignIn ? (
              <button type="button" onClick={() => onSignIn(true)}>
                {ANOTHER_ACCOUNT_BUTTON}
              </button>
            ) : null}
          </div>
          {outcome ? (
            <div className="setup__test">
              <p className={`setup__test-result setup__test-result--${outcome.tone}`}>{outcome.text}</p>
            </div>
          ) : null}
        </section>

        <DataSettingsWarning
          status={status}
          onOpenDataControls={onOpenDataControls}
          onConfirm={onConfirmDataSettings}
        />

        <p className="setup__footer">{CHATGPT_PRIVACY_FOOTER}</p>
        {version ? <p className="setup__version">{setupFooterText(version)}</p> : null}
      </div>
    </div>
  );
}
