import type { Settings } from '../../shared/types';
import { welcomeAgainPatch } from '../../shared/ui/welcome';
import { useApp } from './store';

/*
 * Start, Skip and Settings' Show the welcome guide again (setup.11, PLAN
 * section 7).
 *
 * Start and Skip close the guide at once, by the store's `welcomeClosed`, and
 * then write `onboardingDone: true`. The flag, not the settings, keeps the
 * guide closed for the rest of the run: when that write fails, main still holds
 * `false`, and every later settings reply (Got it on the Save hint, the split,
 * a change in Settings, the review dialog's model) puts main's copy in the
 * store, which would bring the guide back over the chapter (setup.11 review).
 *
 * Show the welcome guide again writes `onboardingDone: false` and settles the
 * Pro preselection in the same write (`welcomeAgainPatch`), so the guide shown
 * again never changes the model; the guide comes back once that write is in.
 *
 * It reaches main through `WelcomeIo`, which App fills with `settings:set`, so
 * this module needs no DOM and is tested in node.
 */

export interface WelcomeIo {
  /** `settings:set`: writes the patch and answers with the settings as saved */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

/**
 * Start and Skip: the guide goes at once and stays away for the rest of the
 * run. Resolves once `onboardingDone: true` is written; rejects with the
 * write's error, for the card that says the guide shows again at the next
 * start (`welcomeNotKept`).
 */
export async function closeWelcome(io: WelcomeIo): Promise<void> {
  useApp.getState().setWelcomeClosed(true);
  const saved = await io.setSettings({ onboardingDone: true });
  useApp.getState().setSettings(saved);
}

/**
 * Show the welcome guide again: writes `welcomeAgainPatch` from the settings
 * as they stand, then takes main's answer and lets the guide show, in one
 * update. Rejects with the write's error, and the guide then stays as it was.
 * Without settings in the store, as while settings.json cannot be read, it
 * writes nothing: a list of hints built from none would replace the
 * author's once the file could be read (hardening.15).
 */
export async function reopenWelcome(io: WelcomeIo): Promise<void> {
  const current = useApp.getState().settings;
  if (!current) return;
  const saved = await io.setSettings(welcomeAgainPatch(current.dismissedHints));
  useApp.setState({ settings: saved, welcomeClosed: false });
}
