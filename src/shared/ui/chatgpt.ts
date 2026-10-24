/**
 * What the Setup screen's ChatGPT view and Settings' ChatGPT account row say
 * (codex.2, PLAN 5.7), decided without React. Sign in with ChatGPT opens
 * OpenAI's own sign-in page in the browser, and main keeps the sign-in
 * encrypted; the page only ever learns `ChatGptStatus`. The training warning,
 * its button and its box are the author's requirement (Appendix D 23): ChatGPT
 * plans may train on what is sent unless the user turns that off, the app
 * cannot check it, and the box "I have confirmed my data settings" is kept for
 * each account. Pure (CLAUDE.md rule 4).
 */

import { APP_NAME } from '../branding';
import type { ChatGptStatus, ExternalPage } from '../ipc';
import type { SetupTone } from './setup';

/**
 * ChatGPT's Data controls settings, where "Improve the model for everyone" is
 * turned off: the web app's own address for that page (Appendix A, read
 * 2026-10-24). If ChatGPT stops honouring it, the page opens on ChatGPT's home
 * page, and the warning names the way there by hand.
 */
export const CHATGPT_DATA_CONTROLS_URL = 'https://chatgpt.com/#settings/DataControls';

/** The address of each page `shell:open-external` opens; main reads it, the page sends only the name. */
export const EXTERNAL_PAGE_URLS: Readonly<Record<ExternalPage, string>> = Object.freeze({
  'chatgpt-data-controls': CHATGPT_DATA_CONTROLS_URL
});

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

/** One of the labels OpenAI's guidelines approve for the button that starts the sign-in (Appendix A). */
export const SIGN_IN_BUTTON = 'Sign in with ChatGPT';
export const SIGN_OUT_BUTTON = 'Sign out';
/** While signed out with a registration kept: register again, for another ChatGPT account. */
export const ANOTHER_ACCOUNT_BUTTON = 'Use another account';
export const CANCEL_SIGN_IN_BUTTON = 'Cancel';
export const DATA_CONTROLS_BUTTON = 'Open Data controls';
/** The box's words, the author's own (Appendix D 23): a check of the settings, not a promise to turn training off. */
export const DATA_SETTINGS_CHECKBOX = 'I have confirmed my data settings';

/* ------------------------------------------------------------------ */
/* The training warning                                                */
/* ------------------------------------------------------------------ */

export const TRAINING_WARNING_TITLE = 'ChatGPT may train on your chapters';

export const TRAINING_WARNING_TEXT = `On personal ChatGPT plans (Free, Go, Plus and Pro), OpenAI may use what you send to train its models unless you turn that off in ChatGPT: open Settings, then Data controls, and turn off Improve the model for everyone. For a review, ${APP_NAME} sends your chapter and your guidelines file. ${APP_NAME} cannot see that setting, so check it yourself.`;

/** The author's words (Appendix D 23): leaving training on is allowed, only not recommended. */
export const TRAINING_CHOICE_TEXT =
  'You may leave it on if you are happy for OpenAI to train on your writing, but turning it off is recommended.';

/** The line under the box: what it is for, and whose it is. */
export function dataSettingsNote(status: ChatGptStatus | null): string {
  if (!status?.signedIn) return 'Sign in first: the box is kept for the account you sign in with.';
  return status.dataSettingsConfirmed
    ? 'Kept for this account.'
    : 'Your first ChatGPT review needs this box ticked. It is kept for this account.';
}

/* ------------------------------------------------------------------ */
/* The status card                                                     */
/* ------------------------------------------------------------------ */

export interface ChatGptSetupStatus {
  tone: SetupTone;
  title: string;
  /** one paragraph each */
  lines: string[];
}

export const SIGNED_OUT_TEXT = `Sign in with your ChatGPT account to review on your ChatGPT plan, with no API key. ${APP_NAME} opens OpenAI's sign-in page in your browser; once you have signed in there and allowed ${APP_NAME}, your browser hands the sign-in back to ${APP_NAME}.`;

