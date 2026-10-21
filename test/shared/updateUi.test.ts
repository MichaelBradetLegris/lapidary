import { describe, expect, it } from 'vitest';
import { APP_NAME } from '../../src/shared/branding';
import {
  AUTO_CHECK_LABEL,
  AUTO_CHECK_NOTE,
  NO_UPDATE_CARD,
  RESTART_AFTER_REVIEW,
  UPDATE_ACTION_LABELS,
  aboutUpdateLine,
  actionKeepsCard,
  canCheckForUpdates,
  checkForUpdatesOff,
  checkForUpdatesWaits,
  checkHeld,
  isUpdateAction,
  overlayEnds,
  updateActionFor,
  updateActionHeld,
  updateCardStateKey,
  updateCardStep,
  updateOverlayText,
  versionToDownload,
  type UpdateCardMemory
} from '../../src/shared/ui/update';
import {
  updateCardFor,
  updateStatusLine,
  type UpdateState,
  type UpdateStatus
} from '../../src/shared/updates';

/* release.9: the update card follows main's states in place, About's update
   controls and Restart now's overlay. The card's words are updateCardFor's
   (test/shared/updates.test.ts); here, how the one card under the key
   `update` goes from state to state. */

function status(state: UpdateState, patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    mode: 'auto',
    offReason: null,
    current: '1.0.0',
    state,
    checkedAt: null,
    releaseUrl: 'https://github.com/example/app/releases',
    ...patch
  };
}

const AVAILABLE = status({ phase: 'available', version: '1.0.1', size: 114_000_000 });
const downloading = (percent: number): UpdateStatus =>
  status({ phase: 'downloading', version: '1.0.1', percent, transferred: 0, total: 114_000_000 });
const DOWNLOADED = status({ phase: 'downloaded', version: '1.0.1' });
const INSTALLING = status({ phase: 'installing', version: '1.0.1' });
const CHECKING = status({ phase: 'checking', manual: true });
const UP_TO_DATE = status({ phase: 'up-to-date', manual: true });
const INSTALL_FAILED = status({
  phase: 'failed',
  stage: 'install',
  kind: 'failed',
  manual: false,
  version: '1.0.1',
  retry: false
});

/** Plays states through `updateCardStep`, as the page does, with the stack's card up or not. */
function play(
  steps: ReadonlyArray<{ status: UpdateStatus; closedByAuthor?: boolean }>
): Array<'show' | 'keep' | 'withdraw'> {
  let memory: UpdateCardMemory = NO_UPDATE_CARD;
  let up = false;
  const done: Array<'show' | 'keep' | 'withdraw'> = [];
  for (const step of steps) {
    if (step.closedByAuthor) up = false;
    const next = updateCardStep(step.status, memory, up);
    memory = next.memory;
    done.push(next.step.do);
    if (next.step.do === 'show') up = true;
    if (next.step.do === 'withdraw') up = false;
  }
  return done;
}

