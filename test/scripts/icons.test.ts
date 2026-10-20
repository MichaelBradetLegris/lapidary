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
 * px, the SVG's gradients, the small spec at 40 px and below, and the line's
 * edges on whole pixels.
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
