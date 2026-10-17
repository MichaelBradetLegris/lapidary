import { useCallback } from 'react';
import { composeReview, unsavedDecisionCount } from '../../shared/diff/compose';
import { rebaseReview } from '../../shared/diff/rebase';
import type { FileContent, SaveRequest, SaveResponse } from '../../shared/ipc';
import type { Review, ReviewBase } from '../../shared/types';
import { CHAPTER_MATCHES_PAGE } from '../../shared/ui/save';
import { changedParagraphCount, isLocked, savedReview, useApp } from './store';

/*
 * Save to chapter (apply.3, PLAN 6.3): the one path from the page to the
 * chapter file, used by the toolbar button, Ctrl+S, the review dialog's Save to
 * chapter, and later the leave and close prompts, which wait for its outcome.
 *
 * It reaches main only through `SaveDeps`, which App fills with the IPC call
 * and the review writer, so this module needs neither the DOM nor the preload
 * bridge and is tested in node with stand-ins.
 */

/**
 * How a save ended. `saved` and `nothing-to-save` both mean the chapter file
 * now reads like the page; the others mean it may not.
 *
 * - `nothing-to-save`: no decision differed from the file, so nothing was
 *   written ("The chapter already matches the page.").
 * - `cancelled`: the author answered Cancel to applying paragraph boxes first.
 * - `blocked`: something on screen prevents a save: no chapter is open, a
 *   review of it is running, or a paragraph box could not be applied.
 * - `failed`: the file could not be written, or kept changing on disk; a card
 *   says why.
 */
export type SaveOutcome = 'saved' | 'nothing-to-save' | 'cancelled' | 'blocked' | 'failed';

export interface SaveOptions {
  /**
   * Paragraph boxes whose text changed are applied before the save. `ask`
   * asks first; `apply` is for a caller whose own question already said so,
   * such as a leave prompt's "Apply and save first".
   */
  applyDrafts: 'ask' | 'apply';
}

export interface SaveDeps {
  /** `files:save` */
  saveFile: (request: SaveRequest) => Promise<SaveResponse>;
  /** write the review json now (`writeReviewNow`) */
  writeReview: (review: Review, path: string | null) => Promise<string | null>;
  /** after `files:save` wrote the chapter, or found it already as the page reads: refresh History and the list */
  onSaved?: (review: Review) => void;
}

/** Cards about a Save to chapter share a key, so the newest replaces the last. */
export const SAVE_CARD = 'save-chapter';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function baseFrom(content: FileContent): ReviewBase {
  return {
    text: content.text,
    hash: content.hash,
    eol: content.eol,
    bom: content.bom,
    trailingNewline: content.trailingNewline
  };
}

function sameReview(a: Review | null, b: Review): boolean {
  return a !== null && a.id === b.id && a.sourcePath === b.sourcePath;
}

