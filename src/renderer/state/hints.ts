import { create } from 'zustand';
import { withHint } from '../../shared/ui/saveHint';
import type { Settings } from '../../shared/types';
import { useApp } from './store';

/*
 * One-time hints put away for good (apply.12, PLAN 11.3 d): the id goes into
 * the `dismissedHints` setting, which main keeps in settings.json.
 *
 * A hint goes from the screen at once: the store's settings take the id before
 * anything is written, and the id is also remembered for this session, so a
 * write that fails, or a later settings reply that lacks it, does not bring the
 * hint back before the app is next started. Writes run one after another, each
 * from the settings as they then stand, so two dismissals cannot undo each
 * other.
 *
 * It reaches main through `HintIo`, which App fills with `settings:set`, so
 * this module needs no DOM and is tested in node.
 */

export interface HintIo {
  /** `settings:set`: writes the patch and answers with the settings as saved */
  setSettings: (patch: Partial<Settings>) => Promise<Settings>;
}

export interface Hints {
  /**
   * Put the hint `id` away for good. Resolves once the setting is written, or
   * could not be; never rejects. A hint already in the settings writes
   * nothing. Without settings loaded there is nothing to add the id to, so it
   * is put away for this session only.
   */
  dismiss(id: string, io: HintIo): Promise<void>;
  /** whether `id` was put away this session, whether or not the setting could be written */
  dismissedThisSession(id: string): boolean;
  /** the writes still under way; never rejects */
  flush(): Promise<void>;
}

export function createHints(): Hints {
  const thisSession = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const app = useApp.getState;

  function dismiss(id: string, io: HintIo): Promise<void> {
    thisSession.add(id);
    const before = app().settings;
    if (!before || before.dismissedHints.includes(id)) return chain;
    app().setSettings({ ...before, dismissedHints: withHint(before.dismissedHints, id) });

    chain = chain.then(async () => {
      const latest = app().settings;
      if (!latest) return;
      try {
        const saved = await io.setSettings({ dismissedHints: withHint(latest.dismissedHints, id) });
        app().setSettings(saved);
      } catch {
        // Kept off the screen for this session; until the setting is written,
        // the next start shows the hint again.
      }
    });
    return chain;
  }

  return {
    dismiss,
    dismissedThisSession: (id) => thisSession.has(id),
    flush: () => chain
  };
}

/** The app's one set of hints. */
const hints = createHints();

/** Put the hint `id` away for good (`Hints.dismiss`). */
export function dismissHint(id: string, io: HintIo): Promise<void> {
  return hints.dismiss(id, io);
}

/** Whether `id` was put away this session (`Hints.dismissedThisSession`). */
export function hintDismissedThisSession(id: string): boolean {
  return hints.dismissedThisSession(id);
}

/** The hint writes under way, for a close to wait for with the other writes (apply.9). */
export function flushHintWrites(): Promise<void> {
  return hints.flush();
}

/*
 * The first-use hint over the prose (ui.3 review, PLAN 7 "First-use hint").
 * With the side panel folded, the hint hangs over the top right of the prose,
 * and at 200% in the smallest window over most of it, so once the author goes
 * on after it has shown it is set aside: nothing is written, and it stays away
 * while the panel is folded until the app next starts (`saveHintVisible`).
 */

export interface SaveHintAside {
  /** the hint is on screen over the prose; `SaveHint.tsx` keeps this up to date */
  overProse: boolean;
  /** set aside for the rest of the session */
  setAside: boolean;
}

export const useSaveHintAside = create<SaveHintAside>(() => ({ overProse: false, setAside: false }));

/**
 * The author went on: a press anywhere but on the hint, a review key, or a
 * drawer opened. A hint over the prose then gives way, and nothing else
 * changes; the press or the key still does what it does. A hint not on screen,
 * or over the side panel drawn in place, is left as it is, so the press or key
 * that makes the first change, before the hint shows, never sets it aside.
 */
export function saveHintGivesWay(): void {
  if (useSaveHintAside.getState().overProse) useSaveHintAside.setState({ setAside: true });
}
