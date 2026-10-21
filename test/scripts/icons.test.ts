import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePng, isPng, type DecodedPng } from '../helpers/png';

/*
 * brand.5 and brand.6: the icon files scripts/make-icons.py writes into
 * resources/icon/, read as they are committed (PLAN C.92). The script needs
 * Pillow, which CI does not have, so this checks its output rather than
 * running it: the .ico's 14 frames, each equal to the PNG of its size, the PNG
 * set from 16 to 1024 px, the pebble's width, height, place and tilt, the
 * small spec at 40 px and below, every edge of the ghost, the line and the
 * dots on the whole pixels C.92's layout gives, worked out here from the
 * spec's numbers, the rim at least 1.25 px wide, and the SVG's shapes and
 * gradients.
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

// brand.6's spec: the large one scaled with the larger pebble, the small one
// with a taller line and larger dots for the taskbar (PLAN 11.3 (o), C.92).
const SPECS = {
  large: {
    ghost: { width: 0.6811 - 0.3189, top: 0.2982, height: 0.0564 },
    line: { width: 0.7663 - 0.2337, top: 0.4223, height: 0.1241 },
    dots: { count: 5, diameter: 0.0767, gap: 0.0452, top: 0.6378 }
  },
  small: {
    ghost: null,
    line: { width: 0.75 - 0.25, top: 0.37, height: 0.16 },
    dots: { count: 3, diameter: 0.13, gap: 0.07, top: 0.6 }
  }
};

// The pebble, in fractions of the side (PLAN 11.3 (o)): since brand.6 it fills
// the frame as the other icons on the taskbar do.
const PEBBLE = { cx: 0.5, cy: 0.52, a: 0.49, bTop: 0.47, bBottom: 0.41, n: 2.6, rotation: -5 };

/**
 * The pebble's outline at `size` px as make-icons.py works it out, each
 * semi-axis shortened by `inset` of the side (the body's outline is inset by
 * the rim), from 720 points for the rasters or 360 for the SVG.
 */
function pebbleOutline(size: number, inset = 0, count = 720): [number, number][] {
  const { cx, cy, a, bTop, bBottom, n, rotation } = PEBBLE;
  const rot = (rotation * Math.PI) / 180;
  return Array.from({ length: count }, (_, i): [number, number] => {
    const t = (2 * Math.PI * i) / count;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const x = (a - inset) * Math.sign(c) * Math.abs(c) ** (2 / n);
    const y = (s > 0 ? bBottom - inset : bTop - inset) * Math.sign(s) * Math.abs(s) ** (2 / n);
    return [
      (cx + x * Math.cos(rot) - y * Math.sin(rot)) * size,
      (cy + x * Math.sin(rot) + y * Math.cos(rot)) * size
    ];
  });
}

/** The centre of the area inside a closed outline (the shoelace formulas). */
function outlineCentre(points: [number, number][]): { x: number; y: number } {
  let area = 0;
  let x = 0;
  let y = 0;
  points.forEach(([x0, y0], i) => {
    const [x1, y1] = points[(i + 1) % points.length] ?? points[0] ?? [0, 0];
    const cross = x0 * y1 - x1 * y0;
    area += cross / 2;
    x += ((x0 + x1) * cross) / 6;
    y += ((y0 + y1) * cross) / 6;
  });
  return { x: x / area, y: y / area };
}

/**
 * The centre of an image's opacity and the tilt of its long axis in degrees,
 * negative when its right end is higher (as the pebble's rotation of -5 has
 * it), each pixel weighted by its alpha at its centre.
 */
