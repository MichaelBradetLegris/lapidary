import { unsavedDecisionCount } from '../../shared/diff/compose';
import type { CloseGuardState, CloseStatus, FlushReason } from '../../shared/ipc';
import type { ConfirmChoice, ConfirmSpec } from '../../shared/ui/confirm';
import { closePrompt, stillWritingPrompt, WRITES_WAIT_MS } from '../../shared/ui/save';
import { pendingSave, type SaveOptions, type SaveOutcome } from './saveChapter';
import { changedParagraphCount, hasDialogText, isLocked, useApp, type AppState } from './store';

/*
 * The close guard, page side (apply.9; PLAN 7.7, 11.3 i, C.54). Main decides
 * at the window's `close` event from the last state the page pushed, so the
 * page:
 *
 * - pushes what a close would put at risk (`CloseGuardState`) once it has
 *   loaded and then whenever that changes, in the same task as the change, so
 *   a close that follows a decision at once already knows about it;
 * - answers main's close request (`app:close-requested`) through
 *   `prepareToLeaveApp('close')`: it says it has the request, lets the save
 *   under way end and writes what the review and paragraph writers hold,
 *   then asks `closePrompt`'s question in the same dialog as leaving a
 *   chapter, and always answers with a decision;
 * - writes what it holds at once when Windows ends the session (`app:flush`).
 *
 * Restart now (`release.9`) calls `prepareToLeaveApp('update')` before it
 * installs, and goes on only when it resolves true.
 *
 * Main is reached only through `CloseGuardDeps`, which App fills, so this
 * module needs neither the DOM nor the preload bridge and is tested in node.
 */

/** Why the page is about to go: the window's close, or Restart now's install. */
export type LeaveAppReason = 'close' | 'update';

/** How the page talks to main's close guard. Every send goes out before it returns. */
export interface CloseGuardIo {
  /** `app:guard-state` */
  pushState(state: CloseGuardState): void;
  /** `app:close-status` */
  sendStatus(status: CloseStatus): void;
  /** `app:close-decision` */
  sendDecision(close: boolean): void;
  /** `app:close-requested`; returns the unsubscribe */
  onCloseRequested(listener: () => void): () => void;
  /** `app:flush`; returns the unsubscribe */
  onFlush(listener: (reason: FlushReason) => void): () => void;
}

/** The page's writers together: review json (apply.1) and kept paragraph boxes (apply.16). */
export interface PageWrites {
  /** write everything waiting now, and wait for it; never rejects */
  flush(): Promise<void>;
  /** queue again the writes that failed, so the next flush tries them once more */
  retry(): void;
  /** why something is not on disk as the author left it, in the words of its card; empty when all is */
  failures(): string[];
}

export interface CloseGuardDeps {
  io: CloseGuardIo;
  writes: PageWrites;
  /** Save to chapter, waited for (`useSaveChapter`) */
  save: (options: SaveOptions) => Promise<SaveOutcome>;
  /** stop the review that is running, if one is */
  cancelReview: () => void;
  /** how long the writes may take before the page asks; `WRITES_WAIT_MS` unless a test shortens it */
  writesWaitMs?: number;
  /**
   * What a close would put at risk, read from the store: `closeGuardStateOf`
   * unless given, and `crashedPageState` on the page shown after a crash
   * (hardening.4), which can offer no Save.
   */
  stateOf?: (state: GuardSlices) => CloseGuardState;
  /**
   * false when the page cannot show a question (hardening.4's last resort,
   * with nothing drawn): each question is taken as answered Close anyway, so
   * a close still gives the writes their time and then goes, rather than
   * waiting for an answer nobody can give.
   */
  questions?: boolean;
}

/** The parts of the store a close puts at risk. */
export type GuardSlices = Pick<
  AppState,
  | 'review'
  | 'drafts'
  | 'aiBusyPath'
  | 'persistPending'
  | 'draftWritesPending'
  | 'chapterSaving'
  | 'dialogText'
  | 'editor'
>;

/**
 * What closing the window now would put at risk (PLAN 11.3 i). A write
 * counts while it waits, runs, is held or has failed and not been made since,
 * and so does a Save to chapter under way, so main asks the page, which then
 * gets to finish them, even when nothing else is at risk.
 */
