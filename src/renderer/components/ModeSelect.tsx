import { pickerHoldsKey } from '../../shared/ui/history';
import {
  MODE_LABEL,
  MODE_TITLE,
  MODES,
  modeOf,
  modeOfLetter,
  modeSelectTyped,
  type Mode
} from '../../shared/ui/modes';
import { chooseMode } from '../state/modes';
import { currentMode, useApp } from '../state/store';

/**
 * The Mode select (rr.2, PLAN section 7): Main, Full edit or Preview. Since
 * `rr.6` it is the toolbar's first item, before the eye and the chips, which
 * also decide what the page shows; from `rr.2` it stood at the top right of
 * the prose column, on a strip of its own above the prose. It shows the
 * window's mode, which no setting keeps, and a choice goes through
 * `chooseMode`, which asks first when something typed would be left behind.
 *
 * Since `rr.8` it carries its own name: each option reads "Mode: Main" and so
 * on, no label stands beside it, and its accessible name is Mode. It has the
 * eye's type and height at every width (app.css), where from `rr.6` it shrank
 * with the chips' steps, which FilterChips drew it at.
 *
 * Closed, a select changes at once on the arrows, Home, End and the page keys,
 * which here would switch the view at every press, so it holds them back, as
 * the review selector does (`pickerHoldsKey`); Alt+Down, F4 and Space open its
 * list, where they only move the highlight until Enter or a click chooses. A
 * character typed is held back from the browser's type-ahead too, which would
 * match every option at m, as each starts "Mode: ", and m, f or p picks Main,
 * Full edit or Preview by its name (`modeSelectTyped`, `modeOfLetter`).
 *
 * A choice that lands in Main or Preview hands the focus back to the page, as
 * the review selector's does, so j, k, a and the arrows act at once: a focused
 * select takes them as typing. Full edit's box takes the focus itself. After
 * Cancel in a question the focus stays on the select.
 */
export function ModeSelect(): React.JSX.Element {
  const mode = useApp(currentMode);
  const choose = (select: HTMLSelectElement, target: Mode): void => {
    void chooseMode(target).then((switched) => {
      if (switched && target !== 'edit' && document.activeElement === select) select.blur();
    });
  };
  return (
    <select
      id="mode-select"
      className="mode-select"
      aria-label={MODE_LABEL}
      value={mode}
      title={MODE_TITLE}
      onKeyDown={(event) => {
        const typed = modeSelectTyped(event);
        if (typed || pickerHoldsKey(event)) event.preventDefault();
        const target = typed ? modeOfLetter(event.key) : null;
        if (target !== null && target !== mode) choose(event.currentTarget, target);
      }}
      onChange={(event) => {
        const target = modeOf(event.currentTarget.value);
        if (target) choose(event.currentTarget, target);
      }}
    >
      {MODES.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
