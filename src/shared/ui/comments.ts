/**
 * Grouping and one-line summaries for comments (item 4).
 *
 * Resolving a comment used to delete it from the page, which the author read as
 * losing the note rather than finishing with it. A resolved comment now stays
 * where it was as a collapsed card, so the margin still shows that something was
 * said about that paragraph.
 */

import { paragraphNumber } from '../prompt/chapter';
import { flatten } from './suggestions';
import type { ReviewComment } from '../types';

/** The side panel's three runs of comments, in the order it lists them (ui.7). */
export interface CommentGroups {
  /** open comments on a paragraph, then open comments about the whole chapter */
  open: ReviewComment[];
  /** open comments whose paragraph left the file, by the paragraph they had */
  unanchored: ReviewComment[];
  /** resolved comments, anchored or not */
  resolved: ReviewComment[];
}

/**
 * A comment whose paragraph left the file when it changed on disk, as against
 * one about the whole chapter, which never had a paragraph (ui.7).
 */
export function isUnanchored(comment: Pick<ReviewComment, 'paragraph' | 'wasParagraph'>): boolean {
  return comment.paragraph === null && comment.wasParagraph !== undefined;
}

/**
 * Comments in reading order: by paragraph, first to last (round 4, item 4). A
 * model returns them in whatever order it thought of them, which read as random
 * in the sidebar. An unanchored comment counts by the paragraph it had (ui.7).
 * Comments on the same paragraph keep the order they came in, and comments
 * about the chapter as a whole, which have no paragraph, come last.
 */
export function sortComments<T extends Pick<ReviewComment, 'paragraph' | 'wasParagraph'>>(
  comments: readonly T[]
): T[] {
  const rank = (c: T): number => c.paragraph ?? c.wasParagraph ?? Number.POSITIVE_INFINITY;
  return comments
    .map((comment, order) => ({ comment, order }))
    .sort((a, b) => rank(a.comment) - rank(b.comment) || a.order - b.order)
    .map(({ comment }) => comment);
}

export function groupComments(comments: readonly ReviewComment[]): CommentGroups {
  const sorted = sortComments(comments);
  return {
    open: sorted.filter((c) => c.status === 'open' && !isUnanchored(c)),
    unanchored: sorted.filter((c) => c.status === 'open' && isUnanchored(c)),
    resolved: sorted.filter((c) => c.status === 'resolved')
  };
}

/**
 * The side panel's one list of comments (ui.7): the open ones first, then the
 * unanchored, then the resolved, each run in reading order. Under three
 * headings, once most comments were resolved the open ones sat under a
 * near-empty heading and the rest were out of sight below it.
 */
export function commentList(comments: readonly ReviewComment[]): ReviewComment[] {
  const { open, unanchored, resolved } = groupComments(comments);
  return [...open, ...unanchored, ...resolved];
}

/**
 * The list's heading, which shows progress: "Comments (5 of 8 resolved)". The
 * author asked for "Comments (5/8)", which could be read as 5 open of 8 (ui.7).
 */
export function commentsHeading(comments: readonly Pick<ReviewComment, 'status'>[]): string {
  if (comments.length === 0) return 'Comments (0)';
  const resolved = comments.filter((c) => c.status === 'resolved').length;
  return `Comments (${resolved} of ${comments.length} resolved)`;
}

/**
 * Where a comment sits, beside its category: "paragraph 12", "unanchored (was
 * paragraph 12)" for one whose paragraph left the file (ui.7), or "chapter"
 * for one about the chapter as a whole.
 */
export function commentPlace(comment: Pick<ReviewComment, 'paragraph' | 'wasParagraph'>): string {
  if (comment.paragraph !== null) return `paragraph ${paragraphNumber(comment.paragraph)}`;
  if (comment.wasParagraph !== undefined) {
    return `unanchored (was paragraph ${paragraphNumber(comment.wasParagraph)})`;
  }
  return 'chapter';
}

/**
 * Why "Edit text" on a comment opens no paragraph, or null when it has one to
 * open: its paragraph left the file when it changed on disk (ui.7), or it is
 * about the chapter as a whole and never had one.
 */
export function commentEditBlocked(
  comment: Pick<ReviewComment, 'paragraph' | 'wasParagraph'>
): string | null {
  if (comment.paragraph !== null) return null;
  return isUnanchored(comment)
    ? "That comment's paragraph is no longer in the chapter, so there is no one paragraph to edit."
    : 'That comment is about the chapter as a whole, so there is no one paragraph to edit.';
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
