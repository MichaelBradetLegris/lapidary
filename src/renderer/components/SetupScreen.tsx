import { useEffect, useRef, useState } from 'react';
import type { RateLimitInfo, RuntimeStatus } from '../../shared/ipc';
import {
  CONNECTION_TEST_RUNNING,
  FULL_PATH_TEXT,
  OTHER_INSTALLS_NOTE,
  PRIVACY_FOOTER,
  SETUP_DONE,
  advancedRows,
  canTestConnection,
  claudeSetupSucceeded,
  connectionTestLine,
  connectionTestNote,
  needsSetup,
  osFromUserAgent,
  otherInstalls,
  setupStatus,
  setupSteps,
  setupTroubleshooting,
  setupView,
  stepsHeading,
  updateAdvice,
  type ConnectionTestOutcome,
  type LastFailure,
  type SetupOs
} from '../../shared/ui/setup';
import { setupFooterText } from '../../shared/ui/about';
import { COPY_DIAGNOSTICS, SETUP_DIAGNOSTICS_TEXT } from '../../shared/ui/diagnostics';
import { heldButton } from '../state/heldButton';
import { focusInView } from '../state/scroll';
import { useSetupEscape } from '../state/setupEscape';
import { Command } from './Command';
import { UpdateNote } from './UpdateNote';

interface Props {
  /** null while the first check runs */
  runtime: RuntimeStatus | null;
  lastFailure: LastFailure | null;
  /** a check is running */
  checking: boolean;
  /** the system whose commands show first; `host` when left out */
  os?: SetupOs;
  /**
   * the system this machine runs, the user agent's when left out: only its
   * own tab gives the full-path forms, since the path is this machine's
   */
  host?: SetupOs;
  onCheckAgain: () => void;
  /**
   * Done, Close and Escape: leave Setup for where it was opened from, Review
   * with AI, the welcome guide or the chapter (setup.19, `setupLeave`)
   */
  onClose: () => void;
  /** given when a chapter is open and nothing the check found stops a review (`canTryReviewAnyway`) */
  onTryAnyway?: () => void;
  /** Test the connection (setup.8); offered where `canTestConnection` says, when given */
  onTest?: () => void;
  /** a connection test is running */
  testing?: boolean;
  /** the last connection test that finished */
  testOutcome?: ConnectionTestOutcome | null;
  /** Claude Code's last usage notice, which names the limit a usage-limit view advises on (setup.9) */
  rateLimit?: RateLimitInfo | null;
  /** Copy diagnostics (hardening.5): opens the Diagnostics dialog, which copies the report; shown when given */
  onCopyDiagnostics?: () => void;
  /** the app's version, for the last line, the name and the version (release.9); no line while it is not known */
  version?: string | null;
}

const SYSTEMS: ReadonlyArray<{ id: SetupOs; label: string }> = [
  { id: 'windows', label: 'Windows' },
  { id: 'mac', label: 'macOS' },
  { id: 'linux', label: 'Linux' }
];

const SETUP_DOCS = 'https://code.claude.com/docs/en/setup';

/**
 * How Claude is set up, and what to do when it is not (setup.7, PLAN 5.6 and
 * 11.3 f). A status card says what the last check found, with Check again
 * and, once Claude Code has been found, Test the connection, which sends one
 * very small request and says under the buttons how it went (setup.8); then,
 * for the view, the steps on the chosen system, each command with a Copy
 * that says when it fails; troubleshooting; Advanced, with the Claude Code
 * path and version; Copy diagnostics (hardening.5); Done, the blue button
 * at the foot, which leaves as Close and Escape do and takes the focus once a
 * check finds Claude ready after something to do (setup.19); the privacy
 * footer; and the app's name and version (release.9).
 * Everything it says comes from `src/shared/ui/setup.ts`, and the
 * diagnostics line from `src/shared/ui/diagnostics.ts`.
 *
 * The app never offers a sign-in of its own: no button here signs in. The
 * author signs in with Anthropic, in Claude Code and the browser, and this
 * screen only says how (CLAUDE.md rule 2).
 */
