import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { insideBand, placeTooltip, type Span } from '../../shared/ui/tooltip';
import { helpButtonLabel } from '../../shared/ui/settingsDialog';

/** How long the card waits after the pointer leaves, so the pointer can cross the gap onto it. */
const LEAVE_DELAY_MS = 150;

/**
 * The part of the dialog's box where a (?) can be seen: between Settings'
 * head and foot, which stay in view as the box scrolls (polish.4), or the
 * box's own edges where it has none. Null outside a box.
 */
function visibleBand(button: HTMLElement): Span | null {
  const box = button.closest('.modal');
  if (!box) return null;
  const edges = box.getBoundingClientRect();
  const head = box.querySelector('.settings__head')?.getBoundingClientRect();
  const foot = box.querySelector('.settings__foot')?.getBoundingClientRect();
  return { top: head ? head.bottom : edges.top, bottom: foot ? foot.top : edges.bottom };
}

interface Props {
  /** the card's id, which the row's control may also name in its `aria-describedby` */
  id: string;
  /** what the (?) explains, as in "More about <topic>" */
  topic: string;
  text: string;
}

/**
 * The small (?) of a row in Settings (`polish.4`), with the longer
 * explanation the row's one-line note leaves out. It is the row's last cell,
 * `.modal__help`, after the row's buttons, so that every (?) stands in one
 * line at the right of the dialog (polish.15; a row without one keeps the
 * cell empty), and the keyboard reaches it after the row's controls. The card
 * shows while the pointer is over the (?) or over the card itself, and while
 * the (?) has the keyboard's focus (`:focus-visible`), not after a click. It
 * is always in the page, hidden when not shown, so that it is the (?)'s
 * description for a screen reader, and the row's control can point at it
 * too. Escape still closes Settings wherever the focus is (ui.1), the card
 * with it.
 *
 * Placed like the suggestions' hover card (HunkTooltip): `position: fixed`,
 * measured and moved in a layout effect, so showing it never scrolls the
 * dialog, and placed again when anything scrolls or the window is resized.
 * It stands to the left of the (?), over its own row, its top at the (?)'s
 * and kept between the box's head and foot, so it never covers the (?) above
 * or below in the column (polish.19); only where the window is too narrow
 * for it there does it go under the (?), its right edge under the (?)'s, or
 * above when there is no room below (polish.15). While the box has scrolled
 * the (?) under the head or the foot, or out of sight, the card is hidden,
 * though still open, and it shows again once the (?) is back (polish.4
 * review): the keyboard's focus stays on a (?) that Page Down or the wheel
 * scrolls away, and the card would follow it over the title.
 */
export function HelpTip({ id, topic, text }: Props): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [keyFocus, setKeyFocus] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const open = hovered || keyFocus;

  const cancelLeave = (): void => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  const enter = (): void => {
    cancelLeave();
    setHovered(true);
  };
  const leave = (): void => {
    cancelLeave();
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setHovered(false);
    }, LEAVE_DELAY_MS);
  };
  useEffect(() => {
    const timer = leaveTimer;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const tip = tipRef.current;
      const button = buttonRef.current;
      if (!tip || !button) return;
      const at = button.getBoundingClientRect();
      const band = visibleBand(button);
      if (band && !insideBand(at, band)) {
        tip.style.visibility = 'hidden';
        return;
      }
      tip.style.visibility = '';
      tip.style.left = '0px';
      tip.style.top = '0px';
      const size = tip.getBoundingClientRect();
      const placed = placeTooltip(
        { left: at.left, top: at.top, width: at.width, height: at.height },
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
        6,
        8,
        'end',
        { side: 'left', gap: 10, band }
      );
      tip.style.left = `${placed.left}px`;
      tip.style.top = `${placed.top}px`;
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  return (
    <span className="modal__help">
      <button
        type="button"
        className="help"
        ref={buttonRef}
        aria-label={helpButtonLabel(topic)}
        aria-describedby={id}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={(event) => setKeyFocus(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeyFocus(false)}
      >
        ?
      </button>
      <span
        role="tooltip"
        id={id}
        className="help__tip"
        ref={tipRef}
        hidden={!open}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        {text}
      </span>
    </span>
  );
}
