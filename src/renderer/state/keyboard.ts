import { useEffect } from 'react';
import { sortComments } from '../../shared/ui/comments';
import { saveShortcutAction } from '../../shared/ui/save';
import { arrowsScrollBox } from '../../shared/ui/scroll';
import { splitTakesKey } from '../../shared/ui/split';
import { closeDrawer, inOpenDrawer, popupTakesEscape, useDrawer } from './columns';
import { editHunk } from './edit';
import { saveHintGivesWay } from './hints';
import { SAVE_CARD, type SaveOptions, type SaveOutcome } from './saveChapter';
import { readingRange, scrollToElement } from './scroll';
import { isModalOpen, reviewKeysActive, saveShortcutContext, useApp } from './store';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * Review-pane keys from the plan section 7: j/k move, Shift+J and Shift+K go to
 * the next and previous pending change (11.7, small.9), a accepts, u returns to
 * pending, d toggles dismissed, n jumps to the next commented paragraph.
 * Ctrl+F opens the find bar (item 11) and Escape closes it. Ctrl+S, or Cmd+S,
 * runs Save to chapter (apply.3), wherever the focus is, under the rules of
 * `saveShortcutAction`. None of them acts behind a dialog, a question,
 * Settings or the Setup screen (`reviewKeysActive`, `isModalOpen`; apply.20
 * review).
 */
export function useKeyboardBindings(save: (options: SaveOptions) => Promise<SaveOutcome>): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useApp.getState();

      /* Before the early return for modified keys, and for keys typed in a
         text field too: the rules decide when it does nothing. */
      if (event.ctrlKey || event.metaKey) {
        const target = event.target instanceof Element ? event.target : null;
        const shortcut = saveShortcutAction(
          event,
          saveShortcutContext(state, target?.closest('.para-editor') != null)
        );
        if (shortcut.kind !== 'pass') {
          event.preventDefault();
          if (shortcut.kind === 'card') state.notify('info', shortcut.message, SAVE_CARD);
          else if (shortcut.kind === 'save') void save({ applyDrafts: 'ask' });
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        // Not behind a dialog: the focus would go to the bar behind it.
        if (!state.review || isModalOpen(state)) return;
        state.openFind();
        event.preventDefault();
        // Pressing it again while the bar is open goes back to the box with the
        // query selected, ready to be typed over, as browsers do.
        requestAnimationFrame(() => {
          const input = document.querySelector<HTMLInputElement>('.findbar input');
          input?.focus();
          input?.select();
        });
        return;
      }

      /* While a dialog is open Escape is the dialog's: Settings and Review
         with AI close on it (useDialogEscape), a question cancels, and the
         others ignore it. It never closes the find bar or the suggestion
         editor then (ui.1). A drawer open from a folded column (ui.3) takes
         Escape first when the focus is in it or on its strip, and last
         otherwise, after the suggestion editor and the find bar. One press
         closes one thing: an Escape something else has already taken closes
         no drawer, such as one in the find bar's box, which closes the bar
         before this listener runs (`preventDefault`), and nor does one
         pressed while a toolbar menu or the legend is open, which close on
         it in listeners of their own (`popupTakesEscape`). */
      const drawerEscape =
        event.key === 'Escape' &&
        useDrawer.getState().open !== null &&
        !isModalOpen(state) &&
        !event.defaultPrevented &&
        !popupTakesEscape();
      if (drawerEscape && inOpenDrawer(event.target)) {
        closeDrawer();
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape' && state.editor && !isModalOpen(state)) {
        state.closeEditor();
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape' && state.find.open && !isModalOpen(state)) {
        state.closeFind();
        event.preventDefault();
        return;
      }

      if (drawerEscape) {
        closeDrawer();
        event.preventDefault();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // Nothing behind a dialog, a question, Settings or the Setup screen,
      // with the suggestion editor open, or while a review of this chapter
      // runs (round 3, item 3).
      if (!reviewKeysActive(state)) return;

      const review = state.review;
      if (!review) return;
      const focused = state.focusedHunkId;

      /* The arrows scroll the focused suggestion's box when Tab has put the
         focus in it and it has more to show; j and k still step (ui.5
         review). The browser does the scrolling. */
      if (arrowsScrollBox(event.key, event.target instanceof HTMLElement ? event.target : null)) return;
      /* The arrows move the side panel's split when its handle has the focus
         (ui.6); the handle has already moved. */
      if (splitTakesKey(event.key, event.target instanceof HTMLElement ? event.target : null)) return;

      /* Letters by their lower case, so Caps Lock does not turn the keys off;
         Shift is read from the event. Shift+J and Shift+K go to the next and
         previous pending change; with any other letter Shift does nothing,
         as before. j, k and the arrows start from the paragraphs on screen
         when the focus is not on screen (11.7, small.9). */
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const step = key === 'j' || key === 'k' || key === 'ArrowDown' || key === 'ArrowUp';
      if (!step && key.length === 1 && event.shiftKey) return;
      const view = (): ReturnType<typeof readingRange> => readingRange(document.querySelector('.center'));

      switch (key) {
        case 'j':
        case 'ArrowDown':
          state.moveFocus(1, { pendingOnly: key === 'j' && event.shiftKey, view: view() });
          break;
        case 'k':
        case 'ArrowUp':
          state.moveFocus(-1, { pendingOnly: key === 'k' && event.shiftKey, view: view() });
          break;
        case 'a':
          if (focused) state.setHunkStatus(focused, 'accepted');
          break;
        case 'u':
          if (focused) state.setHunkStatus(focused, 'pending');
          break;
        case 'd':
          if (focused) state.toggleDismissed(focused);
          break;
        /* e rewrites the focused suggestion (item 3a). Prose is edited from the
           pen beside each paragraph (Phase 5d). */
        case 'e':
          if (focused) editHunk(focused);
          break;
        case 'n': {
          // In reading order, so "next" is the nearest comment below, not
          // whichever one the model happened to write down first.
          const open = sortComments(review.comments).filter(
            (c) => c.status === 'open' && c.paragraph !== null
          );
          if (open.length === 0) return;
          const current = focused ? (review.hunks.find((h) => h.id === focused)?.paragraph ?? -1) : -1;
          const next = open.find((c) => (c.paragraph ?? 0) > current) ?? open[0];
          if (next) {
            state.setActiveComment(next.id);
            const el = document.getElementById(`para-${next.paragraph ?? 0}`);
            scrollToElement(el, 'center');
          }
          break;
        }
        default:
          return;
      }
      event.preventDefault();
      // The author goes on: a first-use hint over the prose gives way (ui.3).
      saveHintGivesWay();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);
}