export function SetupScreen({
  runtime,
  lastFailure,
  checking,
  os: initialOs,
  host: givenHost,
  onCheckAgain,
  onClose,
  onTryAnyway,
  onTest,
  testing = false,
  testOutcome = null,
  rateLimit = null,
  onCopyDiagnostics,
  version = null
}: Props): React.JSX.Element {
  const host = givenHost ?? osFromUserAgent(navigator.userAgent);
  const [os, setOs] = useState<SetupOs>(() => initialOs ?? host);
  const view = setupView(runtime, lastFailure);
  const status = setupStatus(view, runtime, lastFailure, rateLimit);
  const checkBusy = checking || view === 'checking';
  const testable = onTest !== undefined && canTestConnection(runtime);
  const testLine = testOutcome ? connectionTestLine(testOutcome) : null;
  const steps = setupSteps(view, runtime, os, host);
  const heading = stepsHeading(view);
  const others = view === 'not-installed' ? otherInstalls(os) : [];
  // The steps of an outdated view already update it, and a missing one has no version.
  const advice = view === 'outdated' || view === 'not-installed' ? null : updateAdvice(runtime, os, host);
  const trouble = setupTroubleshooting(view, runtime, os, host);

  /* Done, Close and Escape leave alike (setup.19). Once a check finds Claude
     ready after there was something to do, as when the author comes back
     from signing in in a terminal, the focus goes to Done. The page keeps
     still while Done is in view, so the status card, which says so, stays
     where it was; when Done is below the fold, as under the long steps of a
     view that had something to do, the page comes up just far enough to
     show it (`focusInView`, setup.19 review). */
  useSetupEscape(onClose);
  const pageRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const lastView = useRef(view);
  useEffect(() => {
    if (claudeSetupSucceeded(lastView.current, view)) focusInView(doneRef.current, pageRef.current);
    lastView.current = view;
  }, [view]);

  // The whole width scrolls, so the wheel works over the margins and the
  // scrollbar sits at the window's edge; the page inside is a centred column.
  return (
    <div ref={pageRef} className="setup" data-view={view}>
      <div className="setup__page">
        <div className="setup__head">
          <h1>Set up Claude</h1>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <section
          className={`setup__status setup__status--${status.tone}`}
          role="status"
          aria-live="polite"
          aria-label="Claude status"
        >
          <div className="setup__status-text">
            <h2>{status.title}</h2>
            {status.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <div className="setup__status-actions">
            {/* Both are held, not disabled, while their work runs, so a
                button pressed from the keyboard keeps the focus (heldButton). */}
            <button
              type="button"
              className={needsSetup(view) ? 'primary' : undefined}
              {...heldButton(checkBusy, onCheckAgain)}
            >
              {checkBusy ? 'Checking…' : 'Check again'}
            </button>
            {/* Its label stays while a test runs, so the buttons keep their
                width and the card's text does not reflow; the line under
                them says it is waiting, in the place of the last result. */}
            {testable ? (
              <button type="button" {...heldButton(testing, onTest)}>
                Test the connection
              </button>
            ) : null}
            {onTryAnyway ? (
              <button type="button" onClick={onTryAnyway}>
                Try the review anyway
              </button>
            ) : null}
          </div>
          {testable || testing || testLine ? (
            <div className="setup__test">
              {testable ? <p className="setup__test-note">{connectionTestNote(runtime)}</p> : null}
              {testing ? (
                <p className="setup__test-result setup__test-result--running">{CONNECTION_TEST_RUNNING}</p>
              ) : testLine ? (
                <p className={`setup__test-result setup__test-result--${testLine.tone}`}>{testLine.text}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        {advice ? <UpdateNote advice={advice} /> : null}

        {heading ? (
          <section className="setup__section">
            <h2>{heading}</h2>
            <div className="setup__tabs" role="group" aria-label="Your system">
              {SYSTEMS.map((system) => (
                <button
                  key={system.id}
                  type="button"
                  className={os === system.id ? 'setup__tab--active' : ''}
                  aria-pressed={os === system.id}
                  onClick={() => setOs(system.id)}
                >
                  {system.label}
                </button>
              ))}
            </div>
            <ol className="setup__steps">
              {steps.map((step) => (
                <li key={step.text}>
                  <p>{step.text}</p>
                  {step.command ? <Command text={step.command.command} /> : null}
                  {step.command?.fullPathCommand ? (
                    <>
                      <p className="setup__note">{FULL_PATH_TEXT}</p>
                      <Command text={step.command.fullPathCommand} />
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
            {others.length > 0 ? (
              <div className="setup__others">
                <p className="setup__note">{OTHER_INSTALLS_NOTE}</p>
                {others.map((other) => (
                  <div key={other.name} className="setup__other">
                    <span>{other.name}</span>
                    <Command text={other.command} />
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {trouble.length > 0 ? (
          <section className="setup__section">
            <h2>Troubleshooting</h2>
            {trouble.map((item) => (
              <details key={item.question} className="setup__trouble">
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </section>
        ) : null}

        <details className="setup__advanced">
          <summary>Advanced</summary>
          <dl>
            {advancedRows(runtime, os).map((row) => (
              <div key={row.label} className="setup__row">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>

        {/* For whoever helps when something goes wrong (hardening.5): the
            dialog it opens copies the report and shows what was copied. */}
        {onCopyDiagnostics ? (
          <p className="setup__diagnostics">
            <button type="button" className="link" data-opens="diagnostics" onClick={onCopyDiagnostics}>
              {COPY_DIAGNOSTICS}
            </button>{' '}
            {SETUP_DIAGNOSTICS_TEXT}
          </p>
        ) : null}

        <div className="setup__foot">
          <button type="button" ref={doneRef} className="primary" onClick={onClose}>
            {SETUP_DONE}
          </button>
        </div>

        <p className="setup__footer">
          {PRIVACY_FOOTER}{' '}
          <a href={SETUP_DOCS} target="_blank" rel="noreferrer">
            Anthropic&apos;s setup guide for Claude Code
          </a>
        </p>
        {version ? <p className="setup__version">{setupFooterText(version)}</p> : null}
      </div>
    </div>
  );
}
