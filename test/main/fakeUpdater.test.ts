import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_CHECK_MS,
  FAKE_INSTALLER_BYTES,
  FAKE_STEP_MS,
  FAKE_STEPS,
  createFakeUpdater
} from '../../src/main/fakeUpdater';
import { createUpdateController, type ProgressLike } from '../../src/main/updates';
import { APP_NAME } from '../../src/shared/branding';
import {
  parseFakeUpdate,
  updateCardFor,
  type FakeUpdatePlan,
  type UpdateStatus
} from '../../src/shared/updates';

/* release.8b: the fake update of a development run
   (`MANUSCRIPT_REVIEW_DEV_FAKE_UPDATE`, PLAN 11.3 b), which plays each plan
   through the calls electron-updater has, with no request at all. */

function fake(text: string): {
  updater: ReturnType<typeof createFakeUpdater>;
  said: string[];
  quit: ReturnType<typeof vi.fn>;
} {
  const plan = parseFakeUpdate(text) as FakeUpdatePlan;
  const said: string[] = [];
  const quit = vi.fn();
  return {
    updater: createFakeUpdater({ plan, current: '0.1.0', quit, say: (line) => said.push(line) }),
    said,
    quit
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createFakeUpdater', () => {
  it('finds the version after 1.5 s, with the size of an installer', async () => {
    const { updater, said } = fake('1.0.1');
    let result: unknown = null;
    void updater.checkForUpdates().then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(FAKE_CHECK_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({
      isUpdateAvailable: true,
      updateInfo: { version: '1.0.1', files: [{ size: FAKE_INSTALLER_BYTES }] }
    });
    expect(said).toEqual(['[fake update] checking', '[fake update] check: 1.0.1 is available']);
  });

  it('finds nothing newer, no release, or no connection, as its plan says', async () => {
    const upToDate = fake('up-to-date').updater.checkForUpdates();
    const none = fake('no-releases').updater.checkForUpdates();
    const offline = fake('offline').updater.checkForUpdates();
    const caught = Promise.allSettled([upToDate, none, offline]);
    await vi.advanceTimersByTimeAsync(FAKE_CHECK_MS);
    const [a, b, c] = await caught;
    expect(a).toEqual({
      status: 'fulfilled',
      value: { isUpdateAvailable: false, updateInfo: { version: '0.1.0', files: [] } }
    });
    expect(b).toMatchObject({ status: 'rejected', reason: { code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' } });
    expect(c).toMatchObject({ status: 'rejected', reason: { message: 'net::ERR_INTERNET_DISCONNECTED' } });
  });

  it('downloads in ten steps of 0.3 s', async () => {
    const { updater } = fake('1.0.1');
    const seen: ProgressLike[] = [];
    updater.on('download-progress', (info) => seen.push(info));
    let done = false;
    void updater.downloadUpdate().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(FAKE_STEP_MS * (FAKE_STEPS - 1));
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(FAKE_STEP_MS);
    expect(done).toBe(true);
    expect(seen.map((p) => p.percent)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(seen.at(-1)).toMatchObject({ transferred: FAKE_INSTALLER_BYTES, total: FAKE_INSTALLER_BYTES });
  });

  it('breaks the download off at 40% for download-fails', async () => {
    const { updater } = fake('1.0.1 download-fails');
    const seen: number[] = [];
    updater.on('download-progress', (info) => seen.push(info.percent));
    const result = updater.downloadUpdate().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(FAKE_STEP_MS * FAKE_STEPS);
    expect(seen).toEqual([10, 20, 30, 40]);
    expect(await result).toMatchObject({ message: 'net::ERR_CONNECTION_RESET' });
  });

  it('quits on the next turn where the installer would start', async () => {
    const { updater, quit, said } = fake('1.0.1');
    updater.quitAndInstall(false, true);
    expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toContain('install: the installer would start now (silent false, run after true)');
  });

  it('raises the error event and quits nothing for install-fails, as electron-updater does', async () => {
    const { updater, quit } = fake('1.0.1 install-fails');
    const errors: Error[] = [];
    const listener = (err: Error): void => void errors.push(err);
    updater.on('error', listener);
    updater.quitAndInstall(false, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveLength(1);
    expect(quit).not.toHaveBeenCalled();
    updater.removeListener('error', listener);
    updater.quitAndInstall(false, true);
    expect(errors).toHaveLength(1);
  });
});

describe('the fake through the controller', () => {
  function run(text: string): {
    controller: ReturnType<typeof createUpdateController>;
    cards: (string | null)[];
    quit: ReturnType<typeof vi.fn>;
  } {
    const plan = parseFakeUpdate(text) as FakeUpdatePlan;
    const quit = vi.fn();
    const cards: (string | null)[] = [];
    const controller = createUpdateController({
      mode: 'auto',
      offReason: null,
      current: '0.1.0',
      repository: 'owner/repo',
      loadUpdater: () => createFakeUpdater({ plan, current: '0.1.0', quit, say: () => undefined }),
      settings: () => Promise.resolve({ checkForUpdates: true, updateDownloadConsent: null }),
      saveConsent: () => Promise.resolve(),
      push: (status: UpdateStatus) => {
        // Each change of the card, as the page would draw it: null for none.
        const text = updateCardFor(status)?.text ?? null;
        if (cards.length === 0 || text !== cards.at(-1)) cards.push(text);
      },
      install: {
        allowNextClose: () => () => undefined,
        abortAll: () => 0,
        writesSettled: () => Promise.resolve(true),
        stopWatching: () => undefined,
        resumeWatching: () => undefined
      },
      log: () => undefined,
      now: () => new Date('2026-10-20T12:00:00Z')
    });
    return { controller, cards, quit };
  }

  it('moves the card from the offer through the download to Restart now, then quits', async () => {
    const { controller, cards, quit } = run('1.0.1');
    controller.start();
    await vi.advanceTimersByTimeAsync(15_000 + FAKE_CHECK_MS);
    expect(controller.status().state.phase).toBe('available');
    await controller.download('1.0.1');
    await vi.advanceTimersByTimeAsync(FAKE_STEP_MS * FAKE_STEPS);
    expect(controller.status().state.phase).toBe('downloaded');
    await controller.install();
    await vi.advanceTimersByTimeAsync(0);
    expect(quit).toHaveBeenCalledTimes(1);
    expect(cards).toEqual([
      null,
      `${APP_NAME} 1.0.1 is available: a download of up to 108.7 MB.`,
      `Downloading ${APP_NAME} 1.0.1: 0%.`,
      `Downloading ${APP_NAME} 1.0.1: 10%.`,
      `Downloading ${APP_NAME} 1.0.1: 20%.`,
      `Downloading ${APP_NAME} 1.0.1: 30%.`,
      `Downloading ${APP_NAME} 1.0.1: 40%.`,
      `Downloading ${APP_NAME} 1.0.1: 50%.`,
      `Downloading ${APP_NAME} 1.0.1: 60%.`,
      `Downloading ${APP_NAME} 1.0.1: 70%.`,
      `Downloading ${APP_NAME} 1.0.1: 80%.`,
      `Downloading ${APP_NAME} 1.0.1: 90%.`,
      `Downloading ${APP_NAME} 1.0.1: 100%.`,
      `${APP_NAME} 1.0.1 is ready to install. Restart now closes ${APP_NAME}, installs it and opens ${APP_NAME} again.`,
      null
    ]);
    controller.stop();
  });

  it('ends on the install error card for install-fails, and quits nothing', async () => {
    const { controller, quit } = run('1.0.1 install-fails');
    await Promise.all([controller.check(true), vi.advanceTimersByTimeAsync(FAKE_CHECK_MS)]);
    await controller.download('1.0.1');
    await vi.advanceTimersByTimeAsync(FAKE_STEP_MS * FAKE_STEPS);
    await controller.install();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.status().state).toMatchObject({ phase: 'failed', stage: 'install' });
    expect(quit).not.toHaveBeenCalled();
  });
});
