import { useRef } from 'react';
import { chapterName } from '../../shared/review';
import type { Review } from '../../shared/types';
import { SHOW_BACKUPS, SHOW_BACKUPS_TITLE } from '../../shared/ui/backups';
import { ACTIONS_MENU, REVIEW_MENU } from '../../shared/ui/menu';
import { saveButtonInput, saveButtonState, unsavedDotLabel } from '../../shared/ui/save';
import { SAVE_HINT_ID, saveHintText, saveHintVisible } from '../../shared/ui/saveHint';
import { useBulkAction } from '../state/bulk';
import { hintDismissedThisSession, useSaveHintAside } from '../state/hints';
import { changedParagraphCount, isLocked, useApp } from '../state/store';
import { SaveHint } from './SaveHint';
import { ToolbarMenu } from './ToolbarMenu';

interface Props {
  review: Review | null;
  running: boolean;
  progressLabel: string;
  saving: boolean;
  /** the side panel is folded to a strip, so the first-use hint hangs over the prose (ui.3) */
  sideFolded: boolean;
  /**
   * the Setup screen or the welcome guide stands in place of the chapter, so
   * the first-use hint waits (`setup.11` review)
   */
  singleScreen: boolean;
  onReviewWithAi: () => void;
  onCancelReview: () => void;
  onManualReview: () => void;
  onSaveChapter: () => void;
  onCopyResult: () => void;
  /** open the chapter's backup folder (apply.11), from Actions since `polish.7` */
  onShowBackups: () => void;
  onSettings: () => void;
  /** Got it on the first-use hint: put it away for good (apply.12) */
  onSaveHintDone: () => void;
}

/**
 * One row, in the order the author reads it: what is open, what can act on it,
 * then what writes it out. Model and effort moved into the review dialog, where
 * they are chosen once per review rather than sitting in the way all day
 * (item 6). The chapter name takes the room the buttons leave and gives way
 * first, cut short with an ellipsis; once it is down to about 8em, the last
 * buttons move to a second row instead (app.css, `.toolbar`).
 *
 * Four controls since `polish.7`: Review, a menu holding With AI and Manual
 * (which open Review with AI and Submit manual review); Actions, a menu
 * holding the three bulk actions, Copy result and Show backups, which left the
 * side panel's footer; Save to chapter; and Settings (`ToolbarMenu`). While a
 * review runs, its progress and Cancel come before Review, whose With AI waits
 * until it ends.
 *
 * Save to chapter and the dot before the chapter name come from
 * `saveButtonState` (apply.4), fed by `saveButtonInput` and counted by
 * `unsavedDecisionCount`: the changes the chapter file does not have yet, not
 * every decision made since the review opened.
 *
 * The first time one of those changes is waiting, a hint hangs under the
 * toolbar with its arrow on Save to chapter, until Got it or a save puts it
 * away for good (apply.12, `saveHintVisible`). With the side panel folded it
 * hangs over the prose, and gives way there (ui.3 review); while the Setup
 * screen or the welcome guide is up it waits (`setup.11` review).
 */
export function Toolbar({
  review,
  running,
  progressLabel,
  saving,
  sideFolded,
  singleScreen,
  onReviewWithAi,
  onCancelReview,
  onManualReview,
  onSaveChapter,
  onCopyResult,
  onShowBackups,
  onSettings,
  onSaveHintDone
}: Props): React.JSX.Element {
  // Read-only while a review of this chapter runs (round 3, item 3).
  const locked = useApp(isLocked);
  const editing = useApp((s) => Object.keys(s.drafts).length);
  const changedParagraphs = useApp((s) => changedParagraphCount(s.drafts));
  const runBulk = useBulkAction();

  const input = saveButtonInput({ review, changedParagraphs, saving, locked });
  const save = saveButtonState(input);
  const dotLabel = unsavedDotLabel(input.unsavedDecisions);

  const dismissedHints = useApp((s) => s.settings?.dismissedHints ?? null);
  const hintSetAside = useSaveHintAside((s) => s.setAside);
  const saveRef = useRef<HTMLButtonElement>(null);
  const hint = saveHintVisible({
    dismissedHints,
    dismissedThisSession: hintDismissedThisSession(SAVE_HINT_ID),
    hasChapter: input.hasChapter,
    unsavedDecisions: input.unsavedDecisions,
    locked,
    saving,
    sideFolded,
    editingParagraph: editing > 0,
    singleScreen,
    setAside: hintSetAside
  });

  /* The bulk actions wait while a review of this chapter runs, and while a
     paragraph is open for editing, whose suggestions they would skip or change
     under it (`useBulkAction`). */
  const bulkOff = locked || editing > 0;
  const bulkTitle = editing > 0 ? 'Finish or cancel the paragraphs you are editing first' : undefined;

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
      ) : null}

      {/* Where the focus goes when Review with AI or Submit manual review
          closes (REVIEW_BUTTON_SELECTOR, ui.4). */}
      <ToolbarMenu
        label={REVIEW_MENU.label}
        opens="review"
        disabled={!review?.sourcePath || locked}
        items={[
          {
            label: REVIEW_MENU.withAi,
            onSelect: onReviewWithAi,
            // One review at a time: one of another chapter is running.
            disabled: running,
            title: running ? 'Wait until the review that is running ends, or cancel it' : undefined
          },
          {
            label: REVIEW_MENU.manual,
            onSelect: onManualReview,
            title: 'Paste a corrected version of this chapter and turn the differences into suggestions'
          }
        ]}
      />

      <ToolbarMenu
        label={ACTIONS_MENU}
        disabled={!review}
        items={[
          { label: 'Accept all', onSelect: () => runBulk('accept'), disabled: bulkOff, title: bulkTitle },
          { label: 'Dismiss all', onSelect: () => runBulk('dismiss'), disabled: bulkOff, title: bulkTitle },
          { label: 'Reset', onSelect: () => runBulk('reset'), disabled: bulkOff, title: bulkTitle },
          { label: 'Copy result', onSelect: onCopyResult, separated: true },
          { label: SHOW_BACKUPS, onSelect: onShowBackups, title: SHOW_BACKUPS_TITLE }
        ]}
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

      {/* Where the focus goes when Settings closes (SETTINGS_BUTTON_SELECTOR, ui.1). */}
      <button type="button" data-opens="settings" onClick={onSettings}>
        Settings
      </button>

      {hint && review ? (
        <SaveHint
          anchor={saveRef}
          text={saveHintText(review.sourcePath)}
          overProse={sideFolded}
          onGotIt={onSaveHintDone}
        />
      ) : null}
    </header>
  );
}
