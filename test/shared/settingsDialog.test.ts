import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import { ABOUT_BUTTON } from '../../src/shared/ui/about';
import { BACKUPS_NOTE } from '../../src/shared/ui/backups';
import {
  ABOUT_BUTTON_NOTE,
  APPEARANCE_NOTE,
  BACKUPS_ROW_NOTE,
  BACKUPS_TIP,
  CLAUDE_ACCOUNT_TIP,
  DONE_NOTE,
  EFFORT_TIP,
  GUIDELINES_TIP,
  KEY_CANNOT_ENCRYPT,
  MANUSCRIPT_TIP,
  MODEL_TIP,
  OPENAI_KEY_NOTE,
  OPENAI_KEY_TIP,
  OPENAI_KEYS_LINK_TITLE,
  OPENAI_KEYS_PAGE,
  OPENAI_KEYS_URL,
  REVIEWS_FOLDER_TIP,
  SETTINGS_NOTE_MAX,
  SETTINGS_SECTIONS,
  helpButtonLabel,
  reviewsFolderNote
} from '../../src/shared/ui/settingsDialog';
import { WELCOME_GUIDE_NOTE } from '../../src/shared/ui/welcome';

/* polish.4: the Settings dialog's words. Each note under a row is one short
   line, and the longer explanations it used to give are the tooltips of the
   (?) beside the rows, keeping everything that matters for the author's
   files and key. How the dialog lays them out is in
   test/renderer/settingsDialog.render.test.ts. */

const NOTES = [
  APPEARANCE_NOTE,
  reviewsFolderNote(false),
  reviewsFolderNote(true),
  BACKUPS_ROW_NOTE,
  `${OPENAI_KEY_NOTE} ${OPENAI_KEYS_PAGE}.`,
  KEY_CANNOT_ENCRYPT
];

const TIPS = [
  MODEL_TIP,
  EFFORT_TIP,
  MANUSCRIPT_TIP,
  REVIEWS_FOLDER_TIP,
  BACKUPS_TIP,
  GUIDELINES_TIP,
  CLAUDE_ACCOUNT_TIP,
  OPENAI_KEY_TIP
];

describe('the sections', () => {
  it('are Review, Folders and Accounts, in that order', () => {
    expect(SETTINGS_SECTIONS).toEqual(['Review', 'Folders', 'Accounts']);
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

  it("send the key's link to the page the field's placeholder names", () => {
    expect(OPENAI_KEYS_URL).toBe('https://platform.openai.com/api-keys');
    expect(OPENAI_KEY_NOTE).toMatch(/billed per token/);
    expect(OPENAI_KEYS_LINK_TITLE).toMatch(/browser/);
  });

  it('say, when no key can be encrypted, that none can be saved and what to use instead', () => {
    expect(KEY_CANNOT_ENCRYPT).toMatch(/^Windows cannot encrypt/);
    expect(KEY_CANNOT_ENCRYPT).toMatch(/none can be saved/);
    expect(KEY_CANNOT_ENCRYPT).toContain('OPENAI_API_KEY');
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
  it('keeps that the key is encrypted, never shown, used only in the background, and the environment fallback', () => {
    expect(OPENAI_KEY_TIP).toMatch(/encrypted with your Windows login/);
    expect(OPENAI_KEY_TIP).toMatch(/beside the settings file/);
    expect(OPENAI_KEY_TIP).toMatch(/never shown again/);
    expect(OPENAI_KEY_TIP).toContain(`only ${APP_NAME}'s background process uses it`);
    expect(OPENAI_KEY_TIP).toMatch(/With no saved key, OPENAI_API_KEY from the environment is used/);
    expect(OPENAI_KEY_TIP).toMatch(/not a ChatGPT subscription/);
  });

  it("keeps apply.11's backups note word for word, with the 20-and-30-days rule", () => {
    expect(BACKUPS_TIP).toBe(BACKUPS_NOTE);
    expect(BACKUPS_TIP).toMatch(/The last 20 saves and the first save of each day for 30 days are kept/);
    expect(BACKUPS_TIP).toMatch(/Backups stay on this computer/);
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

  it('says what Default and the effort do, and where the OpenAI model is chosen', () => {
    expect(MODEL_TIP).toMatch(/^Default lets Claude Code use your account's own default model/);
    expect(MODEL_TIP).toMatch(/OpenAI model is chosen/);
    expect(EFFORT_TIP).toMatch(/for Claude and OpenAI alike/);
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
