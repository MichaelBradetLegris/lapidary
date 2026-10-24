import { useEffect, useId, useRef } from 'react';
import type { ChatGptStatus } from '../../shared/ipc';
import { setupFooterText } from '../../shared/ui/about';
import {
  ANOTHER_ACCOUNT_BUTTON,
  CANCEL_SIGN_IN_BUTTON,
  CHATGPT_PLAN_NOTE,
  CHATGPT_PRIVACY_FOOTER,
  MANAGE_USAGE_BUTTON,
  PLAN_WELCOME_DONE,
  PLAN_WELCOME_TEXT,
  PLAN_WELCOME_TITLE,
  SIGN_IN_BUTTON,
  SIGN_OUT_BUTTON,
  USING_CHATGPT_PLAN,
  chatGptSetupStatus,
  signInSucceeded,
  type ChatGptOutcome
} from '../../shared/ui/chatgpt';
import { SETUP_DONE } from '../../shared/ui/setup';
import { heldButton } from '../state/heldButton';
import { focusInView } from '../state/scroll';
import { useSetupEscape } from '../state/setupEscape';
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
  /**
   * OpenAI's first-sign-in welcome under the status card (codex.3): shown
   * while signed in until Got it, once on this computer (`planWelcomeShown`)
   */
  welcome?: boolean;
  /** Manage usage: ChatGPT's usage settings in the browser */
  onManageUsage?: () => void;
  /** Got it: the welcome goes for good */
  onWelcomeDone?: () => void;
  /**
   * Done, Close and Escape: leave Setup for where it was opened from, Review
   * with AI, the welcome guide or the chapter (setup.19, `setupLeave`)
   */
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
 * while signed in, OpenAI's first-sign-in welcome until Got it, and after it
 * OpenAI's "Using ChatGPT plan" with Manage usage on the card (codex.5
 * review); the training warning with its button and its box, always, as a
 * reminder; Done, the blue button at the foot, which leaves as Close and
 * Escape do and takes the focus once the sign-in has succeeded (setup.19);
 * the privacy footer and the version. Unlike Claude's view, this
 * one signs in: OpenAI documents this sign-in for open-source apps, where
 * Anthropic's policy forbids one (5.6 item 7, CLAUDE.md rule 2). Its words
 * are in `src/shared/ui/chatgpt.ts`.
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
  welcome = false,
  onManageUsage,
  onWelcomeDone,
  onClose,
  version = null
}: Props): React.JSX.Element {
  const welcomeId = useId();
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

  /* Got it takes the welcome away with the focus on it: the focus goes back
     to the account button too (codex.3). */
  const hadWelcome = useRef(welcome);
  useEffect(() => {
    if (hadWelcome.current && !welcome && document.activeElement === document.body) {
      accountButton.current?.focus();
    }
    hadWelcome.current = welcome;
  }, [welcome]);

  /* Done, Close and Escape leave alike (setup.19). Once the sign-in has
     succeeded, the focus goes to Done, wherever it was, so the author back
     from the browser leaves with Enter. The page keeps still while Done is in
     view, so the status card, which says "Signed in to ChatGPT", stays where
     it was; when Done is below the fold, as in a short window, at a large
     zoom or with OpenAI's welcome up, the page comes up just far enough to
     show it (`focusInView`, setup.19 review). After the wait's effect above,
     which would otherwise hand it to Sign out. */
  useSetupEscape(onClose);
  const pageRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const signedInNow = status?.signedIn ?? null;
  const wasSignedIn = useRef(signedInNow);
  useEffect(() => {
    if (signInSucceeded(wasSignedIn.current, signedInNow)) focusInView(doneRef.current, pageRef.current);
    wasSignedIn.current = signedInNow;
  }, [signedInNow]);

  return (
    <div
      ref={pageRef}
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
            {/* OpenAI's label for the plan in use, with Manage usage (its UI
                guidelines, Appendix A), which stays on the view once Got it
                has put the welcome away; while the welcome is up it says the
                same, with its own Manage usage. Review with AI had it by the
                model choice until codex.5 (C.116). */}
            {signedIn && !welcome ? (
              <p data-testid="chatgpt-plan-note">
                <b>{USING_CHATGPT_PLAN}.</b> {CHATGPT_PLAN_NOTE}
                {onManageUsage ? (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={onManageUsage}>
                      {MANAGE_USAGE_BUTTON}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="setup__status-actions">
            {/* One button, Sign in or Sign out, under one key, so the focus
                stays on it as the sign-in comes and goes; held, not
                disabled, while it waits or signs out (heldButton). */}
            {signedIn ? (
              <button key="account" type="button" ref={accountButton} {...heldButton(busy, onSignOut)}>
                {SIGN_OUT_BUTTON}
              </button>
            ) : (
              <button
                key="account"
                type="button"
                ref={accountButton}
                className="primary"
                disabled={!canSignIn}
                {...heldButton(waiting || status === null, () => onSignIn(false))}
              >
                {SIGN_IN_BUTTON}
              </button>
            )}
            {/* Cancel and Use another account are two buttons, each under its
                own key: Cancel goes when the wait ends, and the focus with it,
                which the effect above hands to the account button. Under one
                element a second Enter on Cancel would land on Use another
                account and register the app again (codex.2 review). */}
            {waiting ? (
              <button key="cancel" type="button" onClick={onCancelSignIn}>
                {CANCEL_SIGN_IN_BUTTON}
              </button>
            ) : !signedIn && status?.registered && canSignIn ? (
              <button key="another" type="button" onClick={() => onSignIn(true)}>
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

        {/* OpenAI's welcome after the first sign-in with the plan's use
            (its UI guidelines, Appendix A), inline rather than a modal: the
            view is already where the sign-in was made. Got it puts it away
            for good (`PLAN_WELCOME_HINT`). */}
        {welcome ? (
          <section
            className="setup__section chatgpt-welcome"
            aria-labelledby={`${welcomeId}-title`}
            data-testid="chatgpt-plan-welcome"
          >
            <h2 id={`${welcomeId}-title`}>{PLAN_WELCOME_TITLE}</h2>
            <p>{PLAN_WELCOME_TEXT}</p>
            <div className="chatgpt-welcome__actions">
              {onManageUsage ? (
                <button type="button" onClick={onManageUsage}>
                  {MANAGE_USAGE_BUTTON}
                </button>
              ) : null}
              {onWelcomeDone ? (
                <button type="button" className="primary" onClick={onWelcomeDone}>
                  {PLAN_WELCOME_DONE}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <DataSettingsWarning
          status={status}
          onOpenDataControls={onOpenDataControls}
          onConfirm={onConfirmDataSettings}
        />

        <div className="setup__foot">
          <button type="button" ref={doneRef} className="primary" onClick={onClose}>
            {SETUP_DONE}
          </button>
        </div>

        <p className="setup__footer">{CHATGPT_PRIVACY_FOOTER}</p>
        {version ? <p className="setup__version">{setupFooterText(version)}</p> : null}
      </div>
    </div>
  );
}
