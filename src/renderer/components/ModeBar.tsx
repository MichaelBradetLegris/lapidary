import { pickerHoldsKey } from '../../shared/ui/history';
import { MODE_LABEL, MODE_TITLE, MODES, modeOf } from '../../shared/ui/modes';
import { chooseMode } from '../state/modes';
import { currentMode, useApp } from '../state/store';

/**
 * The Mode select (rr.2, PLAN section 7): Main, Full edit or Preview, at the
 * top right of the prose column, inside it and above the prose, where the
 * author's screenshot put it; the toolbar stays as it was. It shows the
 * window's mode, which no setting keeps, and a choice goes through
 * `chooseMode`, which asks first when something typed would be left behind.
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
export function ModeBar(): React.JSX.Element {
  const mode = useApp(currentMode);
  return (
    <div className="modebar">
      <label className="modebar__label" htmlFor="mode-select">
        {MODE_LABEL}
      </label>
      <select
        id="mode-select"
        className="modebar__select"
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
