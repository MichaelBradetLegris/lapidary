import { beforeEach, describe, expect, it } from 'vitest';
import { PRO_PRESELECT_HINT } from '../../src/shared/ai/claudeModels';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { Settings } from '../../src/shared/types';
import { SAVE_HINT_ID } from '../../src/shared/ui/saveHint';
import {
  createHints,
  hintDismissedThisSession,
  saveHintGivesWay,
  useSaveHintAside,
  type HintIo
} from '../../src/renderer/state/hints';
import { useApp } from '../../src/renderer/state/store';

/* apply.12: putting a one-time hint away for good writes `dismissedHints`
   (PLAN 11.3 d). The hint goes from the screen at once, and a write that fails
   keeps it away for the session. */

/** A stand-in for main's settings store: patches merge into what it holds, as settingsStore does. */
function mainSettings(initial: Settings, options: { fail?: boolean } = {}) {
  let disk = initial;
  const patches: Partial<Settings>[] = [];
  let release: (() => void) | null = null;
  let held: Promise<void> | null = null;
  const io: HintIo = {
    setSettings: async (patch) => {
      patches.push(patch);
      if (held) await held;
      if (options.fail) throw new Error('settings.json could not be read');
      disk = normalizeSettings({ ...disk, ...patch });
      return disk;
    }
  };
  return {
    io,
    patches,
    disk: () => disk,
    /** hold every write until `let go` */
    hold: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    letGo: () => {
      held = null;
      release?.();
    }
  };
}

const settingsWith = (hints: string[]): Settings => ({ ...defaultSettings(), dismissedHints: hints });

beforeEach(() => {
  useApp.setState({ settings: settingsWith([]) });
});

