/**
 * Grouping and one-line summaries for comments (item 4).
 *
 * Resolving a comment used to delete it from the page, which the author read as
 * losing the note rather than finishing with it. A resolved comment now stays
 * where it was as a collapsed card, so the margin still shows that something was
 * said about that paragraph.
 */

import { flatten } from './suggestions';
import type { ReviewComment } from '../types';

export interface CommentGroups {
  open: ReviewComment[];
  resolved: ReviewComment[];
}

/**
 * Comments in reading order: by paragraph, first to last (round 4, item 4). A
 * model returns them in whatever order it thought of them, which read as random
 * in the sidebar. Comments on the same paragraph keep the order they came in,
 * and comments about the chapter as a whole, which have no paragraph, come last.
 */
export function sortComments<T extends Pick<ReviewComment, 'paragraph'>>(comments: readonly T[]): T[] {
  const rank = (c: T): number => (c.paragraph === null ? Number.POSITIVE_INFINITY : c.paragraph);
  return comments
    .map((comment, order) => ({ comment, order }))
    .sort((a, b) => rank(a.comment) - rank(b.comment) || a.order - b.order)
    .map(({ comment }) => comment);
}

export function groupComments(comments: readonly ReviewComment[]): CommentGroups {
  const sorted = sortComments(comments);
  return {
    open: sorted.filter((c) => c.status === 'open'),
    resolved: sorted.filter((c) => c.status === 'resolved')
  };
}

/** Comments that take a place in the margin: every anchored one, resolved or not, in reading order. */
export function gutterComments(comments: readonly ReviewComment[]): ReviewComment[] {
  return sortComments(comments.filter((c) => c.paragraph !== null));
}

/**
 * The first few words of a comment, for the collapsed card. Long enough to
 * recognise which note it is, short enough to stay on one line beside the
 * category.
 */
export function commentDigest(comment: Pick<ReviewComment, 'text'>, max = 42): string {
  const flat = flatten(comment.text);
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Height a collapsed card takes in the stacking layout. Resolved cards are kept
 * out of the way of the open ones rather than pushing them down the page.
 */
export const COLLAPSED_CARD_HEIGHT = 26;
