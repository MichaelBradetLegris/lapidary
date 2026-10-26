import type { RefObject } from 'react';
import { pickerHoldsKey } from '../../shared/ui/history';
import { MODE_LABEL, MODE_TITLE, MODES, modeOf } from '../../shared/ui/modes';
import { chooseMode } from '../state/modes';
import { currentMode, useApp } from '../state/store';

interface Props {
  /** the step the chips are drawn at (`CHIP_STEPS`), which the select follows */
  step: number;
  /** its box, whose width the chips' step is decided with (`chipsStep`'s `beside`) */
  boxRef?: RefObject<HTMLDivElement | null> | undefined;
}

/**
 * The Mode select (rr.2, PLAN section 7): Main, Full edit or Preview. Since
 * `rr.6` it is the toolbar's first item, before the eye and the chips, which
 * also decide what the page shows; from `rr.2` it stood at the top right of
 * the prose column, on a strip of its own above the prose. It shows the
 * window's mode, which no setting keeps, and a choice goes through
 * `chooseMode`, which asks first when something typed would be left behind.
 *
 * It is drawn at the chips' step (`data-chip-step`, app.css): its words in
 * the chips' type and the select as tall as a chip, so in a narrow window the
 * two shrink together before the chips' row overflows. FilterChips draws it,
 * as the two share the room the buttons leave (`chipsStep`).
 *
 * Closed, a select changes at once on the arrows, Home, End and the page keys,
 * which here would switch the view at every press, so it holds them back, as
 * the review selector does (`pickerHoldsKey`); Alt+Down, F4 and Space open its
 * list, where they only move the highlight until Enter or a click chooses.
 *
 * A choice that lands in Main or Preview hands the focus back to the page, as
 * the review selector's does, so j, k, a and the arrows act at once: a focused
 * select takes them as typing. Full edit's box takes the focus itself. After
 * Cancel in a question the focus stays on the select.
 */
export function ModeSelect({ step, boxRef }: Props): React.JSX.Element {
  const mode = useApp(currentMode);
  return (
    <div ref={boxRef} className="mode-select" data-chip-step={step}>
      <label className="mode-select__label" htmlFor="mode-select">
        {MODE_LABEL}
      </label>
      <select
        id="mode-select"
        className="mode-select__field"
        value={mode}
        title={MODE_TITLE}
        onKeyDown={(event) => {
          if (pickerHoldsKey(event)) event.preventDefault();
        }}
        onChange={(event) => {
          const select = event.currentTarget;
          const target = modeOf(event.target.value);
          if (!target) return;
          void chooseMode(target).then((switched) => {
            if (switched && target !== 'edit' && document.activeElement === select) select.blur();
          });
        }}
      >
        {MODES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The Mode select at one step, for the copy of the chips out of sight that
 * the step is measured from (`.chips__measure`, FilterChips): its words and a
 * select of the same options, with no id and no handlers, never focused and
 * hidden from screen readers with the rest of the copy. A select is as wide
 * as its longest option, whichever is chosen, so it measures as the one drawn.
 */
export function ModeSelectCopy({ step }: { step: number }): React.JSX.Element {
  return (
    <div className="mode-select" data-chip-step={step}>
      <span className="mode-select__label">{MODE_LABEL}</span>
      <select className="mode-select__field" tabIndex={-1} defaultValue={MODES[0]?.value}>
        {MODES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
