import { useEffect, useMemo, useRef } from 'react';
import { keptOutNote } from '../../shared/diff/protect';
import { isAuthored } from '../../shared/edit';
import type { ReviewSummary } from '../../shared/ipc';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { commentList, commentPlace, commentsHeading } from '../../shared/ui/comments';
import {
  historyCounts,
  historyWhen,
  NO_REVIEWS_YET,
  pickerHoldsKey,
  reviewPicker
} from '../../shared/ui/history';
import { changeInContext, isSmallChange, sideText, type ChangeInContext } from '../../shared/ui/small';
import { groupSuggestions, summaryLine } from '../../shared/ui/suggestions';
import { PROVIDER_NAMES, type Hunk, type Review, type ReviewComment } from '../../shared/types';
import { editFromComment, editHunk } from '../state/edit';
import { followFocus, scrollToElement } from '../state/scroll';
import { SPLIT_LIST_ID, useSplit } from '../state/splitHandle';
import { inDraft, isLocked, useApp } from '../state/store';
import { IconArrow, IconCheck, IconPencil, IconUndo, IconWarning, IconX } from './icons';

interface Props {
  review: Review;
  history?: ReviewSummary[];
  activeReviewPath?: string | null;
  onSetCommentStatus: (id: string, status: ReviewComment['status']) => void;
  onOpenHistory?: (summary: ReviewSummary) => void;
}

const STATUS_MARK: Record<Hunk['status'], string> = {
  pending: '',
  accepted: 'accepted',
  dismissed: 'dismissed'
};

/**
 * A small change's row: a few words of its line on either side, and the
 * change between them in a chip like the keycap above the line, each side
 * named as the tooltip names it (11.7, small.5): "...up with Mira [-> , (comma)]
 * who had...". The words are what finds a comma in a list of commas.
 */
function ContextText({ context }: { context: ChangeInContext }): React.JSX.Element {
  return (
    <span className="row__text row__text--context">
      {context.before}
      <span className="row__chip">
        {context.original !== null ? <span className="row__old">{context.original}</span> : null}
        <IconArrow size={9} />
        {context.replacement !== null ? (
          <span className="row__new">{context.replacement}</span>
        ) : (
          <span className="row__tag">delete</span>
        )}
      </span>
      {context.after}
    </span>
  );
}