export function closeGuardStateOf(state: GuardSlices): CloseGuardState {
  const review = state.review;
  return {
    chapter: review?.sourcePath ? review.sourcePath : null,
    unsavedDecisions: review ? unsavedDecisionCount(review.hunks) : 0,
    changedParagraphs: changedParagraphCount(state.drafts),
    locked: isLocked(state),
    reviewRunning: state.aiBusyPath !== null,
    writesPending: state.persistPending || state.draftWritesPending || state.chapterSaving,
    dialogText: hasDialogText(state)
  };
}

/**
 * What a close puts at risk once drawing the window has failed and the page
 * shown in its place has taken the guard over (hardening.4, `CrashFallback`).
 * Decisions are kept in their review and boxes in their drafts once written,
 * and a crashed page cannot save to the chapter, so no chapter is named and
 * nothing is counted as unsaved: what is left at risk is a write not yet made
 * and a review still running. Text typed in a dialog went with the page.
 */
export function crashedPageState(state: GuardSlices): CloseGuardState {
  const live = closeGuardStateOf(state);
  return {
    chapter: null,
    unsavedDecisions: 0,
    changedParagraphs: 0,
    locked: false,
    reviewRunning: live.reviewRunning,
    writesPending: live.writesPending,
    dialogText: false
  };
}

function sameGuardState(a: CloseGuardState, b: CloseGuardState): boolean {
  return (
    a.chapter === b.chapter &&
    a.unsavedDecisions === b.unsavedDecisions &&
    a.changedParagraphs === b.changedParagraphs &&
    a.locked === b.locked &&
    a.reviewRunning === b.reviewRunning &&
    a.writesPending === b.writesPending &&
    a.dialogText === b.dialogText
  );
}

/** Only these parts of the store can change the state, so nothing else is counted again. */
function slicesChanged(a: GuardSlices, b: GuardSlices): boolean {
  return (
    a.review !== b.review ||
    a.drafts !== b.drafts ||
    a.aiBusyPath !== b.aiBusyPath ||
    a.persistPending !== b.persistPending ||
    a.draftWritesPending !== b.draftWritesPending ||
    a.chapterSaving !== b.chapterSaving ||
    a.dialogText !== b.dialogText ||
    a.editor !== b.editor
  );
}

/**
 * One run of `prepareToLeaveApp`, with the deps it began with. The page shown
 * after a crash ends it as it takes the guard over (hardening.4): what the run
 * would go on to do, Wait's next round of writes or the close question with
 * its Save, belongs to the page that failed. An ended run stops at its next
 * step and answers false, so the close it held is kept.
 */
interface Run {
  readonly deps: CloseGuardDeps;
  ended: boolean;
  /** resolves when the run is ended, so a run waiting on its writes stops at once */
  readonly stopped: Promise<'ended'>;
  end(): void;
}

function startRun(deps: CloseGuardDeps): Run {
  let stop: () => void = () => undefined;
  const stopped = new Promise<'ended'>((resolve) => {
    stop = () => resolve('ended');
  });
  const run: Run = {
    deps,
    ended: false,
    stopped,
    end() {
      run.ended = true;
      stop();
    }
  };
  return run;
}

/** Thrown at an ended run's next step; `leaveApp` answers false, with no card. */
class RunEnded extends Error {}

/** Go on only while the run has not been ended. */
function goOn(run: Run): void {
  if (run.ended) throw new RunEnded('The page that began this close has been replaced.');
}

/** The deps App installed; `prepareToLeaveApp` uses them. */
let installed: CloseGuardDeps | null = null;
/** The run of `prepareToLeaveApp` under way; a second call shares it. */
let leaving: Promise<boolean> | null = null;
/** That run's state, which the page shown after a crash ends. */
let leavingRun: Run | null = null;
/** Main has asked to close and has not been answered yet, so the page reports how far it has got. */
let closeAsked = false;
/** One of the run's questions is on screen. */
let asking = false;

/**
 * Write what the writers hold after drawing the window failed (hardening.4,
 * `CrashFallback`): failed writes queued again, then flushed, and why any is
 * still not on disk, in the words of its card; empty when all is.
 */
export async function writeAfterCrash(writes: PageWrites): Promise<string[]> {
  try {
    writes.retry();
    await writes.flush();
  } catch {
    // A writer that throws has said why in its failures, or has nothing to say.
  }
  return [...new Set(writes.failures())];
}

