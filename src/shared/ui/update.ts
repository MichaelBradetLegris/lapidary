/**
 * The update card, About's update controls and Restart now's overlay, in the
 * page's words (`release.9`, PLAN 11.3 n). Main keeps where the updater is and
 * pushes it as `update:state` (`src/main/updates.ts`); `updateCardFor` and
 * `updateStatusLine` in `src/shared/updates.ts` say what a state shows. This
 * module decides how the one card under the key `update` follows the states,
 * so that it changes in place rather than going and coming back, and what the
 * overlay says while Restart now runs.
 *
 * Pure (CLAUDE.md rule 4), so every rule has a test (test/shared/updateUi.test.ts).
 */

import { APP_NAME } from '../branding';
import type { NotificationAction } from '../ipc';
import {
  updateCardFor,
  updateStatusLine,
  type UpdateCard,
  type UpdateState,
  type UpdateStatus
} from '../updates';

/** The key of the one update card in the message stack (`upsertNotification`). */
export const UPDATE_CARD_KEY = 'update';

/**
 * The key of a card that says why a press on Download or Restart now did
 * nothing, such as Restart now during a review. Apart from the update card,
 * so that card stays where it is, with its button.
 */
export const UPDATE_PROBLEM_CARD_KEY = 'update-problem';

/** The buttons an update card can carry. */
export type UpdateAction = NonNullable<UpdateCard['action']>;

/** Their labels, on the card and beside About's status line. */
export const UPDATE_ACTION_LABELS: Readonly<Record<UpdateAction, string>> = {
  'update-download': 'Download',
  'update-restart': 'Restart now',
  'update-open-page': 'Open the release page'
};

/** Whether a card's button is one of the update card's. */
export function isUpdateAction(action: NotificationAction): action is UpdateAction {
  return action === 'update-download' || action === 'update-restart' || action === 'update-open-page';
}

/**
 * Whether a card stays up after its button is pressed. Every card closes after
 * its button has done its job, but Download and Restart now begin a job the
 * same card goes on to show: the download's progress, then Restart now, or why
 * the install did not start. Closed and put up again, it would move to the
 * foot of the stack at each step.
 */
export function actionKeepsCard(action: NotificationAction): boolean {
  return action === 'update-download' || action === 'update-restart';
}

export const CHECK_FOR_UPDATES = 'Check for updates';
export const AUTO_CHECK_LABEL = 'Check for updates automatically';
export const AUTO_CHECK_NOTE =
  'Checking asks github.com for the latest version; nothing about your chapters is sent.';

/** Restart now while a review runs (PLAN 11.3 n). */
export const RESTART_AFTER_REVIEW =
  'Restart after the review finishes. Restarting now would stop the review that is running.';

/**
 * Whether Check for updates is off (disabled): until main has said where the
 * updater is, and while updates are off (a development run, or no feed),
 * which the status line beside it says.
 */
export function checkForUpdatesOff(status: UpdateStatus | null): boolean {
  return status === null || status.mode === 'off';
}

/**
 * Why Check for updates would do nothing now although updates are on, for
 * its title, or null when a check can run (release.9 review). Main's `check`
 * (src/main/updates.ts) answers with the status as it is, checking nothing,
 * while an update downloads, waits for Restart now or installs, and after an
 * install that failed once started, which Restart now cannot try again until
 * the app has been opened again (C.94). Pressed then, the button did nothing
 * the page could show. About holds it then rather than disabling it, so a
 * press that resumes a download leaves the focus on it (`heldButton`).
 */
export function checkForUpdatesWaits(status: UpdateStatus | null): string | null {
  if (status === null || checkForUpdatesOff(status)) return null;
  const state = status.state;
  switch (state.phase) {
    case 'downloading':
      return `Not while ${APP_NAME} ${state.version} is downloading.`;
    case 'downloaded':
      return `Not while ${APP_NAME} ${state.version} is ready to install. Restart now installs it.`;
    case 'installing':
      return `Not while ${APP_NAME} ${state.version} is installing.`;
    case 'failed':
      return state.stage === 'install' && !state.retry
        ? `Close ${APP_NAME} and open it again to check for updates.`
        : null;
    default:
      return null;
  }
}

/**
 * Whether Check for updates can do anything, as main's `check` decides: not
 * while it is off (`checkForUpdatesOff`), and not while main would answer it
 * without checking (`checkForUpdatesWaits`). test/main/updates.test.ts holds
 * it against the controller in every state.
 */
export function canCheckForUpdates(status: UpdateStatus | null): boolean {
  return !checkForUpdatesOff(status) && checkForUpdatesWaits(status) === null;
}

/** Check for updates is held, not disabled, while a check runs, so it keeps the focus (`heldButton`). */
export function checkHeld(status: UpdateStatus | null): boolean {
  return status?.state.phase === 'checking';
}

