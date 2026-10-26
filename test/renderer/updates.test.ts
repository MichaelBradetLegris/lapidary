import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReview } from '../../src/shared/review';
import type { Review } from '../../src/shared/types';
import { RESTART_AFTER_REVIEW, UPDATE_CARD_KEY, UPDATE_PROBLEM_CARD_KEY } from '../../src/shared/ui/update';
import { updateCardFor, type UpdateState, type UpdateStatus } from '../../src/shared/updates';
import {
  installCloseGuard,
  prepareToLeaveApp,
  type CloseGuardDeps
} from '../../src/renderer/state/closeGuard';
import { useApp } from '../../src/renderer/state/store';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdateCards,
  noteUpdateStatus,
  restartNow,
  type UpdateIo
} from '../../src/renderer/state/updates';

/* release.9: the update card, page side, and Restart now (PLAN 11.3 n).
   Main's controller is test/main/updates.test.ts; the card's words are
   updateCardFor's (test/shared/updates.test.ts) and how it goes from state to
   state is updateCardStep's (test/shared/updateUi.test.ts). Here the page
   runs against a stand-in for main, with the store and the real close guard,
   so Restart now's question is the one closing the window asks. */

const SOURCE = 'C:/vault/Chapter 01.md';
const CHAPTER = 'Tilting his head aside, the man watched.\n\nShe said nothing at all.';

function chapterReview(): Review {
  return createReview({
    sourcePath: SOURCE,
    base: { text: CHAPTER, hash: 'h1', eol: 'lf', bom: false, trailingNewline: true },
    hunks: [],
    generator: { kind: 'claude' }
  });
}

function status(state: UpdateState): UpdateStatus {
  return {
    mode: 'auto',
    offReason: null,
    current: '1.0.0',
    state,
    checkedAt: null,
    releaseUrl: 'https://github.com/example/app/releases/tag/v1.0.1'
  };
}

const AVAILABLE = status({ phase: 'available', version: '1.0.1', size: 114_000_000 });
const downloading = (percent: number): UpdateStatus =>
  status({ phase: 'downloading', version: '1.0.1', percent, transferred: 0, total: 114_000_000 });
const DOWNLOADED = status({ phase: 'downloaded', version: '1.0.1' });
const INSTALLING = status({ phase: 'installing', version: '1.0.1' });
const lateFailure = (retry: boolean): UpdateStatus =>
  status({ phase: 'failed', stage: 'install', kind: 'failed', manual: false, version: '1.0.1', retry });

interface Main {
  io: UpdateIo;
  /** what the page asked of main, in order */
  asked: string[];
  push: (status: UpdateStatus) => void;
  /** what `update:get` answers, once released */
  getAnswer: { resolve: (status: UpdateStatus) => void };
  install: (() => Promise<UpdateStatus>) | null;
  download: ((version: string) => Promise<UpdateStatus>) | null;
  check: (() => Promise<UpdateStatus>) | null;
}

function main(): Main {
  let listener: (status: UpdateStatus) => void = () => undefined;
  const m: Main = {
    asked: [],
    push: (s) => listener(s),
    getAnswer: { resolve: () => undefined },
    install: null,
    download: null,
    check: null,
    io: {
      get: () => {
        m.asked.push('get');
        return new Promise((resolve) => (m.getAnswer = { resolve }));
      },
      check: () => {
        m.asked.push('check');
        return m.check ? m.check() : Promise.resolve(status({ phase: 'up-to-date', manual: true }));
      },
      download: (version) => {
        m.asked.push(`download ${version}`);
        return m.download ? m.download(version) : Promise.resolve(downloading(0));
      },
      install: () => {
        m.asked.push('install');
        return m.install ? m.install() : Promise.resolve(INSTALLING);
      },
      onState: (l) => {
        listener = l;
        return () => {
          listener = () => undefined;
        };
      }
    }
  };
  return m;
}

