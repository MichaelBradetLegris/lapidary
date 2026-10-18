import { useId, useState } from 'react';
import { COPY_FAILED_TEXT } from '../../shared/ui/setup';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A terminal command the author is meant to run, with a Copy button. Used by the
 * Setup screen and by the "Claude Code is out of date" note. A copy the
 * clipboard refuses says so, on the button and in a line under the command,
 * which a click selects whole for copying by hand (setup.7); it used to fail in
 * silence. The button's name stays "Copy": the command describes it.
 */
export function Command({ text }: { text: string }): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle');
  const id = useId();
  return (
    <div className="cmd">
      <code id={id}>{text}</code>
      <button
        type="button"
        aria-describedby={id}
        onClick={() => {
          setState('idle');
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setState('copied');
              window.setTimeout(() => setState((now) => (now === 'copied' ? 'idle' : now)), 1500);
            })
            .catch(() => setState('failed'));
        }}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
      {state === 'failed' ? (
        <span className="cmd__failed" role="alert">
          {COPY_FAILED_TEXT}
        </span>
      ) : null}
    </div>
  );
}
