import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { enabledItems, firstEnabled, lastEnabled, menuItemKey } from '../../shared/ui/menu';

/** One entry of a menu. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** greyed out and skipped by the arrows */
  disabled?: boolean | undefined;
  title?: string | undefined;
  /** a line above it, between two groups */
  separated?: boolean | undefined;
}

/** What `useMenu` gives the component that draws the menu. */
export interface Menu {
  /** the list is drawn */
  shown: boolean;
  listId: string;
  /** which items can be used now (`enabledItems`) */
  enabled: boolean[];
  /** the element holding the opener and the list: a press outside it, or the focus leaving it, closes the list */
  ref: RefObject<HTMLSpanElement | null>;
  openOn: (where: 'first' | 'last') => void;
  close: (giveFocusBack: boolean) => void;
  focusItem: (index: number) => void;
  /** for the holding element's `onBlur` */
  onBlur: (event: React.FocusEvent) => void;
  /** what `MenuList` needs */
  list: MenuListParts;
}

export interface MenuListParts {
  itemRefs: RefObject<(HTMLButtonElement | null)[]>;
  run: (item: MenuItem) => void;
  onListKey: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onListPress: (event: React.PointerEvent<HTMLDivElement>) => void;
}

/**
 * How a menu behaves (`polish.7`, PLAN section 7), for the toolbar's Review
 * and Actions (`ToolbarMenu`) and a category chip's menu (`polish.10`,
 * FilterChips): the keys are worked out in `menuItemKey` (src/shared/ui/menu.ts).
 * Opening it focuses its first item that can be used, or its last; in it the
 * arrows, Home, End and a letter move; Escape closes it and gives the focus
 * back to `invoker`, Tab closes it and goes on from there, and a press outside
 * it closes it. Keys pressed in it are its own, so a, d, j and the arrows never
 * act on the chapter behind it (keyboard.ts); Ctrl+S still saves. A press in
 * it leaves the focus in it (`onListPress`), so a click on a greyed-out item
 * or between the items does not take its keys away.
 *
 * An item goes with the menu, so the focus moves to `invoker` first: a
 * question or a dialog the item opens then hands it back there when it
 * closes, not to nothing (ui.4).
 */
export function useMenu(
  items: readonly MenuItem[],
  invoker: RefObject<HTMLElement | null>,
  disabled = false
): Menu {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  // An opener that turns disabled while its list is open, as Review does when
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
    if (giveFocusBack) invoker.current?.focus({ preventScroll: true });
    setOpen(false);
  };

  const run = (item: MenuItem): void => {
    close(true);
    item.onSelect();
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
      // The browser's Tab goes on from the opener, forwards or back.
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
     `run` then puts the focus on the opener (`polish.7` review). */
  const onListPress = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  /* The focus went elsewhere in the page, as a click outside does. */
  const onBlur = (event: React.FocusEvent): void => {
    const next = event.relatedTarget;
    if (shown && next instanceof Node && !ref.current?.contains(next)) setOpen(false);
  };

  return {
    shown,
    listId,
    enabled,
    ref,
    openOn,
    close,
    focusItem,
    onBlur,
    list: { itemRefs, run, onListKey, onListPress }
  };
}
