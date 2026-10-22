import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { enabledItems, firstEnabled, lastEnabled, menuButtonKey, menuItemKey } from '../../shared/ui/menu';
import { IconChevronDown } from './icons';

/** One entry of a toolbar menu. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** greyed out and skipped by the arrows */
  disabled?: boolean | undefined;
  title?: string | undefined;
  /** a line above it, between two groups */
  separated?: boolean | undefined;
}

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
 * items, Copy result and Show backups. It behaves as a menu does
 * (`menuItemKey`, `menuButtonKey` in src/shared/ui/menu.ts): Enter, Space or
 * a click opens it with the focus on its first item, the down and up arrows
 * on the button open it on the first or the last, the arrows, Home, End and
 * a letter move in it, Escape closes it and gives the focus back to the
 * button, Tab closes it and goes on from the button, and a click outside it
 * closes it. Keys pressed in it are its own, so a, d, j and the arrows never
 * act on the chapter behind it (keyboard.ts); Ctrl+S still saves. A press in
 * it leaves the focus in it (`onListPress`), so a click on a greyed-out item
 * or between the items does not take its keys away.
 *
 * An item goes with the menu, so the focus moves to the button first: a
 * question or a dialog the item opens then hands it back there when it
 * closes, not to nothing (ui.4).
 */
export function ToolbarMenu({ label, items, disabled = false, title, opens }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  // A button that turns disabled while its list is open, as Review does when
  // a review of this chapter starts, takes its list with it.
  const shown = open && !disabled;
  const enabled = enabledItems(items);

  useEffect(() => {
    if (!shown) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    /* Only an Escape pressed outside the list reaches this: the list takes
       its own keys (`onListKey`). */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The press is the menu's: it closes no drawer as well (keyboard.ts, ui.3).
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [shown]);

  const focusItem = (index: number): void => {
    if (index >= 0) itemRefs.current[index]?.focus({ preventScroll: true });
  };

  /* Drawn at once, so the item to focus is there to take it. */
  const openOn = (where: 'first' | 'last'): void => {
    flushSync(() => setOpen(true));
    focusItem(where === 'first' ? firstEnabled(enabled) : lastEnabled(enabled));
  };

  const close = (giveFocusBack: boolean): void => {
    if (giveFocusBack) buttonRef.current?.focus({ preventScroll: true });
    setOpen(false);
  };

  const run = (item: MenuItem): void => {
    close(true);
    item.onSelect();
  };

  const onButtonKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    const where = menuButtonKey(event);
    if (where === null) return;
    // The arrows are the menu's here, not the chapter's (keyboard.ts).
    event.preventDefault();
    event.stopPropagation();
    if (shown) focusItem(where === 'first' ? firstEnabled(enabled) : lastEnabled(enabled));
    else openOn(where);
  };

  const onListKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const current = itemRefs.current.findIndex((item) => item !== null && item === document.activeElement);
    const action = menuItemKey(
      event,
      current,
      enabled,
      items.map((item) => item.label)
    );
    if (action.kind === 'pass') return;
    // Not the chapter's, the find bar's or a drawer's (keyboard.ts).
    event.stopPropagation();
    if (action.kind === 'leave') {
      // The browser's Tab goes on from the button, forwards or back.
      close(true);
      return;
    }
    event.preventDefault();
    if (action.kind === 'close') close(true);
    else if (action.kind === 'focus') focusItem(action.index);
  };

  /* A press in the list keeps the focus where it is. One that lands on
     nothing that takes the focus, the separator, the list's padding or a
     greyed-out item, would otherwise move it to the page's body with the list
     still open, and the list's keys would then reach the chapter behind it.
     The pointerdown, not the mousedown: Chromium sends a disabled button no
     mousedown, only the pointer events. A click on an item still comes, and
     `run` then puts the focus on the button (`polish.7` review). */
  const onListPress = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  return (
    <span
      className="menu"
      ref={ref}
      onBlur={(event) => {
        // The focus went elsewhere in the page, as a click outside does.
        const next = event.relatedTarget;
        if (shown && next instanceof Node && !ref.current?.contains(next)) setOpen(false);
      }}
    >
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
      {shown ? (
        <div
          className="menu__list"
          role="menu"
          id={listId}
          aria-label={label}
          onKeyDown={onListKey}
          onPointerDown={onListPress}
        >
          {items.map((item, index) => (
            <Fragment key={item.label}>
              {item.separated === true ? <div className="menu__sep" role="separator" /> : null}
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled === true}
                title={item.title}
                onClick={() => run(item)}
              >
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </span>
  );
}
