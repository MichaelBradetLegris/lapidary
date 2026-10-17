import { useEffect, useRef } from 'react';
import { matchLabel } from '../../shared/ui/find';
import { useApp } from '../state/store';
import { IconChevronDown, IconChevronUp, IconX } from './icons';

/**
 * The find bar at the top of the manuscript pane (item 11). Enter steps forward,
 * Shift+Enter back, Escape closes. The input keeps focus while stepping so the
 * author can type, page through matches, and close without reaching for a mouse.
 */
export function FindBar(): React.JSX.Element | null {
  const find = useApp((s) => s.find);
  const setQuery = useApp((s) => s.setFindQuery);
  const step = useApp((s) => s.stepFind);
  const close = useApp((s) => s.closeFind);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (find.open) inputRef.current?.focus();
  }, [find.open]);

  if (!find.open) return null;

  return (
    <div className="findbar">
      <input
        ref={inputRef}
        type="text"
        value={find.query}
        placeholder="Find in chapter"
        aria-label="Find in chapter"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          }
        }}
      />
      <span className="findbar__count">{matchLabel(find.index, find.count, find.query)}</span>
      <button type="button" aria-label="Previous match" disabled={find.count === 0} onClick={() => step(-1)}>
        <IconChevronUp />
      </button>
      <button type="button" aria-label="Next match" disabled={find.count === 0} onClick={() => step(1)}>
        <IconChevronDown />
      </button>
      <button type="button" aria-label="Close find bar" onClick={close}>
        <IconX />
      </button>
    </div>
  );
}
