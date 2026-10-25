import { useLayoutEffect, useMemo, useRef } from 'react';
import { chapterForEdit } from '../../shared/edit';
import { chapterName } from '../../shared/review';
import type { Review } from '../../shared/types';
import { WHOLE_DRAFT_KEY } from '../../shared/ui/drafts';
import {
  FRONTMATTER_LABEL,
  FULL_EDIT_HINT,
  FULL_EDIT_HINT_UNCHANGED,
  fullEditLabel
} from '../../shared/ui/modes';
import { cancelFullEdit, finishFullEdit } from '../state/modes';
import { fullEditDraft, useApp } from '../state/store';

interface Props {
  review: Review;
}

/**
 * Full edit (rr.2): the whole chapter in one box, the height of the prose
 * column, in the prose's typeface, as the page reads it with every decision
 * applied and no suggestion marks. The frontmatter stands above the box as
 * Main draws it and is not in it, so it cannot be changed here, as a
 * paragraph box never opens on it. Done, or Ctrl+Enter, turns what was typed
 * into the author's own hunks, as a paragraph box's Done does, and goes back
 * to Main; Cancel, or Escape, goes back after asking when something was
 * typed. Nothing reaches the chapter before Save to chapter (CLAUDE.md rule
 * 1). The box is kept on disk as it is typed in, as a paragraph box is
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

  /* The box takes the focus as it opens, its caret at the top, so the
     keyboard goes straight into the chapter; later renders leave the caret
     where the author put it. A chapter opened from Full edit draws this with
     no box until what was kept for it is back (rr.5, `fullEditPending`), so
     the box opens, and takes the focus, after this has been drawn. */
  const open = draft !== null;
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!open || !area) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(0, 0);
    area.scrollTop = 0;
  }, [open]);

  if (!draft) return null;
  const changed = draft.text !== draft.initial;

  return (
    <div className="fulledit">
      {frontmatter !== null ? (
        <pre className="frontmatter fulledit__frontmatter" title={FRONTMATTER_LABEL}>
          {frontmatter}
        </pre>
      ) : null}
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
          }
        }}
      />
      <div className="fulledit__foot">
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
