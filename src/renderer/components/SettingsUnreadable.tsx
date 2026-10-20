import type { SettingsReadFailure } from '../../shared/ipc';
import {
  SETTINGS_SHOW_DIAGNOSTICS,
  SETTINGS_SHOW_FILE,
  settingsUnreadableCard
} from '../../shared/ui/settingsRead';
import { heldButton } from '../state/heldButton';

interface Props {
  /** why main could not read settings.json */
  reason: SettingsReadFailure;
  /** a Try again is reading the file */
  trying: boolean;
  /** the last Try again found the file still unreadable */
  failedAgain: boolean;
  onTryAgain: () => void;
  /** shows settings.json selected in its folder */
  onShowFile: () => void;
  /** opens Diagnostics, whose warnings say why the read or the copy failed */
  onShowDiagnostics: () => void;
}

/**
 * What the page shows while settings.json cannot be read (hardening.15, PLAN
 * section 7 and C.86): one warning card, in the Setup screen's scroller and
 * centred column (`.setup`, `.setup__page`) and in its status card's look,
 * with the words of `settingsUnreadableCard` for the reason main gave, Try
 * again, Show in folder and Show diagnostics. Try again is held, not
 * disabled, while it reads, so a press from the keyboard keeps the focus
 * (`heldButton`). Show diagnostics carries Setup's mark
 * (`DIAGNOSTICS_LINK_SELECTOR`), where Diagnostics sends the focus back when
 * the button that opened it has gone, as a notification card's Show
 * diagnostics has once pressed.
 */
export function SettingsUnreadable({
  reason,
  trying,
  failedAgain,
  onTryAgain,
  onShowFile,
  onShowDiagnostics
}: Props): React.JSX.Element {
  const card = settingsUnreadableCard(reason, trying, failedAgain);
  return (
    <div className="setup settings-unreadable">
      <div className="setup__page">
        <section className="setup__status setup__status--warn" aria-labelledby="settings-unreadable-title">
          <div className="setup__status-text">
            <h1 id="settings-unreadable-title">{card.title}</h1>
            {card.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {/* Read out when a Try again finds the file still unreadable. */}
            <p className="settings-unreadable__status" aria-live="polite">
              {card.status}
            </p>
          </div>
          <div className="setup__status-actions">
            <button type="button" className="primary" {...heldButton(trying, onTryAgain)}>
              {card.button}
            </button>
            <button type="button" onClick={onShowFile}>
              {SETTINGS_SHOW_FILE}
            </button>
            <button type="button" data-opens="diagnostics" onClick={onShowDiagnostics}>
              {SETTINGS_SHOW_DIAGNOSTICS}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
