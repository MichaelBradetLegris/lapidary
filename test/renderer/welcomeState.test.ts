import { beforeEach, describe, expect, it } from 'vitest';
import { PRO_PRESELECT_HINT, proPreselection } from '../../src/shared/ai/claudeModels';
import { createReview } from '../../src/shared/review';
import { normalizeSettings } from '../../src/shared/settings';
import type { Review, Settings } from '../../src/shared/types';
import { SAVE_HINT_ID } from '../../src/shared/ui/saveHint';
import { welcomeShown } from '../../src/shared/ui/welcome';
import { isModalOpen, reviewKeysActive, useApp } from '../../src/renderer/state/store';
import { closeWelcome, reopenWelcome, type WelcomeIo } from '../../src/renderer/state/welcome';

/* setup.11 review: Start and Skip hid the guide only by setting the store's
   `onboardingDone`. When writing it failed, the next settings reply from
   anywhere (Got it on the Save hint, the split, a change in Settings) put
   main's `false` back, and the guide came back over the chapter mid-session,
   the review keys and Ctrl+S dead behind it. And Show the welcome guide again
   wrote `onboardingDone: false` alone, so an install on Pro whose model is
   Default was moved to Sonnet. The guide's wiring in App is checked in
   welcomeEntry.test.ts; the window checks are in PLAN (setup.11). */

const SOURCE = 'C:/vault/Chapter 01.md';

function chapterReview(): Review {
  return createReview({
    sourcePath: SOURCE,
    base: {
      text: 'Tilting his head aside, the man watched.',
      hash: 'h1',
      eol: 'lf',
      bom: false,
      trailingNewline: true
    },
    hunks: [
      {
        id: 'h1',
        start: 0,
        end: 7,
        baseSide: 'original',
        original: 'Tilting',
        replacement: 'As he tilted',
        paragraph: 0,
        category: 'awkward',
        reason: 'Participial opener.',
        source: 'claude',
        status: 'pending',
        anchor: 'exact'
      }
    ],
    generator: { kind: 'claude' }
  });
}

/**
 * A stand-in for main's settings store: patches merge into what it holds, as
 * settingsStore does. Each write lands as it is sent, in the order sent; the
 * answer comes after.
 */
function mainSettings(initial: Settings) {
  let disk = initial;
  let failing = false;
  const patches: Partial<Settings>[] = [];
  const io: WelcomeIo = {
    setSettings: (patch) => {
      patches.push(patch);
      if (failing) return Promise.reject(new Error('settings.json could not be replaced'));
      disk = normalizeSettings({ ...disk, ...patch });
      return Promise.resolve(disk);
    }
  };
  return {
    io,
    patches,
    disk: () => disk,
    fail: (on: boolean) => {
      failing = on;
    },
    /** another write, such as the theme from Settings, whose answer the page takes as App does */
    reply: async (patch: Partial<Settings>) => {
      useApp.getState().setSettings(await io.setSettings(patch));
    }
  };
}

const state = () => useApp.getState();
const guideUp = () => welcomeShown(state().settings, state().welcomeClosed);

/** A fresh install that has chosen its folder, the guide still up, a chapter open behind it. */
const fresh = (): Settings => normalizeSettings({ manuscriptFolder: 'C:/vault', onboardingDone: false });

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    settings: fresh(),
    welcomeClosed: false,
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    settingsOpen: false,
    setupOpen: false,
    newChapterOpen: false,
    manualReviewOpen: false,
    reviewDialogOpen: false
  });
  state().setReview(chapterReview(), 'C:/reviews/chapter-01/r.review.json');
  state().focusHunk('h1');
});

describe('Start and Skip (setup.11 review)', () => {
  it("close the guide at once, before the write answers, then take main's settings", async () => {
    const main = mainSettings(fresh());
    expect(isModalOpen(state())).toBe(true);
    const done = closeWelcome(main.io);
    expect(state().welcomeClosed).toBe(true);
    expect(guideUp()).toBe(false);
    expect(reviewKeysActive(state())).toBe(true);
    await done;
    expect(main.patches).toEqual([{ onboardingDone: true }]);
    expect(state().settings?.onboardingDone).toBe(true);
  });

  it('keep it closed after a write that failed, whatever later settings replies say', async () => {
    const main = mainSettings(fresh());
    main.fail(true);
    await expect(closeWelcome(main.io)).rejects.toThrow('could not be replaced');
    main.fail(false);
    // Got it on the Save hint, then a theme from Settings: each answer carries main's false.
    await main.reply({ dismissedHints: [SAVE_HINT_ID] });
    await main.reply({ theme: 'dark' });
    expect(state().settings?.onboardingDone).toBe(false);
    expect(welcomeShown(state().settings)).toBe(true);
    expect(guideUp()).toBe(false);
    expect(isModalOpen(state())).toBe(false);
    expect(reviewKeysActive(state())).toBe(true);
  });

  it('keep it closed when a reply to a write sent before them answers after them', async () => {
    const main = mainSettings(fresh());
    const before = main.io.setSettings({ zoom: 1.25 });
    const done = closeWelcome(main.io);
    // The zoom's answer, written before Start, says the guide is not done.
    const zoomed = await before;
    expect(zoomed.onboardingDone).toBe(false);
    state().setSettings(zoomed);
    expect(guideUp()).toBe(false);
    expect(reviewKeysActive(state())).toBe(true);
    await done;
    expect(guideUp()).toBe(false);
  });
});

describe('Show the welcome guide again (setup.11 review)', () => {
  it('brings the guide back once its write is in, over the chapter, the keys stopped', async () => {
    const main = mainSettings(fresh());
    await closeWelcome(main.io);
    const again = reopenWelcome(main.io);
    // Not before main has answered: the guide comes back with the settings it shows from.
    expect(guideUp()).toBe(false);
    await again;
    expect(state().welcomeClosed).toBe(false);
    expect(guideUp()).toBe(true);
    expect(isModalOpen(state())).toBe(true);
    expect(reviewKeysActive(state())).toBe(false);
  });

  it('brings it back after a Start whose write failed too', async () => {
    const main = mainSettings(fresh());
    main.fail(true);
    await expect(closeWelcome(main.io)).rejects.toThrow();
    main.fail(false);
    await reopenWelcome(main.io);
    expect(guideUp()).toBe(true);
  });

  it('settles the Pro preselection in the same write, keeping the hints already put away', async () => {
    const existing = normalizeSettings({ manuscriptFolder: 'C:/vault', dismissedHints: [SAVE_HINT_ID] });
    expect(existing.model).toBe('default');
    useApp.setState({ settings: existing });
    const main = mainSettings(existing);
    await reopenWelcome(main.io);
    expect(main.patches).toEqual([
      { onboardingDone: false, dismissedHints: [SAVE_HINT_ID, PRO_PRESELECT_HINT] }
    ]);
    const shown = state().settings!;
    expect(guideUp()).toBe(true);
    // The check that finds Claude ready on Pro then changes nothing.
    expect(proPreselection(shown, 'pro', guideUp())).toBeNull();
    expect(shown.model).toBe('default');
  });

  it('leaves the guide closed when its write fails', async () => {
    const main = mainSettings(fresh());
    await closeWelcome(main.io);
    main.fail(true);
    await expect(reopenWelcome(main.io)).rejects.toThrow();
    expect(state().welcomeClosed).toBe(true);
    expect(guideUp()).toBe(false);
    expect(reviewKeysActive(state())).toBe(true);
  });
});