function opacityCentreAndTilt(image: DecodedPng): { x: number; y: number; tilt: number } {
  let [weight, sx, sy, sxx, syy, sxy] = [0, 0, 0, 0, 0, 0];
  for (const y of range(0, image.height)) {
    for (const x of range(0, image.width)) {
      const w = pixel(image, x, y).alpha / 255;
      const [px, py] = [x + 0.5, y + 0.5];
      weight += w;
      sx += w * px;
      sy += w * py;
      sxx += w * px * px;
      syy += w * py * py;
      sxy += w * px * py;
    }
  }
  const [x, y] = [sx / weight, sy / weight];
  const [xx, yy, xy] = [sxx / weight - x * x, syy / weight - y * y, sxy / weight - x * y];
  return { x, y, tilt: (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI };
}

/** How many canvas pixels make-icons.py draws for each pixel of `size`: 8, or fewer to stay within 4096. */
function supersample(size: number): number {
  return Math.max(1, Math.min(8, Math.floor(4096 / size)));
}

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
// pixels the smoothing leaves at most 0.07 there (16 to 1024 px, measured).
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

  it('fill the frame with the pebble, as wide and as tall as its outline within 0.5 px', () => {
    // brand.6. Each column's most opaque pixel, summed across the image, is
    // how wide the pebble is drawn, and each row's, summed down it, how tall:
    // measured, 0.04 to 0.34 px more than the outline at every size, as the
    // smoothing spreads the edge. The pebble before brand.6 was 0.8 px
    // narrower and 1.5 px shorter at 16 px, and more at every larger size.
    for (const size of PNG_SIZES) {
      const icon = png(`icon-${size}.png`);
      const outline = pebbleOutline(size);
      const xs = outline.map(([x]) => x);
      const ys = outline.map(([, y]) => y);
      const most = (cells: number[]): number =>
        Math.max(...cells.map((cell) => icon.rgba[cell * 4 + 3] ?? 0));
      const columns = range(0, size).map((x) => most(range(0, size).map((y) => y * size + x)));
      const rows = range(0, size).map((y) => most(range(0, size).map((x) => y * size + x)));
      const drawn = {
        width: columns.reduce((sum, v) => sum + v, 0) / 255,
        height: rows.reduce((sum, v) => sum + v, 0) / 255
      };
      expect(Math.abs(drawn.width - (Math.max(...xs) - Math.min(...xs))), `${size} px width`).toBeLessThan(
        0.5
      );
      expect(Math.abs(drawn.height - (Math.max(...ys) - Math.min(...ys))), `${size} px height`).toBeLessThan(
        0.5
      );
    }
  });

  it('put the pebble where its outline is, tilted 5 degrees as the outline is', () => {
    // The centre of each PNG's opacity is the centre of the outline's area
    // less the half canvas pixel the script moves the outline up and left by,
    // 1/16 px at 8x and 1/8 px at 1024 px, drawn at 4x (C.92, Rasters):
    // measured, within 0.01 px at every size. The pebble 0.02 of the side
    // higher (cy 0.50) is 0.33 px off at 16 px and 20 px off at 1024.
    // Its long axis, worked out from the same opacity, is tilted -4.5 to -5.1
    // degrees, measured; about 0 untilted and +4.5 to +5.1 with the tilt
    // reversed.
    for (const size of PNG_SIZES) {
      const drawn = opacityCentreAndTilt(png(`icon-${size}.png`));
      const centre = outlineCentre(pebbleOutline(size));
      const moved = 0.5 / supersample(size);
      expect(Math.abs(drawn.x - (centre.x - moved)), `${size} px across`).toBeLessThan(0.05);
      expect(Math.abs(drawn.y - (centre.y - moved)), `${size} px down`).toBeLessThan(0.05);
      expect(Math.abs(drawn.tilt - PEBBLE.rotation), `${size} px tilt`).toBeLessThan(1);
    }
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
      // The ghost is 36% of the side wide and 5.6% high; half of it at least
      // keeps its colour after the edges are smoothed.
      const { width, height } = SPECS.large.ghost;
      if (size <= SMALL_MAX) expect(near, `${size} px`).toBe(0);
      else expect(near, `${size} px`).toBeGreaterThanOrEqual(width * size * height * size * 0.5);
    }
  });

  it('put the line of type on whole pixels at 40 px and below, never blended across a row', () => {
    // Down the middle column, from a quarter of the side to just above the
    // dots, every pixel is the line's cream or the body's shade at that row.
    // The smoothing leaves at most about 35 either way; a line edge that fell
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
  const ghost = rgb(PALETTE.ghost);
  const line = rgb(PALETTE.line);
  const dots = rgb(PALETTE.dots);

  it('lays the line and the dots out as C.92 gives them at 16, 24, 32 and 40 px', () => {
    expect(layout(16).line).toEqual({ x0: 4, y0: 6, x1: 12, y1: 9 });
    expect(layout(16).dots).toEqual(dotRow(4, 10, 2, 1, 3));
    expect(layout(24).line).toEqual({ x0: 6, y0: 9, x1: 19, y1: 13 });
    expect(layout(24).dots).toEqual(dotRow(6, 14, 3, 2, 3));
    expect(layout(24).axis2).toBe(25);
    expect(layout(32).line).toEqual({ x0: 8, y0: 12, x1: 24, y1: 17 });
    expect(layout(32).dots).toEqual(dotRow(8, 19, 4, 2, 3));
    expect(layout(32).axis2).toBe(32);
    expect(layout(40).line).toEqual({ x0: 10, y0: 15, x1: 31, y1: 21 });
    expect(layout(40).dots).toEqual(dotRow(10, 24, 5, 3, 3));
    expect(layout(40).axis2).toBe(41);
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
    // two of five would be at 16 px, makes a pixel greener than the rim: 60
    // over its shade there. The smoothing makes the rim's own edges up to 21
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
      // The rows just above and just below them. Below was the rim at 16 px
      // until brand.6 made the pebble taller; it is the body at every size now.
      const columns = row.flatMap((box) => range(box.x0, box.x1));
      for (const y of [first.y0 - 1, first.y1]) {
        expect(mean(columns.map((x) => coverage(icon, x, y, dots))), `${size} px, row ${y}`).toBeLessThan(
          BLEND
        );
      }
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

  it('keeps all four edges of the ghost on whole pixels from 48 px', () => {
    // As for the line: measured, at most 0.058 of the ghost's colour in the
    // columns and rows just outside it. The ghost before brand.6, .34 of the
    // side wide at .32 down, put 0.89 to 0.96 of it into the row below this
    // one's at 60 px and from 72, and at 48 and 64 px, where its bottom edge
    // fell on this one's, was 2 px narrower on its middle row.
    for (const size of PNG_SIZES.filter((s) => s > SMALL_MAX)) {
      const icon = image(size);
      const { ghost: bar } = layout(size);
      if (!bar) throw new Error(`${size} px: no ghost`);
      const rows = range(bar.y0, bar.y1);
      const columns = range(bar.x0, bar.x1);
      for (const x of [bar.x0 - 1, bar.x1]) {
        expect(mean(rows.map((y) => coverage(icon, x, y, ghost))), `${size} px, column ${x}`).toBeLessThan(
          BLEND
        );
      }
      for (const y of [bar.y0 - 1, bar.y1]) {
        expect(mean(columns.map((x) => coverage(icon, x, y, ghost))), `${size} px, row ${y}`).toBeLessThan(
          BLEND
        );
      }
      const middle = bar.y0 + Math.floor((bar.y1 - bar.y0) / 2);
      expect(runs(icon, middle, bar.x0 - 1, bar.x1 + 1, ghost), `${size} px`).toEqual([[bar.x0, bar.x1]]);
    }
  });

  it('centres the ghost, the line and the row of dots on the same axis', () => {
    for (const size of PNG_SIZES) {
      const icon = image(size);
      const { axis2, ghost: faint, line: bar, dots: row } = layout(size);
      expect(Math.abs(centreX(icon, [bar], line) - axis2 / 2), `${size} px line`).toBeLessThan(0.05);
      expect(Math.abs(centreX(icon, row, dots) - axis2 / 2), `${size} px dots`).toBeLessThan(0.05);
      if (faint)
        expect(Math.abs(centreX(icon, [faint], ghost) - axis2 / 2), `${size} px ghost`).toBeLessThan(0.05);
    }
  });

  it('keeps the rim at least 1.25 px wide, so that it shows at 16 px', () => {
    // Down the middle column, from the top of the canvas to the first part,
    // each pixel's opacity times how much of the rim's shade it holds over the
    // body's adds up to the rim's width there: measured, 0.12 to 0.20 px over
    // at 40 px and below and within 0.11 px from 48 to 1024. Without the
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

  // The attributes of each element with this tag, by name, the elements in
  // the order the file has them.
  const elements = (tag: string): Record<string, string>[] =>
    [...svg.matchAll(new RegExp(`<${tag} ([^>]*?)\\s*/>`, 'g'))].map((found): Record<string, string> =>
      Object.fromEntries(
        [...(found[1] ?? '').matchAll(/([\w-]+)="([^"]*)"/g)].map((a): [string, string] => [
          a[1] ?? '',
          a[2] ?? ''
        ])
      )
    );

  it('draws the ghost, the line and the dots where the 256 px layout puts them', () => {
    // The About dialog shows this file at 64 px (AboutDialog.tsx). brand.5's
    // SVG beside brand.6's PNGs passed every test before this one and the next.
    const { ghost, line, dots } = layout(256);
    expect(ghost).toEqual({ x0: 82, y0: 76, x1: 174, y1: 90 });
    expect(line).toEqual({ x0: 60, y0: 108, x1: 196, y1: 140 });
    expect(dots).toEqual(dotRow(54, 163, 20, 12, 5));
    if (!ghost) throw new Error('no ghost at 256 px');
    const rect = (box: Box, rx: number, fill: string): Record<string, string> => ({
      x: String(box.x0),
      y: String(box.y0),
      width: String(box.x1 - box.x0),
      height: String(box.y1 - box.y0),
      rx: String(rx),
      fill
    });
    expect(elements('rect')).toEqual([
      rect(ghost, (ghost.y1 - ghost.y0) / 2, PALETTE.ghost),
      rect(line, (line.y1 - line.y0) / 4, PALETTE.line)
    ]);
    expect(elements('circle')).toEqual(
      dots.map((box) => ({
        cx: String((box.x0 + box.x1) / 2),
        cy: String((box.y0 + box.y1) / 2),
        r: String((box.x1 - box.x0) / 2),
        fill: PALETTE.dots
      }))
    );
  });

  it('draws the pebble and its body as their outlines at 256 px, each point within 0.01 px', () => {
    // 360 points each, given to two decimals, so within 0.005 px, measured:
    // the rim's outline, and the body's, each semi-axis shortened by the
    // rim's .035 of the side.
    const polygons = elements('polygon');
    expect(polygons.map((p) => p.fill)).toEqual(['url(#icon-rim)', 'url(#icon-body)']);
    const outlines = [pebbleOutline(256, 0, 360), pebbleOutline(256, layout(256).rim / 256, 360)];
    polygons.forEach((polygon, i) => {
      const points = (polygon.points ?? '').split(' ').map((pair) => pair.split(',').map(Number));
      const outline = outlines[i] ?? [];
      expect(points, `polygon ${i + 1}`).toHaveLength(outline.length);
      const off = Math.max(
        ...points.map(([x, y], j) => {
          const [ox, oy] = outline[j] ?? [Number.NaN, Number.NaN];
          return Math.max(Math.abs((x ?? Number.NaN) - ox), Math.abs((y ?? Number.NaN) - oy));
        })
      );
      expect(off, `polygon ${i + 1}`).toBeLessThan(0.01);
    });
  });
});
