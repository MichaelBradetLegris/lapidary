import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { ABOUT_BUTTON } from '../../src/shared/ui/about';
import { BACKUPS_NOTE } from '../../src/shared/ui/backups';
import {
  ABOUT_BUTTON_NOTE,
  APPEARANCE_NOTE,
  BACKUPS_TIP,
  CHATGPT_ACCOUNT_TIP,
  CLAUDE_ACCOUNT_TIP,
  DONE_NOTE,
  EFFORT_TIP,
  GUIDELINES_TIP,
  MANUSCRIPT_TIP,
  MODEL_TIP,
  REVIEWS_FOLDER_TIP,
  SETTINGS_NOTE_MAX,
  SETTINGS_SECTIONS,
  backupsFolderNote,
  helpButtonLabel,
  reviewsFolderNote
} from '../../src/shared/ui/settingsDialog';
import { WELCOME_GUIDE_NOTE } from '../../src/shared/ui/welcome';

/* polish.4: the Settings dialog's words. Each note under a row is one short
   line, and the longer explanations it used to give are the tooltips of the
   (?) beside the rows, keeping everything that matters for the author's
   files and sign-ins. How the dialog lays them out is in
   test/renderer/settingsDialog.render.test.ts. The OpenAI API key's row, its
   note and its tooltip went with that provider (codex.6). */

const NOTES = [
  APPEARANCE_NOTE,
  reviewsFolderNote(false),
  reviewsFolderNote(true),
  backupsFolderNote(false),
  backupsFolderNote(true)
];

const TIPS = [
  MODEL_TIP,
  EFFORT_TIP,
  MANUSCRIPT_TIP,
  REVIEWS_FOLDER_TIP,
  BACKUPS_TIP,
  GUIDELINES_TIP,
  CLAUDE_ACCOUNT_TIP,
  CHATGPT_ACCOUNT_TIP
];

describe('the sections', () => {
  /* polish.22: App, the settings of the app itself, at the top. */
  it('are App, Review, Folders and Accounts, in that order', () => {
    expect(SETTINGS_SECTIONS).toEqual(['App', 'Review', 'Folders', 'Accounts']);
  });
});

describe('the notes under the rows', () => {
  it('are each one short line, one sentence or two', () => {
    expect(SETTINGS_NOTE_MAX).toBeLessThanOrEqual(85);
    for (const note of NOTES) {
      expect(note.length, note).toBeLessThanOrEqual(SETTINGS_NOTE_MAX);
      expect(note.split(/\.(?:\s|$)/).filter(Boolean).length, note).toBeLessThanOrEqual(2);
    }
  });

  it('are shorter than the tooltips that hold the rest', () => {
    const longest = Math.max(...NOTES.map((n) => n.length));
    for (const tip of TIPS) expect(tip.length, tip).toBeGreaterThan(longest);
  });

  it('keep the Appearance note theme.7 gave', () => {
    expect(APPEARANCE_NOTE).toBe("Match system follows your computer's light or dark setting.");
  });

  it('say when the reviews folder is the default one, as the long note did', () => {
    expect(reviewsFolderNote(false)).toBe('Your reviews and decisions are saved here as you go.');
    expect(reviewsFolderNote(true)).toBe(
      'Your reviews and decisions are saved here as you go. This is the default folder.'
    );
  });

  /* setup.18: the backups folder can be chosen, so its note says when it is
     the default one, as the reviews folder's does. */
  it('say when the backups folder is the default one, as the reviews folder does', () => {
    expect(backupsFolderNote(false)).toBe('Copies of your chapters before each Save to chapter.');
    expect(backupsFolderNote(true)).toBe(
      'Copies of your chapters before each Save to chapter. This is the default folder.'
    );
  });

  it('give the foot buttons short tooltips too', () => {
    for (const note of [WELCOME_GUIDE_NOTE, ABOUT_BUTTON_NOTE, DONE_NOTE]) {
      expect(note.length, note).toBeLessThanOrEqual(SETTINGS_NOTE_MAX);
    }
    expect(ABOUT_BUTTON).toBe('About');
    expect(DONE_NOTE).toBe('Each setting is saved as soon as you change it.');
  });
});

describe('the tooltips keep what the long notes said', () => {
  it('keeps that the ChatGPT sign-in is encrypted, never shown and used only in the background, with no API key', () => {
    expect(CHATGPT_ACCOUNT_TIP).toMatch(/encrypted with your Windows login/);
    expect(CHATGPT_ACCOUNT_TIP).toMatch(/beside the settings file/);
    expect(CHATGPT_ACCOUNT_TIP).toMatch(/never shown/);
    expect(CHATGPT_ACCOUNT_TIP).toContain(`only ${APP_NAME}'s background process uses it`);
    expect(CHATGPT_ACCOUNT_TIP).toMatch(/with no API key/);
  });

  it("keeps apply.11's backups note, with the 20-and-30-days rule, and where the folder may be (setup.18)", () => {
    expect(BACKUPS_TIP).toBe(BACKUPS_NOTE);
    expect(BACKUPS_TIP).toBe(
      `Before every Save to chapter, the version it replaces is copied here. The last 20 saves and the first save of each day for 30 days are kept. With no folder chosen, backups stay in ${APP_NAME}'s data folder, on this computer. The folder cannot be the manuscript folder or inside it, and choosing another leaves the backups made so far where they are.`
    );
    // A folder the author chooses may be a synced one, so "Backups stay on
    // this computer" holds only for the data folder's.
    expect(BACKUPS_TIP).not.toMatch(/^Backups stay on this computer|\. Backups stay on this computer/);
  });

  it('keeps when reviews are saved, where they go with no folder chosen, and that they hold the chapter', () => {
    expect(REVIEWS_FOLDER_TIP).toMatch(/as soon as the model answers, and again after every decision/);
    expect(REVIEWS_FOLDER_TIP).toContain(`${APP_NAME}'s own data folder`);
    expect(REVIEWS_FOLDER_TIP).toMatch(/full text of its chapter/);
  });

  it('says where the guidelines file is by default and that one there is never written over', () => {
    expect(GUIDELINES_TIP).toMatch(/Sent with every review/);
    expect(GUIDELINES_TIP).toMatch(/GUIDELINES\.md in the manuscript folder/);
    expect(GUIDELINES_TIP).toContain(`${APP_NAME} never writes over one that is there`);
  });

  it('says a chapter changes only on Save to chapter, and that the app never sees the Claude sign-in', () => {
    expect(MANUSCRIPT_TIP).toMatch(/A chapter changes only when you press Save to chapter/);
    expect(CLAUDE_ACCOUNT_TIP).toContain(`${APP_NAME} never sees your Claude password or sign-in token`);
  });

  it('says what Default and the effort do, and where the ChatGPT model is chosen', () => {
    expect(MODEL_TIP).toMatch(/^Default lets Claude Code use your account's own default model/);
    expect(MODEL_TIP).toMatch(/ChatGPT model is chosen/);
    expect(EFFORT_TIP).toMatch(/for Claude and ChatGPT alike/);
    for (const tip of TIPS) expect(tip, tip).not.toMatch(/OpenAI (model|key)|OPENAI_API_KEY/);
  });

  it('never says "accepted changes"', () => {
    for (const text of [...NOTES, ...TIPS]) expect(text).not.toMatch(/accepted changes?/i);
  });
});

describe("the (?)'s name", () => {
  it('says what it explains', () => {
    expect(helpButtonLabel('the reviews folder')).toBe('More about the reviews folder');
  });
});
