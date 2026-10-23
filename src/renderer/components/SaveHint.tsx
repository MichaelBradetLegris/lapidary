import { useEffect, useLayoutEffect, useRef } from 'react';
import { SAVE_HINT_GOT_IT, saveHintPlacement, type Span } from '../../shared/ui/saveHint';
import { saveHintGivesWay, useSaveHintAside } from '../state/hints';

interface Props {
  /** the toolbar's Save to chapter button, which the arrow points at */
  anchor: React.RefObject<HTMLButtonElement | null>;
  /** `saveHintText` for the chapter on screen */
  text: string;
  /** the side panel is folded, so the hint hangs over the prose (ui.3) */
  overProse: boolean;
  onGotIt: () => void;
}

/**
 * The first-use hint (apply.12): a note hanging under the toolbar with its
 * arrow on Save to chapter. The toolbar decides when it shows
 * (`saveHintVisible`); the words and the placement are in
 * `src/shared/ui/saveHint.ts`.
 *
 * It is placed inside the toolbar, below its last row, so it can never cover
 * one of the toolbar's buttons, whichever row Save to chapter has wrapped onto.
 * It keeps to the side panel's column, so the category chips, the notification
 * cards, the find bar and the chapter's text, all in the column beside it, stay
 * in the clear. In a narrow window, with the panel folded to a strip, that is
 * where the panel's drawer opens, beside the strip, over the edge of the prose
 * (ui.3), so the strip stays in the clear. What it may cover is the top of the
 * side panel, and the find bar's last buttons when a centre column too narrow
 * for the bar lets them spill into the side panel's; with the panel folded, the
 * right end of the chips and the top right of the prose and of the find bar
 * there, until the author goes on, when it gives way (PLAN 7). Got it is the
 * way out. The arrow points only at a part of Save to chapter with no toolbar
 * button under it, or the hint has none.
 *
 * It is measured where it stands and moved by writing its style, as the hover
 * card is, and measured again whenever the toolbar, the button or the columns
 * change size: zoom, a review's progress label, a longer count on the button,
 * the side panel folding or unfolding. It takes no focus, so j, k and the
 * other keys go on working while it shows.
 */
export function SaveHint({ anchor, text, overProse, onGotIt }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  /* Over the prose it gives way once the author goes on (ui.3 review): a press
     anywhere but on the hint sets it aside (`saveHintGivesWay`), and so do a
     review key (keyboard.ts) and a drawer opened from the keyboard
     (state/columns.ts), which read `overProse`. In the capture phase, so a
     press that a handler stops still counts; the press goes on to do what it
     does. Added after the commit that drew the hint, so the press that made the
     first change never counts. */
  useEffect(() => {
    if (!overProse) return undefined;
    useSaveHintAside.setState({ overProse: true });
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      saveHintGivesWay();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      useSaveHintAside.setState({ overProse: false });
    };
  }, [overProse]);

  useLayoutEffect(() => {
    const hint = ref.current;
    const button = anchor.current;
    const bar = hint?.offsetParent;
    if (!hint || !button || !(bar instanceof HTMLElement)) return;

    const place = (): void => {
      const b = bar.getBoundingClientRect();
      const s = button.getBoundingClientRect();
      const span = (r: DOMRect): Span => ({ left: r.left - b.left, right: r.right - b.left });
      // The side panel's column, drawn in place or, folded, its drawer's,
      // open or not, beside the strip (ui.3). The Setup screen and the welcome
      // guide have none, but the hint waits while they are up (`saveHintVisible`).
      const side = document.querySelector('.body .side')?.getBoundingClientRect();
      // The toolbar's items on rows below Save to chapter's.
      const below = [...bar.children]
        .filter((item) => item !== hint && item.getClientRects().length > 0)
        .map((item) => item.getBoundingClientRect())
        .filter((r) => r.top >= s.bottom - 1)
        .map(span);
      const placed = saveHintPlacement({
        barWidth: b.width,
        buttonLeft: s.left - b.left,
        buttonWidth: s.width,
        column: side && side.width > 0 ? span(side) : null,
        below
      });
      hint.style.left = `${placed.left}px`;
      hint.style.width = `${placed.width}px`;
      if (placed.arrow === null) {
        hint.dataset.arrow = 'none';
      } else {
        delete hint.dataset.arrow;
        hint.style.setProperty('--save-hint-arrow', `${placed.arrow}px`);
      }
      hint.style.visibility = 'visible';
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    observer.observe(button);
    observer.observe(hint);
    /* The columns are laid out again after the window's own resize has been
       seen here, when the page has rendered the new layout, and the side
       panel's column can move without the toolbar changing size: folded to a
       strip it moves in from the window's edge (ui.3). Either the panel or the
       centre column beside it changes size whenever that happens. */
    for (const column of document.querySelectorAll('.body .side, .body > .center-col')) {
      observer.observe(column);
    }
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchor, text]);

  return (
    <div ref={ref} className="save-hint" role="status">
      <p className="save-hint__text">{text}</p>
      <div className="save-hint__actions">
        <button type="button" onClick={onGotIt}>
          {SAVE_HINT_GOT_IT}
        </button>
      </div>
    </div>
  );
}
