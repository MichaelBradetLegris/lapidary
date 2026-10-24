import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import type { ChatGptStatus } from '../../src/shared/ipc';
import {
  ANOTHER_ACCOUNT_BUTTON,
  CALLBACK_CANCELLED,
  CALLBACK_NOT_OURS,
  CALLBACK_SIGNED_IN,
  CHATGPT_DATA_CONTROLS_URL,
  CHATGPT_PRIVACY_FOOTER,
  DATA_CONTROLS_BUTTON,
  DATA_SETTINGS_CHECKBOX,
  EXTERNAL_PAGE_URLS,
  NO_ENCRYPTION_TEXT,
  SIGNED_IN_TEXT,
  SIGNED_OUT_NOT_REVOKED,
  SIGNED_OUT_REVOKED,
  SIGNED_OUT_TEXT,
  SIGN_IN_BUTTON,
  SIGN_IN_WAIT_MINUTES,
  TRAINING_CHOICE_TEXT,
  TRAINING_WARNING_TEXT,
  TRAINING_WARNING_TITLE,
  WAITING_TEXT,
  callbackFailedPage,
  chatGptAccountLine,
  chatGptPlanLabel,
  chatGptSetupStatus,
  dataSettingsNote,
  signInFailureMessage,
  type SignInFailure
} from '../../src/shared/ui/chatgpt';

/* codex.2: what the Setup screen's ChatGPT view, Settings' ChatGPT account
   row and the sign-in's browser tab say (PLAN 5.7). The training warning and
   the box are the author's (Appendix D 23). */

const SIGNED_OUT: ChatGptStatus = {
  signedIn: false,
  plan: null,
  dataSettingsConfirmed: false,
  signingIn: false,
  registered: false,
  encryptionAvailable: true
};
const SIGNED_IN: ChatGptStatus = { ...SIGNED_OUT, signedIn: true, plan: 'Plus', registered: true };

describe('the training warning (codex.2)', () => {
  it('says what the author asked: ChatGPT plans may train on what is sent, where to turn it off, that the app cannot check it, and that leaving it on is allowed', () => {
    expect(TRAINING_WARNING_TITLE).toBe('ChatGPT may train on your chapters');
    expect(TRAINING_WARNING_TEXT).toContain('OpenAI may use what you send to train its models');
    expect(TRAINING_WARNING_TEXT).toContain(
      'Settings, then Data controls, and turn off Improve the model for everyone'
    );
    expect(TRAINING_WARNING_TEXT).toContain(`${APP_NAME} cannot see that setting, so check it yourself.`);
    expect(TRAINING_WARNING_TEXT).toContain('your chapter and your guidelines file');
    expect(TRAINING_CHOICE_TEXT).toContain('You may leave it on');
    expect(TRAINING_CHOICE_TEXT).toContain('turning it off is recommended');
  });

  it("has the box in the author's own words, and a button that names the page it opens", () => {
    expect(DATA_SETTINGS_CHECKBOX).toBe('I have confirmed my data settings');
    expect(DATA_CONTROLS_BUTTON).toBe('Open Data controls');
  });

  it("opens ChatGPT's Data controls, an https page of chatgpt.com, by name only", () => {
    expect(CHATGPT_DATA_CONTROLS_URL).toBe('https://chatgpt.com/#settings/DataControls');
    expect(EXTERNAL_PAGE_URLS).toEqual({ 'chatgpt-data-controls': CHATGPT_DATA_CONTROLS_URL });
    expect(Object.isFrozen(EXTERNAL_PAGE_URLS)).toBe(true);
  });

  it('says under the box whose it is and what it is for', () => {
    expect(dataSettingsNote(null)).toBe('Sign in first: the box is kept for the account you sign in with.');
    expect(dataSettingsNote(SIGNED_OUT)).toBe(dataSettingsNote(null));
    expect(dataSettingsNote(SIGNED_IN)).toBe(
      'Your first ChatGPT review needs this box ticked. It is kept for this account.'
    );
    expect(dataSettingsNote({ ...SIGNED_IN, dataSettingsConfirmed: true })).toBe('Kept for this account.');
  });
});