/** How long main waits for the browser's answer, in minutes (`SIGN_IN_WAIT_MS` in src/main/chatgpt). */
export const SIGN_IN_WAIT_MINUTES = 10;

export const WAITING_TEXT = `${APP_NAME} has opened OpenAI's sign-in page in your browser. Sign in there and allow ${APP_NAME} to use your ChatGPT plan; ${APP_NAME} waits up to ${SIGN_IN_WAIT_MINUTES} minutes. If no page opened, or you closed it, choose Cancel and sign in again.`;

export const SIGNED_IN_TEXT = `${APP_NAME} keeps the sign-in encrypted on this computer and never shows it. Sign out removes it here and asks OpenAI to end it.`;

export const NO_ENCRYPTION_TEXT = `Windows cannot encrypt secrets for ${APP_NAME} right now, so a ChatGPT sign-in cannot be kept, and ${APP_NAME} keeps none unencrypted.`;

/** The view's privacy footer, as Claude's Setup has one (`PRIVACY_FOOTER`). */
export const CHATGPT_PRIVACY_FOOTER = `${APP_NAME} never sees your ChatGPT password: you sign in on OpenAI's own page. It keeps only the sign-in's tokens, encrypted with your Windows login in its data folder, never shown and used only by its background process.`;

/** The status card: where the sign-in stands, in a few words. */
export function chatGptSetupStatus(status: ChatGptStatus | null, waiting: boolean): ChatGptSetupStatus {
  const dev = status?.devServer ? [`Using a development sign-in server: ${status.devServer}`] : [];
  if (waiting) return { tone: 'pending', title: 'Waiting for you to sign in', lines: [WAITING_TEXT, ...dev] };
  if (status === null) {
    return { tone: 'pending', title: 'Reading the ChatGPT sign-in…', lines: [] };
  }
  if (status.signedIn) {
    const plan = status.plan ? [`Your ChatGPT account is on the ${status.plan} plan.`] : [];
    return { tone: 'ok', title: 'Signed in to ChatGPT', lines: [...plan, SIGNED_IN_TEXT, ...dev] };
  }
  if (!status.encryptionAvailable) {
    return {
      tone: 'warn',
      title: `${APP_NAME} cannot keep a sign-in here`,
      lines: [NO_ENCRYPTION_TEXT, ...dev]
    };
  }
  return { tone: 'pending', title: 'Not signed in to ChatGPT', lines: [SIGNED_OUT_TEXT, ...dev] };
}

/** Settings' ChatGPT account row: signed in or not, and the plan when the sign-in named it. */
export function chatGptAccountLine(status: ChatGptStatus | null, waiting: boolean): string {
  if (waiting) return 'waiting for the browser';
  if (status === null) return 'not read yet';
  if (!status.signedIn) return 'not signed in';
  return status.plan ? `signed in (${status.plan})` : 'signed in';
}

/* ------------------------------------------------------------------ */
/* What a sign-in or a sign-out says                                   */
/* ------------------------------------------------------------------ */

/** Why a sign-in did not finish, as main reports it; a cancelled one says nothing. */
export type SignInFailure =
  /** the browser could not be opened */
  | 'browser'
  /** nothing came back within `SIGN_IN_WAIT_MINUTES` */
  | 'timeout'
  /** the author did not allow the app on OpenAI's page */
  | 'denied'
  /** OpenAI's page answered with another error */
  | 'refused'
  /** a first sign-in's answer carried no client id */
  | 'registration'
  /** the answer named a client id other than the one asked for */
  | 'client-mismatch'
  /** OpenAI refused the code */
  | 'invalid-grant'
  /** the code could not be exchanged: no answer, or an answer that was not tokens */
  | 'exchange'
  /** the ID token did not pass its checks */
  | 'id-token'
  /** a kept registration came back signed in as another account */
  | 'other-account'
  /** the sign-in did not grant the use of the ChatGPT plan */
  | 'no-plan-use';

/**
 * What the page says for a sign-in that did not finish. `extra` is OpenAI's
 * error word for `refused`, or the HTTP status for `exchange`, already reduced
 * to a short word or number by main; never anything OpenAI wrote at length.
 */
