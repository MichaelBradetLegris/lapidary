import { useRef } from 'react';
import { firstEnabled, lastEnabled, menuButtonKey } from '../../shared/ui/menu';
import { IconChevronDown } from './icons';
import { MenuList } from './MenuList';
import { useMenu, type MenuItem } from './useMenu';

export type { MenuItem } from './useMenu';

interface Props {
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean | undefined;
  title?: string | undefined;
  /**
   * What the button's items open, as its `data-opens`: where a dialog opened
   * from the menu hands the focus back when it closes (ui.4, `polish.7`).
   */
  opens?: string | undefined;
}

/**
 * A button in the toolbar that opens a short list (`polish.7`, PLAN section
 * 7): Review, holding With AI and Manual, and Actions, holding the bulk
 * items, Copy result and Show backups, and, since `polish.10`, Accept all and
 * Dismiss all for the category chip last focused. It behaves as a menu does
 * (`useMenu`, with the keys in src/shared/ui/menu.ts): Enter, Space or a
 * click opens it with the focus on its first item, the down and up arrows on
 * the button open it on the first or the last, the arrows, Home, End and a
 * letter move in it, Escape closes it and gives the focus back to the button,
 * Tab closes it and goes on from the button, and a click outside it closes
 * it. An item puts the focus on the button before it runs.
 */
export function ToolbarMenu({ label, items, disabled = false, title, opens }: Props): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { shown, listId, enabled, ref, openOn, close, focusItem, onBlur, list } = useMenu(
    items,
    buttonRef,
    disabled
  );

  const onButtonKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const where = menuButtonKey(event);
    if (where === null) return;
    // The arrows are the menu's here, not the chapter's (keyboard.ts).
    event.preventDefault();
    event.stopPropagation();
    if (shown) focusItem(where === 'first' ? firstEnabled(enabled) : lastEnabled(enabled));
    else openOn(where);
  };

  return (
    <span className="menu" ref={ref} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        title={title}
        data-opens={opens}
        aria-haspopup="menu"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        onClick={() => (shown ? close(false) : openOn('first'))}
        onKeyDown={onButtonKey}
      >
        {label} <IconChevronDown size={10} />
      </button>
      {shown ? <MenuList id={listId} label={label} items={items} {...list} /> : null}
    </span>
  );
}
