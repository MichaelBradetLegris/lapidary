/**
 * The ways into editing.
 *
 * These are plain functions rather than hooks because the same actions are
 * reached from the pane, the side panel, a comment card, a tooltip and a key
 * binding, and threading callbacks through all of those would be worse than
 * reading the store directly.
 *
 * Two kinds of edit exist. A suggestion's replacement text is rewritten in the
 * editor popover (item 3a). Prose is edited a whole paragraph at a time, in
 * place, from the pen beside the paragraph (Phase 5d); that replaced editing a
 * mouse selection, which caught stray spaces and fought with clicking a word.
 */

import { paragraphNumber } from '../../shared/prompt/chapter';
import type { ReviewComment } from '../../shared/types';
import { commentEditBlocked } from '../../shared/ui/comments';
import { FULL_EDIT_FREEZES } from '../../shared/ui/modes';
import { hoverCancel } from './hover';
import { scrollToElement } from './scroll';
import { fullEditDraft, inDraft, isLocked, useApp, type AnchorRect } from './store';

function anchorFrom(rect: DOMRect | null): AnchorRect | null {
  if (!rect) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/** Edit one suggestion's replacement text (item 3a). */
export function editHunk(id: string, rect?: DOMRect | null): void {
  const state = useApp.getState();
  const hunk = state.review?.hunks.find((h) => h.id === id);
  if (!hunk || isLocked(state)) return;
  if (inDraft(state.drafts, hunk.paragraph)) {
    state.notify(
      'info',
      fullEditDraft(state.drafts)
        ? FULL_EDIT_FREEZES
        : `Paragraph ${paragraphNumber(hunk.paragraph)} is open for editing. Finish it, or cancel it, to change this suggestion.`
    );
    return;
  }
  hoverCancel();
  const element = document.querySelector(`[data-hunk-id="${id}"]`);
  state.focusHunk(id);
  state.openEditor({
    kind: 'suggestion',
    hunkId: id,
    initial: hunk.replacement,
    anchor: anchorFrom(rect ?? element?.getBoundingClientRect() ?? null)
  });
}

/** Open a paragraph for editing in place and bring it into view. */
export function editParagraph(paragraph: number, select?: { start: number; end: number }): void {
  hoverCancel();
  if (!useApp.getState().openDraft(paragraph, select)) return;
  // The box is rendered on the next frame; scroll to it once it exists.
  requestAnimationFrame(() => {
    scrollToElement(document.getElementById(`para-${paragraph}`), 'nearest');
  });
}

/**
 * "Edit text" on a comment card. It opens the comment's paragraph, with the
 * words the comment quoted already selected when they can be found, since those
 * are the words the author is most likely to change.
 */
export function editFromComment(comment: ReviewComment): void {
  const state = useApp.getState();
  // A comment with no paragraph says why there is none to open (ui.7).
  const blocked = commentEditBlocked(comment);
  if (blocked !== null) {
    state.notify('warn', blocked);
    return;
  }
  const paragraph = comment.paragraph;
  if (!state.review || paragraph === null) return;
  state.setActiveComment(comment.id);
  if (!state.openDraft(paragraph)) return;
  // The box is Main's: from Preview, the window goes back to Main to show it (rr.2).
  if (useApp.getState().viewMode === 'preview') useApp.getState().setViewMode('main');

  const quote = comment.quote;
  const opened = Object.values(useApp.getState().drafts).find((d) => d.paragraphs.includes(paragraph));
  if (opened && quote) {
    const at = opened.text.indexOf(quote);
    // Only a box that has just opened: never move the caret in one being typed in.
    if (at >= 0 && opened.text === opened.initial) {
      const select = { start: at, end: at + quote.length };
      useApp.setState((s) => ({ drafts: { ...s.drafts, [opened.key]: { ...opened, select } } }));
    }
  }
  requestAnimationFrame(() => {
    scrollToElement(document.getElementById(`para-${paragraph}`), 'nearest');
  });
}
