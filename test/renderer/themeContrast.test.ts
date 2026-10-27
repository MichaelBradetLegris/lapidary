import { describe, expect, it } from 'vitest';
import { CHANGE_CATEGORIES } from '../../src/shared/types';
import {
  contrastRatio,
  deltaE76,
  mixWithTransparent,
  over,
  parseColour,
  toHex,
  type Rgb
} from '../helpers/contrast';
import { APP_CSS, SCHEMES, resolveToken, tokenBlocks, type Scheme } from '../helpers/themeTokens';

/* theme.5: the contrast tiers of PLAN 11.3 (e), WCAG 2.x, in both themes, with the
   token values read out of app.css's two blocks. A failure names the pair, the
   two colours as painted, and the ratio, so the token to adjust is plain. */

const BLOCKS = tokenBlocks(APP_CSS);

const SURFACES = ['--bg', '--panel', '--panel-alt'];
const TEXT = ['--ink', '--ink-soft', '--accent', '--accept', '--danger', '--warn'];
/** Every category's own colour (polish.16), thirteen where seven served them all. */
const CATEGORIES = CHANGE_CATEGORIES.map((category) => `--cat-${category}`);
const PARAGRAPHS = ['--para-active-bg', '--para-flash-bg'];
/** Backgrounds that mark a place: the focused row or suggestion, a selected row, find matches, paragraphs. */
const HIGHLIGHTS = ['--focus-bg', '--selected-bg', '--find-bg', ...PARAGRAPHS];
/** What a suggestion's words can sit on: the page, an active or flashing paragraph, the focus. */
const UNDER_SUGGESTIONS = ['--bg', ...PARAGRAPHS, '--focus-bg'];
const FILLS = ['--accent-fill', '--accent-hover', '--accent-active'];
/**
 * What a row of the suggestions list sits on, pending or decided: the list at
 * rest, the row under the pointer, the focused row (polish.12). polish.20 gave
 * a decided row a shade of its own and a step further under the pointer;
 * polish.24 took them away, so a decided row is on these three again.
 */
const ROWS = ['--panel', '--panel-alt', '--focus-bg'];
/** The two colours of a decided row's own button (polish.12): the accepted tick and the dismissed x. */
const DECIDED = ['--accept-strong', '--danger'];

/**
 * A background: a token, or a tint painted over one the way app.css paints it,
 * `color-mix(in srgb, <colour> <share>, transparent)` over `base`, or an
 * overlay token such as `--hover-overlay` or the selection band over `base`,
 * which may itself be painted.
 */
type Background =
  string | { tint: string; share: string; base: string } | { overlay: string; base: Background };

interface Pair {
  ink: string;
  /**
   * An overlay painted over the ink as well as over its background: a mark
   * such as a suggestion's underline lies under the selection band, while text
   * is painted over it.
   */
  under?: string;
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
  return over(colour(scheme, on.overlay), paint(scheme, on.base));
}

/** The ink as painted: itself, or under an overlay when it is a mark the overlay covers. */
function paintInk(scheme: Scheme, { ink, under }: Pick<Pair, 'ink' | 'under'>): Rgb {
  return under === undefined ? opaque(scheme, ink) : over(colour(scheme, under), opaque(scheme, ink));
}

