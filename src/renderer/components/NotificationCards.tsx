import { SHOW_ALL_BACKUPS, SHOW_BACKUPS } from '../../shared/ui/backups';
import { UPDATE_ACTION_LABELS, UPDATE_CARD_KEY, actionKeepsCard } from '../../shared/ui/update';
import { useApp, type NotificationAction } from '../state/store';
import { IconX } from './icons';

const ACTION_LABELS: Record<NotificationAction, string> = {
  'open-settings': 'Open Settings',
  'open-setup': 'Open Setup',
  'show-diagnostics': 'Show diagnostics',
  'reveal-drafts': 'Show the text',
  'reveal-backups': SHOW_BACKUPS,
  'reveal-all-backups': SHOW_ALL_BACKUPS,
  ...UPDATE_ACTION_LABELS
};

interface Props {
  /** what a card's button does, with what it acts on (`actionArg`); the card closes after it runs */
  onAction?: (action: NotificationAction, arg?: string) => void;
}

/**
 * The message stack in the top-right corner of the manuscript pane (item 1).
 * Cards are sized to their text, stack downwards, and only ever close on the X:
 * no click-away and no timeout, so a save error stays until it is read. A card
 * may carry one button, which closes it after doing its job, except the update
 * card's Download and Restart now, whose card goes on to show what follows in
 * place (`actionKeepsCard`, release.9). The update card keeps one width
 * (`note--update`).
 */
export function NotificationCards({ onAction }: Props): React.JSX.Element | null {
  const notifications = useApp((s) => s.notifications);
  const dismiss = useApp((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="notes" role="status" aria-live="polite">
      {notifications.map((note) => (
        <div
          key={note.id}
          className={`note note--${note.tone}${note.key === UPDATE_CARD_KEY ? ' note--update' : ''}`}
        >
          <span className="note__text">
            {note.text}
            {note.action && onAction ? (
              <>
                {' '}
                <button
                  type="button"
                  className="link note__action"
                  onClick={() => {
                    const action = note.action;
                    if (!action || !actionKeepsCard(action)) dismiss(note.id);
                    if (action) onAction(action, note.actionArg);
                  }}
                >
                  {ACTION_LABELS[note.action]}
                </button>
              </>
            ) : null}
          </span>
          <button
            type="button"
            className="note__close"
            aria-label="Dismiss message"
            onClick={() => dismiss(note.id)}
          >
            <IconX size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
