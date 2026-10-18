import { useLayoutEffect, useRef } from 'react';
import { SAVE_HINT_GOT_IT, saveHintPlacement, type Span } from '../../shared/ui/saveHint';

interface Props {
  /** the toolbar's Save to chapter button, which the arrow points at */
  anchor: React.RefObject<HTMLButtonElement | null>;
  /** `saveHintText` for the chapter on screen */
  text: string;
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
 * It keeps to the side panel's column, so the notification cards, the find bar
 * and the chapter's text, all in the column beside it, stay in the clear; what
 * it may cover is the top of the side panel, the chips at that end of their
 * strip, and the find bar's last buttons when a centre column too narrow for
 * the bar lets them spill into the side panel's (PLAN 7). Got it is the way
 * out. The arrow points only at a part of Save to chapter with no toolbar
 * button under it, or the hint has none.
 *
 * It is measured where it stands and moved by writing its style, as the hover
 * card is, and measured again whenever the toolbar or the button changes size:
 * zoom, a review's progress label, a longer count on the button. It takes no
 * focus, so j, k and the other keys go on working while it shows.
 */
export function SaveHint({ anchor, text, onGotIt }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const hint = ref.current;
    const button = anchor.current;
    const bar = hint?.offsetParent;
    if (!hint || !button || !(bar instanceof HTMLElement)) return;

    const place = (): void => {
      const b = bar.getBoundingClientRect();
      const s = button.getBoundingClientRect();
      const span = (r: DOMRect): Span => ({ left: r.left - b.left, right: r.right - b.left });
      // The side panel's column; the Setup screen has none.
      const side = document.querySelector('.body > .side')?.getBoundingClientRect();
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