describe('the update card through its states (release.9)', () => {
  it('is put up for a version on offer and changed in place from Download to Restart now', () => {
    const first = updateCardStep(AVAILABLE, NO_UPDATE_CARD, false);
    expect(first.step).toEqual({ do: 'show', card: updateCardFor(AVAILABLE) });
    expect(play([{ status: AVAILABLE }, { status: downloading(0) }, { status: downloading(50) }])).toEqual([
      'show',
      'show',
      'show'
    ]);
    const ready = updateCardStep(DOWNLOADED, first.memory, true);
    expect(ready.step).toEqual({ do: 'show', card: updateCardFor(DOWNLOADED) });
    expect(ready.memory).toEqual({ shown: 'downloaded 1.0.1', closed: null });
  });

  it('stays as it was while a check runs, which may find the same version, and while Restart now runs', () => {
    expect(play([{ status: AVAILABLE }, { status: CHECKING }, { status: AVAILABLE }])).toEqual([
      'show',
      'keep',
      'show'
    ]);
    expect(play([{ status: DOWNLOADED }, { status: INSTALLING }, { status: INSTALL_FAILED }])).toEqual([
      'show',
      'keep',
      'show'
    ]);
  });

  it('goes when the state has nothing to show, and a check finds nothing newer', () => {
    expect(play([{ status: AVAILABLE }, { status: CHECKING }, { status: UP_TO_DATE }])).toEqual([
      'show',
      'keep',
      'withdraw'
    ]);
    expect(updateCardStep(status({ phase: 'idle' }), NO_UPDATE_CARD, false).step).toEqual({
      do: 'withdraw'
    });
  });

  it('stays closed once the author closes it, while the state it told lasts, and comes back with the next', () => {
    expect(
      play([
        { status: downloading(10) },
        { status: downloading(20), closedByAuthor: true },
        { status: downloading(30) },
        { status: downloading(100) },
        { status: DOWNLOADED }
      ])
    ).toEqual(['show', 'keep', 'keep', 'keep', 'show']);
    // A version on offer closed stays closed through a check that finds it again.
    expect(
      play([
        { status: AVAILABLE },
        { status: CHECKING, closedByAuthor: true },
        { status: AVAILABLE },
        { status: downloading(0) }
      ])
    ).toEqual(['show', 'keep', 'keep', 'show']);
  });

  it('forgets a closed card once its state is over, so the same state later shows again', () => {
    expect(
      play([
        { status: AVAILABLE },
        { status: AVAILABLE, closedByAuthor: true },
        { status: UP_TO_DATE },
        { status: AVAILABLE }
      ])
    ).toEqual(['show', 'keep', 'withdraw', 'show']);
  });

  it('tells each state apart by phase, version and, for a failure, stage and retry, not by progress', () => {
    expect(updateCardStateKey(downloading(10).state)).toBe(updateCardStateKey(downloading(90).state));
    expect(updateCardStateKey(AVAILABLE.state)).toBe('available 1.0.1');
    expect(updateCardStateKey(status({ phase: 'available', version: '1.0.2', size: null }).state)).toBe(
      'available 1.0.2'
    );
    expect(updateCardStateKey(INSTALL_FAILED.state)).toBe('failed install 1.0.1 spent');
    expect(updateCardStateKey({ ...INSTALL_FAILED.state, retry: true } as UpdateState)).toBe(
      'failed install 1.0.1 retry'
    );
    expect(updateCardStateKey(CHECKING.state)).toBe('checking');
  });
});

describe("the card's buttons", () => {
  it('names them as the card does', () => {
    expect(UPDATE_ACTION_LABELS).toEqual({
      'update-download': 'Download',
      'update-restart': 'Restart now',
      'update-open-page': 'Open the release page'
    });
    expect(isUpdateAction('update-open-page')).toBe(true);
    expect(isUpdateAction('show-diagnostics')).toBe(false);
  });

  it('keeps the card up after Download and Restart now, whose card shows what follows, and closes it after the others', () => {
    expect(actionKeepsCard('update-download')).toBe(true);
    expect(actionKeepsCard('update-restart')).toBe(true);
    expect(actionKeepsCard('update-open-page')).toBe(false);
    expect(actionKeepsCard('open-setup')).toBe(false);
    expect(actionKeepsCard('reveal-backups')).toBe(false);
  });

  it("gives About the card's button, and Download the version on offer or the one that failed", () => {
    expect(updateActionFor(AVAILABLE)).toBe('update-download');
    expect(updateActionFor(DOWNLOADED)).toBe('update-restart');
    expect(updateActionFor(INSTALL_FAILED)).toBe('update-open-page');
    expect(updateActionFor(downloading(5))).toBeNull();
    expect(updateActionFor(null)).toBeNull();
    // release.9 review: Restart now stays, held, while it runs, so the focus can go back to it.
    expect(updateActionFor(INSTALLING)).toBe('update-restart');
    expect(updateActionHeld(INSTALLING)).toBe(true);
    for (const s of [AVAILABLE, DOWNLOADED, INSTALL_FAILED, downloading(5), null]) {
      expect(updateActionHeld(s)).toBe(false);
    }
    expect(versionToDownload(AVAILABLE)).toBe('1.0.1');
    expect(
      versionToDownload(
        status({
          phase: 'failed',
          stage: 'download',
          kind: 'offline',
          manual: false,
          version: '1.0.1',
          retry: true
        })
      )
    ).toBe('1.0.1');
    expect(versionToDownload(DOWNLOADED)).toBeNull();
    expect(versionToDownload(null)).toBeNull();
  });
});

