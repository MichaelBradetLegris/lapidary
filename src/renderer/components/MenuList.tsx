import { Fragment, type CSSProperties, type RefObject } from 'react';
import type { MenuItem, MenuListParts } from './useMenu';

interface MenuListProps extends MenuListParts {
  id: string;
  label: string;
  items: readonly MenuItem[];
  /** a class beside `menu__list`, for a list placed by its owner */
  className?: string | undefined;
  /** where its owner places it */
  style?: CSSProperties | undefined;
  listRef?: RefObject<HTMLDivElement | null> | undefined;
}

/**
 * The open list of a menu: `role="menu"` with `role="menuitem"` items that
 * only the arrows reach (`tabIndex={-1}`), and a separator where an item asks
 * for one. A context menu asked for inside it, as the menu key's release sends
 * once its press has opened a chip's list, does nothing.
 */
export function MenuList({
  id,
  label,
  items,
  className,
  style,
  listRef,
  itemRefs,
  run,
  onListKey,
  onListPress
}: MenuListProps): React.JSX.Element {
  return (
    <div
      ref={listRef}
      className={className ? `menu__list ${className}` : 'menu__list'}
      role="menu"
      id={id}
      aria-label={label}
      style={style}
      onKeyDown={onListKey}
      onPointerDown={onListPress}
      onContextMenu={(event) => event.preventDefault()}
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
  );
}