function label(on: Background): string {
  if (typeof on === 'string') return on;
  if ('tint' in on) return `${on.tint} at ${on.share} over ${on.base}`;
  return `${on.overlay} over ${typeof on.base === 'string' ? on.base : `(${label(on.base)})`}`;
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
  {
    ink: '--badge-conflict-ink',
    on: '--badge-conflict-bg',
    min: 4.5,
    why: 'the conflict copy badge in the file list (files.11)'
  },
  { ink: '--warn', on: '--warn-bg-strong', min: 4.5, why: 'the unsaved-decisions box in the review dialog' },
  { ink: '--unsaved', on: '--panel', min: 4.5, why: 'the count not saved to the chapter, in the status bar' },
  { ink: '--danger', on: '--danger-bg', min: 4.5, why: 'the error card' },
  ...['--ink-soft', '--accept', '--danger'].map((ink) => ({
    ink,
    on: '--warn-bg',
    min: 4.5,
    why: "Test the connection's note and result in a Setup status card that warns (setup.8)"
  })),
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
  ...CATEGORIES.map((tint) => ({
    ink: '--ink',
    on: { tint, share: '--tint-small-hover', base: '--bg' },
    min: 4.5,
    why: "a small change's capsule, hovered (11.7, small.6)"
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
    why: 'a primary button or the active Setup tab, at rest, hovered and pressed'
  })),
  ...[...CATEGORIES, '--accent'].map((ink) => ({
    ink,
    on: '--panel',
    min: 4.5,
    why: "a suggestion row's tag, on its own --panel fill whatever the row's background (polish.12)"
  })),
  ...ROWS.map((on) => ({
    ink: '--ink',
    on,
    min: 4.5,
    why: "a pending row's buttons in its words' --ink, on the row at rest, hovered and focused (polish.24; --ink-soft from polish.20, --ink-faint at 3:1 before)"
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
  { ink: '--bg', on: '--ink-faint', min: 3, why: "the focus mode switch's knob on its track, off (focus.4)" },
  {
    ink: '--on-accent',
    on: '--accent-fill',
    min: 3,
    why: "the focus mode switch's knob on its track, on (focus.4)"
  },
  ...['--panel-alt', '--selected-bg'].map((on) => ({
    ink: '--unsaved',
    on,
    min: 3,
    why: 'the unsaved dot on a hovered or the open row of the chapter list (apply.5)'
  })),
  ...['--ink-faint', '--ink-soft'].map((ink) => ({
    ink,
    on: '--scrollbar-track',
    min: 3,
    why: "a scrollbar's arrows, at rest and under the pointer, and a field's resize handle beside a bar (polish.2)"
  })),
  ...each(DECIDED, [...ROWS, '--border']).map(([ink, on]) => ({
    ink,
    on,
    min: 3,
    why: "a decided row's own button, the accepted tick or the dismissed x, on the row at rest (and the legend's tick on --panel), hovered and focused, and under the pointer on the button's --border (polish.12)"
  })),
  ...ROWS.map((on) => ({
    ink: '--ink-done',
    on,
    min: 3,
    why: "a decided row's words, accepted or dismissed, on the row at rest, hovered and focused: faint text by the author's choice, the third exception below (polish.24)"
  })),
  {
    ink: '--ink',
    on: '--border',
    min: 3,
    why: "a row button under the pointer, a decided row's faded ones among them, which come back there (polish.14)"
  }
];

/**
 * polish.2: a mark under 3:1, by the author's choice (2026-10-22), the only
 * one until polish.14's faded row buttons (below). The
 * scrollbar's thumb is a square a shade off its gutter, `--scrollbar-thumb` on
 * `--scrollbar-track`: about 1.4:1 at rest and 1.6 under the pointer ("a tiny
 * bit darker" than the sheet's variant D, 1.24 and 1.58 in light, 1.21 and
 * 1.82 in dark), and a step further from the track again while dragged, each
 * step darker in light and lighter in dark. Light comes to 1.41, 1.60 and
 * 1.86, dark to 1.41, 1.60 and 1.85, the same as the window's pixels at 100%
 * and 150%. The exception names these three tokens and no other, and
 * pins each to its band, so the thumb can neither fade into the track nor
 * drift unnoticed, and the 3:1 floor stands for every other mark but those
 * faded buttons. The arrows
 * and the resize handle keep it, above.
 */
interface Band {
  token: string;
  min: number;
  max: number;
  why: string;
}

const THUMB_ON = '--scrollbar-track';
const THUMB_EXCEPTION: Band[] = [
  { token: '--scrollbar-thumb', min: 1.3, max: 1.5, why: 'at rest' },
  { token: '--scrollbar-thumb-hover', min: 1.5, max: 1.7, why: 'under the pointer' },
  { token: '--scrollbar-thumb-active', min: 1.7, max: 2, why: 'while dragged, a step further again' }
];

function outOfBand(scheme: Scheme, bands: Band[]): string[] {
  const track = opaque(scheme, THUMB_ON);
  return bands.flatMap(({ token, min, max, why }) => {
    const thumb = opaque(scheme, token);
    const ratio = contrastRatio(thumb, track);
    return ratio >= min && ratio <= max
      ? []
      : [
          `${token} ${toHex(thumb)} on ${THUMB_ON} ${toHex(track)}: ${ratio.toFixed(2)}, not ${min} to ${max} (${why})`
        ];
  });
}

/**
 * polish.14: the second mark under 3:1, by the author's choice (2026-10-23:
 * "make the not clicked ones fade more ... It should clearly indicate 'we are
 * done with this row'"), where polish.12's thinner stroke in `--ink-faint`
 * "barely looks any different". On a decided row the two buttons not chosen
 * keep `--row-fade` of `--ink-faint`, painted as color-mix() paints it over
 * the row at rest, hovered and focused: 1.48, 1.43 and 1.45:1 in light, 1.74,
 * 1.71 and 1.54 in dark, near the scrollbar thumb's 1.4. polish.20 gave a
 * decided row a shade of its own and measured the fade there (1.43, 1.41 and
 * 1.44:1 in light, 1.70, 1.66 and 1.54 in dark); polish.24 took the shade
 * away, so the fade is measured on the row's own three backgrounds again.
 * Under the pointer they come back as any row button, `--ink` on `--border`
 * (a pair above at 3:1), and with the keyboard's focus as `--ink` on the row
 * (a text pair). The exception names this ink, this share and the row's three
 * backgrounds and no other, and pins each ratio to a band, so the fade can
 * neither vanish nor creep back towards the grey it fades from.
 */
interface Fade {
  ink: string;
  share: string;
  on: readonly string[];
  min: number;
  max: number;
}

const FADE_EXCEPTION: Fade = {
  ink: '--ink-faint',
  share: '--row-fade',
  on: ROWS,
  min: 1.35,
  max: 1.9
};

function fadeOutOfBand(scheme: Scheme, { ink, share, on, min, max }: Fade): string[] {
  const percent = parseFloat(resolveToken(BLOCKS, scheme, share));
  return on.flatMap((base) => {
    const row = opaque(scheme, base);
    const mark = over(mixWithTransparent(colour(scheme, ink), percent), row);
    const ratio = contrastRatio(mark, row);
    return ratio >= min && ratio <= max
      ? []
      : [
          `${ink} at ${share} (${percent}%) over ${base} ${toHex(mark)} on ${toHex(row)}: ${ratio.toFixed(2)}, not ${min} to ${max} (a decided row's faded button)`
        ];
  });
}

/**
 * polish.24: the third exception, and the one for text, by the author's choice
 * (2026-10-26: "when something is selected, for both light/dark, can we lower
 * the text contrast again? As in, make the text more faded a little"). A
 * decided row's words, accepted or dismissed, are `--ink-done`, a step fainter
 * than the `--ink-soft` polish.20 gave them, halfway to `--ink-faint`: on the
 * row at rest, hovered and focused 4.48, 3.93 and 4.08:1 in light and 6.28,
 * 5.66 and 4.13 in dark, so under the 4.5:1 of text on all three in light and
 * on the focused row in dark. They are held to the 3:1 of faint text (a pair
 * above). The exception names this token and the row's three backgrounds and
 * no other, and holds each ratio between that floor and a step under
 * `--ink-soft`'s on the same background (`--ink-soft` stands 1.23 times above
 * the words in light and 1.24 in dark), so the words can neither fade past
 * 3:1 nor creep back to the soft ink unnoticed.
 */
interface Done {
  ink: string;
  /** The ink the words are a step fainter than. */
  than: string;
  on: readonly string[];
  /** The 3:1 of faint text. */
  min: number;
  /** How many times `than`'s ratio on each background stands above the words', at least. */
  step: number;
}

const DONE_EXCEPTION: Done = { ink: '--ink-done', than: '--ink-soft', on: ROWS, min: 3, step: 1.15 };

function doneOutOfBand(scheme: Scheme, { ink, than, on, min, step }: Done): string[] {
  return on.flatMap((base) => {
    const row = opaque(scheme, base);
    const words = opaque(scheme, ink);
    const ratio = contrastRatio(words, row);
    const max = contrastRatio(opaque(scheme, than), row) / step;
    return ratio >= min && ratio <= max
      ? []
      : [
          `${ink} ${toHex(words)} on ${base} ${toHex(row)}: ${ratio.toFixed(2)}, not ${min} to ${max.toFixed(2)}, a step under ${than} (a decided row's words)`
        ];
  });
}

/**
 * polish.1: selected text lies on one of the app's two bands, translucent
 * turquoises over whatever the text sits on, so the pairs below paint them over
 * each background. `--selection-bg` is the band everywhere but the prose's
 * lines, and in the paragraph box, with the selected text in `--selection-ink`.
 * `--selection-prose-bg` is the faint band of the prose (`.prose ::selection`),
 * where the text keeps its own colour (`currentColor`), which there is `--ink`,
 * the frontmatter's `--ink-faint` or the active find match's ink. A ghost is
 * never selected: it is painted over the prose's band in its own colour, which
 * is why that band is faint. A suggestion's underline and a small change's
 * capsule lie under it, which covers them as it covers the page around them. A
 * filled button shows no band (`transparent`), so its pairs are the ones above.
 */
const BAND = '--selection-bg';
const PROSE_BAND = '--selection-prose-bg';
const selected = (base: Background): Background => ({ overlay: BAND, base });
const selectedInProse = (base: Background): Background => ({ overlay: PROSE_BAND, base });
/** What a selected line of the prose and the ghost above it can sit on. */
const PROSE_LINES = ['--bg', ...PARAGRAPHS];
/** What the prose's band can lie on: its lines, the frontmatter, the focus and a find match. */
const UNDER_PROSE_BAND = [...PROSE_LINES, '--panel-alt', '--focus-bg', '--find-bg'];
/**
 * What `--selection-bg` can lie on: the surfaces of the side panel, the chapter
 * list, the margin notes, the dialogs and the fields, the focused and selected
 * rows, the paragraph box, the warning and error cards and the badges.
 */
const UNDER_BAND = [
  ...SURFACES,
  '--focus-bg',
  '--selected-bg',
  '--editor-bg',
  '--warn-bg',
  '--warn-bg-strong',
  '--danger-bg',
  '--badge-pending-bg',
  '--badge-conflict-bg'
];

const SELECTION_TEXT_PAIRS: Pair[] = [
  ...UNDER_BAND.map((base) => ({
    ink: '--selection-ink',
    on: selected(base),
    min: 4.5,
    why: 'selected text outside the prose (the side panel, the margin notes, a dialog, a field) and in the paragraph box'
  })),
  ...[...PROSE_LINES, '--focus-bg', '--find-bg'].map((base) => ({
    ink: '--ink',
    on: selectedInProse(base),
    min: 4.5,
    why: 'selected prose in its own --ink, on the focus and a find match too'
  })),
  ...each(CATEGORIES, UNDER_SUGGESTIONS).flatMap(([tint, base]) =>
    ['--tint-pending', '--tint-hover'].map((share) => ({
      ink: '--ink',
      on: selectedInProse({ tint, share, base }),
      min: 4.5,
      why: 'a selected pending suggestion, at rest and hovered'
    }))
  ),
  ...UNDER_SUGGESTIONS.map((base) => ({
    ink: '--ink',
    on: selectedInProse({ tint: '--ink-faint', share: '--tint-decided-hover', base }),
    min: 4.5,
    why: 'a selected decided suggestion, hovered'
  })),
  ...CATEGORIES.map((tint) => ({
    ink: '--ink',
    on: selectedInProse({ tint, share: '--tint-small-hover', base: '--bg' }),
    min: 4.5,
    why: "a selected small change's capsule, hovered"
  })),
  {
    ink: '--find-active-ink',
    on: selectedInProse('--find-active-bg'),
    min: 4.5,
    why: 'the active find match, selected'
  },
  ...each(CATEGORIES, PROSE_LINES).map(([ink, base]) => ({
    ink,
    on: selectedInProse(base),
    min: 4.5,
    why: 'a ghost above a selected line, which keeps the 4.5:1 of a category as text'
  }))
];

const SELECTION_FAINT_PAIRS: Pair[] = [
  ...PROSE_LINES.map((base) => ({
    ink: '--ink-faint',
    on: selectedInProse(base),
    min: 3,
    why: 'the struck-through "was" ghost above a selected line'
  })),
  ...['--panel-alt', '--find-bg'].map((base) => ({
    ink: '--ink-faint',
    on: selectedInProse(base),
    min: 3,
    why: 'the frontmatter selected, and a find match in it'
  })),
  ...each(CATEGORIES, UNDER_SUGGESTIONS).map(([ink, base]) => ({
    ink,
    under: PROSE_BAND,
    on: selectedInProse(base),
    min: 3,
    why: "a pending suggestion's underline and a small change's foot line, under the band"
  }))
];

/**
 * The polish.1 review: how plainly each band shows on what it covers, as the
 * band over a background against the background itself. polish.1 first laid
 * the prose's faint band everywhere, where a selected word in the find field,
 * the edit popover or the Setup page's command block could hardly be seen in
 * dark (9.2 apart in CIELAB on the panel, 1.11:1). `--selection-bg` is held to
 * a CIELAB difference and a luminance ratio both, the second for whoever tells
 * colours apart less well, since the luminance difference reaches everyone.
 * The prose's band is held to a difference only, as the ghosts keep it within
 * a few hundredths of the page's luminance; the floor keeps it from fading any
 * further.
 */
interface Floor {
  band: string;
  on: string[];
  minDeltaE: number;
  minLuminance: number;
  why: string;
}

const BAND_FLOOR: Floor = {
  band: BAND,
  on: UNDER_BAND,
  minDeltaE: 20,
  minLuminance: 1.3,
  why: 'the band of the fields, dialogs and panels'
};
const PROSE_FLOOR: Floor = {
  band: PROSE_BAND,
  on: UNDER_PROSE_BAND,
  minDeltaE: 8,
  minLuminance: 1,
  why: "the prose's faint band"
};

function faded(scheme: Scheme, { band, on, minDeltaE, minLuminance, why }: Floor): string[] {
  return on.flatMap((base) => {
    const under = opaque(scheme, base);
    const painted = over(colour(scheme, band), under);
    const difference = deltaE76(painted, under);
    const ratio = contrastRatio(painted, under);
    return difference >= minDeltaE && ratio >= minLuminance
      ? []
      : [
          `${band} over ${base} ${toHex(painted)} against ${toHex(under)}: ${difference.toFixed(1)} apart (at least ${minDeltaE}), ${ratio.toFixed(3)}:1 (at least ${minLuminance}) (${why})`
        ];
  });
}

/**
 * polish.16: the chips' colours told apart. The author (2026-10-23): "typo and
 * spelling look almost identical. Grammar and Agreement also look very
 * similar", where each pair was one token. The chips' row holds the thirteen
 * categories, the comments and You: fifteen colours, which also mark the
 * rows' tags and the prose, each read from its chip's `.cat-*` rule as it is
 * painted. Any two stand at least 15 apart in CIELAB, as `deltaE76` measures
 * it (two flat patches side by side are told apart from about 2.3), and two of
 * one family, categories close in meaning, at least 35.
 */
const FAMILIES: readonly (readonly string[])[] = [
  ['spelling', 'typo', 'homophone'],
  ['grammar', 'agreement', 'tense'],
  ['word-choice', 'redundancy', 'awkward'],
  ['formatting', 'other']
];
const CHIPS: readonly string[] = [...CHANGE_CATEGORIES, 'you', 'comments'];
const APART = 15;
const FAMILY_APART = 35;

/** The token a chip's rule sets `--cat` to, as in `.cat-typo { --cat: var(--cat-typo); }`. */
function chipToken(key: string): string {
  const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) =>
      (m[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .includes(`.cat-${key}`)
    )
    .flatMap((m) => /(?:^|;)\s*--cat:\s*var\((--[\w-]+)\)/.exec(m[2] ?? '')?.[1] ?? []);
  const [token] = tokens;
  if (tokens.length !== 1 || token === undefined)
    throw new Error(`.cat-${key} sets --cat ${tokens.length} times`);
  return token;
}

/** Each two of the fifteen that stand closer than their floor, as painted in `scheme`. */
function tooClose(scheme: Scheme, token: (key: string) => string = chipToken): string[] {
  const painted = CHIPS.map((key) => ({ key, colour: opaque(scheme, token(key)) }));
  return painted.flatMap((a, i) =>
    painted.slice(i + 1).flatMap((b) => {
      const family = FAMILIES.some((f) => f.includes(a.key) && f.includes(b.key));
      const min = family ? FAMILY_APART : APART;
      const apart = deltaE76(a.colour, b.colour);
      return apart >= min
        ? []
        : [
            `${a.key} ${toHex(a.colour)} and ${b.key} ${toHex(b.colour)}: ${apart.toFixed(1)} apart, at least ${min}${family ? ' (one family)' : ''}`
          ];
    })
  );
}

/**
 * `tooClose`'s lines without the two colours and the distance measured, so a
 * test can name the pair, its floor and whether it is one family's:
 * "spelling and typo: at least 35 (one family)".
 */
function floorsBroken(lines: string[]): string[] {
  return lines.map((line) => line.replace(/ #[0-9a-f]{6}/g, '').replace(/: \d+\.\d apart, /, ': '));
}

function failures(scheme: Scheme, pairs: Pair[]): string[] {
  return pairs.flatMap((pair) => {
    const { ink, under, on, min, why } = pair;
    const fg = paintInk(scheme, pair);
    const bg = paint(scheme, on);
    const ratio = contrastRatio(fg, bg);
    const name = under === undefined ? ink : `${ink} under ${under}`;
    return ratio >= min
      ? []
      : [`${name} ${toHex(fg)} on ${label(on)} ${toHex(bg)}: ${ratio.toFixed(2)} < ${min} (${why})`];
  });
}

describe('contrast (theme.5, PLAN 11.3 e)', () => {
  it('reads every colour it checks in both themes', () => {
    for (const scheme of SCHEMES) {
      for (const pair of [...TEXT_PAIRS, ...FAINT_PAIRS, ...SELECTION_TEXT_PAIRS, ...SELECTION_FAINT_PAIRS]) {
        expect(() => paintInk(scheme, pair)).not.toThrow();
        expect(() => paint(scheme, pair.on)).not.toThrow();
      }
    }
    // polish.16: thirteen categories where there were seven tokens (156, 75, 105 and 33 pairs).
    // polish.20: six text pairs more for the rows (246 before), and the decided buttons' pairs
    // on the decided row's backgrounds, where the pending buttons' 3:1 pairs went (111 before).
    // polish.24: the decided words' three text pairs went to 3:1 as --ink-done (252 and 110
    // before), and the decided buttons' pairs are on the row's own backgrounds again, the
    // legend's tick on --panel among them. rr.7: Full edit's focus edge on the column
    // and the sheet (111 before); rr.9 took the edge and its two pairs away (113 before); focus.4
    // added the switch's knob on its track, off and on (111 before).
    expect(CATEGORIES).toHaveLength(13);
    expect([
      TEXT_PAIRS.length,
      FAINT_PAIRS.length,
      SELECTION_TEXT_PAIRS.length,
      SELECTION_FAINT_PAIRS.length
    ]).toEqual([249, 113, 177, 57]);
  });

  /* polish.12: the accepted tick "needs to pop a little more" (the author).
     --accept, the green it had, already held 4.5:1 on the rows; the stronger
     green is more saturated, as well as drawn bolder, and still a green. */
  it('draws the accepted tick in a green more saturated than --accept, in both themes (polish.12)', () => {
    const hsl = ({ r, g, b }: Rgb): { h: number; s: number } => {
      const [R, G, B] = [r / 255, g / 255, b / 255];
      const max = Math.max(R, G, B);
      const min = Math.min(R, G, B);
      const l = (max + min) / 2;
      const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      const h =
        max === min
          ? 0
          : max === G
            ? 60 * ((B - R) / (max - min) + 2)
            : max === R
              ? 60 * (((G - B) / (max - min) + 6) % 6)
              : 60 * ((R - G) / (max - min) + 4);
      return { h, s };
    };
    for (const scheme of SCHEMES) {
      const strong = hsl(opaque(scheme, '--accept-strong'));
      const before = hsl(opaque(scheme, '--accept'));
      // 0.44 to 0.76 in light, 0.41 to 0.61 in dark.
      expect(strong.s, scheme).toBeGreaterThan(before.s + 0.15);
      expect(strong.h, scheme).toBeGreaterThan(130);
      expect(strong.h, scheme).toBeLessThan(150);
    }
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

    it(`gives selected text and the ghosts above it 4.5:1 on the selection band in ${scheme} (polish.1)`, () => {
      expect(failures(scheme, SELECTION_TEXT_PAIRS)).toEqual([]);
    });

    it(`keeps faint text, the "was" ghost and the underline under the band at 3:1 in ${scheme} (polish.1)`, () => {
      expect(failures(scheme, SELECTION_FAINT_PAIRS)).toEqual([]);
    });

    it(`shows each selection band plainly on what it covers in ${scheme} (polish.1 review)`, () => {
      expect([BAND_FLOOR, PROSE_FLOOR].flatMap((floor) => faded(scheme, floor))).toEqual([]);
    });

    it(`keeps the chips' fifteen colours apart in ${scheme}, a family's further (polish.16)`, () => {
      expect(tooClose(scheme)).toEqual([]);
    });

    it(`keeps the scrollbar's thumb a shade off its gutter in ${scheme}, a mark under 3:1 (polish.2)`, () => {
      expect(outOfBand(scheme, THUMB_EXCEPTION)).toEqual([]);
      // Each state a step further from the track, and all three under the floor they are exempt from.
      const track = opaque(scheme, THUMB_ON);
      const ratios = THUMB_EXCEPTION.map(({ token }) => contrastRatio(opaque(scheme, token), track));
      expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
      expect(Math.max(...ratios)).toBeLessThan(3);
    });

    it(`fades a decided row's other buttons plainly in ${scheme}, the second mark under 3:1 (polish.14, on the row's own backgrounds again since polish.24)`, () => {
      expect(fadeOutOfBand(scheme, FADE_EXCEPTION)).toEqual([]);
      // The grey it fades from holds 3:1 on every row background; faded, it is well under it.
      for (const base of ROWS) {
        const row = opaque(scheme, base);
        expect(contrastRatio(opaque(scheme, '--ink-faint'), row), base).toBeGreaterThanOrEqual(3);
      }
    });

    it(`fades a decided row's words in ${scheme}, the third exception and the one for text, held to 3:1 (polish.24)`, () => {
      expect(doneOutOfBand(scheme, DONE_EXCEPTION)).toEqual([]);
      // Under the 4.5:1 of text on at least one of the row's backgrounds, or it would be no exception.
      const ratios = ROWS.map((base) => contrastRatio(opaque(scheme, '--ink-done'), opaque(scheme, base)));
      expect(Math.min(...ratios)).toBeLessThan(4.5);
      // Fainter than the soft ink and the pending row's buttons and words, on every background.
      for (const base of ROWS) {
        const row = opaque(scheme, base);
        expect(contrastRatio(opaque(scheme, '--ink-soft'), row), base).toBeGreaterThan(
          contrastRatio(opaque(scheme, '--ink-done'), row)
        );
      }
    });
  }

  it("fails a fade outside its band, so the faded buttons' exception can fail", () => {
    // polish.12's buttons, --ink-faint whole, are no fade at all, and a tenth of it is next to nothing.
    for (const scheme of SCHEMES) {
      expect(fadeOutOfBand(scheme, { ...FADE_EXCEPTION, share: '--tint-pending' })).toHaveLength(3);
    }
    const whole = SCHEMES.flatMap((scheme) =>
      ROWS.map((base) => contrastRatio(opaque(scheme, '--ink-faint'), opaque(scheme, base)))
    );
    expect(Math.min(...whole)).toBeGreaterThan(FADE_EXCEPTION.max);
    expect(FADE_EXCEPTION.on).toEqual(['--panel', '--panel-alt', '--focus-bg']);
  });

  /* polish.24: the words polish.20 gave a decided row, --ink-soft, are no fade
     at all, and a grey under 3:1, such as a dotted line's --border-strong, is
     too far; either is what the band is there to stop. */
  it("fails a decided row's words that are no step under --ink-soft or under 3:1, so the words' exception can fail", () => {
    for (const scheme of SCHEMES) {
      expect(doneOutOfBand(scheme, { ...DONE_EXCEPTION, ink: '--ink-soft' }), scheme).toHaveLength(3);
      expect(doneOutOfBand(scheme, { ...DONE_EXCEPTION, ink: '--border-strong' }), scheme).toHaveLength(3);
      // The pending row's --ink, plainer than the soft ink, is no fade either.
      expect(doneOutOfBand(scheme, { ...DONE_EXCEPTION, ink: '--ink' }), scheme).toHaveLength(3);
    }
    expect(DONE_EXCEPTION.on).toEqual(['--panel', '--panel-alt', '--focus-bg']);
    expect([DONE_EXCEPTION.ink, DONE_EXCEPTION.than]).toEqual(['--ink-done', '--ink-soft']);
  });

  it("fails a thumb outside its band, so the scrollbar's exception can fail", () => {
    // The sheet's D as drawn: --border at rest is too faint, and dark's --border-strong
    // hovered too strong; C's --ink-faint is no shade at all.
    const rest = (token: string): Band[] => [{ token, min: 1.3, max: 1.5, why: 'at rest' }];
    const hover = (token: string): Band[] => [{ token, min: 1.5, max: 1.7, why: 'under the pointer' }];
    expect(THUMB_EXCEPTION.slice(0, 2)).toEqual([
      ...rest('--scrollbar-thumb'),
      ...hover('--scrollbar-thumb-hover')
    ]);
    expect(outOfBand('light', rest('--border'))).toHaveLength(1);
    expect(outOfBand('dark', rest('--border'))).toHaveLength(1);
    expect(outOfBand('dark', hover('--border-strong'))).toHaveLength(1);
    expect(outOfBand('light', hover('--ink-faint'))).toHaveLength(1);
  });

  it("reads each chip's colour from its own rule, a token per category (polish.16)", () => {
    expect(CHIPS.map((key) => chipToken(key))).toEqual([...CATEGORIES, '--accent', '--ink-soft']);
    // The task's four families, as PLAN's polish.16 names them, of categories that exist, none in two.
    expect(FAMILIES).toEqual([
      ['spelling', 'typo', 'homophone'],
      ['grammar', 'agreement', 'tense'],
      ['word-choice', 'redundancy', 'awkward'],
      ['formatting', 'other']
    ]);
    const named = FAMILIES.flat();
    expect(named.filter((c) => !(CHANGE_CATEGORIES as readonly string[]).includes(c))).toEqual([]);
    expect(new Set(named).size).toBe(named.length);
  });

  /* polish.16: the colours the chips had, each family on one token, are what
     the floor is there to stop, and so is other in the comments' grey, which
     light other was (#6d675e) until then. */
  it("fails the old shared colours and other in the comments' grey, so the floor can fail", () => {
    const shared: Record<string, string> = {
      typo: '--cat-spelling',
      agreement: '--cat-grammar',
      tense: '--cat-grammar',
      redundancy: '--cat-word-choice',
      awkward: '--cat-word-choice',
      formatting: '--cat-other'
    };
    for (const scheme of SCHEMES) {
      // Each pair under the family floor and marked as one family's.
      expect(floorsBroken(tooClose(scheme, (key) => shared[key] ?? chipToken(key))), scheme).toEqual([
        'spelling and typo: at least 35 (one family)',
        'grammar and agreement: at least 35 (one family)',
        'grammar and tense: at least 35 (one family)',
        'agreement and tense: at least 35 (one family)',
        'word-choice and redundancy: at least 35 (one family)',
        'word-choice and awkward: at least 35 (one family)',
        'redundancy and awkward: at least 35 (one family)',
        'formatting and other: at least 35 (one family)'
      ]);
      expect(
        floorsBroken(tooClose(scheme, (key) => (key === 'other' ? '--ink-soft' : chipToken(key)))),
        scheme
      ).toContain('other and comments: at least 15');
    }
  });

  /* The polish.16 review: the old colours are 0 apart, under both floors, so
     they cannot show that the family floor applies. Formatting in the ink's
     colour stands more than 15 from every chip and less than 35 from other,
     so it breaks the family floor and nothing else. */
  it('fails formatting in the ink, a pair under the family floor alone, so that floor can fail', () => {
    const inked = (key: string): string => (key === 'formatting' ? '--ink' : chipToken(key));
    for (const scheme of SCHEMES) {
      const apart = deltaE76(opaque(scheme, '--ink'), opaque(scheme, chipToken('other')));
      expect(apart, scheme).toBeGreaterThanOrEqual(APART);
      expect(apart, scheme).toBeLessThan(FAMILY_APART);
      expect(floorsBroken(tooClose(scheme, inked)), scheme).toEqual([
        'formatting and other: at least 35 (one family)'
      ]);
    }
  });

  /* The polish.1 review: the prose's band laid everywhere, as polish.1 first
     had it, is what the floor is there to stop. */
  it("fails the prose's faint band as the band of the fields, so the floor can fail", () => {
    for (const scheme of SCHEMES) {
      expect(faded(scheme, { ...BAND_FLOOR, band: PROSE_BAND }).length).toBeGreaterThan(0);
    }
  });

  it('measures colour differences in CIELAB as CIE76 does', () => {
    const [white, black] = [parseColour('#ffffff'), parseColour('#000000')];
    expect(deltaE76(white, black)).toBeCloseTo(100, 3);
    expect(deltaE76(white, white)).toBe(0);
    // sRGB red is L 53.24, a 80.09, b 67.20 under D65.
    expect(deltaE76(parseColour('#ff0000'), black)).toBeCloseTo(Math.hypot(53.24, 80.09, 67.2), 0);
  });

  /* polish.1. Both bands are translucent, so what lies under selected text
     still shows: in the prose, what marks a suggestion (its underline and
     tint, the focus yellow, a small change's capsule), which an opaque band
     hid (11.3 e), and elsewhere a badge's or a focused row's colour. */
  it('lays translucent bands in both themes, and an opaque one would hide the underline', () => {
    for (const scheme of SCHEMES) {
      const band = colour(scheme, BAND);
      expect(band.a).toBeGreaterThan(0);
      expect(band.a).toBeLessThan(1);
      const prose = colour(scheme, PROSE_BAND);
      expect(prose.a).toBeGreaterThan(0);
      expect(prose.a).toBeLessThan(0.5);
      // The prose's band made opaque covers the underline and the page alike.
      const solid = { ...prose, a: 1 };
      const underline = over(solid, opaque(scheme, '--cat-spelling'));
      expect(contrastRatio(underline, over(solid, opaque(scheme, '--bg')))).toBeCloseTo(1, 6);
    }
  });

  it('paints a mark under the band and text over it, so the two kinds of pair differ', () => {
    // 20% of the light prose band over the light spelling red, against the band over the page.
    const ink = paintInk('light', { ink: '--cat-spelling', under: PROSE_BAND });
    const red = opaque('light', '--cat-spelling');
    const band = colour('light', PROSE_BAND);
    expect(ink.r).toBeCloseTo(band.r * band.a + red.r * (1 - band.a), 6);
    const page = paint('light', selectedInProse('--bg'));
    expect(contrastRatio(ink, page)).toBeLessThan(contrastRatio(red, page));
  });

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

  /* Ghost text, in a category colour or --ink-faint, sits on whatever its line
     sits on: the page or an active or flashing paragraph, the pairs above.
     Nothing fills behind it. small.6 filled a focused small change's ghost
     with --focus-bg, where spelling, homophone, punctuation and other came to
     4.14, 4.18, 4.28 and 4.03:1 in dark, under the 4.5 of a category as text
     (small review); the capsule and the arrowhead mark the focus instead. */
  it('fills nothing behind the ghost row, so its text meets only the backgrounds checked above', () => {
    const css = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const filled = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /\.hunk__(above|ghost|role|tag|key)\b/.test(m[1] ?? ''))
      .filter((m) =>
        (m[2] ?? '').split(';').some((decl) => {
          const [name = '', value = ''] = decl.split(':').map((s) => s.trim());
          return /^background(-color|-image)?$/.test(name) && !/^(none|transparent)$/.test(value);
        })
      )
      .map((m) => (m[1] ?? '').trim());
    expect(filled).toEqual([]);
  });

  it('fails a pair that is too faint, so the checks above can fail', () => {
    const grey = parseColour('#999999');
    const white = parseColour('#ffffff');
    expect(contrastRatio(grey, white)).toBeLessThan(4.5);
    expect(contrastRatio(grey, white)).toBeGreaterThan(2.5);
  });
});
