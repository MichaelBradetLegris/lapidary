import { installCrashedPageGuard, writeAfterCrash, type CloseGuardIo, type PageWrites } from './closeGuard';

/*
 * What the page shown after a crash does (hardening.4, PLAN 7.7, C.81), apart
 * from React so it is tested in node: `CrashFallback` draws it and calls
 * these from its effects and its Try again link.
 *
 * - As it opens it takes the close guard over (`installCrashedPageGuard`),
 *   which ends a close the failed page had under way and answers its open
 *   question Cancel, and writes what the review and paragraph writers hold
 *   (`writeAfterCrash`).
 * - Reload window has the focus whenever no question is open and the focus is
 *   on nothing: as the page opens, and once the failed page's question has
 *   gone. While that question is still in the store on the page's first
 *   render, the page under it is inert, and a focus given then is lost.
 * - Try again puts the focus on Reload window before it writes again, since
 *   the link goes with the failure it sat in.
 */

/** How the page's writes stand: being written, or done with what could not be written. */
export type CrashWrites = { writing: true } | { writing: false; failures: string[] };

/** What the page takes over and writes with: `CRASH_PAGE` in pageIo.ts. */
export interface CrashPageDeps {
  /** how the close guard reaches main (`CLOSE_GUARD_IO`) */
  io: CloseGuardIo;
  /** what a close writes (`PAGE_WRITES`) */
  closeWrites: PageWrites;
  /** what the page writes as it opens and on Try again (`CRASH_WRITES`) */
  writes: PageWrites;
}

/** The parts of the page `CrashFallback` draws. */
export interface CrashPageView {
  /** show how the writes stand */
  setWrites(writes: CrashWrites): void;
  /** put the focus on Reload window */
  focusReload(): void;
  /** true when the focus is on nothing: the body, or no element at all */
  focusLost(): boolean;
}

export interface CrashPage {
  /** the page has opened: the guard taken over and the writes begun; returns what its going undoes */
  open(): () => void;
  /** no question is open: Reload window takes the focus, unless the author has put it elsewhere */
  noQuestion(): void;
  /** Try again: the focus to Reload window, and the writes again */
  tryAgain(): void;
}

export function createCrashPage(deps: CrashPageDeps, view: CrashPageView): CrashPage {
  /** the page is open; a round that ends after it has gone shows nothing */
  let live = false;
  /** the latest round of writes, the only one whose end is shown */
  let round = 0;

  /** One round of writes; the page starts out showing them as being written. */
  function write(): void {
    const mine = (round += 1);
    void writeAfterCrash(deps.writes).then((failures) => {
      if (live && mine === round) view.setWrites({ writing: false, failures });
    });
  }

  return {
    open() {
      live = true;
      // The close guard is this page's now, its questions drawn by the page.
      const uninstall = installCrashedPageGuard(deps.io, deps.closeWrites, { questions: true });
      write();
      return () => {
        live = false;
        uninstall();
      };
    },
    noQuestion() {
      if (view.focusLost()) view.focusReload();
    },
    tryAgain() {
      // Reload window is held, not disabled, while the writes run, so it can take the focus.
      view.focusReload();
      view.setWrites({ writing: true });
      write();
    }
  };
}
