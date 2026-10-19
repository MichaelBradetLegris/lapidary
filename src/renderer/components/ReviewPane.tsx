import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent
} from 'react';
import { paragraphNumber } from '../../shared/prompt/chapter';
import { buildRenderBlocks, type RenderBlock } from '../../shared/render';
import { splitParagraphs } from '../../shared/text/paragraphs';
import { gutterComments as gutterCommentsOf } from '../../shared/ui/comments';
import { marginMarks, markAnchorName, type MarginMark } from '../../shared/ui/marks';
import type { Review, ReviewComment } from '../../shared/types';
import { editParagraph } from '../state/edit';
import { useFindHighlight } from '../state/find';
import { clipGhosts } from '../state/ghosts';
import { hoverOff, hoverOn, markHover } from '../state/hover';
import { proseInRange } from '../state/prose';
import { scrollToElement } from '../state/scroll';
import { isLocked, useApp, type ParagraphDraft } from '../state/store';
import { HunkSpan } from './HunkSpan';
import { IconPencil } from './icons';
import { MarginNotes } from './MarginNotes';
import { ParagraphEditor } from './ParagraphEditor';

interface Props {
  review: Review;
  onSetCommentStatus: (id: string, status: ReviewComment['status']) => void;
}

/**
 * Below this the gutter would squeeze the prose too hard, so comments fall back
 * to the sidebar alone. Measured against the scroller, not the window: the file
 * list and the side panel take up to 550px between them, and less once they
 * give way to the prose in a narrow window (ui.3).
 */
const GUTTER_MIN_WIDTH = 820;

/** "12", or "12-13" for a block that spans two paragraphs. */
function blockLabel(block: Pick<RenderBlock, 'paragraphs'>): string {
  const first = block.paragraphs[0] ?? 0;
  const last = block.paragraphs[block.paragraphs.length - 1] ?? first;
  return first === last ? `${paragraphNumber(first)}` : `${paragraphNumber(first)}-${paragraphNumber(last)}`;
}

/**
 * A copy from the page carries the chapter's words as they currently read, as
 * plain text, and none of the app's markup (shared/ui/copy.ts says what the
 * browser's own copy brought along). A copy inside an open paragraph editor is
 * the textarea's own business.
 */
function copyProse(event: ClipboardEvent<HTMLDivElement>): void {
  if (event.target instanceof Element && event.target.closest('.para-editor')) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const text = proseInRange(event.currentTarget, selection.getRangeAt(0));
  if (text === null) return;
  event.clipboardData.setData('text/plain', text);
  event.preventDefault();
}

/**
 * One margin mark (11.7, small.8). A bar is a target 11 by 39 CSS px outside
 * the prose: a click selects its change without scrolling and leaves the
 * keyboard where it was, so a, d, u and e act on it, and hovering shows its
 * card under the change. The arrowhead takes no pointer (app.css).
 *
 * Both are the same button under the same key, so a bar that becomes the
 * arrowhead under the pointer, by a click or by any other way to the focus,
 * keeps its element, and its leave still runs when the pointer moves off. The
 * arrowhead was a span, which replaced the button; React fires no leave for an
 * element that has gone, and the card stayed open over the prose (small
 * review). A mark that goes away while the pointer is on it closes its card
 * itself (`markHover`).
 */
