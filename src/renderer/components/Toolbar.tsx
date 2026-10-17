import { useEffect, useRef, useState } from 'react';
import { chapterName } from '../../shared/review';
import type { Review } from '../../shared/types';
import { useBulkAction } from '../state/bulk';
import { isLocked, useApp } from '../state/store';
import { IconChevronDown } from './icons';

interface Props {
  review: Review | null;
  running: boolean;
  progressLabel: string;
  saving: boolean;
  onReviewWithAi: () => void;
  onCancelReview: () => void;
  onManualReview: () => void;
  onSaveChapter: () => void;
  onCopyResult: () => void;
  onSettings: () => void;
}

/**
 * The three bulk actions behind one button (item 6). They are rare, they all
 * ask for confirmation anyway, and each one used to cost a slot in a row that
 * had to fit on a 1100px window.
 */
function BulkMenu({ disabled, title }: { disabled: boolean; title?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const runBulk = useBulkAction();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = (action: 'accept' | 'dismiss' | 'reset'): void => {
    setOpen(false);
    runBulk(action);
  };

  return (
    <span className="menu" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Bulk <IconChevronDown size={10} />
      </button>
      {open ? (
        <div className="menu__list" role="menu">
          <button type="button" role="menuitem" onClick={() => run('accept')}>
            Accept all
          </button>
          <button type="button" role="menuitem" onClick={() => run('dismiss')}>
            Dismiss all
          </button>
          <button type="button" role="menuitem" onClick={() => run('reset')}>
            Reset
          </button>
        </div>
      ) : null}
    </span>
  );
}

/**
 * One row, in the order the author reads it: what is open, what can act on it,
 * then what writes it out. Model and effort moved into the review dialog, where
 * they are chosen once per review rather than sitting in the way all day
 * (item 6).
 */
export function Toolbar({
  review,
  running,
  progressLabel,
  saving,
  onReviewWithAi,
  onCancelReview,
  onManualReview,
  onSaveChapter,
  onCopyResult,
  onSettings
}: Props): React.JSX.Element {
  const dirty = useApp((s) => s.dirty);
  // Read-only while a review of this chapter runs (round 3, item 3).
  const locked = useApp(isLocked);
  const editing = useApp((s) => Object.keys(s.drafts).length);

  const title = review
    ? review.sourcePath
      ? chapterName(review.sourcePath)
      : 'Pasted text'
    : 'No review open';

  return (
    <header className="toolbar">
      <span className="toolbar__title">
        {title}
        {dirty ? <span className="toolbar__dirty" title="Unsaved decisions" /> : null}
      </span>
      <span className="spacer" />

      {running ? (
        <>
          <span className="progress" aria-live="polite">
            {progressLabel}
          </span>
          <button type="button" onClick={onCancelReview}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" disabled={!review?.sourcePath} onClick={onReviewWithAi}>
          Review with AI
        </button>
      )}

      <button
        type="button"
        disabled={!review?.sourcePath || locked}
        title="Paste a corrected version of this chapter and turn the differences into suggestions"
        onClick={onManualReview}
      >
        Submit manual review
      </button>

      <BulkMenu
        disabled={!review || locked || editing > 0}
        {...(editing > 0 ? { title: 'Finish or cancel the paragraphs you are editing first' } : {})}
      />

      <button
        type="button"
        className="primary"
        disabled={!review?.sourcePath || saving || locked}
        title="Write the accepted changes into the chapter file"
        onClick={onSaveChapter}
      >
        {saving ? 'Saving…' : 'Save to chapter'}
      </button>

      <button type="button" disabled={!review} onClick={onCopyResult}>
        Copy result
      </button>

      <button type="button" onClick={onSettings}>
        Settings
      </button>
    </header>
  );
}