export function signInFailureMessage(reason: SignInFailure, extra?: string): string {
  switch (reason) {
    case 'browser':
      return `${APP_NAME} could not open your browser for the sign-in. Check that your computer has a default browser, then try again.`;
    case 'timeout':
      return `The sign-in was not finished within ${SIGN_IN_WAIT_MINUTES} minutes, so ${APP_NAME} stopped waiting. Choose ${SIGN_IN_BUTTON} to try again.`;
    case 'denied':
      return `You did not allow ${APP_NAME} on OpenAI's page, so you are not signed in.`;
    case 'refused':
      return `OpenAI's sign-in page did not sign you in${extra ? ` (it answered "${extra}")` : ''}. Try again.`;
    case 'registration':
      return `OpenAI's sign-in page did not finish registering ${APP_NAME}, so you are not signed in. Try again.`;
    case 'client-mismatch':
      return `The answer from OpenAI's sign-in page was for another registration of ${APP_NAME}, so it was not used. Try again.`;
    case 'invalid-grant':
      return `OpenAI did not accept the sign-in, which may have taken too long. Choose ${SIGN_IN_BUTTON} to try again.`;
    case 'exchange':
      return `${APP_NAME} could not finish the sign-in with OpenAI${extra ? ` (${extra})` : ''}. Check your connection and try again.`;
    case 'id-token':
      return `OpenAI's answer to the sign-in did not pass ${APP_NAME}'s checks, so it was not kept. Try again.`;
    case 'other-account':
      return `You signed in as another ChatGPT account than the one ${APP_NAME} was registered with on this computer, so that sign-in was not kept. To use that account, choose ${ANOTHER_ACCOUNT_BUTTON}.`;
    case 'no-plan-use':
      return `OpenAI did not give ${APP_NAME} permission to use your ChatGPT plan, so you are not signed in. Choose ${SIGN_IN_BUTTON} again and allow it on OpenAI's page.`;
  }
}

export const SIGNED_OUT_REVOKED =
  'Signed out. The sign-in was removed from this computer, and OpenAI ended it.';

export const SIGNED_OUT_NOT_REVOKED = `Signed out on this computer, but OpenAI did not confirm that it ended the sign-in. To be sure, disconnect ${APP_NAME} in your ChatGPT settings.`;

/* ------------------------------------------------------------------ */
/* The browser tab the sign-in ends in                                 */
/* ------------------------------------------------------------------ */

/** What the loopback listener answers the browser with: a title and one paragraph, never anything it was sent. */
export interface CallbackPageWords {
  title: string;
  text: string;
}

export const CALLBACK_SIGNED_IN: CallbackPageWords = {
  title: 'Signed in',
  text: `You are signed in to ChatGPT in ${APP_NAME}. You can close this tab and go back to ${APP_NAME}.`
};

export const CALLBACK_NOT_OURS: CallbackPageWords = {
  title: 'Not this sign-in',
  text: `This is not the sign-in ${APP_NAME} is waiting for. Go back to ${APP_NAME} and choose ${SIGN_IN_BUTTON} again.`
};

export const CALLBACK_CANCELLED: CallbackPageWords = {
  title: 'Sign-in stopped',
  text: `${APP_NAME} stopped waiting for this sign-in. Go back to ${APP_NAME} to sign in again.`
};

/** The page for a sign-in that did not finish: the same words the app shows. */
export function callbackFailedPage(message: string): CallbackPageWords {
  return { title: 'Not signed in', text: `${message} You can close this tab.` };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

const PLAN_NAMES: Readonly<Record<string, string>> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu'
};

/**
 * The plan's name from the word an ID token gives for it (`chatgpt_plan_type`
 * in its `https://api.openai.com/auth` claim, as Codex reads it; OpenAI's
 * pages for this sign-in do not document it, so it may be missing): a known
 * word by its name, another plain word capitalised, anything else nothing.
 */
export function chatGptPlanLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const word = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(word)) return null;
  const known = PLAN_NAMES[word];
  if (known) return known;
  return word
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
