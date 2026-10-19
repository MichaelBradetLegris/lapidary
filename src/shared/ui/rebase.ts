import type { RebaseStats } from '../diff/rebase';

/**
 * The cards that report a rebase (PLAN 6.2 and 6.3): a chapter opened on a
 * review made before the file changed, an older review opened from History,
 * the chapter reloaded after it changed on disk, and Save to chapter finding
 * the file changed underneath it.
 */
export type RebaseCard = 'opened' | 'history' | 'reloaded' | 'saving';

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