describe("the ChatGPT view's status card (codex.2)", () => {
  it('reads the sign-in before saying anything', () => {
    expect(chatGptSetupStatus(null, false)).toEqual({
      tone: 'pending',
      title: 'Reading the ChatGPT sign-in…',
      lines: []
    });
  });

  it('says how the sign-in goes while signed out', () => {
    expect(chatGptSetupStatus(SIGNED_OUT, false)).toEqual({
      tone: 'pending',
      title: 'Not signed in to ChatGPT',
      lines: [SIGNED_OUT_TEXT]
    });
    expect(SIGNED_OUT_TEXT).toContain("opens OpenAI's sign-in page in your browser");
  });

  it('says what to do while waiting for the browser', () => {
    expect(chatGptSetupStatus(SIGNED_OUT, true)).toEqual({
      tone: 'pending',
      title: 'Waiting for you to sign in',
      lines: [WAITING_TEXT]
    });
    expect(WAITING_TEXT).toContain(`waits up to ${SIGN_IN_WAIT_MINUTES} minutes`);
    expect(SIGN_IN_WAIT_MINUTES).toBe(10);
  });

  it('names the plan when signed in, and only the plan', () => {
    expect(chatGptSetupStatus(SIGNED_IN, false)).toEqual({
      tone: 'ok',
      title: 'Signed in to ChatGPT',
      lines: ['Your ChatGPT account is on the Plus plan.', SIGNED_IN_TEXT]
    });
    expect(chatGptSetupStatus({ ...SIGNED_IN, plan: null }, false).lines).toEqual([SIGNED_IN_TEXT]);
  });

  it('warns when Windows cannot encrypt, so nothing can be kept', () => {
    expect(chatGptSetupStatus({ ...SIGNED_OUT, encryptionAvailable: false }, false)).toEqual({
      tone: 'warn',
      title: `${APP_NAME} cannot keep a sign-in here`,
      lines: [NO_ENCRYPTION_TEXT]
    });
  });

  it('names a development sign-in server last', () => {
    const dev = { ...SIGNED_OUT, devServer: 'http://127.0.0.1:4600' };
    expect(chatGptSetupStatus(dev, false).lines.at(-1)).toBe(
      'Using a development sign-in server: http://127.0.0.1:4600'
    );
  });

  it('has a privacy footer that says where the sign-in is kept and that the password is never seen', () => {
    expect(CHATGPT_PRIVACY_FOOTER).toContain(`${APP_NAME} never sees your ChatGPT password`);
    expect(CHATGPT_PRIVACY_FOOTER).toContain('encrypted with your Windows login');
  });
});

describe("Settings' ChatGPT account row (codex.2)", () => {
  it('says signed in or not, and the plan', () => {
    expect(chatGptAccountLine(null, false)).toBe('not read yet');
    expect(chatGptAccountLine(SIGNED_OUT, false)).toBe('not signed in');
    expect(chatGptAccountLine(SIGNED_OUT, true)).toBe('waiting for the browser');
    expect(chatGptAccountLine(SIGNED_IN, false)).toBe('signed in (Plus)');
    expect(chatGptAccountLine({ ...SIGNED_IN, plan: null }, false)).toBe('signed in');
  });
});

describe('what a sign-in that did not finish says (codex.2)', () => {
  const REASONS: SignInFailure[] = [
    'browser',
    'timeout',
    'denied',
    'refused',
    'registration',
    'client-mismatch',
    'invalid-grant',
    'exchange',
    'id-token',
    'other-account',
    'no-plan-use'
  ];

  it('has a sentence for every reason, each ending in a full stop', () => {
    const all = REASONS.map((reason) => signInFailureMessage(reason));
    expect(new Set(all).size).toBe(REASONS.length);
    for (const message of all) expect(message).toMatch(/^[A-Z].*\.$/);
  });

  it('adds only a short word or a status it is given', () => {
    expect(signInFailureMessage('refused', 'server_error')).toBe(
      'OpenAI\'s sign-in page did not sign you in (it answered "server_error"). Try again.'
    );
    expect(signInFailureMessage('exchange', 'status 500')).toBe(
      `${APP_NAME} could not finish the sign-in with OpenAI (status 500). Check your connection and try again.`
    );
  });

  it('points at the buttons by their labels', () => {
    expect(signInFailureMessage('other-account')).toContain(ANOTHER_ACCOUNT_BUTTON);
    expect(signInFailureMessage('no-plan-use')).toContain(SIGN_IN_BUTTON);
    expect(SIGN_IN_BUTTON).toBe('Sign in with ChatGPT');
  });

  it('says whether OpenAI ended the sign-in at Sign out', () => {
    expect(SIGNED_OUT_REVOKED).toContain('OpenAI ended it');
    expect(SIGNED_OUT_NOT_REVOKED).toContain(`disconnect ${APP_NAME} in your ChatGPT settings`);
  });
});

describe("the browser tab's pages (codex.2)", () => {
  it("say signed in, not this sign-in, stopped, or the reason, in the app's own words", () => {
    expect(CALLBACK_SIGNED_IN.title).toBe('Signed in');
    expect(CALLBACK_SIGNED_IN.text).toContain(`go back to ${APP_NAME}`);
    expect(CALLBACK_NOT_OURS.title).toBe('Not this sign-in');
    expect(CALLBACK_CANCELLED.title).toBe('Sign-in stopped');
    expect(callbackFailedPage(signInFailureMessage('denied'))).toEqual({
      title: 'Not signed in',
      text: `${signInFailureMessage('denied')} You can close this tab.`
    });
  });
});

describe('the plan (codex.2)', () => {
  it('names the plans by their names, capitalises another plain word, and drops anything else', () => {
    expect(chatGptPlanLabel('plus')).toBe('Plus');
    expect(chatGptPlanLabel('PRO')).toBe('Pro');
    expect(chatGptPlanLabel('go')).toBe('Go');
    expect(chatGptPlanLabel('enterprise')).toBe('Enterprise');
    expect(chatGptPlanLabel('pro_lite')).toBe('Pro Lite');
    expect(chatGptPlanLabel('<b>plus</b>')).toBeNull();
    expect(chatGptPlanLabel('a'.repeat(40))).toBeNull();
    expect(chatGptPlanLabel(3)).toBeNull();
    expect(chatGptPlanLabel(undefined)).toBeNull();
  });
});