describe("About's update controls", () => {
  it('words the toggle and what a check sends exactly as the plan gives them', () => {
    expect(AUTO_CHECK_LABEL).toBe('Check for updates automatically');
    expect(AUTO_CHECK_NOTE).toBe(
      'Checking asks github.com for the latest version; nothing about your chapters is sent.'
    );
  });

  it('turns Check for updates off while updates are, and holds it while a check runs', () => {
    expect(checkForUpdatesOff(null)).toBe(true);
    expect(checkForUpdatesOff(status({ phase: 'idle' }, { mode: 'off', offReason: 'development' }))).toBe(
      true
    );
    expect(checkForUpdatesOff(status({ phase: 'idle' }, { mode: 'off', offReason: 'no-feed' }))).toBe(true);
    for (const s of [
      status({ phase: 'idle' }),
      downloading(40),
      DOWNLOADED,
      INSTALLING,
      INSTALL_FAILED,
      CHECKING
    ]) {
      expect(checkForUpdatesOff(s), s.state.phase).toBe(false);
    }
    expect(checkForUpdatesOff(status({ phase: 'notify', version: '1.0.1' }, { mode: 'notify' }))).toBe(false);
    expect(canCheckForUpdates(null)).toBe(false);
    expect(canCheckForUpdates(status({ phase: 'idle' }, { mode: 'off', offReason: 'development' }))).toBe(
      false
    );
    expect(canCheckForUpdates(status({ phase: 'idle' }))).toBe(true);
    expect(canCheckForUpdates(status({ phase: 'idle' }, { mode: 'notify' }))).toBe(true);
    expect(checkHeld(CHECKING)).toBe(true);
    expect(checkHeld(AVAILABLE)).toBe(false);
    expect(checkHeld(null)).toBe(false);
  });

  /* release.9 review: in these states main's check() answers with the status
     as it is and checks nothing, so About's Check for updates did nothing the
     page could show. test/main/updates.test.ts holds the two together. */
  it('holds Check for updates where main would answer without checking, and says why', () => {
    const failed = (stage: 'check' | 'download' | 'install', retry: boolean): UpdateStatus =>
      status({
        phase: 'failed',
        stage,
        kind: 'failed',
        manual: false,
        version: stage === 'check' ? null : '1.0.1',
        retry
      });
    const waits: [UpdateStatus, string][] = [
      [downloading(40), `Not while ${APP_NAME} 1.0.1 is downloading.`],
      [DOWNLOADED, `Not while ${APP_NAME} 1.0.1 is ready to install. Restart now installs it.`],
      [INSTALLING, `Not while ${APP_NAME} 1.0.1 is installing.`],
      [INSTALL_FAILED, `Close ${APP_NAME} and open it again to check for updates.`]
    ];
    for (const [s, why] of waits) {
      expect(canCheckForUpdates(s), s.state.phase).toBe(false);
      expect(checkForUpdatesWaits(s), s.state.phase).toBe(why);
    }
    const checks = [
      status({ phase: 'idle' }),
      CHECKING,
      UP_TO_DATE,
      AVAILABLE,
      status({ phase: 'notify', version: '1.0.1' }, { mode: 'notify' }),
      failed('check', true),
      failed('download', true),
      failed('install', true)
    ];
    for (const s of checks) {
      expect(canCheckForUpdates(s), JSON.stringify(s.state)).toBe(true);
      expect(checkForUpdatesWaits(s), JSON.stringify(s.state)).toBeNull();
    }
    // Updates off: the status line says why, and no title is needed.
    expect(checkForUpdatesWaits(null)).toBeNull();
    expect(checkForUpdatesWaits(status(DOWNLOADED.state, { mode: 'off', offReason: 'no-feed' }))).toBeNull();
    expect(canCheckForUpdates(status(DOWNLOADED.state, { mode: 'off', offReason: 'no-feed' }))).toBe(false);
  });

  it("says where the updater is in updateStatusLine's words, or that nothing is known yet", () => {
    expect(aboutUpdateLine(null)).toBe('Not checked yet.');
    expect(aboutUpdateLine(UP_TO_DATE)).toBe('Up to date');
    expect(aboutUpdateLine(AVAILABLE)).toBe(updateStatusLine(AVAILABLE));
    expect(aboutUpdateLine(status({ phase: 'idle' }, { mode: 'off', offReason: 'development' }))).toBe(
      'Updates are off in a development run.'
    );
  });
});

describe("Restart now's refusal and overlay", () => {
  it('refuses during a review in the words of 11.3 (n)', () => {
    expect(RESTART_AFTER_REVIEW.startsWith('Restart after the review finishes.')).toBe(true);
  });

  it('says the app closes for the installer, with the version being installed', () => {
    expect(updateOverlayText(INSTALLING)).toEqual({
      title: `Installing ${APP_NAME} 1.0.1…`,
      body: `${APP_NAME} closes now. The installer shows its progress, then opens ${APP_NAME} again.`
    });
    expect(updateOverlayText(null).title).toBe(`Installing ${APP_NAME}…`);
  });

  it('stays while the install is under way, and goes with anything else', () => {
    expect(overlayEnds(INSTALLING)).toBe(false);
    expect(overlayEnds(INSTALL_FAILED)).toBe(true);
    expect(overlayEnds(DOWNLOADED)).toBe(true);
  });
});
