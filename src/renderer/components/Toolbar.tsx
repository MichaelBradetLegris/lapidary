import { useEffect, useRef, useState } from 'react';
import { chapterName } from '../../shared/review';
import type { Review } from '../../shared/types';
import { saveButtonInput, saveButtonState, unsavedDotLabel } from '../../shared/ui/save';
import { SAVE_HINT_ID, saveHintText, saveHintVisible } from '../../shared/ui/saveHint';
import { useBulkAction } from '../state/bulk';
import { hintDismissedThisSession } from '../state/hints';
import { changedParagraphCount, isLocked, useApp } from '../state/store';
import { IconChevronDown } from './icons';
import { SaveHint } from './SaveHint';

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
  /** Got it on the first-use hint: put it away for good (apply.12) */
  onSaveHintDone: () => void;
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
 * (item 6). The chapter name takes the room the buttons leave and gives way
 * first, cut short with an ellipsis; once it is down to about 8em, the last
 * buttons move to a second row instead (app.css, `.toolbar`).
 *
 * Save to chapter and the dot before the chapter name come from
 * `saveButtonState` (apply.4), fed by `saveButtonInput` and counted by
 * `unsavedDecisionCount`: the changes the chapter file does not have yet, not
 * every decision made since the review opened.
 *
 * The first time one of those changes is waiting, a hint hangs under the
 * toolbar with its arrow on Save to chapter, until Got it or a save puts it
 * away for good (apply.12, `saveHintVisible`).
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
  onSettings,
  onSaveHintDone
}: Props): React.JSX.Element {
  // Read-only while a review of this chapter runs (round 3, item 3).
  const locked = useApp(isLocked);
  const editing = useApp((s) => Object.keys(s.drafts).length);
  const changedParagraphs = useApp((s) => changedParagraphCount(s.drafts));

  const input = saveButtonInput({ review, changedParagraphs, saving, locked });
  const save = saveButtonState(input);
  const dotLabel = unsavedDotLabel(input.unsavedDecisions);

  const dismissedHints = useApp((s) => s.settings?.dismissedHints ?? null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const hint = saveHintVisible({
    dismissedHints,
    dismissedThisSession: hintDismissedThisSession(SAVE_HINT_ID),
    hasChapter: input.hasChapter,
    unsavedDecisions: input.unsavedDecisions,
    locked,
    saving
  });

  const title = review
    ? review.sourcePath
      ? chapterName(review.sourcePath)
      : 'Pasted text'
    : 'No review open';

  return (
    <header className="toolbar">
      <span className="toolbar__title">
        {save.dot ? <span className="unsaved-dot" role="img" aria-label={dotLabel} title={dotLabel} /> : null}
        <span className="toolbar__name" title={title}>
          {title}
        </span>
      </span>

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
        ref={saveRef}
        type="button"
        className="primary"
        disabled={save.disabled}
        title={save.title}
        onClick={onSaveChapter}
      >
        {save.label}
      </button>

      <button type="button" disabled={!review} onClick={onCopyResult}>
        Copy result
      </button>

      <button type="button" onClick={onSettings}>
        Settings
      </button>

      {hint && review ? (
        <SaveHint anchor={saveRef} text={saveHintText(review.sourcePath)} onGotIt={onSaveHintDone} />
      ) : null}
    </header>
  );
}
