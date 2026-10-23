/**
 * WCAG 2.x colour contrast, for the theme tests (PLAN 11.3 e, `theme.5`).
 *
 * Relative luminance and contrast ratio as WCAG 2.x defines them
 * (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance). The sRGB threshold is
 * 0.04045; WCAG 2.0 and 2.1 quote 0.03928, and the two give the same result for
 * every 8-bit channel value. Colours are sRGB with channels 0 to 255 and alpha
 * 0 to 1.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(\s*([^)]*)\)$/i;

/** A channel, `255` or `100%`. */
function channel(text: string): number {
  const value = text.endsWith('%') ? (parseFloat(text) / 100) * 255 : parseFloat(text);
  if (!Number.isFinite(value) || value < 0 || value > 255) throw new Error(`Not a colour channel: ${text}`);
  return value;
}

/** An alpha, `0.5` or `50%`. */
function alpha(text: string): number {
  const value = text.endsWith('%') ? parseFloat(text) / 100 : parseFloat(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Not an alpha: ${text}`);
  return value;
}

/**
 * A colour as app.css writes one: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb(r g b)`, `rgb(r g b / a)`, or the comma forms of `rgb()` and `rgba()`.
 * Anything else throws, so a token the tests cannot read fails loudly.
 */
export function parseColour(text: string): Rgba {
  const value = text.trim();
  const hex = HEX.exec(value)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    const byte = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return { r: byte(0), g: byte(1), b: byte(2), a: full.length === 8 ? byte(3) / 255 : 1 };
  }
  const args = RGB_FUNCTION.exec(value)?.[1];
  if (args !== undefined) {
    const [colour = '', slash] = args.split('/');
    const parts = colour
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const commaAlpha = slash === undefined && parts.length === 4 ? parts.pop() : undefined;
    if (parts.length !== 3) throw new Error(`Not a colour: ${text}`);
    const [r = '', g = '', b = ''] = parts;
    const a = slash !== undefined ? alpha(slash.trim()) : commaAlpha !== undefined ? alpha(commaAlpha) : 1;
    return { r: channel(r), g: channel(g), b: channel(b), a };
  }
  throw new Error(`Not a colour: ${text}`);
}

/** An sRGB channel, 0 to 255, as linear light, 0 to 1. */
function linear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque colour, 0 for black to 1 for white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** CIELAB of an opaque sRGB colour, under the D65 white sRGB is defined with. */
export function lab({ r, g, b }: Rgb): { l: number; a: number; b: number } {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/**
 * The CIE76 colour difference of two opaque colours, the distance between them
 * in CIELAB: 0 for the same colour, 100 for black and white. Two flat patches
 * side by side are told apart from about 2.3; the theme tests use it for how
 * plainly a translucent band shows on what it covers, which a luminance ratio
 * alone misses when the band differs mostly in hue.
 */
export function deltaE76(p: Rgb, q: Rgb): number {
  const [m, n] = [lab(p), lab(q)];
  return Math.hypot(m.l - n.l, m.a - n.a, m.b - n.b);
}

/** WCAG 2.x contrast ratio of two opaque colours, 1 to 21, in either order. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A colour painted over an opaque one (source-over), as the browser composites it. */
export function over(top: Rgba, bottom: Rgb): Rgb {
  const mix = (t: number, b: number): number => t * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) };
}

/**
 * `color-mix(in srgb, <colour> <percent>, transparent)`: the colour itself at
 * `percent` of its opacity. Mixing with `transparent` interpolates with
 * premultiplied alpha (CSS Color 5), so the hue does not drift towards black.
 */
export function mixWithTransparent(colour: Rgba, percent: number): Rgba {
  if (!(percent >= 0 && percent <= 100)) throw new Error(`Not a percentage: ${percent}`);
  return { ...colour, a: colour.a * (percent / 100) };
}

/** `#rrggbb` for an opaque colour, rounding each channel, for messages. */
export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
