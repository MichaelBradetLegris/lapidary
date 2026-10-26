/**
 * Inline SVG icons.
 *
 * Every glyph the UI draws as a control is an SVG path rather than a character.
 * A literal multiplication sign once reached the author's screen as "Ã—" because
 * the source had been round-tripped through Windows-1252, and a path cannot be
 * mis-decoded that way (item 1). Where a character is genuinely wanted in prose,
 * the source uses a \uXXXX escape.
 */

interface IconProps {
  /** side length in px; icons are square and inherit the current colour */
  size?: number;
}

function svgProps(size: number): {
  width: number;
  height: number;
  viewBox: string;
  fill: 'none';
  stroke: 'currentColor';
  strokeWidth: number;
  strokeLinecap: 'round';
  strokeLinejoin: 'round';
  'aria-hidden': true;
  focusable: 'false';
} {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: 'false'
  };
}

export function IconX({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
    </svg>
  );
}

export function IconCheck({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 8.6 6.4 12 13 4.5" />
    </svg>
  );
}

export function IconUndo({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 7.5h7a3 3 0 1 1 0 6H6.5" />
      <path d="M5.5 4.5 2.6 7.5l2.9 3" />
    </svg>
  );
}

/** Marks a ghost that is a suggestion rather than a replaced original. */
export function IconArrow({ size = 10 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M2.5 8h11M9.5 4.5 13.5 8l-4 3.5" />
    </svg>
  );
}

/**
 * Edit: opens the editor popover on a suggestion, a selection or a comment.
 *
 * One path, the outline and the ferrule's line as two subpaths, so its stroke
 * is painted once: a faded row button draws it in a translucent ink
 * (polish.14), and as two paths the ink built up where the line's ends meet
 * the outline, two darker spots on every faded pencil.
 */
export function IconPencil({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M11.2 2.6 13.4 4.8 5.6 12.6 2.8 13.2 3.4 10.4zM9.8 4 12 6.2" />
    </svg>
  );
}

/** Choose the manuscript folder, beside the Chapters heading (item 7a). */
export function IconFolder({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M2 12.5v-9h4l1.5 2h6.5v7z" />
    </svg>
  );
}

/** New chapter (item 7a). */
export function IconPlus({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconMinus({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 8h10" />
    </svg>
  );
}

export function IconChevronUp({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.5 10 8 5.5 12.5 10" />
    </svg>
  );
}

/** A folded column's strip (ui.3): the way its drawer opens or closes. */
export function IconChevronRight({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function IconChevronLeft({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

/** The review selector's mark when the review on screen is not the newest (apply.26). */
export function IconWarning({ size = 14 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 2.3 14.2 13.2H1.8z" />
      <path d="M8 6.5v3.1M8 11.4v.1" />
    </svg>
  );
}

export function IconChevronDown({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

/** The eye before the category chips while every category is shown (polish.11). */
export function IconEye({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M1.3 8C2.9 5.1 5.3 3.6 8 3.6s5.1 1.5 6.7 4.4c-1.6 2.9-4 4.4-6.7 4.4S2.9 10.9 1.3 8Z" />
      <circle cx="8" cy="8" r="2.1" />
    </svg>
  );
}

/** The eye closed, while some category is hidden (polish.11): a lid and three lashes. */
export function IconEyeClosed({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M1.6 6.4c1.6 2.5 3.8 3.8 6.4 3.8s4.8-1.3 6.4-3.8" />
      <path d="M3.9 9.3 2.7 11M8 10.2v2.1M12.1 9.3l1.2 1.7" />
    </svg>
  );
}

/**
 * Full screen (polish.23): two arrows out to opposite corners, the system's
 * sign for it.
 */
export function IconFullScreen({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M9.5 2.5h4v4M13.5 2.5 9.3 6.7M6.5 13.5h-4v-4M2.5 13.5l4.2-4.2" />
    </svg>
  );
}

/** Leave full screen (polish.23): the same two arrows, pointing back in from the corners. */
export function IconLeaveFullScreen({ size = 16 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M13.5 2.5 9.5 6.5M9.5 2.5v4h4M2.5 13.5l4-4M2.5 9.5h4v4" />
    </svg>
  );
}