/**
 * The page shown after a crash takes the close guard over from App
 * (hardening.4) with `crashedPageState`. What the failed page would go on to
 * do belongs to that page: a run of `prepareToLeaveApp` it began is ended,
 * and a question it had open is answered Cancel, so the run stops there
 * rather than writing again or asking its close question, Save included, on
 * this page. A close it held is then kept, and the next is asked of this
 * page, which offers no Save. `questions` is false when nothing can be drawn
 * to ask them. Returns the uninstall.
 */
export function installCrashedPageGuard(
  io: CloseGuardIo,
  writes: PageWrites,
  options: { questions: boolean }
): () => void {
  leavingRun?.end();
  const open = useApp.getState();
  if (open.confirmSpec) open.answerChoice('cancel');
  return installCloseGuard({
    io,
    writes,
    // Never called: a crashed page names no chapter, so no question offers Save.
    save: () => Promise.resolve('failed'),
    // The review's request belongs to the page that failed; quitting the app stops it.
    cancelReview: () => undefined,
    stateOf: crashedPageState,
    questions: options.questions
  });
}

/** What a close puts at risk now, as the installed guard reads it. */
function stateNow(deps: CloseGuardDeps): CloseGuardState {
  return (deps.stateOf ?? closeGuardStateOf)(useApp.getState());
}

function report(deps: CloseGuardDeps, status: CloseStatus): void {
  if (closeAsked) deps.io.sendStatus(status);
}

/** Ask one of the run's questions; main is told it is on screen. */
async function ask(deps: CloseGuardDeps, spec: ConfirmSpec): Promise<ConfirmChoice> {
  if (deps.questions === false) return 'alt';
  report(deps, 'prompting');
  asking = true;
  try {
    return await useApp.getState().askChoice(spec);
  } finally {
    asking = false;
  }
}

/** A macrotask, so the clock in `raceWrites` can run between two rounds of writes. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Let the save under way end, then write what the writers hold, retrying a
 * write that failed, against `writesWaitMs`. `slow` when the time ran out,
 * `failed` when a write could not be made.
 *
 * The page stays live while it waits, so the author can decide something
 * that does not count as unsaved (a dismissal, a comment) or press Save.
 * The writer holds that value for its own 700 ms and lets the flush end
 * without it, so while the store still says a write or a save is pending
 * and none has failed, the page goes round again within the same time.
 * Otherwise a close with nothing to ask went on the next tick and lost it
 * (apply.9 review). A run ended meanwhile stops waiting at once (`RunEnded`).
 */
async function raceWrites(run: Run): Promise<'written' | 'slow' | 'failed'> {
  const deps = run.deps;
  deps.writes.retry();
  let over = false;
  const more = (): boolean => !over && stateNow(deps).writesPending && deps.writes.failures().length === 0;
  const done = (async () => {
    await pendingSave();
    await deps.writes.flush();
    while (more()) {
      await nextTask();
      if (over) return;
      await pendingSave();
      await deps.writes.flush();
    }
  })().then(
    () => 'done' as const,
    () => 'done' as const
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => resolve('slow'), deps.writesWaitMs ?? WRITES_WAIT_MS);
  });
  let first: 'done' | 'slow' | 'ended';
  try {
    first = await Promise.race([done, slow, run.stopped]);
  } finally {
    over = true;
    clearTimeout(timer);
  }
  goOn(run);
  if (first === 'slow') return 'slow';
  return deps.writes.failures().length > 0 ? 'failed' : 'written';
}

/**
 * Everything the page holds is on disk (`written`), or the author chose Close
 * anyway in "Still writing your decisions" (`close-anyway`). Wait, Escape or a
 * question replacing it tries again, with another `writesWaitMs`, unless the
 * run has been ended: the crash page answers the question Cancel as it takes
 * the guard over, and Wait's next round is not this run's to make.
 */
async function writeEverything(run: Run): Promise<'written' | 'close-anyway'> {
  for (;;) {
    if ((await raceWrites(run)) === 'written') return 'written';
    const prompt = stillWritingPrompt(run.deps.writes.failures(), stateNow(run.deps));
    const choice = await ask(run.deps, prompt);
    goOn(run);
    if (choice === 'alt') return 'close-anyway';
  }
}

/** The page is going: a review that is running stops, as the close prompt says. */
function stopReview(deps: CloseGuardDeps): void {
  if (useApp.getState().aiBusyPath !== null) deps.cancelReview();
}

/**
 * True to close: the author's answer, after what it asked for is on disk.
 * Every step after an await goes on only while the run has not been ended
 * (`goOn`), so a run the crash page took over asks nothing more.
 */
