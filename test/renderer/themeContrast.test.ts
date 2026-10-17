import { describe, expect, it } from 'vitest';
import { contrastRatio, mixWithTransparent, over, parseColour, toHex, type Rgb } from '../helpers/contrast';
import { APP_CSS, SCHEMES, resolveToken, tokenBlocks, type Scheme } from '../helpers/themeTokens';

/* theme.5: the contrast tiers of PLAN 11.3 (e), WCAG 2.x, in both themes, with the
   token values read out of app.css's two blocks. A failure names the pair, the
   two colours as painted, and the ratio, so the token to adjust is plain. */

const BLOCKS = tokenBlocks(APP_CSS);

const SURFACES = ['--bg', '--panel', '--panel-alt'];
const TEXT = ['--ink', '--ink-soft', '--accent', '--accept', '--danger', '--warn'];
const CATEGORIES = [
  '--cat-spelling',
  '--cat-homophone',
  '--cat-grammar',
  '--cat-punctuation',
  '--cat-word-choice',
  '--cat-consistency',
  '--cat-other'
];
const PARAGRAPHS = ['--para-active-bg', '--para-flash-bg'];
/** Backgrounds that mark a place: the focused row or suggestion, a selected row, find matches, paragraphs. */
const HIGHLIGHTS = ['--focus-bg', '--selected-bg', '--find-bg', ...PARAGRAPHS];
/** What a suggestion's words can sit on: the page, an active or flashing paragraph, the focus. */
const UNDER_SUGGESTIONS = ['--bg', ...PARAGRAPHS, '--focus-bg'];
const FILLS = ['--accent-fill', '--accent-hover', '--accent-active'];

/**
 * A background: a token, or a tint painted over one the way app.css paints it,
 * `color-mix(in srgb, <colour> <share>, transparent)` over `base`, or an
 * overlay token such as `--hover-overlay` over `base`.
 */
type Background = string | { tint: string; share: string; base: string } | { overlay: string; base: string };

interface Pair {
  ink: string;
  on: Background;
  min: number;
  /** Where this pair is on screen. */
  why: string;
}

function colour(scheme: Scheme, token: string): ReturnType<typeof parseColour> {
  return parseColour(resolveToken(BLOCKS, scheme, token));
}

function opaque(scheme: Scheme, token: string): Rgb {
  const c = colour(scheme, token);
  if (c.a !== 1) throw new Error(`${scheme}: ${token} is not opaque`);
  return c;
}

function paint(scheme: Scheme, on: Background): Rgb {
  if (typeof on === 'string') return opaque(scheme, on);
  if ('tint' in on) {
    const share = parseFloat(resolveToken(BLOCKS, scheme, on.share));
    return over(mixWithTransparent(colour(scheme, on.tint), share), opaque(scheme, on.base));
  }
  return over(colour(scheme, on.overlay), opaque(scheme, on.base));
}

function label(on: Background): string {
  if (typeof on === 'string') return on;
  return 'tint' in on ? `${on.tint} at ${on.share} over ${on.base}` : `${on.overlay} over ${on.base}`;
}

const each = <T, U>(xs: readonly T[], ys: readonly U[]): [T, U][] =>
  xs.flatMap((x) => ys.map((y): [T, U] => [x, y]));

/** The pairs of PLAN 11.3 (e), the same list for both themes. */
const TEXT_PAIRS: Pair[] = [
  ...each(TEXT, SURFACES).map(([ink, on]) => ({ ink, on, min: 4.5, why: 'text on a surface' })),
  ...each(CATEGORIES, SURFACES).map(([ink, on]) => ({ ink, on, min: 4.5, why: 'a category as text' })),
  ...each(CATEGORIES, PARAGRAPHS).map(([ink, on]) => ({
    ink,
    on,
    min: 4.5,
    why: 'a suggestion in an active or flashing paragraph'
  })),
  ...[...HIGHLIGHTS, '--editor-bg', '--warn-bg', '--warn-bg-strong', '--danger-bg'].map((on) => ({
    ink: '--ink',
    on,
    min: 4.5,
    why: 'text on a highlight, a warning, an error or the paragraph editor'
  })),
  { ink: '--find-active-ink', on: '--find-active-bg', min: 4.5, why: 'the active find match' },
  {
    ink: '--badge-pending-ink',
    on: '--badge-pending-bg',
    min: 4.5,
    why: 'the pending count in the file list'
  },
  { ink: '--warn', on: '--warn-bg-strong', min: 4.5, why: 'the unsaved-decisions box in the review dialog' },
  { ink: '--unsaved', on: '--panel', min: 4.5, why: 'the count not saved to the chapter, in the status bar' },
  { ink: '--danger', on: '--danger-bg', min: 4.5, why: 'the error card' },
  ...each(CATEGORIES, UNDER_SUGGESTIONS).flatMap(([tint, base]) =>
    ['--tint-pending', '--tint-hover'].map((share) => ({
      ink: '--ink',
      on: { tint, share, base },
      min: 4.5,
      why: 'a pending suggestion, at rest and hovered'
    }))
  ),
  ...UNDER_SUGGESTIONS.map((base) => ({
    ink: '--ink',
    on: { tint: '--ink-faint', share: '--tint-decided-hover', base },
    min: 4.5,
    why: 'a decided suggestion, hovered'
  })),
  ...['--panel', '--warn-bg', '--danger-bg'].map((base) => ({
    ink: '--ink',
    on: { overlay: '--hover-overlay', base },
    min: 4.5,
    why: "a card's close button, hovered"
  })),
  ...each(['--ink-soft', '--accent'], ['--focus-bg', '--selected-bg']).map(([ink, on]) => ({
    ink,
    on,
    min: 4.5,
    why: 'a focused or selected row'
  })),
  ...FILLS.map((on) => ({
    ink: '--on-accent',
    on,
    min: 4.5,
    why: 'a blue button, at rest, hovered and pressed'
  }))
];