async function runSave(options: SaveOptions, deps: SaveDeps): Promise<SaveOutcome> {
  const app = useApp.getState;
  const start = app();
  if (!start.review?.sourcePath) return 'blocked';
  if (isLocked(start)) {
    start.notify('info', 'Wait for the review to finish, then save.', SAVE_CARD);
    return 'blocked';
  }

  /* Open paragraph boxes hold changes that are not suggestions yet. Saving
     without them would write a chapter the author did not see; applying them
     silently would apply edits the author has not finished. So a changed box
     is asked about, unless the caller already asked. A box opened and left as
     it was is closed without a question when there is something to write,
     because the save can renumber the paragraphs it sits on. */
  const open = Object.keys(start.drafts).length;
  const changed = changedParagraphCount(start.drafts);
  if (changed === 0 && unsavedDecisionCount(start.review.hunks) === 0) {
    start.notify('info', CHAPTER_MATCHES_PAGE, SAVE_CARD);
    return 'nothing-to-save';
  }
  if (changed > 0 && options.applyDrafts === 'ask') {
    const ok = await start.askConfirm({
      title: 'Apply paragraph edits first?',
      body: `${changed} paragraph${changed === 1 ? ' is' : 's are'} still open for editing. Apply ${
        changed === 1 ? 'its changes' : 'their changes'
      } as accepted suggestions, then save the chapter?`,
      confirmLabel: 'Apply and save'
    });
    if (!ok) return 'cancelled';
  }
  if (open > 0) {
    // A box still as it opened has nothing to apply, so it closes without the
    // check that its paragraph still reads the same.
    for (const draft of Object.values(app().drafts)) {
      if (draft.text === draft.initial) app().cancelDraft(draft.key);
    }
    const { blocked } = app().commitAllDrafts();
    if (blocked.length > 0) {
      for (const message of blocked) app().notify('warn', message);
      app().notify('error', 'Nothing was saved. Resolve the paragraphs above, then save again.', SAVE_CARD);
      return 'blocked';
    }
  }

  const current = app().review;
  if (!current?.sourcePath) return 'blocked';
  if (unsavedDecisionCount(current.hunks) === 0) {
    app().notify('info', CHAPTER_MATCHES_PAGE, SAVE_CARD);
    return 'nothing-to-save';
  }

  const currentPath = app().reviewPath;
  app().setChapterSaving(true);
  try {
    let working = current;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await deps.saveFile({
        path: working.sourcePath,
        text: composeReview(working),
        eol: working.base.eol,
        bom: working.base.bom,
        trailingNewline: working.base.trailingNewline,
        expectedHash: working.base.hash
      });

      if (response.status === 'written') {
        if (app().markSaved(response.hash, working)) {
          const saved = app().review;
          if (saved) await deps.writeReview(saved, app().reviewPath);
        } else if (!sameReview(app().review, working)) {
          // Another chapter or History entry was opened while the file was
          // written: record the save in the review it belongs to, off screen.
          await deps.writeReview(savedReview(working, response.hash), currentPath);
        }
        deps.onSaved?.(working);
        if (response.unchanged) {
          app().notify('info', CHAPTER_MATCHES_PAGE, SAVE_CARD);
          return 'nothing-to-save';
        }
        app().notify('info', 'Saved to the chapter file.', SAVE_CARD);
        return 'saved';
      }

      if (!sameReview(app().review, working)) {
        app().notify(
          'warn',
          'The chapter changed on disk before saving, and another review is open now, so nothing was saved.'
        );
        return 'failed';
      }
      const { review: rebased, stats } = rebaseReview(working, baseFrom(response.disk));
      app().setReview(rebased, app().reviewPath);
      working = rebased;
      app().notify(
        'warn',
        `The chapter changed on disk before saving. Rebased: ${stats.anchored} re-anchored, ${stats.stale} lost. Retrying.`
      );
    }
    app().notify('error', 'The chapter keeps changing on disk. Close it in Obsidian and save again.');
    return 'failed';
  } catch (err) {
    app().notify('error', messageOf(err));
    return 'failed';
  } finally {
    app().setChapterSaving(false);
  }
}

/** Saves run one after another; a second waits for the first to end. */
let queue: Promise<unknown> = Promise.resolve();
let inFlight: Promise<SaveOutcome> | null = null;

/**
 * Save the open chapter and resolve with how it went. Never rejects: every
 * failure has put a card on screen and resolves `failed`.
 */
export function saveChapter(options: SaveOptions, deps: SaveDeps): Promise<SaveOutcome> {
  const run = queue
    .then(() => runSave(options, deps))
    .catch((err: unknown) => {
      useApp.getState().notify('error', messageOf(err));
      return 'failed' as const;
    });
  queue = run;
  inFlight = run;
  void run.then(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** The save under way or waiting, for a caller that must let it end first (closing the window). */
export function pendingSave(): Promise<SaveOutcome> | null {
  return inFlight;
}

/**
 * Save to chapter for a component. `deps.onSaved` runs after every save that
 * reached the file, including one that found it already reading like the page.
 */
export function useSaveChapter(deps: SaveDeps): {
  save: (options?: SaveOptions) => Promise<SaveOutcome>;
} {
  const save = useCallback(
    (options: SaveOptions = { applyDrafts: 'ask' }) => saveChapter(options, deps),
    [deps]
  );
  return { save };
}
