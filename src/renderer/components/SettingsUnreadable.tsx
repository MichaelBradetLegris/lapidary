import { settingsUnreadableCard } from '../../shared/ui/settingsRead';
import { heldButton } from '../state/heldButton';

interface Props {
  /** a Try again is reading the file */
  trying: boolean;
  /** the last Try again found the file still unreadable */
  failedAgain: boolean;
  onTryAgain: () => void;
}

/**
 * What the page shows while settings.json cannot be read (hardening.15, PLAN
 * section 7 and C.86): one warning card, in the Setup screen's scroller and
 * centred column (`.setup`, `.setup__page`) and in its status card's look,
 * with the words of `settingsUnreadableCard` and Try again. Try again is held,
 * not disabled, while it reads, so a press from the keyboard keeps the focus
 * (`heldButton`).
 */
export function SettingsUnreadable({ trying, failedAgain, onTryAgain }: Props): React.JSX.Element {
  const card = settingsUnreadableCard(trying, failedAgain);
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
          </div>
        </section>
      </div>
    </div>
  );
}