function MarkButton({
  mark,
  anchor,
  onSelect
}: {
  mark: MarginMark;
  anchor: string;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const id = mark.hunk.id;
  const hover = useMemo(() => markHover(id), [id]);
  useEffect(() => hover.gone, [hover]);
  const bar = mark.kind === 'bar';
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      className={bar ? `mark mark--bar cat-${mark.hunk.category ?? 'other'}` : 'mark mark--focus'}
      style={{ positionAnchor: anchor }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={bar ? () => onSelect(id) : undefined}
      onMouseEnter={bar ? hover.enter : undefined}
      onMouseLeave={hover.leave}
    />
  );
}

export function ReviewPane({ review, onSetCommentStatus }: Props): React.JSX.Element {
  const focusedHunkId = useApp((s) => s.focusedHunkId);
  const focusScrollToken = useApp((s) => s.focusScrollToken);
  const hoveredHunkId = useApp((s) => s.hoveredHunkId);
  const activeCommentId = useApp((s) => s.activeCommentId);
  const hiddenCategories = useApp((s) => s.hiddenCategories);
  const toggleAccepted = useApp((s) => s.toggleAccepted);
  const toggleDismissed = useApp((s) => s.toggleDismissed);
  const focusHunk = useApp((s) => s.focusHunk);
  const drafts = useApp((s) => s.drafts);
  const commitDraft = useApp((s) => s.commitDraft);
  const notify = useApp((s) => s.notify);
  const locked = useApp(isLocked);

  const paneRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0, proseHeight: 0, version: 0 });

  const blocks = useMemo(() => {
    const paragraphs = splitParagraphs(review.base.text);
    const visible = review.hunks.filter((h) => !hiddenCategories.includes(h.category ?? 'other'));
    return buildRenderBlocks(review.base.text, paragraphs, visible);
  }, [review.base.text, review.hunks, hiddenCategories]);

  /* Resolved comments keep their place in the margin, collapsed and greyed
     (item 4). A resolved note that vanished read as a lost note. */
  const gutterComments = useMemo(() => gutterCommentsOf(review.comments), [review.comments]);

  const commentedParagraphs = useMemo(() => {
    const set = new Set<number>();
    for (const c of review.comments) {
      if (c.paragraph !== null && c.status === 'open') set.add(c.paragraph);
    }
    return set;
  }, [review.comments]);

  const activeParagraph = useMemo(() => {
    const comment = review.comments.find((c) => c.id === activeCommentId);
    return comment?.paragraph ?? null;
  }, [review.comments, activeCommentId]);

  useFindHighlight(proseRef, blocks);

  /* Track the size of the scroller: it decides whether the gutter fits and how
     tall the position strip is, and a reflow means the cards must remeasure.
     An open paragraph editor growing as the author types counts as a reflow. */
  useLayoutEffect(() => {
    const scroller = paneRef.current?.closest('.center');
    const prose = proseRef.current;
    if (!(scroller instanceof HTMLElement) || !prose) return;
    const measure = (): void => {
      setLayout((prev) => {
        const next = {
          width: scroller.clientWidth,
          height: scroller.clientHeight,
          proseHeight: prose.offsetHeight,
          version: prev.version + 1
        };
        const unchanged =
          prev.width === next.width && prev.height === next.height && prev.proseHeight === next.proseHeight;
        return unchanged ? prev : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(prose);
    return () => observer.disconnect();
  }, [blocks]);

  /* Scroll only when something asked for it: keyboard navigation, or a click in
     the suggestions list. Hover and clicks in the prose never bump the token. */
  const lastToken = useRef(focusScrollToken);
  useEffect(() => {
    if (focusScrollToken === lastToken.current) return;
    lastToken.current = focusScrollToken;
    if (!focusedHunkId || !paneRef.current) return;
    const el = paneRef.current.querySelector(`[data-hunk-id="${focusedHunkId}"]`);
    scrollToElement(el, 'center');
  }, [focusScrollToken, focusedHunkId]);

  const finishDraft = useCallback(
    (key: number) => {
      const outcome = commitDraft(key);
      if (outcome.status === 'blocked') {
        notify('warn', outcome.message, `draft-${key}`);
      } else if (outcome.status === 'applied') {
        const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
        const parts: string[] = [];
        if (outcome.added > 0) parts.push(`${plural(outcome.added, 'change')} added, already accepted`);
        if (outcome.accepted > 0) {
          parts.push(`${plural(outcome.accepted, 'suggestion')} accepted, since you typed exactly that`);
        }
        if (outcome.superseded > 0) {
          parts.push(`${plural(outcome.superseded, 'suggestion')} your edit replaced moved to Unanchored`);
        }
        const summary = parts.length > 0 ? parts.join('; ') : 'suggestions updated';
        notify('info', `Paragraph ${paragraphNumber(key)}: ${summary}.`, 'edit');
      }
    },
    [commitDraft, notify]
  );

  /** The open editor that covers this block, if any, and whether this block is the one that shows it. */
  const draftFor = (block: RenderBlock): { draft: ParagraphDraft; shows: boolean } | null => {
    const draft = Object.values(drafts).find((d) => d.paragraphs.some((p) => block.paragraphs.includes(p)));
    return draft ? { draft, shows: block.paragraphs.includes(draft.key) } : null;
  };

  const showGutter = layout.width >= GUTTER_MIN_WIDTH && gutterComments.length > 0;

  /* Ghosts are laid out by the browser, so collisions between two of them, and
     a ghost running out of the pane or into the margin column, can only be
     found by measuring (item 2, ui.2). The margin column narrows the prose as it
     appears, so its arrival clips at once rather than a frame later, when the
     prose's resize comes back through the observer above. */
  useLayoutEffect(() => {
    clipGhosts(proseRef.current);
  }, [blocks, layout.version, layout.width, showGutter]);

  const marks = useMemo(() => {
    const length = Math.max(1, review.base.text.length);
    return review.hunks
      .filter((h) => h.anchor !== 'stale' && h.status === 'pending')
      .filter((h) => !hiddenCategories.includes(h.category ?? 'other'))
      .map((h) => ({ id: h.id, category: h.category ?? 'other', at: h.start / length }));
  }, [review.hunks, review.base.text.length, hiddenCategories]);

  return (
    <>
      <div
        className={`pane ${showGutter ? 'pane--gutter' : ''} ${locked ? 'pane--locked' : ''}`}
        ref={paneRef}
        aria-busy={locked}
      >
        {/* While a review of this chapter runs, the page is read-only (round 3,
            item 3): its result replaces this working set, so a decision made
            now would vanish when it lands. The status card that says so lives
            outside the scroller, in App, so it cannot scroll away. */}
        <div className="pane__body" inert={locked}>
          <div className="prose" ref={proseRef} onCopy={copyProse}>
            {blocks.map((block) => {
              if (block.isFrontmatter) {
                return (
                  <pre key={block.key} className="frontmatter">
                    {block.segments.map((s) => s.text).join('')}
                  </pre>
                );
              }

              const first = block.paragraphs[0] ?? 0;
              const label = blockLabel(block);
              const commented = block.paragraphs.some((i) => commentedParagraphs.has(i));
              const rail = (
                <span className="para__rail">
                  {/* The number is decoration for sighted readers; the pen's own
                      label carries it for everyone else. */}
                  <span
                    className={`para__num ${commented ? 'para__num--commented' : ''}`}
                    aria-hidden="true"
                    title={commented ? 'This paragraph has a comment' : undefined}
                  >
                    {label}
                  </span>
                </span>
              );

              const open = draftFor(block);
              if (open) {
                if (!open.shows) return null;
                return (
                  <div
                    key={block.key}
                    className="para para--editing"
                    data-paragraph={first}
                    data-start={block.start}
                    data-end={block.end}
                    id={`para-${first}`}
                  >
                    {rail}
                    <ParagraphEditor draft={open.draft} label={label} onDone={finishDraft} />
                  </div>
                );
              }

              /* Margin marks (11.7, small.8): a bar beside each line with a
                 pending small change, an arrowhead beside the line where the
                 focused suggestion starts. Children of the paragraph, placed
                 by CSS anchor positioning on the change's live text. */
              const marks = marginMarks(block.segments, focusedHunkId);
              const markAt = new Map<number, MarginMark>(marks.map((m) => [m.index, m]));
              return (
                <p
                  key={block.key}
                  className={`para ${
                    activeParagraph !== null && block.paragraphs.includes(activeParagraph)
                      ? 'para--active'
                      : ''
                  }`}
                  data-paragraph={first}
                  data-start={block.start}
                  data-end={block.end}
                  id={`para-${first}`}
                >
                  <span className="para__rail">
                    <button
                      type="button"
                      className="para__pen"
                      aria-label={`Edit paragraph ${label}`}
                      title="Edit this paragraph"
                      onClick={() => editParagraph(first)}
                    >
                      <IconPencil size={12} />
                    </button>
                    <span
                      className={`para__num ${commented ? 'para__num--commented' : ''}`}
                      aria-hidden="true"
                      title={commented ? 'This paragraph has a comment' : undefined}
                    >
                      {label}
                    </span>
                  </span>
                  {block.segments.map((segment, index) =>
                    segment.kind === 'text' ? (
                      <span key={`t${index}`}>{segment.text}</span>
                    ) : (
                      <HunkSpan
                        key={segment.hunk.id}
                        hunk={segment.hunk}
                        focused={segment.hunk.id === focusedHunkId}
                        hovered={segment.hunk.id === hoveredHunkId}
                        flushBefore={segment.flushBefore}
                        flushAfter={segment.flushAfter}
                        markAnchor={markAt.has(index) ? markAnchorName(block.key, index) : null}
                        onToggleAccept={toggleAccepted}
                        onToggleDismiss={toggleDismissed}
                        onHover={hoverOn}
                        onHoverEnd={hoverOff}
                      />
                    )
                  )}
                  {marks.map((mark) => (
                    <MarkButton
                      key={`mark-${mark.hunk.id}`}
                      mark={mark}
                      anchor={markAnchorName(block.key, mark.index)}
                      onSelect={focusHunk}
                    />
                  ))}
                </p>
              );
            })}
          </div>
          {showGutter ? (
            <MarginNotes
              comments={gutterComments}
              proseRef={proseRef}
              onSetStatus={onSetCommentStatus}
              layoutKey={layout.version}
            />
          ) : null}
        </div>
      </div>

      {/* Positions of the pending suggestions, as a strip beside the scrollbar
          (plan 5a, item 14). Offsets are proportional to character position,
          which is close enough for a locator and costs no measurement. */}
      <div className="minimap" aria-hidden="true" inert={locked}>
        <div className="minimap__track" style={{ height: layout.height || undefined }}>
          {marks.map((mark) => (
            <button
              key={mark.id}
              type="button"
              tabIndex={-1}
              className={`minimap__mark cat-${mark.category} ${
                mark.id === focusedHunkId ? 'minimap__mark--focused' : ''
              }`}
              style={{ top: `${(mark.at * 100).toFixed(3)}%` }}
              onClick={() => focusHunk(mark.id, { scroll: true })}
            />
          ))}
        </div>
      </div>
    </>
  );
}
