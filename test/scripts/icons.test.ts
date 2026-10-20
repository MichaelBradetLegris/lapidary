import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng, isPng, type DecodedPng } from '../helpers/png';

/*
 * brand.5: the icon files scripts/make-icons.py writes into resources/icon/,
 * read as they are committed (PLAN C.92). The script needs Pillow, which CI
 * does not have, so this checks its output rather than running it: the .ico's
 * 14 frames, each equal to the PNG of its size, the PNG set from 16 to 1024
 * px, the SVG's gradients, the small spec at 40 px and below, and every edge
 * of the line and the dots on the whole pixels C.92's layout gives, worked out
 * here from the spec's numbers, with the rim at least 1.25 px wide.
 */

const ICON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'icon');
const ICO_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 96, 128, 256];
const PNG_SIZES = [...ICO_SIZES, 512, 1024];
const SMALL_MAX = 40;

// The turquoise palette (PLAN Appendix D 2).
const PALETTE = {
  rimTop: '#5ad3db',
  rimBottom: '#178e9c',
  bodyTop: '#29393c',
  bodyBottom: '#121b1d',
  ghost: '#7d999b',
  line: '#f1efe6',
  dots: '#4fd8e0'
};

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface IcoFrame {
  width: number;
  height: number;
  planes: number;
  bitCount: number;
  data: Buffer;
}

/** The directory of an .ico file and each frame's bytes. */
function readIco(file: string): { type: number; frames: IcoFrame[] } {
  const data = readFileSync(file);
  expect(data.readUInt16LE(0)).toBe(0);
  const type = data.readUInt16LE(2);
  const count = data.readUInt16LE(4);
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    expect(offset + size).toBeLessThanOrEqual(data.length);
    frames.push({
      width: data.readUInt8(entry) || 256,
      height: data.readUInt8(entry + 1) || 256,
      planes: data.readUInt16LE(entry + 4),
      bitCount: data.readUInt16LE(entry + 6),
      data: data.subarray(offset, offset + size)
    });
  }
  return { type, frames };
}

function png(name: string): DecodedPng {
  return decodePng(readFileSync(path.join(ICON, name)));
}

function pixel(image: DecodedPng, x: number, y: number): { colour: Rgb; alpha: number } {
  const at = (y * image.width + x) * 4;
  const b = image.rgba;
  return { colour: [b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0], alpha: b[at + 3] ?? 0 };
}

const ico = readIco(path.join(ICON, 'icon.ico'));

/*
 * PLAN C.92's layout, worked out from 11.3 (o)'s numbers the way
 * make-icons.py works it out: each part's edges in whole pixels of the size
 * drawn (x1 and y1 exclusive), every part centred on one axis, at x = axis2 / 2.
 */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Layout {
  axis2: number;
  ghost: Box | null;
  line: Box;
  dots: Box[];
  /** The rim's width in pixels. */
  rim: number;
}

const SPECS = {
  large: {
    ghost: { width: 0.67 - 0.33, top: 0.32, height: 0.05 },
    line: { width: 0.75 - 0.25, top: 0.43, height: 0.11 },
    dots: { count: 5, diameter: 0.07, gap: 0.045, top: 0.62 }
  },
  small: {
    ghost: null,
    line: { width: 0.75 - 0.25, top: 0.4, height: 0.13 },
    dots: { count: 3, diameter: 0.1, gap: 0.07, top: 0.6 }
  }
};

/** The nearest whole pixel, a half rounded up. */
function snap(value: number): number {
  return Math.floor(value + 0.5);
}

/** Left and right edges of a part about `width` px wide on the axis: the nearest width with axis2's parity, the larger on a tie. */
function centred(width: number, axis2: number): [number, number] {
  const parity = axis2 % 2;
  const low = Math.floor((width - parity) / 2) * 2 + parity;
  const whole = Math.max(width - low < low + 2 - width ? low : low + 2, 2 - parity);
  const left = (axis2 - whole) / 2;
  return [left, left + whole];
}