const FAINT_PAIRS: Pair[] = [
  ...each(['--ink-faint', '--dismiss'], [...SURFACES, ...HIGHLIGHTS]).map(([ink, on]) => ({
    ink,
    on,
    min: 3,
    why: 'faint text on a surface or highlight'
  })),
  ...each(CATEGORIES, [...SURFACES, ...PARAGRAPHS, '--focus-bg']).map(([ink, on]) => ({
    ink,
    on,
    min: 3,
    why: 'a category as a mark: underline, dot, caret'
  })),
  { ink: '--unsaved', on: '--panel', min: 3, why: 'the unsaved dot before the chapter name (apply.4)' },
  ...['--panel-alt', '--selected-bg'].map((on) => ({
    ink: '--unsaved',
    on,
    min: 3,
    why: 'the unsaved dot on a hovered or the open row of the chapter list (apply.5)'
  }))
];

function failures(scheme: Scheme, pairs: Pair[]): string[] {
  return pairs.flatMap(({ ink, on, min, why }) => {
    const fg = opaque(scheme, ink);
    const bg = paint(scheme, on);
    const ratio = contrastRatio(fg, bg);
    return ratio >= min
      ? []
      : [`${ink} ${toHex(fg)} on ${label(on)} ${toHex(bg)}: ${ratio.toFixed(2)} < ${min} (${why})`];
  });
}

describe('contrast (theme.5, PLAN 11.3 e)', () => {
  it('reads every colour it checks in both themes', () => {
    for (const scheme of SCHEMES) {
      for (const pair of [...TEXT_PAIRS, ...FAINT_PAIRS]) {
        expect(() => opaque(scheme, pair.ink)).not.toThrow();
        expect(() => paint(scheme, pair.on)).not.toThrow();
      }
    }
    expect([TEXT_PAIRS.length, FAINT_PAIRS.length]).toEqual([137, 61]);
  });

  it('paints a tint the way color-mix() does, so the tinted pairs mean something', () => {
    // 18% of the light grammar blue over the light page.
    const tinted = paint('light', { tint: '--cat-grammar', share: '--tint-hover', base: '--bg' });
    const blue = opaque('light', '--cat-grammar');
    const page = opaque('light', '--bg');
    expect(tinted.r).toBeCloseTo(blue.r * 0.18 + page.r * 0.82, 6);
    expect(toHex(tinted)).not.toBe(toHex(page));
  });

  for (const scheme of SCHEMES) {
    it(`gives text 4.5:1 in ${scheme}`, () => {
      expect(failures(scheme, TEXT_PAIRS)).toEqual([]);
    });

    it(`gives faint text and category marks 3:1 in ${scheme}`, () => {
      expect(failures(scheme, FAINT_PAIRS)).toEqual([]);
    });
  }

  /* theme.8. A focused suggestion in the active comment's paragraph has the
     focus yellow on the paragraph's yellow, and a hairline in --active-ring
     marks it there. Both are told apart by hue more than by lightness (the
     focus yellow is 1.03:1 on the light page), so there is no 3:1 tier here; the
     hairline only has to stand out from the paragraph more than the yellow
     does, or it adds nothing. */
  for (const scheme of SCHEMES) {
    it(`marks a focused suggestion in the active paragraph more strongly than the focus yellow alone in ${scheme}`, () => {
      const paragraph = opaque(scheme, '--para-active-bg');
      const yellow = contrastRatio(opaque(scheme, '--focus-bg'), paragraph);
      const ring = contrastRatio(opaque(scheme, '--active-ring'), paragraph);
      expect(ring).toBeGreaterThan(yellow);
    });
  }

  it('fails a pair that is too faint, so the checks above can fail', () => {
    const grey = parseColour('#999999');
    const white = parseColour('#ffffff');
    expect(contrastRatio(grey, white)).toBeLessThan(4.5);
    expect(contrastRatio(grey, white)).toBeGreaterThan(2.5);
  });
});
