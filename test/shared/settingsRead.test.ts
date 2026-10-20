import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import {
  SETTINGS_READING,
  SETTINGS_STILL_UNREADABLE,
  SETTINGS_TRY_AGAIN,
  SETTINGS_UNREADABLE_LINES,
  SETTINGS_UNREADABLE_TITLE,
  settingsUnreadableCard
} from '../../src/shared/ui/settingsRead';

/* hardening.15: the words of the card shown while settings.json cannot be
   read. The card as drawn is in test/renderer/settingsUnreadable.render.test.ts. */

describe('settingsUnreadableCard', () => {
  it('names the app and settings.json, and says to close the program holding it, then Try again', () => {
    expect(SETTINGS_UNREADABLE_TITLE).toBe(`${APP_NAME} could not read its settings`);
    expect(SETTINGS_UNREADABLE_LINES).toEqual([
      'Another program may have settings.json open, such as a backup or sync tool, a virus scanner or an editor. Close it, then choose Try again.',
      `Until ${APP_NAME} can read the file it changes nothing in it, so your manuscript folder, your model and your other settings are kept as they are.`
    ]);
  });

  it('says "Try again", "Reading…" while it reads, and "still" only after a Try again that failed', () => {
    const cases: [boolean, boolean, string, string | null][] = [
      [false, false, SETTINGS_TRY_AGAIN, null],
      [true, false, SETTINGS_READING, null],
      [true, true, SETTINGS_READING, null],
      [false, true, SETTINGS_TRY_AGAIN, SETTINGS_STILL_UNREADABLE]
    ];
    for (const [trying, failedAgain, button, status] of cases) {
      expect(settingsUnreadableCard(trying, failedAgain)).toEqual({
        title: SETTINGS_UNREADABLE_TITLE,
        lines: SETTINGS_UNREADABLE_LINES,
        button,
        status
      });
    }
    expect(SETTINGS_STILL_UNREADABLE).toBe('settings.json still could not be read.');
  });

  it('speaks of no welcome guide, first run or defaults, which the author need not know of', () => {
    const all = [SETTINGS_UNREADABLE_TITLE, ...SETTINGS_UNREADABLE_LINES, SETTINGS_STILL_UNREADABLE].join(
      ' '
    );
    expect(all).not.toMatch(/welcome|first run|default|error|EBUSY/i);
  });
});
