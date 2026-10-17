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

/** Edit: opens the editor popover on a suggestion, a selection or a comment. */
export function IconPencil({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M11.2 2.6 13.4 4.8 5.6 12.6 2.8 13.2 3.4 10.4z" />
      <path d="M9.8 4 12 6.2" />
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

export function IconChevronDown({ size = 12 }: IconProps = {}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}