export function SidePanel({
  review,
  history = [],
  activeReviewPath = null,
  onSetCommentStatus,
  onOpenHistory
}: Props): React.JSX.Element {
  const focusedHunkId = useApp((s) => s.focusedHunkId);
  const hiddenCategories = useApp((s) => s.hiddenCategories);
  const focusHunk = useApp((s) => s.focusHunk);
  const toggleAccepted = useApp((s) => s.toggleAccepted);
  const toggleDismissed = useApp((s) => s.toggleDismissed);
  const activeCommentId = useApp((s) => s.activeCommentId);
  const setActiveComment = useApp((s) => s.setActiveComment);
  const drafts = useApp((s) => s.drafts);
  const locked = useApp(isLocked);
  const listRef = useRef<HTMLUListElement>(null);
  const focusBodyRef = useRef<HTMLDivElement>(null);
  const { regionsRef, regionsProps, handleProps } = useSplit();

  const { inline, stale } = useMemo(
    () => groupSuggestions(review.hunks, hiddenCategories),
    [review.hunks, hiddenCategories]
  );

  const focused = review.hunks.find((h) => h.id === focusedHunkId) ?? null;
  const comments = useMemo(() => commentList(review.comments), [review.comments]);
  const picker = useMemo(
    () => reviewPicker(history, activeReviewPath, review),
    [history, activeReviewPath, review]
  );
  const pickedLabel = picker.choices.find((c) => c.value === picker.selected)?.label ?? NO_REVIEWS_YET;

  /* Another review from the selector opens as a History row does, without a
     question (apply.26); the review on screen, or one History no longer
     lists, does nothing. */
  const chooseReview = (value: string): void => {
    if (value === picker.selected || !onOpenHistory) return;
    const entry = history.find((e) => e.path === value);
    if (entry) onOpenHistory(entry);
  };

  /* When the focus moves, by key or by click: the box above the list shows
     the new suggestion from its first line, however far the last one's
     explanation was scrolled (ui.5), and the row is kept in view in the list
     (panel.1), moving only when not already wholly in view. The box never
     moves, so it needs no following. */
  useEffect(() => {
    if (focusBodyRef.current) focusBodyRef.current.scrollTop = 0;
    if (!focusedHunkId) return;
    followFocus(listRef.current?.querySelector(`[data-row-id="${CSS.escape(focusedHunkId)}"]`));
  }, [focusedHunkId]);

  const scrollToParagraph = (index: number | null, commentId: string): void => {
    setActiveComment(commentId);
    if (index === null) return;
    const el = document.getElementById(`para-${index}`);
    scrollToElement(el, 'center');
  };

  const commentBody = (comment: ReviewComment): React.JSX.Element => (
    <>
      <button
        type="button"
        className="comment__head"
        onClick={() => scrollToParagraph(comment.paragraph, comment.id)}
      >
        <span className="comment__cat">{comment.category}</span>
        <span className="comment__para">{commentPlace(comment)}</span>
      </button>
      {comment.quote ? <blockquote>{comment.quote}</blockquote> : null}
      <p>{comment.text}</p>
    </>
  );

  /* Under the review selector, the focused suggestion in a box of fixed
     height (ui.5), then two regions that each scroll, and a panel that does
     not (panel.1): the list with its heading pinned, and below it the
     comments, Unanchored and History, with a handle between the two that
     moves the line between them (ui.6). The box stays in view while j and k
     step through the list, and as its height never changes, nothing below it
     moves when the focus does. In a short window the panel scrolls as one
     instead, the box at its top, and the handle is hidden (app.css). */
  return (
    <aside className={`side ${locked ? 'side--locked' : ''}`} inert={locked}>
      {/* The chapter's reviews, the one on screen selected, at the very top
          and outside both regions, so it never scrolls (apply.26). The mark
          says when that one is not the newest; the chapter opens with it all
          the same, since it was the last on screen. */}
      {onOpenHistory ? (
        <div className={`side__head ${picker.notNewest ? 'side__head--older' : ''}`}>
          {picker.notNewest ? (
            <span
              id="review-picker-mark"
              className="review-picker__mark"
              role="img"
              aria-label={picker.notNewest}
              title={picker.notNewest}
            >
              <IconWarning />
            </span>
          ) : null}
          <select
            className="review-picker"
            aria-label="Review shown"
            aria-describedby={picker.notNewest ? 'review-picker-mark' : undefined}
            title={pickedLabel}
            value={picker.selected}
            disabled={picker.choices.length === 0}
            onKeyDown={(event) => {
              /* The arrows, Home, End and the page keys would open another
                 review at every press, and the arrows are review keys too;
                 Alt+Down, F4 and Space still open the list (apply.26 review). */
              if (pickerHoldsKey(event)) event.preventDefault();
            }}
            onChange={(event) => {
              /* A choice hands the focus back to the page, as a History row's
                 click leaves it on a button, so j, k, a and the arrows act on
                 the suggestions at once: a focused select takes them as typing. */
              event.currentTarget.blur();
              chooseReview(event.target.value);
            }}
          >
            {picker.choices.length === 0 ? (
              <option value="">{NO_REVIEWS_YET}</option>
            ) : (
              picker.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))
            )}
          </select>
        </div>
      ) : null}
      <div className="side__body">
        {/* Its heading line names the category after the heading, in the
            category's colour, with the anchor when it is not exact
            ("Focused suggestion · punctuation", polish.8), and ends in the
            pencil, which opens the suggestion editor as e does; a longer
            suggestion or explanation scrolls inside the box. With nothing
            focused the box keeps its height. In a narrow panel the heading's
            words give way before the category's (app.css); the separator keeps
            its spaces, so the heading reads as one phrase to a screen reader. */}
        <section className="side__focus">
          <div className="side__focus-head">
            <h3>
              <span className="side__focus-title">Focused suggestion</span>
              {focused ? (
                <span className={`side__focus-cat cat-${focused.category ?? 'other'}`}>
                  <span className="side__focus-sep"> · </span>
                  {isAuthored(focused) ? 'your edit' : (focused.category ?? 'change')}
                  {focused.anchor !== 'exact' ? (
                    <span className="detail__anchor"> {focused.anchor}</span>
                  ) : null}
                </span>
              ) : null}
            </h3>
            {focused ? (
              <button
                type="button"
                className="row__act side__focus-edit"
                aria-label="Edit suggestion"
                title="Edit suggestion (e)"
                onClick={() => editHunk(focused.id)}
              >
                <IconPencil />
              </button>
            ) : null}
          </div>
          <div className="side__focus-body" ref={focusBodyRef}>
            {focused ? (
              <>
                <dl className="pair">
                  <dt>Original:</dt>
                  <dd className="pair__original">{sideText(focused.original)}</dd>
                  <dt>Suggested:</dt>
                  <dd className="pair__suggested">{sideText(focused.replacement)}</dd>
                </dl>
                {focused.reason ? <p className="detail__reason">{focused.reason}</p> : null}
              </>
            ) : (
              <p className="side__empty">
                Press j or click a row to focus a suggestion. Shift+J goes to the next pending one.
              </p>
            )}
          </div>
        </section>
        <div className="side__regions" ref={regionsRef} {...regionsProps}>
          <section className="side__section side__list" id={SPLIT_LIST_ID}>
            <h3>Suggestions ({inline.length})</h3>
            {inline.length === 0 ? (
              <p className="side__empty">Nothing to review here.</p>
            ) : (
              <ul className="rows" ref={listRef}>
                {inline.map((hunk) => {
                  /* A suggestion inside a paragraph that is open for editing is
                 frozen until the author is done with it: the editor started
                 from the page as it was, and must commit against the same. */
                  const editing = inDraft(drafts, hunk.paragraph);
                  const context = isSmallChange(hunk) ? changeInContext(review.base.text, hunk) : null;
                  return (
                    <li key={hunk.id}>
                      <div
                        data-row-id={hunk.id}
                        className={`row row--${hunk.status} cat-${hunk.category ?? 'other'} ${
                          hunk.id === focusedHunkId ? 'row--focused' : ''
                        } ${editing ? 'row--editing' : ''}`}
                        title={
                          editing
                            ? `Paragraph ${paragraphNumber(hunk.paragraph)} is open for editing`
                            : undefined
                        }
                      >
                        <button
                          type="button"
                          className="row__main"
                          onClick={() => focusHunk(hunk.id, { scroll: true })}
                          title={hunk.reason ?? ''}
                          aria-label={
                            context
                              ? [isAuthored(hunk) ? 'you' : '', summaryLine(hunk), STATUS_MARK[hunk.status]]
                                  .filter(Boolean)
                                  .join(', ')
                              : undefined
                          }
                        >
                          {/* Words the author wrote are marked "you" rather than given
                        a category colour they never chose (item 3). */}
                          {isAuthored(hunk) ? (
                            <span className="row__you" title="Your own words">
                              you
                            </span>
                          ) : (
                            <span className="row__dot" aria-hidden="true" />
                          )}
                          {context ? (
                            <ContextText context={context} />
                          ) : (
                            <span className="row__text">{summaryLine(hunk)}</span>
                          )}
                          {STATUS_MARK[hunk.status] ? (
                            <span className="row__status">{STATUS_MARK[hunk.status]}</span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="row__act"
                          aria-label="Edit this suggestion"
                          title="Edit"
                          disabled={editing}
                          onClick={() => editHunk(hunk.id)}
                        >
                          <IconPencil />
                        </button>
                        <button
                          type="button"
                          className={`row__act ${hunk.status === 'accepted' ? 'row__act--on' : ''}`}
                          aria-label={hunk.status === 'accepted' ? 'Undo accept' : 'Accept suggestion'}
                          title={hunk.status === 'accepted' ? 'Undo accept' : 'Accept'}
                          disabled={editing}
                          onClick={() => toggleAccepted(hunk.id)}
                        >
                          <IconCheck />
                        </button>
                        <button
                          type="button"
                          className={`row__act ${hunk.status === 'dismissed' ? 'row__act--on' : ''}`}
                          aria-label={
                            hunk.status === 'dismissed' ? 'Undismiss suggestion' : 'Dismiss suggestion'
                          }
                          title={hunk.status === 'dismissed' ? 'Undismiss' : 'Dismiss'}
                          disabled={editing}
                          onClick={() => toggleDismissed(hunk.id)}
                        >
                          {hunk.status === 'dismissed' ? <IconUndo /> : <IconX />}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Dragged, or moved with the arrows, Home and End, to give the list
              or the region below more room; double-click or Enter puts back
              the usual split. The split is kept in settings (ui.6). */}
          <div {...handleProps} />

          <div className="side__lower">
            {/* One list under one heading that counts the resolved ones (ui.7):
                the open comments, then those whose paragraph left the file,
                then the resolved, which keep their quieter look and Unresolve
                rather than disappearing (item 4). Each run is in reading
                order, an unanchored comment by the paragraph it had. */}
            <section className="side__section">
              <h3>{commentsHeading(review.comments)}</h3>
              {comments.length === 0 ? (
                <p className="side__empty">No comments.</p>
              ) : (
                <ul className="comments">
                  {comments.map((comment) => {
                    const resolved = comment.status === 'resolved';
                    return (
                      <li
                        key={comment.id}
                        className={`comment ${resolved ? 'comment--resolved' : ''} cat-${comment.category} ${
                          comment.id === activeCommentId ? 'comment--active' : ''
                        }`}
                      >
                        {commentBody(comment)}
                        <div className="comment__foot">
                          {resolved ? (
                            <button
                              type="button"
                              className="link"
                              onClick={() => onSetCommentStatus(comment.id, 'open')}
                            >
                              Unresolve
                            </button>
                          ) : (
                            <>
                              <label className="comment__resolve">
                                <input
                                  type="checkbox"
                                  checked={false}
                                  onChange={() => onSetCommentStatus(comment.id, 'resolved')}
                                />
                                Resolve
                              </label>
                              <span className="spacer" />
                              <button type="button" className="link" onClick={() => editFromComment(comment)}>
                                Edit text
                              </button>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="side__section">
              <h3>Unanchored ({stale.length})</h3>
              {stale.length === 0 ? (
                <p className="side__empty">Every suggestion found its place.</p>
              ) : (
                <ul className="stale">
                  {stale.map((hunk) => (
                    <li key={hunk.id} className={`stale__item cat-${hunk.category ?? 'other'}`}>
                      <dl className="pair">
                        <dt>Original:</dt>
                        <dd className="pair__original">{sideText(hunk.original)}</dd>
                        <dt>Suggested:</dt>
                        <dd className="pair__suggested">{sideText(hunk.replacement)}</dd>
                      </dl>
                      {hunk.reason ? <p className="detail__reason">{hunk.reason}</p> : null}
                      {/* Why the guard kept it out of the text (files.7, 11.3 k). */}
                      {hunk.keptOut ? <p className="stale__note">{keptOutNote(hunk.keptOut)}</p> : null}
                      <span className="stale__where">
                        Paragraph {paragraphNumber(hunk.paragraph)} in the original review
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {history.length > 0 && onOpenHistory ? (
              <section className="side__section">
                <h3>History ({history.length})</h3>
                <ul className="history">
                  {history.map((entry) => {
                    /* The review on screen counts from the page, as the
                     chapter list and the status bar do (apply.5). */
                    const counts = historyCounts(entry, activeReviewPath, review);
                    return (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className={`history__item ${counts.onScreen ? 'history__item--active' : ''}`}
                          onClick={() => onOpenHistory(entry)}
                          title={entry.path}
                        >
                          <span className="history__when">{historyWhen(entry.createdAt)}</span>
                          {/* A model-written review names its provider and model; a
                        manual or file review keeps its kind (Phase 5c). */}
                          <span className="badge" title={entry.model ?? ''}>
                            {entry.provider ? PROVIDER_NAMES[entry.provider] : entry.generatorKind}
                          </span>
                          {entry.model ? <span className="history__model">{entry.model}</span> : null}
                          {counts.pendingCount > 0 ? (
                            <span className="badge badge--pending">{counts.pendingCount}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
