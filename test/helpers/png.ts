import { inflateSync } from 'node:zlib';

/*
 * A PNG reader for tests, enough for what Pillow writes: 8 bits a channel,
 * grey, grey with alpha, RGB or RGBA, not interlaced. Every image comes back
 * as RGBA, four bytes a pixel, rows top to bottom.
 */

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function isPng(data: Buffer): boolean {
  return data.subarray(0, SIGNATURE.length).equals(SIGNATURE);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(data: Buffer): DecodedPng {
  if (!isPng(data)) throw new Error('not a PNG');
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = -1;
  let interlace = 0;
  const chunks: Buffer[] = [];
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8] ?? 0;
      colourType = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (type === 'IDAT') {
      chunks.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = CHANNELS[colourType];
  if (depth !== 8 || channels === undefined || interlace !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${colourType}, interlace ${interlace}`);
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  if (raw.length !== height * (stride + 1)) throw new Error('PNG data has the wrong length');
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (pixels[row + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[row - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[row - stride + x - channels] ?? 0) : 0;
      const value = raw[line + x] ?? 0;
      let predicted: number;
      if (filter === 0) predicted = 0;
      else if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, upLeft);
      else throw new Error(`unknown PNG filter ${filter}`);
      pixels[row + x] = (value + predicted) & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const at = i * channels;
    const grey = channels <= 2;
    const r = pixels[at] ?? 0;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = grey ? r : (pixels[at + 1] ?? 0);
    rgba[i * 4 + 2] = grey ? r : (pixels[at + 2] ?? 0);
    rgba[i * 4 + 3] = channels === 4 ? (pixels[at + 3] ?? 0) : channels === 2 ? (pixels[at + 1] ?? 0) : 255;
  }
  return { width, height, rgba };
}