const state = () => useApp.getState();
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await tick();
}
const cards = () => state().notifications;
const updateCard = () => cards().find((n) => n.key === UPDATE_CARD_KEY);

let uninstall: (() => void) | null = null;
let guard: (() => void) | null = null;
const decisions: boolean[] = [];

/** The real close guard, writing nothing, as App installs it. */
function closeGuard(): void {
  const deps: CloseGuardDeps = {
    io: {
      pushState: () => undefined,
      sendStatus: () => undefined,
      sendDecision: (close) => void decisions.push(close),
      onCloseRequested: () => () => undefined,
      onFlush: () => () => undefined
    },
    writes: { flush: () => Promise.resolve(), retry: () => undefined, failures: () => [] },
    save: () => Promise.resolve('saved'),
    cancelReview: () => undefined
  };
  guard = installCloseGuard(deps);
}

beforeEach(() => {
  state().answerChoice('cancel');
  useApp.setState({
    drafts: {},
    aiBusyPath: null,
    chapterSaving: false,
    editor: null,
    persistPending: false,
    draftWritesPending: false,
    updateStatus: null,
    updateOverlay: false,
    dialogText: { 'new-chapter': false, 'manual-review': false }
  });
  state().setReview(chapterReview(), null);
  state().clearNotifications();
  decisions.length = 0;
});

afterEach(async () => {
  for (let i = 0; i < 5 && state().confirmSpec; i += 1) {
    state().answerChoice('cancel');
    await settle();
  }
  uninstall?.();
  uninstall = null;
  guard?.();
  guard = null;
});

describe('following the updater (release.9)', () => {
  it("asks main once where the updater is, and keeps the answer for About's line", async () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    expect(m.asked).toEqual(['get']);
    m.getAnswer.resolve(AVAILABLE);
    await settle();
    expect(state().updateStatus).toEqual(AVAILABLE);
    expect(updateCard()).toMatchObject({
      tone: 'info',
      text: updateCardFor(AVAILABLE)?.text,
      action: 'update-download'
    });
  });

  it('drops the answer when a push came first, which is newer', async () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    m.push(downloading(30));
    m.getAnswer.resolve(AVAILABLE);
    await settle();
    expect(state().updateStatus).toEqual(downloading(30));
  });

  it('moves one card through its states in place, keeping its place among the others', () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    state().notify('info', 'Saved to the chapter file.');
    m.push(AVAILABLE);
    state().notify('warn', 'The chapter changed on disk.');
    const id = updateCard()?.id;
    const seen: string[] = [];
    for (const next of [downloading(0), downloading(10), downloading(50), downloading(100), DOWNLOADED]) {
      m.push(next);
      expect(
        cards()
          .map((n) => n.id)
          .indexOf(id ?? '')
      ).toBe(1);
      expect(cards()).toHaveLength(3);
      seen.push(updateCard()?.text ?? '');
    }
    expect(updateCard()?.id).toBe(id);
    expect(seen).toEqual([
      updateCardFor(downloading(0))?.text,
      updateCardFor(downloading(10))?.text,
      updateCardFor(downloading(50))?.text,
      updateCardFor(downloading(100))?.text,
      updateCardFor(DOWNLOADED)?.text
    ]);
    expect(updateCard()?.action).toBe('update-restart');
  });

  it('leaves a card the author closed closed while its state lasts, and brings it back with the next', () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    m.push(downloading(10));
    state().dismissNotification(updateCard()?.id ?? '');
    m.push(downloading(20));
    m.push(downloading(90));
    expect(updateCard()).toBeUndefined();
    m.push(DOWNLOADED);
    expect(updateCard()?.text).toBe(updateCardFor(DOWNLOADED)?.text);
  });

  it('takes the card down when a check finds nothing newer', () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    m.push(AVAILABLE);
    m.push(status({ phase: 'checking', manual: true }));
    expect(updateCard()).toBeDefined();
    m.push(status({ phase: 'up-to-date', manual: true }));
    expect(updateCard()).toBeUndefined();
  });
});

