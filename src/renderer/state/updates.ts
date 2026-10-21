import {
  NO_UPDATE_CARD,
  RESTART_AFTER_REVIEW,
  UPDATE_CARD_KEY,
  UPDATE_PROBLEM_CARD_KEY,
  overlayEnds,
  updateCardStep,
  versionToDownload,
  type UpdateCardMemory
} from '../../shared/ui/update';
import type { UpdateStatus } from '../../shared/updates';
import type { LeaveAppReason } from './closeGuard';
import { useApp } from './store';

/*
 * The updater, page side (`release.9`, PLAN 11.3 n). Main keeps where the
 * updater is and pushes every change as `update:state` (`src/main/updates.ts`,
 * release.8b); the page keeps the last status in the store, for About's
 * status line, and shows the one update card from it (`updateCardStep`):
 * Download, the download's progress, Restart now, and a download or an
 * install that failed, each in place of the last, so the card keeps its place
 * in the stack. Download and Restart now are the card's buttons and About's.
 *
 * Restart now (11.3 n): refused while a review runs, then the close question
 * (`prepareToLeaveApp('update')`), then the overlay over the whole window and
 * `update:install`; main lets its writes end and starts the installer, which
 * closes the app. An install that fails takes the overlay away, and the card
 * says why.
 *
 * Main is reached only through `UpdateIo`, which App fills, so this module
 * needs neither the DOM nor the preload bridge and is tested in node, and
 * type-checked there too (tsconfig.node.json).
 */

/** How the page reaches main's updater. */
export interface UpdateIo {
  /** `update:get` */
  get(): Promise<UpdateStatus>;
  /** `update:check` */
  check(): Promise<UpdateStatus>;
  /** `update:download` */
  download(version: string): Promise<UpdateStatus>;
  /** `update:install` */
  install(): Promise<UpdateStatus>;
  /** `update:state`; returns the unsubscribe */
  onState(listener: (status: UpdateStatus) => void): () => void;
}

/** What the page remembers of the card between two states. */
let memory: UpdateCardMemory = NO_UPDATE_CARD;
/** A status has come in, pushed or answered, since the guard was installed. */
let heard = false;
/** Restart now is under way, from its press to the install's answer. */
let restarting = false;

/**
 * A status from main, pushed or answered: kept in the store, the card put up,
 * changed in place, left or taken down, and the overlay taken away once the
 * install has failed.
 */
export function noteUpdateStatus(status: UpdateStatus): void {
  heard = true;
  const store = useApp.getState();
  store.setUpdateStatus(status);
  const showing = store.notifications.some((n) => n.key === UPDATE_CARD_KEY);
  const next = updateCardStep(status, memory, showing);
  memory = next.memory;
  if (next.step.do === 'show') {
    const { tone, text, action } = next.step.card;
    store.upsertNotification(UPDATE_CARD_KEY, tone, text, action);
  } else if (next.step.do === 'withdraw') {
    store.dismissNotificationsByKey(UPDATE_CARD_KEY);
  }
  if (store.updateOverlay && overlayEnds(status)) store.setUpdateOverlay(false);
}

/**
 * Follow the updater from now on (App, once): every `update:state`, and
 * `update:get` once, for a page that has just loaded or been reloaded while
 * an update was on offer. A push that comes first is newer than the answer,
 * which is then dropped. Returns the uninstall.
 */
export function installUpdateCards(io: UpdateIo): () => void {
  memory = NO_UPDATE_CARD;
  heard = false;
  const off = io.onState(noteUpdateStatus);
  void io.get().then(
    (status) => {
      if (!heard) noteUpdateStatus(status);
    },
    () => undefined
  );
  return off;
}

/** Main's words for a refusal (an `ApiError` is an `Error` with them as its message). */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A press that did nothing says why, in a card of its own beside the update card. */
function problem(text: string, tone: 'info' | 'error'): void {
  useApp.getState().notify(tone, text, UPDATE_PROBLEM_CARD_KEY);
}

/** Check for updates, from About: the answer comes as `update:state` too; a refusal says why. */
export async function checkForUpdates(io: UpdateIo): Promise<void> {
  try {
    noteUpdateStatus(await io.check());
  } catch (err) {
    problem(errorMessage(err), 'error');
  }
}

/** Download, from the card or About: the version on offer, or the one whose download failed. */
export async function downloadUpdate(io: UpdateIo): Promise<void> {
  const version = versionToDownload(useApp.getState().updateStatus);
  if (version === null) return;
  try {
    noteUpdateStatus(await io.download(version));
  } catch (err) {
    problem(errorMessage(err), 'error');
  }
}

export interface RestartDeps {
  io: UpdateIo;
  /** `prepareToLeaveApp`: the close question, true to go on */
  prepare: (reason: LeaveAppReason) => Promise<boolean>;
}

/** How Restart now ended in the page. */
export type RestartOutcome =
  /** a review is running, or Restart now is already under way */
  | 'refused'
  /** the author chose to stay, or a save the question started did not reach the file */
  | 'stayed'
  /** main is starting the installer, which closes the app */
  | 'installing'
  /** the install did not start; the card or a problem card says why */
  | 'failed';

function reviewRunning(): boolean {
  return useApp.getState().aiBusyPath !== null;
}

/**
 * Restart now (PLAN 11.3 n): refused while a review runs, of this chapter or
 * another ("Restart after the review finishes"), since the install would stop
 * it. Then the close question, as closing the window asks it
 * (`prepareToLeaveApp('update')`): it writes what is waiting, asks about what
 * is not saved to the chapter, and goes on only with the author's yes. A
 * review started while the writes ran is refused the same way. Then the
 * overlay covers the window, so nothing more can be decided, and main
 * installs. Only one Restart now runs at a time.
 */
export async function restartNow(deps: RestartDeps): Promise<RestartOutcome> {
  if (restarting) return 'refused';
  if (reviewRunning()) {
    problem(RESTART_AFTER_REVIEW, 'info');
    return 'refused';
  }
  restarting = true;
  try {
    const go = await deps.prepare('update');
    if (!go) return 'stayed';
    if (reviewRunning()) {
      problem(RESTART_AFTER_REVIEW, 'info');
      return 'refused';
    }
    useApp.getState().dismissNotificationsByKey(UPDATE_PROBLEM_CARD_KEY);
    useApp.getState().setUpdateOverlay(true);
    let status: UpdateStatus;
    try {
      status = await deps.io.install();
    } catch (err) {
      useApp.getState().setUpdateOverlay(false);
      problem(errorMessage(err), 'error');
      return 'failed';
    }
    noteUpdateStatus(status);
    return status.state.phase === 'installing' ? 'installing' : 'failed';
  } finally {
    restarting = false;
  }
}
