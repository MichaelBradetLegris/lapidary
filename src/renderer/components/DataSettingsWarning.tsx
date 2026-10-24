import { useId } from 'react';
import type { ChatGptStatus } from '../../shared/ipc';
import {
  DATA_CONTROLS_BUTTON,
  DATA_SETTINGS_CHECKBOX,
  TRAINING_CHOICE_TEXT,
  TRAINING_WARNING_TEXT,
  TRAINING_WARNING_TITLE,
  dataSettingsNote
} from '../../shared/ui/chatgpt';

interface Props {
  status: ChatGptStatus | null;
  onOpenDataControls: () => void;
  onConfirm: (confirmed: boolean) => void;
  /** its title's level: 2 on the Setup screen, 3 in Review with AI, under the dialog's own heading (codex.3) */
  headingLevel?: 2 | 3;
}

/**
 * The training warning (codex.2, the author's requirement, Appendix D 23):
 * personal ChatGPT plans may train on what is sent unless the setting is
 * turned off, the app cannot see it, a button opens ChatGPT's Data controls
 * in the browser (`shell:open-external`), and the box "I have confirmed my
 * data settings", kept for the signed-in account, which the first ChatGPT
 * review needs. It stays after the box is ticked, as a reminder. The Setup
 * screen's ChatGPT view shows it whenever it is open, and Review with AI
 * before the first ChatGPT review, while the box is not ticked (codex.3); the
 * words are in `src/shared/ui/chatgpt.ts`.
 */
export function DataSettingsWarning({
  status,
  onOpenDataControls,
  onConfirm,
  headingLevel = 2
}: Props): React.JSX.Element {
  const uid = useId();
  const signedIn = status?.signedIn === true;
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      className="modal__warn modal__warn--stack data-warning"
      role="note"
      aria-labelledby={`${uid}-title`}
      data-testid="chatgpt-training-warning"
    >
      <Heading id={`${uid}-title`} className="data-warning__title">
        {TRAINING_WARNING_TITLE}
      </Heading>
      <p>{TRAINING_WARNING_TEXT}</p>
      <p>{TRAINING_CHOICE_TEXT}</p>
      <div className="data-warning__actions">
        <button type="button" onClick={onOpenDataControls}>
          {DATA_CONTROLS_BUTTON}
        </button>
        <label className="data-warning__check">
          {/* Never disabled while main writes it: Chromium would take the
              focus from a box ticked from the keyboard (heldButton). */}
          <input
            type="checkbox"
            checked={status?.dataSettingsConfirmed === true}
            disabled={!signedIn}
            aria-describedby={`${uid}-note`}
            onChange={(e) => onConfirm(e.target.checked)}
          />
          {DATA_SETTINGS_CHECKBOX}
        </label>
      </div>
      <p className="data-warning__note" id={`${uid}-note`}>
        {dataSettingsNote(status)}
      </p>
    </section>
  );
}
