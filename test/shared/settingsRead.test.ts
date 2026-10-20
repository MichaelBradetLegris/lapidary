import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import type { SettingsReadFailure } from '../../src/shared/ipc';
import {
  SETTINGS_DAMAGED_LINES,
  SETTINGS_HELD_LINES,
  SETTINGS_READING,
  SETTINGS_SHOW_DIAGNOSTICS,
  SETTINGS_SHOW_FILE,
  SETTINGS_STILL_DAMAGED,
  SETTINGS_STILL_UNREADABLE,
  SETTINGS_TRY_AGAIN,
  SETTINGS_UNREADABLE_TITLE,
  settingsUnreadableCard
} from '../../src/shared/ui/settingsRead';

/* hardening.15: the words of the card shown while settings.json cannot be
   read, for each reason main gives. The card as drawn is in
   test/renderer/settingsUnreadable.render.test.ts. */

describe('settingsUnreadableCard', () => {
  it('for a read refused, names settings.json and says to close the program holding it, then Try again', () => {
    expect(SETTINGS_UNREADABLE_TITLE).toBe(`${APP_NAME} could not read its settings`);
    expect(SETTINGS_HELD_LINES).toEqual([
      'Another program may have settings.json open, such as a backup or sync tool, a virus scanner or an editor. Close it, then choose Try again.',
      `Until ${APP_NAME} can read the file it changes nothing in it, so your manuscript folder, your model and your other settings are kept as they are.`
    ]);
    expect(settingsUnreadableCard('refused', false, false).lines).toBe(SETTINGS_HELD_LINES);
  });

  it('for a file that is not JSON with no copy made, says it is damaged and left as it is, and what to do instead', () => {
    // The hardening.15 review: this case showed the advice for a held file,
    // which no closing of programs ends.
    expect(SETTINGS_DAMAGED_LINES).toEqual([
      `settings.json is damaged: it is not valid JSON. ${APP_NAME} keeps a copy of such a file before it starts afresh, and no copy could be made, so it has left the file as it is.`,
      'Mend the file, or move it out of its folder to start afresh, then choose Try again. Show diagnostics says why the copy could not be made.'
    ]);
    const card = settingsUnreadableCard('no-copy', false, false);
    expect(card.title).toBe(SETTINGS_UNREADABLE_TITLE);
    expect(card.lines).toBe(SETTINGS_DAMAGED_LINES);
    expect(card.lines.join(' ')).not.toMatch(/Another program|Close it/);
    // The buttons the lines name.
    expect(card.lines.join(' ')).toContain(SETTINGS_SHOW_DIAGNOSTICS);
    expect([SETTINGS_SHOW_FILE, SETTINGS_SHOW_DIAGNOSTICS]).toEqual(['Show in folder', 'Show diagnostics']);
  });

  it('says "Try again", "Reading…" while it reads, and "still" only after a Try again that failed, in words for each reason', () => {
    const still: Record<SettingsReadFailure, string> = {
      refused: SETTINGS_STILL_UNREADABLE,
      'no-copy': SETTINGS_STILL_DAMAGED
    };
    const lines: Record<SettingsReadFailure, readonly string[]> = {
      refused: SETTINGS_HELD_LINES,
      'no-copy': SETTINGS_DAMAGED_LINES
    };
    for (const reason of ['refused', 'no-copy'] as const) {
      const cases: [boolean, boolean, string, string | null][] = [
        [false, false, SETTINGS_TRY_AGAIN, null],
        [true, false, SETTINGS_READING, null],
        [true, true, SETTINGS_READING, null],
        [false, true, SETTINGS_TRY_AGAIN, still[reason]]
      ];
      for (const [trying, failedAgain, button, status] of cases) {
        expect(settingsUnreadableCard(reason, trying, failedAgain)).toEqual({
          title: SETTINGS_UNREADABLE_TITLE,
          lines: lines[reason],
          button,
          status
        });
      }
    }
    expect(SETTINGS_STILL_UNREADABLE).toBe('settings.json still could not be read.');
    expect(SETTINGS_STILL_DAMAGED).toBe(
      'settings.json is still not valid JSON, and no copy of it could be made.'
    );
  });

  it('speaks of no welcome guide, first run or defaults, which the author need not know of', () => {
    const all = [
      SETTINGS_UNREADABLE_TITLE,
      ...SETTINGS_HELD_LINES,
      ...SETTINGS_DAMAGED_LINES,
      SETTINGS_STILL_UNREADABLE,
      SETTINGS_STILL_DAMAGED
    ].join(' ');
    expect(all).not.toMatch(/welcome|first run|default|error|EBUSY|EACCES|EEXIST/i);
  });
});
