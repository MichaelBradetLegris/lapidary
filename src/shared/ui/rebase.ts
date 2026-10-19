import type { RebaseResult, RebaseStats } from '../diff/rebase';

/**
 * The cards that report a rebase (PLAN 6.2 and 6.3): a chapter opened on a
 * review made before the file changed, an older review opened from History,
 * the chapter reloaded after it changed on disk, and Save to chapter finding
 * the file changed underneath it: `saving` when it tries again, and
 * `saving-stopped` when the change brought merge markers, which stop the save
 * before anything is written (files.11, PLAN 6.3 step 2).
 */
export type RebaseCard = 'opened' | 'history' | 'reloaded' | 'saving' | 'saving-stopped';

/** What a rebase card is worded from. */
export type RebaseCardStats = Pick<RebaseStats, 'anchored' | 'newlyStale' | 'keptOut' | 'adopted'>;

/**
 * Decisions the rebase changed to match the file (`stats.adopted`): a change
 * the author made by hand outside the app is now accepted, and a saved change
 * the author undid by hand is a suggestion again. Empty when there are none
 * (apply.23: the card used to say nothing about them).
 */
export function adoptedSentence(adopted: number): string {
  if (adopted <= 0) return '';
  return `${adopted} decision${adopted === 1 ? '' : 's'} changed to match the file.`;
}

/**
 * Suggestions the rebase kept out of the text (`stats.keptOut`, `files.20`):
 * where the file has them now, they would change Obsidian syntax, so they are
 * listed under Unanchored with the note that says why. Empty when there are
 * none. Those kept out before are not news, and are not counted.
 */
export function keptOutSentence(keptOut: number): string {
  if (keptOut <= 0) return '';
  return `${suggestions(keptOut)} kept out of the text, as ${keptOut === 1 ? 'it' : 'they'} would now change Obsidian syntax.`;
}

function suggestions(n: number): string {
  return `${n} suggestion${n === 1 ? '' : 's'}`;
}

/**
 * The text of a rebase card. "Could not be found" and "lost" count only the
 * suggestions this rebase took off the page (`newlyStale`), not those already
 * under Unanchored (`files.20`); then the suggestions it kept out of the text
 * and the decisions that changed to match the file, when there are any.
 */
export function rebaseCardText(card: RebaseCard, stats: RebaseCardStats): string {
  const then = [keptOutSentence(stats.keptOut), adoptedSentence(stats.adopted)]
    .filter((sentence) => sentence !== '')
    .map((sentence) => ` ${sentence}`)
    .join('');
  switch (card) {
    case 'opened':
      return `The chapter changed since this review was made. ${suggestions(stats.anchored)} re-anchored, ${stats.newlyStale} could not be found.${then}`;
    case 'history':
      return `Loaded an older review. ${stats.anchored} re-anchored, ${stats.newlyStale} could not be found.${then}`;
    case 'reloaded':
      return `Reloaded from disk. ${suggestions(stats.anchored)} re-anchored, ${stats.newlyStale} could not be found.${then}`;
    case 'saving':
      return `The chapter changed on disk before saving. Rebased: ${stats.anchored} re-anchored, ${stats.newlyStale} lost.${then} Retrying.`;
    case 'saving-stopped':
      return `The chapter changed on disk before saving. Rebased: ${stats.anchored} re-anchored, ${stats.newlyStale} lost.${then}`;
  }
}

/**
 * The tone of the card for a chapter opened on an older review or reloaded
 * from disk: a warning only when the rebase took suggestions off the page
 * (`newlyStale`), never for those already under Unanchored or those it kept
 * out of the text (`files.20`).
 */
export function rebaseCardTone(stats: Pick<RebaseStats, 'newlyStale'>): 'warn' | 'info' {
  return stats.newlyStale > 0 ? 'warn' : 'info';
}

/**
 * The reloads the reload card reports (PLAN 6.2, C.74). Each reload replaces
 * that card, and Obsidian saves on a debounce while the author types, so
 * reloads come in runs: a card that counted only its own reload was replaced,
 * two seconds after it warned of suggestions lost, by one that counted none
 * (the `files.20` review). While the card is up, the next reload's card
 * reports the whole run since it went up.
 */
export interface ReloadRun {
  /** the review the run's reloads moved; a reload of another review starts a run of its own */
  reviewId: string;
  /** suggestions a reload of the run took off the page that are still off it, and not kept out */
  newlyStale: readonly string[];
  /** suggestions a reload of the run kept out of the text */
  keptOut: readonly string[];
  /** hunks whose decision a reload of the run changed to match the file */
  adopted: readonly string[];
  /** what the card says: re-anchored as the latest reload left them, the rest counted from the lists */
  stats: RebaseCardStats;
}

/**
 * The run after one more reload. `previous` is the run the reload card on
 * screen reports, or null when none is up (none yet, closed with its X, or a
 * chapter or a review opened since), which starts a new run; so does a reload
 * of another review. A run of one reload says just what its stats say. Over
 * several: re-anchored as the latest left them; "could not be found" counts
 * the suggestions any of them took off the page that are still off it and not
 * kept out, so one a later reload found again, as when a paragraph is cut and
 * pasted back, is not counted; the suggestions any of them kept out; and the
 * decisions any of them changed to match the file, each once.
 */
export function mergeReloadRun(
  previous: ReloadRun | null,
  result: Pick<RebaseResult, 'review' | 'stats' | 'changes'>
): ReloadRun {
  const { review, stats, changes } = result;
  const carried = previous !== null && previous.reviewId === review.id ? previous : null;
  const now = new Map(review.hunks.map((h) => [h.id, h]));
  const join = (before: readonly string[] | undefined, added: readonly string[]): string[] => [
    ...new Set([...(before ?? []), ...added])
  ];
  const newlyStale = join(carried?.newlyStale, changes.newlyStale).filter((id) => {
    const hunk = now.get(id);
    return hunk !== undefined && hunk.anchor === 'stale' && hunk.keptOut === undefined;
  });
  const keptOut = join(carried?.keptOut, changes.keptOut).filter((id) => now.get(id)?.keptOut !== undefined);
  const adopted = join(carried?.adopted, changes.adopted).filter((id) => now.has(id));
  return {
    reviewId: review.id,
    newlyStale,
    keptOut,
    adopted,
    stats: {
      anchored: stats.anchored,
      newlyStale: newlyStale.length,
      keptOut: keptOut.length,
      adopted: adopted.length
    }
  };
}
