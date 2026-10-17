import { useLayoutEffect, useRef, useState } from 'react';
import { useApp, type EditorRequest } from '../state/store';

interface Props {
  /** how the result is announced, as a notification card */
  onSaved: (message: string, tone?: 'info' | 'warn') => void;
}

const WIDTH = 380;
const MARGIN = 10;

/**
 * The editor for one suggestion's replacement text (item 3a), opened from the
 * pencil in the tooltip, the details block and each row of the suggestions list.
 * It is a floating panel rather than a modal because the author is editing words
 * they can still see, and it places itself beside them without covering the
 * line. Prose itself is edited a paragraph at a time, in place (Phase 5d).
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

  const [text, setText] = useState(request.initial);
  const panelRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  /* Place the panel beside the words, clamped to the window. Measured after
     layout and written straight to the style, so opening it can never scroll
     the pane out from under the author. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const anchor = request.anchor;
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
  }, [request]);

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