describe('Download and Check for updates', () => {
  it('downloads the version on offer, and keeps the card in place for its progress', async () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    m.push(AVAILABLE);
    const id = updateCard()?.id;
    await downloadUpdate(m.io);
    expect(m.asked).toContain('download 1.0.1');
    expect(updateCard()?.id).toBe(id);
    expect(updateCard()?.text).toBe(updateCardFor(downloading(0))?.text);
  });

  it('asks nothing with no version on offer, and says why a refused download did nothing', async () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    await downloadUpdate(m.io);
    expect(m.asked).toEqual(['get']);
    m.push(AVAILABLE);
    m.download = () =>
      Promise.reject(new Error('Version 1.0.1 is not on offer now. Check for updates again.'));
    await downloadUpdate(m.io);
    expect(cards().find((n) => n.key === UPDATE_PROBLEM_CARD_KEY)).toMatchObject({
      tone: 'error',
      text: 'Version 1.0.1 is not on offer now. Check for updates again.'
    });
    expect(updateCard()?.action).toBe('update-download');
  });

  it("notes a check's answer, and says why one was refused", async () => {
    const m = main();
    uninstall = installUpdateCards(m.io);
    await checkForUpdates(m.io);
    expect(state().updateStatus?.state.phase).toBe('up-to-date');
    m.check = () => Promise.reject(new Error('The check failed.'));
    await checkForUpdates(m.io);
    expect(cards().find((n) => n.key === UPDATE_PROBLEM_CARD_KEY)?.text).toBe('The check failed.');
  });
});