/** About's status line; "Not checked yet." until main has said where the updater is. */
export function aboutUpdateLine(status: UpdateStatus | null): string {
  return status ? updateStatusLine(status) : 'Not checked yet.';
}

/**
 * The button About shows beside its status line: the one the card has, so a
 * closed card is not the only way to it. While Restart now runs, the card
 * stays as it was (`updateCardStep`), and so does this button, Restart now,
 * held under the overlay (`updateActionHeld`): it is the button the focus goes
 * back to when the install fails, which then offers Restart now again or Open
 * the release page (release.9 review). Taken away, it took the focus with it.
 */
export function updateActionFor(status: UpdateStatus | null): UpdateAction | null {
  if (status === null) return null;
  if (status.state.phase === 'installing') return 'update-restart';
  return updateCardFor(status)?.action ?? null;
}

/** About's update button is held, not pressed, while Restart now runs. */
export function updateActionHeld(status: UpdateStatus | null): boolean {
  return status?.state.phase === 'installing';
}

/** The version Download fetches: the one on offer, or the one whose download failed. */
export function versionToDownload(status: UpdateStatus | null): string | null {
  const state = status?.state;
  if (!state) return null;
  if (state.phase === 'available') return state.version;
  if (state.phase === 'failed' && state.stage === 'download') return state.version;
  return null;
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/**
 * One state as the card tells it: the phase, the version and, for a failure,
 * the stage and whether Restart now can try again. A download's progress is
 * not part of it, so the card closed during a download stays closed until the
 * download ends.
 */
export function updateCardStateKey(state: UpdateState): string {
  switch (state.phase) {
    case 'failed':
      return `failed ${state.stage} ${state.version ?? ''} ${state.retry ? 'retry' : 'spent'}`;
    case 'idle':
    case 'checking':
    case 'up-to-date':
      return state.phase;
    default:
      return `${state.phase} ${state.version}`;
  }
}

/** What the page remembers of the card between two states. */
export interface UpdateCardMemory {
  /** the state the card on screen tells, or null with none up */
  shown: string | null;
  /** the state whose card the author closed, which stays closed while that state lasts */
  closed: string | null;
}

export const NO_UPDATE_CARD: UpdateCardMemory = Object.freeze({ shown: null, closed: null });

/** What to do with the card for a new state. */
export type UpdateCardStep =
  /** put the card up, or change the one up in place */
  | { do: 'show'; card: UpdateCard }
  /** leave the stack as it is */
  | { do: 'keep' }
  /** take the card down */
  | { do: 'withdraw' };

/**
 * The update card for a new state (`release.9`): the card `updateCardFor`
 * gives, put up or changed in place under `UPDATE_CARD_KEY`, so it keeps its
 * place in the stack from Download to Restart now. `showing` is whether a card
 * under the key is up now: one the page put up and that is gone was closed by
 * the author, with its X or its Open the release page, and stays closed while
 * the state it told lasts, however often a download's progress comes; the
 * next state puts it up again. A state with no card takes the card down,
 * except while a check runs, which may find the same version again, and while
 * Restart now runs, whose overlay speaks over it and whose failure comes back
 * on it: in both the card stays as it was.
 */
export function updateCardStep(
  status: UpdateStatus,
  memory: UpdateCardMemory,
  showing: boolean
): { step: UpdateCardStep; memory: UpdateCardMemory } {
  const closed = memory.shown !== null && !showing ? memory.shown : memory.closed;
  const card = updateCardFor(status);
  if (card === null) {
    const phase = status.state.phase;
    if (phase === 'checking' || phase === 'installing') {
      return { step: { do: 'keep' }, memory: { shown: showing ? memory.shown : null, closed } };
    }
    return { step: { do: 'withdraw' }, memory: NO_UPDATE_CARD };
  }
  const key = updateCardStateKey(status.state);
  if (key === closed) return { step: { do: 'keep' }, memory: { shown: null, closed } };
  return { step: { do: 'show', card }, memory: { shown: key, closed: null } };
}

/* ------------------------------------------------------------------ */
/* Restart now's overlay                                               */
/* ------------------------------------------------------------------ */

/** What the overlay says while Restart now runs (11.3 n): the app is about to close and the installer to start. */
export function updateOverlayText(status: UpdateStatus | null): { title: string; body: string } {
  const state = status?.state;
  const version = state && 'version' in state && state.version ? ` ${state.version}` : '';
  return {
    title: `Installing ${APP_NAME}${version}…`,
    body: `${APP_NAME} closes now. The installer shows its progress, then opens ${APP_NAME} again.`
  };
}

/**
 * Whether the overlay goes once a state comes in: it stays while Restart now
 * is under way (`installing`) and goes with anything else, such as an install
 * that failed, whose card then says why.
 */
export function overlayEnds(status: UpdateStatus): boolean {
  return status.state.phase !== 'installing';
}
