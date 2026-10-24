/**
 * The keys of the toolbar's two menus, Review and Actions (`polish.7`, PLAN
 * section 7), and of a category chip's menu (`polish.10`; since `polish.11`
 * the chip is itself a menu button, which opens it with `contextMenuKey` as
 * well): a menu button that opens a list of
 * items, with the keyboard of a proper menu. The button opens the list with Enter or Space, on its first
 * item, or with the down or up arrow, on its first or last; in the list the
 * arrows step through the items, round from the last to the first and back,
 * Home and End go to the first and the last, a letter goes to the next item
 * whose name starts with it, Escape closes the list and gives the focus back
 * to the button, and Tab closes it and goes on from the button. An item that
 * cannot be used now is skipped. Pure, so it is tested in node; the menus
 * themselves are `useMenu` in src/renderer/components/useMenu.tsx, which
 * `ToolbarMenu` and a chip's menu (FilterChips) share.
 */

import { PROVIDER_LABELS, type Provider } from '../types';

/**
 * The toolbar's Review menu: an item for each provider, in `PROVIDERS`'
 * order and named as the review dialog's Provider list names it, each
 * opening Review with AI with that provider chosen (codex.3; one With AI
 * until then, `polish.7`), then Manual, which opens Submit manual review.
 */
export const REVIEW_MENU = { label: 'Review', manual: 'Manual' } as const;

/** What each provider's item in the Review menu says when the pointer is on it. */
export const REVIEW_WITH_TITLES: Readonly<Record<Provider, string>> = {
  claude: 'Review this chapter with Claude, through Claude Code',
  chatgpt: 'Review this chapter with ChatGPT, on your ChatGPT plan'
};

/** The item's label: the provider's, as the review dialog's Provider list gives it. */
export function reviewMenuLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider];
}

/** The toolbar's Actions menu, in Bulk's place: the bulk actions, Copy result and Show backups. */
export const ACTIONS_MENU = 'Actions';

/** Where Setup says a review with Claude starts: the Review menu's Claude. */
export const WITH_CLAUDE_IN_MENU = `${PROVIDER_LABELS.claude}, in the ${REVIEW_MENU.label} menu,`;

/** The parts of a keydown event the menu reads. */
export interface MenuKey {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/** What a key pressed in the open list does. */
export type MenuKeyAction =
  /** move the focus to this item; the key is the menu's */
  | { kind: 'focus'; index: number }
  /** Escape: close the list and give the focus back to the button */
  | { kind: 'close' }
  /** Tab: close the list with the focus on the button, and let Tab go on from there */
  | { kind: 'leave' }
  /** the menu takes the key, and nothing moves (a letter no item starts with) */
  | { kind: 'swallow' }
  /** not the menu's: Enter and Space press the item, and Ctrl+S still saves */
  | { kind: 'pass' };

/**
 * Which items can be used now, in order: every item but one marked disabled.
 * What the arrows, Home, End, a letter and the opening of the list read, so
 * none of them stops on a greyed-out item (`polish.7` review).
 */
export function enabledItems(items: readonly { readonly disabled?: boolean | undefined }[]): boolean[] {
  return items.map((item) => item.disabled !== true);
}

/**
 * The next item that can be used, `step` (1 or -1) from `from`, going round
 * the end of the list; -1 when there is none. From -1 forwards it is the
 * first, and from the list's length backwards the last.
 */
export function nextEnabled(enabled: readonly boolean[], from: number, step: 1 | -1): number {
  const n = enabled.length;
  for (let i = 1; i <= n; i += 1) {
    const index = (((from + step * i) % n) + n) % n;
    if (enabled[index]) return index;
  }
  return -1;
}

/** The first item that can be used, or -1. */
export function firstEnabled(enabled: readonly boolean[]): number {
  return nextEnabled(enabled, -1, 1);
}

/** The last item that can be used, or -1. */
export function lastEnabled(enabled: readonly boolean[]): number {
  return nextEnabled(enabled, enabled.length, -1);
}

/** Whether a key is a letter, a digit or a sign typed as itself, with no modifier but Shift. */
function isTyped(event: MenuKey): boolean {
  return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * What a key pressed on an item of the open list does. `current` is the item
 * with the focus, or -1; `enabled` and `labels` are the items', in order.
 */
export function menuItemKey(
  event: MenuKey,
  current: number,
  enabled: readonly boolean[],
  labels: readonly string[]
): MenuKeyAction {
  if (event.isComposing === true) return { kind: 'pass' };
  const to = (index: number): MenuKeyAction => (index < 0 ? { kind: 'swallow' } : { kind: 'focus', index });
  const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
  switch (event.key) {
    case 'ArrowDown':
      return plain ? to(nextEnabled(enabled, current, 1)) : { kind: 'pass' };
    case 'ArrowUp':
      return plain ? to(nextEnabled(enabled, current < 0 ? enabled.length : current, -1)) : { kind: 'pass' };
    case 'Home':
      return plain ? to(firstEnabled(enabled)) : { kind: 'pass' };
    case 'End':
      return plain ? to(lastEnabled(enabled)) : { kind: 'pass' };
    case 'Escape':
      return { kind: 'close' };
    case 'Tab':
      return plain ? { kind: 'leave' } : { kind: 'pass' };
    default:
      break;
  }
  if (!isTyped(event)) return { kind: 'pass' };
  const letter = event.key.toLowerCase();
  const n = labels.length;
  for (let i = 1; i <= n; i += 1) {
    const index = (((current + i) % n) + n) % n;
    if (enabled[index] && (labels[index] ?? '').toLowerCase().startsWith(letter))
      return { kind: 'focus', index };
  }
  return { kind: 'swallow' };
}

/**
 * What a key pressed on the menu button does: the down arrow opens the list
 * on its first item and the up arrow on its last; anything else is the
 * button's own (Enter and Space press it, which opens the list on its first
 * item) or the page's.
 */
export function menuButtonKey(event: MenuKey): 'first' | 'last' | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing === true) return null;
  if (event.key === 'ArrowDown') return 'first';
  if (event.key === 'ArrowUp') return 'last';
  return null;
}

/**
 * Whether a key opens a context menu: the keyboard's menu key, alone, or
 * Shift+F10, as on Windows (polish.10, a category chip's menu). Chromium also
 * sends a `contextmenu` event for both, on the menu key's release and on
 * Shift+F10's press, which the chip takes as well.
 */
export function contextMenuKey(event: MenuKey & { shiftKey: boolean }): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing === true) return false;
  if (event.key === 'ContextMenu') return !event.shiftKey;
  return event.key === 'F10' && event.shiftKey;
}
