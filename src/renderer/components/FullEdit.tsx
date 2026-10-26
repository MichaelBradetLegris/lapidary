import { useLayoutEffect, useMemo, useRef } from 'react';
import { chapterForEdit } from '../../shared/edit';
import { chapterName } from '../../shared/review';
import type { Review } from '../../shared/types';
import { WHOLE_DRAFT_KEY } from '../../shared/ui/drafts';
import {
  FRONTMATTER_LABEL,
  FULL_EDIT_HINT,
  FULL_EDIT_HINT_UNCHANGED,
  fullEditEndKey,
  fullEditLabel,
  fullEditPageEnd,
  fullEditTopPlace
} from '../../shared/ui/modes';
import { cancelFullEdit, finishFullEdit } from '../state/modes';
import { fullEditDraft, useApp } from '../state/store';

interface Props {
  review: Review;
}

/**
 * After Ctrl+Home, Ctrl+End, Page Up or Page Down (`fullEditEndKey`), a caret
 * whose moving end is at the start or the end of the text takes the column
 * the rest of the way to the top or the end of the page, so the frontmatter
 * and the sheet's top margin, or the sheet's foot, show (`fullEditPageEnd`).
 * It does so in the next frame: by then the browser has moved the caret and
 * brought its line into view (the window showed that scroll done before the
 * frame's callbacks run), and nothing of the frame is painted yet, so the
 * page goes there in one step. At the top it stops short when the frontmatter
 * would push the caret's line, the text area's first, out of a column a few
 * lines tall (`fullEditTopPlace`), with the column's scroll padding, 16 px,
 * under the line.
 */
function showPageEnd(area: HTMLTextAreaElement): void {
  const column = area.closest('.center');
  if (!column) return;
  requestAnimationFrame(() => {
    const caret = area.selectionDirection === 'backward' ? area.selectionStart : area.selectionEnd;
    const end = fullEditPageEnd(caret, area.value.length);
    if (end === null) return;
    if (end === 'end') {
      column.scrollTop = column.scrollHeight;
      return;
    }
    const style = getComputedStyle(area);
    const areaTop = area.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop;
    const firstLineBottom = areaTop + parseFloat(style.paddingTop) + parseFloat(style.lineHeight);
    const room = parseFloat(getComputedStyle(column).scrollPaddingTop) || 0;
    column.scrollTop = fullEditTopPlace(firstLineBottom, column.clientHeight, room);
  });
}

/**
 * Full edit (rr.2): the whole chapter as the page reads it, every decision
 * applied and no suggestion marks, to edit at once. Since rr.7 it is drawn as
 * Preview's page, editable: the same sheet (`.fulledit__page`, as
 * `.preview__page`), and in it a plain text area with no border of its own
 * that fills the sheet and grows with the text, so the column scrolls, as
 * Preview's does. It stays a plain `<textarea>`, so what ProWritingAid types
 * into it arrives as ordinary input. The frontmatter stands above the sheet
 * as Main draws it and is not in it, so it cannot be changed here, as a
 * paragraph box never opens on it; the foot, with Done and Cancel, is under
 * the scroller (`FullEditFoot`). Done, or Ctrl+Enter, turns what was typed
 * into the author's own hunks, as a paragraph box's Done does, and goes back
 * to Main; Cancel, or Escape, goes back after asking when something was
 * typed. Nothing reaches the chapter before Save to chapter (CLAUDE.md rule
 * 1). The text is kept on disk as it is typed, as a paragraph box's is
 * (`state/drafts.ts`).
 */
export function FullEdit({ review }: Props): React.JSX.Element | null {
  const draft = useApp((s) => fullEditDraft(s.drafts));
  const setText = useApp((s) => s.setDraftText);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const frontmatter = useMemo(
    () => chapterForEdit(review.base.text, review.hunks).frontmatter,
    [review.base.text, review.hunks]
  );

  /* The text area takes the focus as it opens, its caret at the top, so the
     keyboard goes straight into the chapter; later renders leave the caret
     where the author put it. The column starts at its top (`modePlace`): the
     area grows with the text and never scrolls itself (rr.7). A chapter
     opened from Full edit draws this with no text area until what was kept
     for it is back (rr.5, `fullEditPending`), so the area opens, and takes
     the focus, after this has been drawn. */
  const open = draft !== null;
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!open || !area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(0, 0);
  }, [open]);

  if (!draft) return null;

  return (
    <div className="fulledit">
      {frontmatter !== null ? (
        <pre className="frontmatter fulledit__frontmatter" title={FRONTMATTER_LABEL}>
          {frontmatter}
        </pre>
      ) : null}
      {/* The sheet, as Preview's page; the text area fills it. */}
      <div className="fulledit__page">
        <textarea
          ref={areaRef}
          className="fulledit__area"
          value={draft.text}
          spellCheck
          aria-label={fullEditLabel(chapterName(review.sourcePath))}
          onChange={(event) => setText(WHOLE_DRAFT_KEY, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              void cancelFullEdit();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              finishFullEdit();
            } else if (fullEditEndKey(event)) {
              showPageEnd(event.currentTarget);
            }
          }}
        />
      </div>
    </div>
  );
}

/**
 * Full edit's foot (rr.7): the hint, Cancel and Done, under the sheet. App
 * draws it after the scroller that holds the sheet, not in it, so it stays
 * in reach however far down the chapter the author is, and nothing scrolls
 * when it takes the focus: a foot held at the scroller's foot with `position:
 * sticky` made Chromium scroll the column to the foot's place at the end of
 * the chapter when Tab reached Cancel. Its row is as wide as the sheet and
 * under it (`.fulledit__foot` in app.css). `onPointerDown` is what a press in
 * the scroller does, which closes an open drawer (`closeDrawerOnPress`), so a
 * press on Done or Cancel does that as well as its own work, as it did while
 * the foot was in the scroller.
 */
export function FullEditFoot({ onPointerDown }: { onPointerDown: () => void }): React.JSX.Element | null {
  const draft = useApp((s) => fullEditDraft(s.drafts));
  if (!draft) return null;
  const changed = draft.text !== draft.initial;
  return (
    <div className="fulledit__foot" onPointerDown={onPointerDown}>
      <div className="fulledit__foot-row">
        <span className="fulledit__hint">{changed ? FULL_EDIT_HINT : FULL_EDIT_HINT_UNCHANGED}</span>
        <button type="button" onClick={() => void cancelFullEdit()}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => finishFullEdit()}>
          Done
        </button>
      </div>
    </div>
  );
}