function layout(size: number): Layout {
  const spec = size <= SMALL_MAX ? SPECS.small : SPECS.large;
  const { count } = spec.dots;
  const diameter = Math.max(1, snap(spec.dots.diameter * size));
  const gap = Math.max(1, snap(spec.dots.gap * size));
  const span = count * diameter + (count - 1) * gap;
  const axis2 = (size - span) % 2 === 0 ? size : size + 1;
  const left = (axis2 - span) / 2;
  const top = snap(spec.dots.top * size);
  const bar = (part: { width: number; top: number; height: number }): Box => {
    const [x0, x1] = centred(part.width * size, axis2);
    const y0 = snap(part.top * size);
    return { x0, y0, x1, y1: y0 + Math.max(1, snap(part.height * size)) };
  };
  return {
    axis2,
    ghost: spec.ghost ? bar(spec.ghost) : null,
    line: bar(spec.line),
    dots: Array.from({ length: count }, (_, i) => {
      const x0 = left + i * (diameter + gap);
      return { x0, y0: top, x1: x0 + diameter, y1: top + diameter };
    }),
    rim: Math.max(0.035 * size, 1.25)
  };
}

/** `count` dots of `diameter` px, `gap` px apart, from (x, y). */
function dotRow(x: number, y: number, diameter: number, gap: number, count: number): Box[] {
  return Array.from({ length: count }, (_, i) => ({
    x0: x + i * (diameter + gap),
    y0: y,
    x1: x + i * (diameter + gap) + diameter,
    y1: y + diameter
  }));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** A gradient's shade at row y, from `top` at the top edge of the canvas to `bottom` at its bottom edge. */
function shade(top: string, bottom: string, size: number, y: number): Rgb {
  const [a, b] = [rgb(top), rgb(bottom)];
  const f = (y + 0.5) / size;
  return [0, 1, 2].map((i) => (a[i] ?? 0) + ((b[i] ?? 0) - (a[i] ?? 0)) * f) as Rgb;
}

/**
 * How much of a colour a pixel holds over the body's shade at its row: 0 for
 * the body, 1 for the colour, about 0.3 for a part whose edge falls 0.3 px
 * into the pixel.
 */
function coverage(image: DecodedPng, x: number, y: number, colour: Rgb): number {
  const ground = shade(PALETTE.bodyTop, PALETTE.bodyBottom, image.width, y);
  const { colour: seen } = pixel(image, x, y);
  let along = 0;
  let length = 0;
  for (const i of [0, 1, 2]) {
    const d = (colour[i] ?? 0) - (ground[i] ?? 0);
    along += ((seen[i] ?? 0) - (ground[i] ?? 0)) * d;
    length += d * d;
  }
  return along / length;
}

/** The runs of opaque pixels along row y, from x0 to x1, that hold more than half of `colour`. */
function runs(image: DecodedPng, y: number, x0: number, x1: number, colour: Rgb): [number, number][] {
  const found: [number, number][] = [];
  let start = -1;
  for (let x = x0; x <= x1; x += 1) {
    // A pixel at the pebble's edge that is mostly transparent can have any colour.
    const on = x < x1 && pixel(image, x, y).alpha >= 128 && coverage(image, x, y, colour) > 0.5;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      found.push([start, x]);
      start = -1;
    }
  }
  return found;
}

/** The x of the centre of `colour` over the boxes, weighted by how much of it each pixel holds. */
function centreX(image: DecodedPng, boxes: Box[], colour: Rgb): number {
  let weight = 0;
  let sum = 0;
  for (const box of boxes) {
    for (const y of range(box.y0, box.y1)) {
      for (const x of range(box.x0, box.x1)) {
        const c = coverage(image, x, y, colour);
        weight += c;
        sum += c * (x + 0.5);
      }
    }
  }
  return sum / weight;
}

// A part edge that falls between two pixels puts as much of its colour into
// the pixel outside as the fraction it covers, 0.3 for 0.3 px. On whole
// pixels the smoothing leaves at most 0.09 there (16 to 1024 px, measured).
const BLEND = 0.15;

