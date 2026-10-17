import { useLayoutEffect, useRef } from 'react';
import { useApp, type ParagraphDraft } from '../state/store';

interface Props {
  draft: ParagraphDraft;
  /** the label beside the box, e.g. "12" or "12-13" */
  label: string;
  onDone: (key: number) => void;
}

/**
 * One paragraph open for editing, in place of the paragraph itself (Phase 5d).
 *
 * The box holds the paragraph as the page shows it, with every accepted change
 * applied, in the same typeface. It grows with its text rather than scrolling,
 * so a long paragraph stays readable while the author works on it. Nothing is
 * written anywhere until Done: then the changed words become suggestions,
 * already accepted, and go through Save to chapter like everything else.
 */
export function ParagraphEditor({ draft, label, onDone }: Props): React.JSX.Element {
  const setText = useApp((s) => s.setDraftText);
  const cancel = useApp((s) => s.cancelDraft);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const fit = (): void => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
  };

  /* Focus once, on open, and select what the caller asked for (a comment's
     quote). Later renders must not steal the caret back from another box. */
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    fit();
    area.focus({ preventScroll: true });
    if (draft.select) area.setSelectionRange(draft.select.start, draft.select.end);
    else area.setSelectionRange(area.value.length, area.value.length);
    // Only on mount: the draft's text changes on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(fit, [draft.text]);

  const changed = draft.text !== draft.initial;

  return (
    <div className="para-editor">
      <textarea
        ref={areaRef}
        className="para-editor__area"
        value={draft.text}
        spellCheck
        aria-label={`Edit paragraph ${label}`}
        onChange={(event) => setText(draft.key, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel(draft.key);
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onDone(draft.key);
          }
        }}
      />
      <div className="para-editor__foot">
        <span className="para-editor__hint">
          {changed ? 'Ctrl+Enter applies, Esc cancels' : 'Nothing changed yet. Esc closes.'}
        </span>
        <span className="spacer" />
        <button type="button" onClick={() => cancel(draft.key)}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onDone(draft.key)}>
          Done
        </button>
      </div>
    </div>
  );
}
