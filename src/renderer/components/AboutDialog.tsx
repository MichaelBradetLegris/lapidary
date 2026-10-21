import { useEffect, useId, useRef, useState, type Ref } from 'react';
import iconUrl from '../../../resources/icon/icon.svg?url';
import { AI_OUTPUT_NOTICE, APP_NAME, APP_TAGLINE, DISCLAIMER } from '../../shared/branding';
import type { AppInfo, RuntimeStatus } from '../../shared/ipc';
import type { Settings } from '../../shared/types';
import {
  ABOUT_TITLE,
  NOTICES_BUTTON,
  OPEN_DATA_FOLDER,
  OPEN_LOG_FOLDER,
  WHATS_NEW,
  aboutVersionLine,
  componentLines,
  whatsNewUrl
} from '../../shared/ui/about';
import { SETTINGS_BUTTON_SELECTOR } from '../../shared/ui/dialog';
import {
  AUTO_CHECK_LABEL,
  AUTO_CHECK_NOTE,
  CHECK_FOR_UPDATES,
  UPDATE_ACTION_LABELS,
  aboutUpdateLine,
  checkForUpdatesOff,
  checkForUpdatesWaits,
  checkHeld,
  updateActionFor,
  updateActionHeld,
  type UpdateAction
} from '../../shared/ui/update';
import type { UpdateStatus } from '../../shared/updates';
import { call, errorMessage } from '../state/client';
import { useDiagnosticsReport, type DiagnosticsReportState } from '../state/diagnosticsReport';
import { useDialogEscape, useDialogFocus } from '../state/dialog';
import { heldButton } from '../state/heldButton';
import { DiagnosticsPanel } from './DiagnosticsPanel';

interface Props {
  settings: Settings;
  /** Claude's live status, for the Claude Code line */
  runtime: RuntimeStatus | null;
  /** where the updater is, as main last said */
  update: UpdateStatus | null;
  /** the settings after a change here (Check for updates automatically) */
  onApply: (next: Settings) => void;
  /** Check for updates; resolves once the check has ended */
  onCheck: () => Promise<void>;
  /** the update card's button, here beside the status line: Download, Restart now or the release page */
  onUpdateAction: (action: UpdateAction) => void;
  onClose: () => void;
}

/**
 * About (`release.9`), from Settings' About button, which it replaces. A modal
 * like the others (ui.1, ui.4): Escape and Close close it, the focus goes
 * into its box as it opens and, since Settings has gone, to the toolbar's
 * Settings button when it closes, and the page behind it is inert. It asks
 * main once as it opens for the versions (`app:info`) and the diagnostics
 * report (`app:diagnostics`); neither runs a check of Claude or OpenAI. What
 * it shows is `AboutView`.
 */
export function AboutDialog({
  settings,
  runtime,
  update,
  onApply,
  onCheck,
  onUpdateAction,
  onClose
}: Props): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const report = useDiagnosticsReport(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogEscape(boxRef, onClose);
  useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);

  useEffect(() => {
    let current = true;
    call('app:info', undefined)
      .then((answer) => {
        if (current) setInfo(answer);
      })
      .catch((err: unknown) => {
        if (current) setError(errorMessage(err));
      });
    return () => {
      current = false;
    };
  }, []);

  /* Each action clears the last failure and says why it did nothing, in
     main's words, in the line under the heading. */
  const run = (request: Promise<unknown>): void => {
    setError(null);
    request.catch((err: unknown) => setError(errorMessage(err)));
  };

  return (
    <AboutView
      boxRef={boxRef}
      info={info}
      error={error}
      checking={asking}
      settings={settings}
      runtime={runtime}
      update={update}
      report={report}
      onCheck={() => {
        setAsking(true);
        void onCheck().finally(() => setAsking(false));
      }}
      onAutoCheck={(checkForUpdates) => run(call('settings:set', { checkForUpdates }).then(onApply))}
      onUpdateAction={onUpdateAction}
      onOpenNotices={() => run(call('app:open-notices', undefined))}
      onReveal={(target) => run(call('shell:reveal', { target }))}
      onClose={onClose}
    />
  );
}

export interface AboutViewProps {
  boxRef?: Ref<HTMLDivElement>;
  /** what `app:info` answered, or null until it has */
  info: AppInfo | null;
  /** why the last action did nothing, in main's words */
  error: string | null;
  /** Check for updates was pressed and has not been answered yet */
  checking: boolean;
  settings: Settings;
  runtime: RuntimeStatus | null;
  update: UpdateStatus | null;
  report: Pick<DiagnosticsReportState, 'text' | 'error' | 'copyState' | 'copy' | 'retry'>;
  onCheck: () => void;
  onAutoCheck: (on: boolean) => void;
  onUpdateAction: (action: UpdateAction) => void;
  onOpenNotices: () => void;
  onReveal: (target: 'logs' | 'data') => void;
  onClose: () => void;
}

