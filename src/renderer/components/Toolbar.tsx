import { useEffect, useMemo, useRef } from 'react';
import type { Review } from '../../shared/types';
import { SHOW_BACKUPS, SHOW_BACKUPS_TITLE } from '../../shared/ui/backups';
import { chipBulkLabel, chipCategories } from '../../shared/ui/chips';
import { ACTIONS_MENU, REVIEW_MENU } from '../../shared/ui/menu';
import { saveButtonInput, saveButtonState } from '../../shared/ui/save';
import { SAVE_HINT_ID, saveHintText, saveHintVisible } from '../../shared/ui/saveHint';
import { useBulkAction } from '../state/bulk';
import { toolbarFocusLeft, useChipFocus, watchToolbarFocus } from '../state/chipFocus';
import { hintDismissedThisSession, useSaveHintAside } from '../state/hints';
import { changedParagraphCount, isLocked, useApp } from '../state/store';
import { FilterChips } from './FilterChips';
import { SaveHint } from './SaveHint';
import { ToolbarMenu, type MenuItem } from './ToolbarMenu';

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
 * One row, the only bar at the top (polish.10), in the order the author reads
 * it: what can be shown, what can act on it, then what writes it out. The
 * chapter's name and its unsaved dot are in the window's title since
 * `polish.10` (`windowTitle`, set by App), and the category chips took their
 * place: they take the room the buttons leave and give way first, scrolling
 * sideways once they do not fit (FilterChips); once they are down to about
 * 8em, the last buttons move to a second row instead (app.css, `.toolbar`).
 * Model and effort moved into the review dialog, where they are chosen once
 * per review rather than sitting in the way all day (item 6). While the Setup
 * screen or the welcome guide stands in place of the chapter, there are no
 * chips, as there is no text for them to filter.
 *
 * Four controls since `polish.7`: Review, a menu holding With AI and Manual
 * (which open Review with AI and Submit manual review); Actions, a menu
 * holding the three bulk actions, Copy result and Show backups, which left the
 * side panel's footer, and since `polish.10` Accept all and Dismiss all of the
 * category whose chip the focus was last on, while it has not left the
 * toolbar (`useChipFocus`, `watchToolbarFocus`); Save to chapter; and Settings
 * (`ToolbarMenu`).
 * While a review runs, its progress and Cancel come before Review, whose With
 * AI waits until it ends.
 *
 * Save to chapter comes from `saveButtonState` (apply.4), fed by
 * `saveButtonInput` and counted by `unsavedDecisionCount`: the changes the
 * chapter file does not have yet, not every decision made since the review
 * opened. Save to chapter is a primary button only while there are some, or a
 * save of them is under way (`polish.9`): with nothing to save it is an
 * ordinary one, so its turquoise says something is waiting.
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

  /* Accept all and Dismiss all of the chip the focus was last on, in Actions
     too, under the bulk items (polish.10); the chip's own menu holds the same
     two. Only for a chip that is drawn. */
  const chips = useMemo(() => (review ? chipCategories(review.hunks) : []), [review]);
  const lastChip = useChipFocus((s) => s.category);
  const chipShown = review !== null && !singleScreen;
  const focusedChip =
    chipShown && lastChip !== null && chips.some(([category]) => category === lastChip) ? lastChip : null;
  /* The chip is forgotten once the focus leaves the toolbar: `onBlur` below,
     and the page watched for the way out it misses, a menu closed by a press
     outside, whose focused item is gone before the press moves the focus. */
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return undefined;
    return watchToolbarFocus(document, (target) => target instanceof Node && header.contains(target));
  }, []);
  const chipItems: MenuItem[] = focusedChip
    ? [
        {
          label: chipBulkLabel('accept', focusedChip),
          onSelect: () => runBulk('accept', focusedChip),
          disabled: bulkOff,
          title: bulkTitle,
          separated: true
        },
        {
          label: chipBulkLabel('dismiss', focusedChip),
          onSelect: () => runBulk('dismiss', focusedChip),
          disabled: bulkOff,
          title: bulkTitle
        }
      ]
    : [];

  return (
    <header
      ref={headerRef}
      className="toolbar"
      onBlur={(event) => {
        const next = event.relatedTarget;
        toolbarFocusLeft(
          next instanceof Node ? event.currentTarget.contains(next) : null,
          document.hasFocus()
        );
      }}
    >
      {/* Where the chapter's name was (polish.10): the name is in the window's title. */}
      {chipShown ? <FilterChips review={review} bulkOff={bulkOff} bulkTitle={bulkTitle} /> : null}

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
          ...chipItems,
          { label: 'Copy result', onSelect: onCopyResult, separated: true },
          { label: SHOW_BACKUPS, onSelect: onShowBackups, title: SHOW_BACKUPS_TITLE }
        ]}
      />

      {/* Primary, in the turquoise, only while changes are waiting or saving (polish.9). */}
      <button
        ref={saveRef}
        type="button"
        className={save.primary ? 'primary' : undefined}
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
