import { describe, expect, it } from 'vitest';
import { contrastRatio, mixWithTransparent, over, parseColour, relativeLuminance, toHex } from './contrast';

/* The WCAG 2.x arithmetic behind the theme's contrast tests (theme.5). */

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('parseColour', () => {
  it('reads every hex form', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#0f08')).toEqual({ r: 0, g: 255, b: 0, a: 0x88 / 255 });
    expect(parseColour('#1C1A17')).toEqual({ r: 28, g: 26, b: 23, a: 1 });
    expect(parseColour(' #3b5bdb80 ')).toEqual({ r: 59, g: 91, b: 219, a: 128 / 255 });
  });

  it('reads rgb() with spaces and a slash, and rgb() and rgba() with commas', () => {
    expect(parseColour('rgb(35 32 28 / 42%)')).toEqual({ r: 35, g: 32, b: 28, a: 0.42 });
    expect(parseColour('rgb(255 255 255 / 0.1)')).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
    expect(parseColour('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColour('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColour('rgb(100%, 0%, 50%)')).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
  });

  it('throws on anything else, so a token the tests cannot read fails loudly', () => {
    for (const text of [
      'red',
      '#12',
      '#12345',
      'rgb(1 2)',
      'rgb(300 0 0)',
      'rgb(0 0 0 / 2)',
      'var(--ink)',
      ''
    ]) {
      expect(() => parseColour(text), text).toThrow();
    }
  });
});

describe('relativeLuminance', () => {
  it('runs from 0 for black to 1 for white', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });

  it('weights green most and blue least', () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect([red, green, blue].map((l) => l.toFixed(4))).toEqual(['0.2126', '0.7152', '0.0722']);
  });

  it('uses the linear part of the sRGB curve for the darkest channels', () => {
    // 10/255 is below the 0.04045 threshold: 10 / 255 / 12.92.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 12);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, 1 for a colour on itself, and the same either way round', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 10);
    expect(contrastRatio(parseColour('#3b5bdb'), parseColour('#3b5bdb'))).toBe(1);
  });

  it('matches the usual reference values either side of 4.5:1', () => {
    // #767676 is the lightest grey that passes 4.5:1 on white; #777777 fails it.
    expect(contrastRatio(parseColour('#767676'), WHITE).toFixed(2)).toBe('4.54');
    expect(contrastRatio(parseColour('#777777'), WHITE).toFixed(2)).toBe('4.48');
    expect(contrastRatio(parseColour('#959595'), WHITE).toFixed(2)).toBe('3.00');
  });
});

describe('over', () => {
  it('composites a translucent colour over an opaque one', () => {
    expect(over({ ...BLACK, a: 0.5 }, WHITE)).toEqual({ r: 127.5, g: 127.5, b: 127.5 });
    expect(over({ r: 200, g: 100, b: 0, a: 1 }, WHITE)).toEqual({ r: 200, g: 100, b: 0 });
    expect(over({ r: 200, g: 100, b: 0, a: 0 }, WHITE)).toEqual(WHITE);
  });
});

describe('mixWithTransparent', () => {
  it('keeps the colour and scales its opacity, as color-mix() with transparent does', () => {
    expect(mixWithTransparent({ r: 31, g: 111, b: 139, a: 1 }, 18)).toEqual({
      r: 31,
      g: 111,
      b: 139,
      a: 0.18
    });
    expect(mixWithTransparent({ r: 0, g: 0, b: 0, a: 0.5 }, 50)).toEqual({ r: 0, g: 0, b: 0, a: 0.25 });
  });

  it('refuses a share outside 0 to 100', () => {
    expect(() => mixWithTransparent({ ...BLACK, a: 1 }, 101)).toThrow();
    expect(() => mixWithTransparent({ ...BLACK, a: 1 }, Number.NaN)).toThrow();
  });
});

describe('toHex', () => {
  it('rounds each channel', () => {
    expect(toHex({ r: 127.5, g: 0.4, b: 254.6 })).toBe('#8000ff');
  });
});