describe('Restart now (PLAN 11.3 n)', () => {
  function ready(): Main {
    const m = main();
    uninstall = installUpdateCards(m.io);
    closeGuard();
    m.push(DOWNLOADED);
    return m;
  }

  it('is refused while a review runs, of this chapter or another, asking nothing and installing nothing', async () => {
    const m = ready();
    for (const running of [SOURCE, 'C:/vault/Chapter 02.md']) {
      useApp.setState({ aiBusyPath: running });
      expect(await restartNow({ io: m.io, prepare: prepareToLeaveApp })).toBe('refused');
      expect(state().confirmSpec).toBeNull();
      expect(m.asked).not.toContain('install');
      expect(state().updateOverlay).toBe(false);
      expect(cards().find((n) => n.key === UPDATE_PROBLEM_CARD_KEY)).toMatchObject({
        tone: 'info',
        text: RESTART_AFTER_REVIEW
      });
      // The card keeps its Restart now for after the review.
      expect(updateCard()?.action).toBe('update-restart');
    }
  });

  it('asks the close question with an open box, and installs only after the answer, under the overlay', async () => {
    const m = ready();
    expect(state().openDraft(0)).toBe(true);
    state().setDraftText(0, 'Tilting his head, the man watched.');
    const run = restartNow({ io: m.io, prepare: prepareToLeaveApp });
    await settle();
    expect(state().confirmSpec?.title).toMatch(/^Close /);
    expect(state().confirmSpec?.confirmLabel).toBe('Apply, save and close');
    expect(state().confirmSpec?.body).toContain('paragraph');
    expect(m.asked).not.toContain('install');
    expect(state().updateOverlay).toBe(false);
    state().answerChoice('alt');
    expect(await run).toBe('installing');
    expect(m.asked.at(-1)).toBe('install');
    expect(state().updateOverlay).toBe(true);
    expect(decisions).toEqual([true]);
  });

  it('stays, with no overlay and no install, when the author cancels', async () => {
    const m = ready();
    expect(state().openDraft(0)).toBe(true);
    state().setDraftText(0, 'Changed.');
    const run = restartNow({ io: m.io, prepare: prepareToLeaveApp });
    await settle();
    state().answerChoice('cancel');
    expect(await run).toBe('stayed');
    expect(m.asked).not.toContain('install');
    expect(state().updateOverlay).toBe(false);
  });

  it('asks nothing with nothing at risk, and takes the overlay away when the install fails late', async () => {
    const m = ready();
    expect(await restartNow({ io: m.io, prepare: prepareToLeaveApp })).toBe('installing');
    expect(state().updateOverlay).toBe(true);
    // While Restart now runs the card stays as it was, under the overlay.
    m.push(INSTALLING);
    expect(updateCard()?.text).toBe(updateCardFor(DOWNLOADED)?.text);
    m.push(lateFailure(false));
    expect(state().updateOverlay).toBe(false);
    expect(updateCard()).toMatchObject({ tone: 'error', action: 'update-open-page' });
  });

  it('takes the overlay away when main answers failed, and the card offers Restart now again', async () => {
    const m = ready();
    m.install = () => Promise.resolve(lateFailure(true));
    expect(await restartNow({ io: m.io, prepare: prepareToLeaveApp })).toBe('failed');
    expect(state().updateOverlay).toBe(false);
    expect(updateCard()).toMatchObject({ tone: 'error', action: 'update-restart' });
  });

  it('takes the overlay away and says why when main refuses', async () => {
    const m = ready();
    m.install = () => Promise.reject(new Error('There is no downloaded update to install.'));
    expect(await restartNow({ io: m.io, prepare: prepareToLeaveApp })).toBe('failed');
    expect(state().updateOverlay).toBe(false);
    expect(cards().find((n) => n.key === UPDATE_PROBLEM_CARD_KEY)).toMatchObject({
      tone: 'error',
      text: 'There is no downloaded update to install.'
    });
  });

  it('is refused when a review started while the writes ran, and runs once at a time', async () => {
    const m = ready();
    let release: (go: boolean) => void = () => undefined;
    const prepare = (): Promise<boolean> => new Promise((resolve) => (release = resolve));
    const first = restartNow({ io: m.io, prepare });
    expect(await restartNow({ io: m.io, prepare })).toBe('refused');
    useApp.setState({ aiBusyPath: SOURCE });
    release(true);
    expect(await first).toBe('refused');
    expect(m.asked).not.toContain('install');
    expect(state().updateOverlay).toBe(false);
    useApp.setState({ aiBusyPath: null });
    expect(await restartNow({ io: m.io, prepare: () => Promise.resolve(true) })).toBe('installing');
    expect(m.asked.filter((a) => a === 'install')).toHaveLength(1);
  });

  it('notes main answering installing, and a later push of the same', async () => {
    const m = ready();
    await restartNow({ io: m.io, prepare: prepareToLeaveApp });
    noteUpdateStatus(INSTALLING);
    expect(state().updateOverlay).toBe(true);
    expect(state().updateStatus).toEqual(INSTALLING);
  });
});