describe('dismissing a hint (apply.12)', () => {
  it('writes the id beside the hints already dismissed, and takes the settings main answers with', async () => {
    useApp.setState({ settings: settingsWith([PRO_PRESELECT_HINT]) });
    // Main holds a setting the page has not heard of yet, as after a zoom key.
    const main = mainSettings({ ...settingsWith([PRO_PRESELECT_HINT]), zoom: 1.5 });
    const hints = createHints();
    await hints.dismiss(SAVE_HINT_ID, main.io);
    expect(main.patches).toEqual([{ dismissedHints: [PRO_PRESELECT_HINT, SAVE_HINT_ID] }]);
    expect(main.disk().dismissedHints).toEqual([PRO_PRESELECT_HINT, SAVE_HINT_ID]);
    expect(main.disk().zoom).toBe(1.5);
    expect(useApp.getState().settings).toEqual(main.disk());
    expect(hints.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
  });

  it('goes from the screen before the write ends', async () => {
    const main = mainSettings(settingsWith([]));
    main.hold();
    const hints = createHints();
    const done = hints.dismiss(SAVE_HINT_ID, main.io);
    expect(useApp.getState().settings?.dismissedHints).toEqual([SAVE_HINT_ID]);
    expect(hints.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
    let flushed = false;
    void hints.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    main.letGo();
    await done;
    await hints.flush();
    expect(flushed).toBe(true);
    expect(main.disk().dismissedHints).toEqual([SAVE_HINT_ID]);
  });

  it('writes nothing for a hint already dismissed, however often it is asked: every later save', async () => {
    const main = mainSettings(settingsWith([]));
    const hints = createHints();
    await hints.dismiss(SAVE_HINT_ID, main.io);
    await hints.dismiss(SAVE_HINT_ID, main.io);
    await hints.dismiss(SAVE_HINT_ID, main.io);
    expect(main.patches).toHaveLength(1);

    useApp.setState({ settings: settingsWith([SAVE_HINT_ID]) });
    const fresh = createHints();
    await fresh.dismiss(SAVE_HINT_ID, main.io);
    expect(main.patches).toHaveLength(1);
    expect(fresh.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
  });

  it('asked twice while the first write runs, writes once', async () => {
    const main = mainSettings(settingsWith([]));
    main.hold();
    const hints = createHints();
    const first = hints.dismiss(SAVE_HINT_ID, main.io);
    const second = hints.dismiss(SAVE_HINT_ID, main.io);
    main.letGo();
    await Promise.all([first, second]);
    expect(main.patches).toEqual([{ dismissedHints: [SAVE_HINT_ID] }]);
  });

  it('runs two dismissals one after the other, so neither undoes the other', async () => {
    const main = mainSettings(settingsWith([]));
    main.hold();
    const hints = createHints();
    const a = hints.dismiss('first-hint', main.io);
    const b = hints.dismiss(SAVE_HINT_ID, main.io);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The second waits for the first to end.
    expect(main.patches).toHaveLength(1);
    main.letGo();
    await Promise.all([a, b]);
    expect(main.patches).toEqual([
      { dismissedHints: ['first-hint', SAVE_HINT_ID] },
      { dismissedHints: ['first-hint', SAVE_HINT_ID] }
    ]);
    expect(main.disk().dismissedHints).toEqual(['first-hint', SAVE_HINT_ID]);
    expect(useApp.getState().settings?.dismissedHints).toEqual(['first-hint', SAVE_HINT_ID]);
  });

  it('a write that fails keeps the hint away for this session only, and never rejects', async () => {
    const main = mainSettings(settingsWith([]), { fail: true });
    const hints = createHints();
    await expect(hints.dismiss(SAVE_HINT_ID, main.io)).resolves.toBeUndefined();
    await expect(hints.flush()).resolves.toBeUndefined();
    expect(main.disk().dismissedHints).toEqual([]);
    expect(hints.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
    // A later settings reply without it (Settings changing the theme, say)
    // does not bring it back this session.
    useApp.setState({ settings: main.disk() });
    expect(hints.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
    // A new session, as after a restart, shows it again.
    expect(createHints().dismissedThisSession(SAVE_HINT_ID)).toBe(false);
  });

  it('tries the write again when a settings reply has taken the id away since', async () => {
    const failing = mainSettings(settingsWith([]), { fail: true });
    const hints = createHints();
    await hints.dismiss(SAVE_HINT_ID, failing.io);
    useApp.setState({ settings: failing.disk() });
    const working = mainSettings(failing.disk());
    await hints.dismiss(SAVE_HINT_ID, working.io);
    expect(working.patches).toEqual([{ dismissedHints: [SAVE_HINT_ID] }]);
    expect(working.disk().dismissedHints).toEqual([SAVE_HINT_ID]);
  });

  it('without settings loaded, puts it away for the session and writes nothing', async () => {
    useApp.setState({ settings: null });
    const main = mainSettings(settingsWith([PRO_PRESELECT_HINT]));
    const hints = createHints();
    await hints.dismiss(SAVE_HINT_ID, main.io);
    expect(main.patches).toEqual([]);
    expect(hints.dismissedThisSession(SAVE_HINT_ID)).toBe(true);
    expect(useApp.getState().settings).toBeNull();
  });
});

/* ui.3 review: with the side panel folded the first-use hint hangs over the
   prose, so once the author goes on after it has shown, it is set aside for
   the session. `SaveHint.tsx` says when it is over the prose; a press, a
   review key and a drawer opened call `saveHintGivesWay`. */
describe('setting the hint aside over the prose (ui.3 review)', () => {
  beforeEach(() => {
    useSaveHintAside.setState({ overProse: false, setAside: false });
  });

  it('sets it aside when the author goes on while it hangs over the prose', () => {
    useSaveHintAside.setState({ overProse: true });
    saveHintGivesWay();
    expect(useSaveHintAside.getState().setAside).toBe(true);
    // For the rest of the session, whatever happens next.
    useSaveHintAside.setState({ overProse: false });
    saveHintGivesWay();
    expect(useSaveHintAside.getState().setAside).toBe(true);
  });

  it('leaves it be when it is not over the prose: the press or key that makes the first change, or the panel in place', () => {
    saveHintGivesWay();
    saveHintGivesWay();
    expect(useSaveHintAside.getState()).toMatchObject({ overProse: false, setAside: false });
  });

  it('puts nothing away, so the settings are untouched and a restart shows it again', () => {
    const before = useApp.getState().settings;
    useSaveHintAside.setState({ overProse: true });
    saveHintGivesWay();
    expect(useApp.getState().settings).toBe(before);
    expect(hintDismissedThisSession(SAVE_HINT_ID)).toBe(false);
  });
});