describe('icon.ico', () => {
  it('lists the 14 sizes from 16 to 256 px, each a 32-bit frame', () => {
    expect(ico.type).toBe(1);
    expect(ico.frames.map((frame) => frame.width)).toEqual(ICO_SIZES);
    expect(ico.frames.map((frame) => frame.height)).toEqual(ICO_SIZES);
    expect(new Set(ico.frames.map((frame) => frame.bitCount))).toEqual(new Set([32]));
  });

  it('holds each frame as a PNG of the size its entry gives', () => {
    for (const frame of ico.frames) {
      expect(isPng(frame.data)).toBe(true);
      const image = decodePng(frame.data);
      expect([image.width, image.height]).toEqual([frame.width, frame.height]);
    }
  });

  it('has 16, 24 and 32 px frames equal to the PNGs of those sizes', () => {
    for (const size of [16, 24, 32]) {
      const frame = ico.frames.find((f) => f.width === size);
      expect(frame, `${size} px frame`).toBeDefined();
      if (!frame) continue;
      expect(decodePng(frame.data).rgba.equals(png(`icon-${size}.png`).rgba), `${size} px`).toBe(true);
    }
  });

  it('has every other frame equal to its PNG too, drawn at that size', () => {
    for (const frame of ico.frames) {
      expect(
        decodePng(frame.data).rgba.equals(png(`icon-${frame.width}.png`).rgba),
        `${frame.width} px`
      ).toBe(true);
    }
  });
});

describe('the PNGs', () => {
  it('are icon-16.png to icon-1024.png, at the .ico sizes, 512 and 1024, and no others', () => {
    const names = readdirSync(ICON).filter((name) => /^icon-.*\.png$/.test(name));
    const sizes = names.map((name) => Number(/^icon-(\d+)\.png$/.exec(name)?.[1])).sort((a, b) => a - b);
    expect(sizes).toEqual(PNG_SIZES);
    for (const size of PNG_SIZES) {
      const image = png(`icon-${size}.png`);
      expect([image.width, image.height], `icon-${size}.png`).toEqual([size, size]);
      expect(pixel(image, 0, 0).alpha, `icon-${size}.png corner`).toBe(0);
    }
  });

  it('have icon.png as the 1024 render', () => {
    const icon = png('icon.png');
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    expect(icon.rgba.equals(png('icon-1024.png').rgba)).toBe(true);
  });

  it('leave the ghost line out at 40 px and below, and draw it from 48', () => {
    const ghost = rgb(PALETTE.ghost);
    for (const size of PNG_SIZES) {
      const image = png(`icon-${size}.png`);
      let near = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const { colour, alpha } = pixel(image, x, y);
          if (alpha === 255 && distance(colour, ghost) <= 16) near += 1;
        }
      }
      // The ghost is 34% of the side wide and 5% high; half of it at least
      // keeps its colour after the edges are smoothed.
      if (size <= SMALL_MAX) expect(near, `${size} px`).toBe(0);
      else expect(near, `${size} px`).toBeGreaterThanOrEqual(0.34 * size * 0.05 * size * 0.5);
    }
  });

  it('put the line of type on whole pixels at 40 px and below, never blended across a row', () => {
    // Down the middle column, from a quarter of the side to just above the
    // dots, every pixel is the line's cream or the body's shade at that row.
    // The smoothing leaves at most about 25 either way; a line edge that fell
    // between two rows would leave a blend up to 150 away from both.
    const line = rgb(PALETTE.line);
    const top = rgb(PALETTE.bodyTop);
    const bottom = rgb(PALETTE.bodyBottom);
    for (const size of ICO_SIZES.filter((s) => s <= SMALL_MAX)) {
      const image = png(`icon-${size}.png`);
      const x = Math.floor(size / 2);
      for (let y = Math.round(0.25 * size); y < Math.round(0.58 * size); y += 1) {
        const f = (y + 0.5) / size;
        const body: Rgb = [0, 1, 2].map((i) => (top[i] ?? 0) + ((bottom[i] ?? 0) - (top[i] ?? 0)) * f) as Rgb;
        const { colour } = pixel(image, x, y);
        expect(Math.min(distance(colour, line), distance(colour, body)), `${size} px, row ${y}`).toBeLessThan(
          40
        );
      }
    }
  });
});