describe("App's wiring (release.9)", () => {
  const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const APP = withoutComments(readFileSync(path.join(__dirname, '../../src/renderer/App.tsx'), 'utf8'));
  const CARDS = withoutComments(
    readFileSync(path.join(__dirname, '../../src/renderer/components/NotificationCards.tsx'), 'utf8')
  );

  it('follows update:state once, through the four update channels', () => {
    expect(APP).toContain('useEffect(() => installUpdateCards(UPDATE_IO), []);');
    expect(APP).toMatch(
      /const UPDATE_IO: UpdateIo = \{\s*get: \(\) => call\('update:get', undefined\),\s*check: \(\) => call\('update:check', undefined\),\s*download: \(version\) => call\('update:download', \{ version \}\),\s*install: \(\) => call\('update:install', undefined\),\s*onState: \(listener\) =>\s*typeof window\.api\?\.on === 'function' \? window\.api\.on\('update:state', listener\) : \(\) => undefined\s*\};/
    );
  });

  it("gives the card's three buttons, and About's, to Download, Restart now with the close question, and the release page", () => {
    const action = APP.slice(
      APP.indexOf('const onUpdateAction = useCallback('),
      APP.indexOf('const copyResult')
    );
    expect(action).toContain('void downloadUpdate(UPDATE_IO);');
    expect(action).toContain('void restartNow({ io: UPDATE_IO, prepare: prepareToLeaveApp });');
    expect(action).toMatch(
      /const url = useApp\.getState\(\)\.updateStatus\?\.releaseUrl;\s*if \(url\) window\.open\(url, '_blank', 'noreferrer'\);/
    );
    expect(APP).toMatch(
      /case 'update-download':\s*case 'update-restart':\s*case 'update-open-page':\s*onUpdateAction\(action\);\s*break;/
    );
  });

  it('keeps the update card up after Download and Restart now, so it changes in place, and gives it one width', () => {
    expect(CARDS).toContain('if (!action || !actionKeepsCard(action)) dismiss(note.id);');
    expect(CARDS).toContain("note.key === UPDATE_CARD_KEY ? ' note--update' : ''");
  });

  it('opens About in place of Settings, and draws the overlay over every layout, under the question', () => {
    expect(APP).toMatch(/onAbout=\{\(\) => \{\s*setSettingsOpen\(false\);\s*setAboutOpen\(true\);\s*\}\}/);
    expect(APP).toMatch(/const aboutDialog =\s*aboutOpen && settings \? \(\s*<AboutDialog/);
    // Inert only under focus mode's overlay (focus.1 review).
    expect(APP).toMatch(
      /const updateOverlay = updateOverlayShown \? \(?\s*<UpdateOverlay update=\{updateStatus\} inert=\{inert\.over\} \/>\s*\)? : null;/
    );
    const layouts = APP.split(/<ConfirmDialog inert=\{(?:inert|cardInert)\.over\} \/>/).slice(0, -1);
    expect(layouts).toHaveLength(3);
    // (a `{}` is a JSX comment with its text taken out)
    for (const layout of layouts) expect(layout).toMatch(/\{updateOverlay\}\s*(\{\s*\}\s*)?$/);
  });
});

describe('About, the overlay and the update card in their source and CSS (release.9)', () => {
  const read = (file: string): string =>
    readFileSync(path.join(__dirname, '../../src/renderer', file), 'utf8');

  it('is a modal like the others: Escape, the focus into its box and back to Settings in the toolbar', () => {
    const source = read('components/AboutDialog.tsx');
    expect(source).toContain('useDialogEscape(boxRef, onClose);');
    expect(source).toContain('useDialogFocus(boxRef, SETTINGS_BUTTON_SELECTOR);');
    expect(source).toContain("import iconUrl from '../../../resources/icon/icon.svg?url';");
    expect(source).toContain("onOpenNotices={() => run(call('app:open-notices', undefined))}");
    expect(source).toContain("onReveal={(target) => run(call('shell:reveal', { target }))}");
    expect(source).toContain("run(call('settings:set', { checkForUpdates }).then(onApply))");
  });

  it('sits over every dialog and under the question', () => {
    const css = read('styles/app.css');
    const z = (selector: string): number =>
      Number(
        new RegExp(`\\n${selector.replace(/[.-]/g, (c) => `\\${c}`)} \\{[^}]*z-index: (\\d+);`).exec(css)?.[1]
      );
    expect(z('.modal-backdrop--overlay')).toBeGreaterThan(z('.modal-backdrop'));
    expect(z('.modal-backdrop--overlay')).toBeLessThan(z('.modal-backdrop--confirm'));
  });

  it('keeps one width, with figures of one width, so the percentage moves nothing', () => {
    const css = read('styles/app.css');
    const rule = /\n\.note--update \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('width: 24em;');
    expect(rule).toContain('max-width: 100%;');
    expect(rule).toContain('font-variant-numeric: tabular-nums;');
  });
});
