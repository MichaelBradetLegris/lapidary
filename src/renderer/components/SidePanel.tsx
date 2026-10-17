import { useEffect, useMemo, useRef } from 'react';
import { isAuthored } from '../../shared/edit';
import type { ReviewSummary } from '../../shared/ipc';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { groupComments } from '../../shared/ui/comments';
import { historyCounts, historyWhen } from '../../shared/ui/history';
import { groupSuggestions, summaryLine } from '../../shared/ui/suggestions';
import { SHOW_BACKUPS, SHOW_BACKUPS_TITLE } from '../../shared/ui/backups';
import { PROVIDER_NAMES, type Hunk, type Review, type ReviewComment } from '../../shared/types';
import { editFromComment, editHunk } from '../state/edit';
import { followFocus, scrollToElement } from '../state/scroll';
import { inDraft, isLocked, useApp } from '../state/store';
import { IconCheck, IconPencil, IconUndo, IconX } from './icons';

interface Props {
  review: Review;
  history?: ReviewSummary[];
  activeReviewPath?: string | null;
  onSetCommentStatus: (id: string, status: ReviewComment['status']) => void;
  onOpenHistory?: (summary: ReviewSummary) => void;
  /** open the chapter's backup folder (apply.11); the footer shows the button when given */
  onShowBackups?: () => void;
}

const STATUS_MARK: Record<Hunk['status'], string> = {
  pending: '',
  accepted: 'accepted',
  dismissed: 'dismissed'
};

export function SidePanel({
  review,
  history = [],
  activeReviewPath = null,
  onSetCommentStatus,
  onOpenHistory,
  onShowBackups
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
  const lowerRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLElement>(null);

  const { inline, stale } = useMemo(
    () => groupSuggestions(review.hunks, hiddenCategories),
    [review.hunks, hiddenCategories]
  );

  const focused = review.hunks.find((h) => h.id === focusedHunkId) ?? null;
  const { open: openComments, resolved } = useMemo(() => groupComments(review.comments), [review.comments]);

  /* Keep the focused suggestion in view when the focus moves, by key or by
     click (panel.1): its row in the list, and its details in the region below
     when that region has been scrolled away from them. Each moves only when
     not already wholly in view, with the app's own timing, and only the region
     that holds it: `scrollIntoView` would also move any ancestor that clips,
     the panel itself included, which is not meant to scroll at all. */
  useEffect(() => {
    if (!focusedHunkId) return;
    const row = listRef.current?.querySelector(`[data-row-id="${CSS.escape(focusedHunkId)}"]`);
    followFocus(row, lowerRef.current, detailsRef.current);
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
        <span className="comment__para">
          {comment.paragraph === null ? 'chapter' : `paragraph ${paragraphNumber(comment.paragraph)}`}
        </span>
      </button>
      {comment.quote ? <blockquote>{comment.quote}</blockquote> : null}
      <p>{comment.text}</p>
    </>
  );

  /* Two regions that each scroll, and a panel that does not (panel.1): the
     list on top with its heading pinned, and below it everything about the
     focused suggestion and the chapter, so the details stay in view while j and
     k step through the list. In a short window the panel scrolls as one
     instead (app.css). */
  return (
    <aside className={`side ${locked ? 'side--locked' : ''}`} inert={locked}>
      <div className="side__body">
        <section className="side__section side__list">
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
                        <span className="row__text">{summaryLine(hunk)}</span>
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

        <div className="side__lower" ref={lowerRef}>
          <section className="side__section" ref={detailsRef}>
            <h3>Focused suggestion</h3>
            {focused ? (
              <div className="detail">
                <div className={`detail__cat cat-${focused.category ?? 'other'}`}>
                  {isAuthored(focused) ? 'your edit' : (focused.category ?? 'change')}
                  {focused.anchor !== 'exact' ? (
                    <span className="detail__anchor"> {focused.anchor}</span>
                  ) : null}
                </div>
                <dl className="pair">
                  <dt>Original:</dt>
                  <dd className="pair__original">{focused.original || '(nothing)'}</dd>
                  <dt>Suggested:</dt>
                  <dd className="pair__suggested">{focused.replacement || '(nothing)'}</dd>
                </dl>
                {focused.reason ? <p className="detail__reason">{focused.reason}</p> : null}
                <div className="detail__actions">
                  <button type="button" onClick={() => editHunk(focused.id)}>
                    <IconPencil /> Edit
                  </button>
                </div>
              </div>
            ) : (
              <p className="side__empty">Press j or click a row to focus a suggestion.</p>
            )}
          </section>

          <section className="side__section">
            <h3>Comments ({openComments.length})</h3>
            {openComments.length === 0 && resolved.length === 0 ? (
              <p className="side__empty">No comments.</p>
            ) : null}
            {openComments.length === 0 && resolved.length > 0 ? (
              <p className="side__empty">All resolved.</p>
            ) : null}
            <ul className="comments">
              {openComments.map((comment) => (
                <li
                  key={comment.id}
                  className={`comment cat-${comment.category} ${
                    comment.id === activeCommentId ? 'comment--active' : ''
                  }`}
                >
                  {commentBody(comment)}
                  <div className="comment__foot">
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
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Resolved comments move down here rather than disappearing (item 4). */}
          {resolved.length > 0 ? (
            <section className="side__section">
              <h3>Resolved comments ({resolved.length})</h3>
              <ul className="comments">
                {resolved.map((comment) => (
                  <li
                    key={comment.id}
                    className={`comment comment--resolved cat-${comment.category} ${
                      comment.id === activeCommentId ? 'comment--active' : ''
                    }`}
                  >
                    {commentBody(comment)}
                    <div className="comment__foot">
                      <button
                        type="button"
                        className="link"
                        onClick={() => onSetCommentStatus(comment.id, 'open')}
                      >
                        Unresolve
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
                      <dd className="pair__original">{hunk.original || '(nothing)'}</dd>
                      <dt>Suggested:</dt>
                      <dd className="pair__suggested">{hunk.replacement || '(nothing)'}</dd>
                    </dl>
                    {hunk.reason ? <p className="detail__reason">{hunk.reason}</p> : null}
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
      {/* Pinned below both regions, so it is in view however far either has
          scrolled (apply.11). */}
      {onShowBackups ? (
        <div className="side__foot">
          <button type="button" title={SHOW_BACKUPS_TITLE} onClick={onShowBackups}>
            {SHOW_BACKUPS}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