describe('the parts on whole pixels (PLAN C.92)', () => {
  const images = new Map(PNG_SIZES.map((size) => [size, png(`icon-${size}.png`)]));
  const image = (size: number): DecodedPng => {
    const found = images.get(size);
    if (!found) throw new Error(`no icon-${size}.png`);
    return found;
  };
  const line = rgb(PALETTE.line);
  const dots = rgb(PALETTE.dots);

  it('lays the line and the dots out as C.92 gives them at 16, 24, 32 and 40 px', () => {
    expect(layout(16).line).toEqual({ x0: 4, y0: 6, x1: 12, y1: 8 });
    expect(layout(16).dots).toEqual(dotRow(4, 10, 2, 1, 3));
    expect(layout(24).line).toEqual({ x0: 6, y0: 10, x1: 18, y1: 13 });
    expect(layout(24).dots).toEqual(dotRow(7, 14, 2, 2, 3));
    expect(layout(32).line).toEqual({ x0: 8, y0: 13, x1: 25, y1: 17 });
    expect(layout(32).dots).toEqual(dotRow(10, 19, 3, 2, 3));
    expect(layout(32).axis2).toBe(33);
    expect(layout(40).line).toEqual({ x0: 10, y0: 16, x1: 30, y1: 21 });
    expect(layout(40).dots).toEqual(dotRow(11, 24, 4, 3, 3));
    for (const size of PNG_SIZES) {
      const { axis2, ghost, line: bar, dots: row } = layout(size);
      expect(row, `${size} px`).toHaveLength(size <= SMALL_MAX ? 3 : 5);
      expect(ghost === null, `${size} px`).toBe(size <= SMALL_MAX);
      const first = row[0];
      const last = row[row.length - 1];
      expect(bar.x0 + bar.x1, `${size} px line`).toBe(axis2);
      expect((first?.x0 ?? 0) + (last?.x1 ?? 0), `${size} px dots`).toBe(axis2);
      if (ghost) expect(ghost.x0 + ghost.x1, `${size} px ghost`).toBe(axis2);
    }
  });

  it('draws three dots at 40 px and below and five from 48, each where the layout puts it', () => {
    // Across the whole middle row of the dots, the opaque pixels that are
    // mostly the dots' colour form one run for each dot, from its left edge to
    // its right, with the rim, which is nearly as light, at either end.
    for (const size of PNG_SIZES) {
      const { dots: row } = layout(size);
      const first = row[0];
      if (!first) throw new Error(`${size} px: no dots`);
      const middle = first.y0 + Math.floor((first.y1 - first.y0) / 2);
      const found = runs(image(size), middle, 0, size, dots);
      expect(found.length, `${size} px: the rim, ${row.length} dots and the rim`).toBe(row.length + 2);
      expect(found.slice(1, -1), `${size} px`).toEqual(row.map((box) => [box.x0, box.x1]));
    }
  });

  it('draws no dot over the rim beyond either end of the row', () => {
    // Beyond the row, the dots' rows are the body and then the rim. The dots'
    // colour is lighter than both, so a dot drawn over the rim, as the outer
    // two of five would be at 16 px, makes a pixel greener than the rim: 61
    // over its shade there. The smoothing makes the rim's own edges up to 19
    // greener, measured from 16 to 1024 px.
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { dots: row } = layout(size);
      const first = row[0];
      const last = row[row.length - 1];
      if (!first || !last) throw new Error(`${size} px: no dots`);
      for (const y of range(first.y0, first.y1)) {
        const limit = shade(PALETTE.rimTop, PALETTE.rimBottom, size, y)[1] + 30;
        for (const x of [...range(0, first.x0), ...range(last.x1, size)]) {
          const { colour, alpha } = pixel(icon, x, y);
          if (alpha >= 128) expect(colour[1], `${size} px, (${x}, ${y})`).toBeLessThan(limit);
        }
      }
    }
  });

  it('keeps every edge of the dots on whole pixels, with nothing blended into the gaps or round the row', () => {
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { dots: row } = layout(size);
      const first = row[0];
      const last = row[row.length - 1];
      if (!first || !last) throw new Error(`${size} px: no dots`);
      const rows = range(first.y0, first.y1);
      const column = (x: number): number => mean(rows.map((y) => coverage(icon, x, y, dots)));
      // The column just outside each end of the row, and every column between two dots.
      const outside = [first.x0 - 1, last.x1];
      for (let i = 0; i + 1 < row.length; i += 1)
        outside.push(...range(row[i]?.x1 ?? 0, row[i + 1]?.x0 ?? 0));
      for (const x of outside) expect(column(x), `${size} px, column ${x}`).toBeLessThan(BLEND);
      // The row just above them. The one below is the rim at 16 px, so the
      // bottom edges are checked against the top ones instead.
      const columns = row.flatMap((box) => range(box.x0, box.x1));
      expect(
        mean(columns.map((x) => coverage(icon, x, first.y0 - 1, dots))),
        `${size} px, above`
      ).toBeLessThan(BLEND);
      // A round dot on whole pixels covers its top row as much as its bottom
      // one, and its left column as much as its right.
      for (const box of row) {
        const across = (y: number): number =>
          mean(range(box.x0, box.x1).map((x) => coverage(icon, x, y, dots)));
        const down = (x: number): number =>
          mean(range(box.y0, box.y1).map((y) => coverage(icon, x, y, dots)));
        expect(Math.abs(across(box.y0) - across(box.y1 - 1)), `${size} px, dot at ${box.x0}`).toBeLessThan(
          BLEND
        );
        expect(Math.abs(down(box.x0) - down(box.x1 - 1)), `${size} px, dot at ${box.x0}`).toBeLessThan(BLEND);
      }
    }
  });

  it('keeps all four edges of the line on whole pixels', () => {
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { line: bar } = layout(size);
      const rows = range(bar.y0, bar.y1);
      const columns = range(bar.x0, bar.x1);
      for (const x of [bar.x0 - 1, bar.x1]) {
        expect(mean(rows.map((y) => coverage(icon, x, y, line))), `${size} px, column ${x}`).toBeLessThan(
          BLEND
        );
      }
      for (const y of [bar.y0 - 1, bar.y1]) {
        expect(mean(columns.map((x) => coverage(icon, x, y, line))), `${size} px, row ${y}`).toBeLessThan(
          BLEND
        );
      }
      const middle = bar.y0 + Math.floor((bar.y1 - bar.y0) / 2);
      expect(runs(icon, middle, bar.x0 - 1, bar.x1 + 1, line), `${size} px`).toEqual([[bar.x0, bar.x1]]);
    }
  });

  it('centres the line and the row of dots on the same axis', () => {
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { axis2, line: bar, dots: row } = layout(size);
      expect(Math.abs(centreX(icon, [bar], line) - axis2 / 2), `${size} px line`).toBeLessThan(0.05);
      expect(Math.abs(centreX(icon, row, dots) - axis2 / 2), `${size} px dots`).toBeLessThan(0.05);
    }
  });

  it('keeps the rim at least 1.25 px wide, so that it shows at 16 px', () => {
    // Down the middle column, from the top of the canvas to the first part,
    // each pixel's opacity times how much of the rim's shade it holds over the
    // body's adds up to the rim's width there: measured, 0.13 to 0.21 px over
    // at 40 px and below and within 0.15 px from 48 to 1024. Without the
    // 1.25 px minimum the rim would be 0.56 px wide at 16 px.
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { ghost, line: bar, rim } = layout(size);
      const x = Math.floor(size / 2);
      let width = 0;
      for (const y of range(0, (ghost ?? bar).y0)) {
        const own = coverage(icon, x, y, shade(PALETTE.rimTop, PALETTE.rimBottom, size, y));
        width += (pixel(icon, x, y).alpha / 255) * Math.min(1, Math.max(0, own));
      }
      expect(width, `${size} px`).toBeGreaterThan(rim * 0.99 - 0.15);
      expect(width, `${size} px`).toBeLessThan(rim + 0.4);
    }
  });
});

describe('icon.svg', () => {
  const svg = readFileSync(path.join(ICON, 'icon.svg'), 'utf8');

  it('draws on a 256 canvas', () => {
    expect(svg).toMatch(/<svg [^>]*viewBox="0 0 256 256"/);
  });

  it('runs both gradients down the whole canvas, in the canvas coordinates', () => {
    const gradients = svg.match(/<linearGradient [^>]*>/g) ?? [];
    expect(gradients).toHaveLength(2);
    for (const gradient of gradients) {
      expect(gradient).toContain('gradientUnits="userSpaceOnUse"');
      expect(gradient).toContain('x1="0" y1="0" x2="0" y2="256"');
    }
  });

  it('uses the turquoise palette', () => {
    for (const colour of Object.values(PALETTE)) expect(svg).toContain(`"${colour}"`);
  });
});