async function decide(run: Run): Promise<boolean> {
  const deps = run.deps;
  // A question already open (a leave prompt, "Apply paragraph edits first?")
  // gives way to this one, as to any question that replaces it, and a save
  // waiting on its answer then ends.
  const open = useApp.getState();
  if (open.confirmSpec) open.answerChoice('cancel');

  if ((await writeEverything(run)) === 'close-anyway') {
    stopReview(deps);
    return true;
  }
  const prompt = closePrompt(stateNow(deps));
  // Nothing to ask: the writes were all there was, and they are done.
  if (!prompt) return true;

  const choice = await ask(deps, prompt);
  goOn(run);
  if (choice === 'cancel') return false;
  if (choice === 'confirm') {
    // "Apply, save and close" already said the boxes are applied. The save is
    // the one under way now, so it runs against the clock as the writes do,
    // and a slow one is asked about rather than holding the window.
    const saving = deps.save({ applyDrafts: 'apply' });
    if ((await writeEverything(run)) === 'close-anyway') {
      stopReview(deps);
      return true;
    }
    // A save that did not reach the file keeps the window; its card says why.
    const outcome = await Promise.race([saving, run.stopped]);
    goOn(run);
    if (outcome !== 'saved' && outcome !== 'nothing-to-save') return false;
  }
  stopReview(deps);
  // Close, keep for later needs everything written, and so does what the save
  // and the closed boxes wrote; anything decided meanwhile is in it too.
  await writeEverything(run);
  return true;
}

async function leaveApp(run: Run): Promise<boolean> {
  let close = false;
  try {
    close = await decide(run);
  } catch (err) {
    // An ended run was told to stop: nothing went wrong, and the close is kept.
    if (!(err instanceof RunEnded)) {
      useApp
        .getState()
        .notify(
          'error',
          `The window could not get ready to close: ${err instanceof Error ? err.message : String(err)}`
        );
    }
  } finally {
    // Always answered, so main never waits on a question that has gone.
    closeAsked = false;
    run.deps.io.sendDecision(close);
  }
  return close;
}

/**
 * Get the page ready to go (PLAN 11.3 i), for the window's close (`close`)
 * or for Restart now (`update`): say the request has arrived, let the save
 * under way end and write what is waiting, asking "Still writing your
 * decisions" (Wait, Close anyway) when that takes more than 5 s or a write
 * fails, then ask `closePrompt`'s question when there is anything to ask.
 * Save proceeds only when the file then reads like the page; Close, keep for
 * later stops a running review and writes what is waiting; Cancel stays.
 * Main is always answered (`app:close-decision`), and so is the caller: true
 * to go, false to stay. A call while one is under way shares its answer.
 */
export function prepareToLeaveApp(reason: LeaveAppReason): Promise<boolean> {
  const deps = installed;
  if (!deps) return Promise.resolve(true);
  if (reason === 'close') {
    closeAsked = true;
    deps.io.sendStatus('received');
    if (asking) deps.io.sendStatus('prompting');
  }
  if (leaving) return leaving;
  const run = startRun(deps);
  const answer = leaveApp(run).finally(() => {
    if (leaving === answer) {
      leaving = null;
      leavingRun = null;
    }
  });
  leaving = answer;
  leavingRun = run;
  return answer;
}

/**
 * Guard the window's close from now on (App, once; React's development mode
 * installs twice, and the second replaces the first). Pushes the state at
 * once, as main forgets the page's state whenever a page loads (7.7). Returns
 * the uninstall.
 */
export function installCloseGuard(deps: CloseGuardDeps): () => void {
  installed = deps;
  let last: CloseGuardState | null = null;
  const stateOf = deps.stateOf ?? closeGuardStateOf;
  const push = (slices: GuardSlices): void => {
    const next = stateOf(slices);
    if (last && sameGuardState(last, next)) return;
    last = next;
    deps.io.pushState(next);
  };
  push(useApp.getState());
  const unsubscribe = useApp.subscribe((state, previous) => {
    if (slicesChanged(state, previous)) push(state);
  });
  const offClose = deps.io.onCloseRequested(() => void prepareToLeaveApp('close'));
  // Shutdown is never held up (C.55): write what is waiting, ask nothing.
  const offFlush = deps.io.onFlush(() => {
    deps.writes.retry();
    void deps.writes.flush();
  });
  return () => {
    unsubscribe();
    offClose();
    offFlush();
    if (installed === deps) installed = null;
  };
}
