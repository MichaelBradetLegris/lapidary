import type { RebaseStats } from '../diff/rebase';

/**
 * The cards that report a rebase (PLAN 6.2 and 6.3): a chapter opened on a
 * review made before the file changed, an older review opened from History,
 * the chapter reloaded after it changed on disk, and Save to chapter finding
 * the file changed underneath it.
 */
export type RebaseCard = 'opened' | 'history' | 'reloaded' | 'saving';

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

function suggestions(n: number): string {
  return `${n} suggestion${n === 1 ? '' : 's'}`;
}

/** The text of a rebase card, with the decisions that changed to match the file when there are any. */
export function rebaseCardText(
  card: RebaseCard,
  stats: Pick<RebaseStats, 'anchored' | 'stale' | 'adopted'>
): string {
  const adopted = adoptedSentence(stats.adopted);
  const then = adopted ? ` ${adopted}` : '';
  switch (card) {
    case 'opened':
      return `The chapter changed since this review was made. ${suggestions(stats.anchored)} re-anchored, ${stats.stale} could not be found.${then}`;
    case 'history':
      return `Loaded an older review. ${stats.anchored} re-anchored, ${stats.stale} could not be found.${then}`;
    case 'reloaded':
      return `Reloaded from disk. ${suggestions(stats.anchored)} re-anchored, ${stats.stale} could not be found.${then}`;
    case 'saving':
      return `The chapter changed on disk before saving. Rebased: ${stats.anchored} re-anchored, ${stats.stale} lost.${then} Retrying.`;
  }
}
