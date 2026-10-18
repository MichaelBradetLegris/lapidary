import { useLayoutEffect, useRef } from 'react';
import { editorText, isModalOpen, useApp, type EditorRequest } from '../state/store';

interface Props {
  /** how the result is announced, as a notification card */
  onSaved: (message: string, tone?: 'info' | 'warn') => void;
}

const WIDTH = 380;
const MARGIN = 10;

/**
 * The editor for one suggestion's replacement text (item 3a), opened from the
 * pencil in the tooltip, the focused suggestion's box and each row of the
 * suggestions list.
 * It is a floating panel rather than a modal because the author is editing words
 * they can still see, and it places itself beside them without covering the
 * line. Prose itself is edited a paragraph at a time, in place (Phase 5d).
 *
 * A dialog opened while it is open covers it: every dialog's backdrop is drawn
 * above it (`.modal-backdrop` over `.editor` in app.css), and it is inert until
 * the dialog closes, so it can be neither clicked nor typed in, nor saved with
 * Ctrl+Enter, behind Settings, Review with AI, New chapter or Submit manual
 * review. It keeps its words for when the dialog closes (ui.1 review).
 *
 * The words live in the store (`EditorRequest.text`), not here: the Setup
 * screen takes the main view off the page, this panel with it, and they must
 * be there as typed when it closes, and count for the close question
 * meanwhile (`hasDialogText`, setup.7 review).
 *
 * Saving never writes anything to the chapter. It changes a hunk, which is what
 * keeps an edit reversible and re-anchorable (CLAUDE.md rules 1 and 5).
 */
export function EditPopover({ onSaved }: Props): React.JSX.Element | null {
  const request = useApp((s) => s.editor);
  if (!request) return null;
  // Keyed, so opening the editor on something else starts the textarea afresh
  // rather than copying the new text in from an effect.
  return <EditorPanel key={request.hunkId} request={request} onSaved={onSaved} />;
}

function EditorPanel({ request, onSaved }: Props & { request: EditorRequest }): React.JSX.Element {
  const accept = useApp((s) => s.editorAccept);
  const setAccept = useApp((s) => s.setEditorAccept);
  const close = useApp((s) => s.closeEditor);
  const editHunkText = useApp((s) => s.editHunkText);
  const setText = useApp((s) => s.setEditorText);
  const covered = useApp(isModalOpen);

  /* Words changed here reach no suggestion until Save; the close guard reads
     them from the store while they differ (apply.16, PLAN 11.3 i). */
  const text = editorText(request);
  const panelRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  /* Place the panel beside the words, clamped to the window. Measured after
     layout and written straight to the style, so opening it can never scroll
     the pane out from under the author. Typing keeps the anchor, so only an
     opening places it and selects the words, not every keystroke. */
  const anchor = request.anchor;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const height = panel.offsetHeight;
    const left = anchor
      ? Math.max(MARGIN, Math.min(window.innerWidth - WIDTH - MARGIN, anchor.left))
      : Math.max(MARGIN, (window.innerWidth - WIDTH) / 2);
    const below = anchor ? anchor.top + anchor.height + 8 : 120;
    const top =
      anchor && below + height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, anchor.top - height - 8)
        : below;
    panel.style.left = `${left}px`;
    panel.style.top = `${Math.max(MARGIN, top)}px`;
    panel.style.visibility = 'visible';
    areaRef.current?.focus();
    areaRef.current?.select();
  }, [anchor]);

  const save = (): void => {
    const outcome = editHunkText(request.hunkId, text, accept);

    if (outcome.status === 'blocked') {
      onSaved(outcome.message, 'warn');
    } else if (outcome.status === 'noop') {
      onSaved('That is what it already says, so nothing changed.', 'info');
    } else {
      onSaved(`Suggestion rewritten${accept ? ' and accepted' : ''}.`);
    }
    close();
  };

  return (
    <div
      className="editor"
      ref={panelRef}
      role="dialog"
      aria-label="Edit this suggestion"
      style={{ width: WIDTH }}
      inert={covered}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          save();
        }
      }}
    >
      <div className="editor__head">Edit this suggestion</div>
      <textarea
        ref={areaRef}
        className="editor__area"
        value={text}
        spellCheck
        rows={3}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="editor__foot">
        <label className="editor__accept">
          <input type="checkbox" checked={accept} onChange={(event) => setAccept(event.target.checked)} />
          Accept now
        </label>
        <span className="spacer" />
        <span className="editor__hint">Ctrl+Enter</span>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