/**
 * What About shows, from the top: the icon, the name, the version and the
 * tagline; Check for updates, off while updates are, and held while a check
 * runs and while main would answer one without checking, such as while an
 * update downloads (`checkForUpdatesWaits`), with the updater's status line
 * (`updateStatusLine`) and the update card's own button beside it, so a card
 * closed with its X is not the only way to Download or Restart now, and
 * Restart now, held, while it runs (`updateActionFor`); Check for updates
 * automatically, with what a check sends; What's new, the release page of
 * the version running, and Licences and notices, which main opens
 * (`app:open-notices`); what the app is (`DISCLAIMER`) and the caution that
 * goes with every review (`AI_OUTPUT_NOTICE`); the versions it runs on, the
 * user's Claude Code from Claude's live status (`componentLines`); and
 * Diagnostics, its Copy a plain button, as Close is the blue one, with Open
 * log folder and Open data folder.
 */
export function AboutView({
  boxRef,
  info,
  error,
  checking,
  settings,
  runtime,
  update,
  report,
  onCheck,
  onAutoCheck,
  onUpdateAction,
  onOpenNotices,
  onReveal,
  onClose
}: AboutViewProps): React.JSX.Element {
  const toggleId = useId();
  const version = info?.version ?? update?.current ?? null;
  const action = updateActionFor(update);
  /* Check for updates is off while updates are. While a check runs, and while
     main would answer one without checking, it is held, not disabled
     (`heldButton`), so a press that resumes a download leaves the focus on it;
     in the second case its title says why (release.9 review). */
  const waits = checkForUpdatesWaits(update);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={ABOUT_TITLE}>
      <div className="modal modal--about" ref={boxRef} tabIndex={-1}>
        <div className="about__head">
          <img className="about__icon" src={iconUrl} alt="" width={64} height={64} />
          <div>
            <h2>{APP_NAME}</h2>
            <p className="about__version">{aboutVersionLine(info)}</p>
            <p className="about__tagline">{APP_TAGLINE}</p>
          </div>
        </div>
        {error ? <p className="modal__hint modal__hint--error">{error}</p> : null}

        <section className="about__section" aria-label="Updates">
          <div className="about__update">
            <button
              type="button"
              disabled={checkForUpdatesOff(update)}
              title={waits ?? undefined}
              {...heldButton(checking || checkHeld(update) || waits !== null, onCheck)}
            >
              {CHECK_FOR_UPDATES}
            </button>
            {action ? (
              <button type="button" {...heldButton(updateActionHeld(update), () => onUpdateAction(action))}>
                {UPDATE_ACTION_LABELS[action]}
              </button>
            ) : null}
            <span className="about__status" role="status" data-testid="about-update-line">
              {aboutUpdateLine(update)}
            </span>
          </div>
          <div className="about__toggle">
            <input
              id={toggleId}
              type="checkbox"
              checked={settings.checkForUpdates}
              aria-describedby={`${toggleId}-note`}
              onChange={(event) => onAutoCheck(event.target.checked)}
            />
            <label htmlFor={toggleId}>{AUTO_CHECK_LABEL}</label>
          </div>
          <p className="modal__note about__toggle-note" id={`${toggleId}-note`}>
            {AUTO_CHECK_NOTE}
          </p>
          <p className="about__links">
            {version ? (
              <a href={whatsNewUrl(version)} target="_blank" rel="noreferrer">
                {WHATS_NEW}
              </a>
            ) : null}
            <button type="button" className="link" onClick={onOpenNotices}>
              {NOTICES_BUTTON}
            </button>
          </p>
        </section>

        <section className="about__section">
          <p className="about__text">{DISCLAIMER}</p>
          <p className="about__text">{AI_OUTPUT_NOTICE}</p>
        </section>

        <section className="about__section" aria-label="Versions">
          <h3>Versions</h3>
          <ul className="about__components" data-testid="about-components">
            {componentLines(info, runtime).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="about__section" aria-label="Diagnostics">
          <h3>Diagnostics</h3>
          <DiagnosticsPanel
            text={report.text}
            error={report.error}
            copyState={report.copyState}
            onCopy={report.copy}
            onRetry={report.retry}
            copyPrimary={false}
          />
          <div className="about__folders">
            <button type="button" onClick={() => onReveal('logs')}>
              {OPEN_LOG_FOLDER}
            </button>
            <button type="button" onClick={() => onReveal('data')}>
              {OPEN_DATA_FOLDER}
            </button>
          </div>
        </section>

        <div className="modal__actions">
          <span className="spacer" />
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
