import { beforeEach, describe, expect, it } from 'vitest';
import { useApp } from '../../src/renderer/state/store';

/* setup.7a: cards that update in place, and closing every card with a key. */

describe('notification cards', () => {
  beforeEach(() => {
    useApp.getState().clearNotifications();
  });

  it('updates a card in place: same id, same position, new tone, text and button', () => {
    const { notify, upsertNotification } = useApp.getState();
    notify('info', 'Saved to the chapter file.');
    const id = upsertNotification('update', 'info', 'Downloading 12%', 'update-download');
    notify('warn', 'The chapter changed on disk.');
    const again = upsertNotification('update', 'info', 'Ready to install.', 'update-restart');
    expect(again).toBe(id);
    const notes = useApp.getState().notifications;
    expect(notes.map((n) => n.text)).toEqual([
      'Saved to the chapter file.',
      'Ready to install.',
      'The chapter changed on disk.'
    ]);
    expect(notes[1]).toEqual({
      id,
      tone: 'info',
      text: 'Ready to install.',
      key: 'update',
      action: 'update-restart'
    });
  });

  it('drops the button when the update has none', () => {
    const { upsertNotification } = useApp.getState();
    upsertNotification('update', 'info', 'Downloading', 'update-download');
    upsertNotification('update', 'warn', 'The download failed.');
    expect(useApp.getState().notifications[0]?.action).toBeUndefined();
  });

  it('adds a card when none has the key yet', () => {
    const id = useApp
      .getState()
      .upsertNotification('main-notice', 'error', 'Something went wrong.', 'show-diagnostics');
    expect(useApp.getState().notifications).toEqual([
      { id, tone: 'error', text: 'Something went wrong.', key: 'main-notice', action: 'show-diagnostics' }
    ]);
  });

  it('closes every card with a key and leaves the others', () => {
    const { notify, dismissNotificationsByKey } = useApp.getState();
    notify('warn', 'Claude Code is not signed in.', 'claude-runtime', 'open-setup');
    notify('info', 'Saved.');
    dismissNotificationsByKey('claude-runtime');
    expect(useApp.getState().notifications.map((n) => n.text)).toEqual(['Saved.']);
  });
});
