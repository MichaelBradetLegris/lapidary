import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_CATEGORIES } from '../../src/shared/types';
import { parseColour } from '../helpers/contrast';
import {
  APP_CSS,
  resolveToken,
  SCHEMES,
  tokenBlocks,
  type Scheme,
  type TokenBlock
} from '../helpers/themeTokens';

/* theme.4: every colour the renderer paints is a token in a `:root` block of
   app.css (PLAN 11.3 e), so a theme is one block of values and nothing else.
   theme.1 and panel.1: which elements scroll, and that every one of them has an
   opaque background in a colour token. A transparent scroller loses its own
   composited layer and its LCD text while it scrolls (PLAN Appendix C, "The
   scrollers have opaque backgrounds (LCD text while scrolling)"). The scroller
   checks were test/renderer/scrollers.test.ts until theme.4 folded them in. */

const RENDERER = path.join(__dirname, '../../src/renderer');

const CSS = readFileSync(path.join(RENDERER, 'styles/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** A token block: `:root { ... }`, at the top level or inside an at-rule such as the dark block. */
const TOKEN_BLOCK = /:root\s*\{[^{}]*\}/g;
const TOKEN_BLOCKS = CSS.match(TOKEN_BLOCK) ?? [];
const OUTSIDE_TOKENS = CSS.replace(TOKEN_BLOCK, '');

/** Every .ts and .tsx file under src/renderer, without its comments. */
const SOURCES = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => ({
    file: file.replace(/\\/g, '/'),
    text: readFileSync(path.join(RENDERER, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Line comments only after a space or at a line start, so `https://` stays.
      .replace(/(^|\s)\/\/.*$/gm, '$1')
  }));

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
}

/** Every innermost rule, with at-rules such as @media flattened away. */
function rules(text: string): Rule[] {
  const out: Rule[] = [];
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const decls = new Map<string, string>();
    for (const decl of (match[2] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) decls.set(decl.slice(0, colon).trim(), decl.slice(colon + 1).trim());
    }
    out.push({ selectors, decls });
  }
  return out;
}

const RULES = rules(CSS);

/** Every declaration made for exactly this selector, across the whole file. */
function declsFor(selector: string): Map<string, string> {
  const merged = new Map<string, string>();
  for (const rule of RULES) {
    if (rule.selectors.includes(selector)) for (const [k, v] of rule.decls) merged.set(k, v);
  }
  return merged;
}

/** The whole function call that starts at `start`, nested brackets and all. */
function callAt(text: string, start: number): string {
  let depth = 0;
  for (let i = text.indexOf('(', start); i >= 0 && i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')' && (depth -= 1) === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/**
 * Colours written out rather than named by a token: hex, and every colour
 * function (`rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`,
 * `color()`) except an `rgb()` or `rgba()` whose first argument is a `var()`, as
 * in `rgb(var(--shadow-rgb) / 8%)`. A var() for the alpha alone still leaves the
 * colour written out. The `&` and word guard keeps HTML entities such as
 * `&#8217;` and names such as `#root` out.
 */
function colourLiterals(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?<![\w&#-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi))
    found.push(m[0]);
  for (const m of text.matchAll(/\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi)) {
    const call = callAt(text, m.index);
    if (!/^rgba?\(\s*var\(/i.test(call)) found.push(call);
  }
  return found;
}

/**
 * The CSS Color 4 named colours and system colours, lower case. `transparent`
 * and `currentColor` are left out, as are `inherit`, `initial` and `unset`: none
 * of them is a colour of its own.
 */
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
  burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
  darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
  ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
  lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
  lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
  mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen
  mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace
  olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey
  snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field
  fieldtext graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext
  visitedtext`
    .trim()
    .split(/\s+/)
);

/**
 * Named colours in the values of CSS declarations, so `white-space` and a word
 * in a selector never count. Custom property names and quoted strings (font
 * names) are taken out of each value first; a named colour in a var() fallback
 * still counts. A word with a hyphen is never a colour name.
 */
function namedColours(css: string): string[] {
  const found: string[] = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of (block[1] ?? '').split(';')) {
      const colon = decl.indexOf(':');
      if (colon <= 0) continue;
      const value = decl
        .slice(colon + 1)
        .replace(/--[\w-]+/g, ' ')
        .replace(/(['"])[^'"]*\1/g, ' ');
      for (const word of value.match(/(?<![\w-])[a-z][\w-]*/gi) ?? []) {
        if (NAMED_COLOURS.has(word.toLowerCase())) found.push(word);
      }
    }
  }
  return found;
}

/** SVG paint set in code, `fill="..."` or `stroke: '...'`, other than none and currentColor. */
function svgPaints(text: string): string[] {
  return [...text.matchAll(/\b(?:fill|stroke)\s*[:=]\s*\{?\s*(['"`])([^'"`]*)\1/g)]
    .map((m) => m[2] ?? '')
    .filter((paint) => !/^(none|currentColor)$/.test(paint));
}

/**
 * A style key that can carry a colour. Broad on purpose: `borderRadius` matches
 * too, and belongs in app.css anyway.
 */
const COLOUR_KEY = /color|background|border|shadow|outline|fill|stroke/i;

/** Every key that a colour could be set through inline, in `style={{ ... }}` and on `.style`. */
function inlineStyleKeys(text: string): { key: string; at: string }[] {
  const keys: { key: string; at: string }[] = [];
  for (const m of text.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const k of (m[1] ?? '').matchAll(/(['"]?)([\w-]+)\1\s*:/g)) keys.push({ key: k[2] ?? '', at: m[0] });
  }
  for (const m of text.matchAll(/\.style\.(\w+)\s*=(?!=)|\.setProperty\(\s*(['"`])([\w-]+)\2/g)) {
    keys.push({ key: m[1] ?? m[3] ?? '', at: m[0] });
  }
  return keys;
}

/** Custom properties declared in this CSS, in order (a declaration, not a `.x--y:hover` selector). */
function definedTokens(text: string): string[] {
  return [...text.matchAll(/(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? '');
}

describe('colour tokens (theme.4)', () => {
  it('reads one token block at least, the light one', () => {
    expect(TOKEN_BLOCKS.length).toBeGreaterThanOrEqual(1);
    expect(definedTokens(TOKEN_BLOCKS[0] ?? '')).toContain('--bg');
  });

  it('notices a colour written out in CSS, so the checks below can fail', () => {
    expect(colourLiterals('a { color: #fff; border: 1px solid #A1B2C3; }')).toEqual(['#fff', '#A1B2C3']);
    expect(colourLiterals('a { box-shadow: 0 0 2px rgb(0 0 0 / 8%); color: rgba(1, 2, 3, 0.5); }')).toEqual([
      'rgb(0 0 0 / 8%)',
      'rgba(1, 2, 3, 0.5)'
    ]);
    expect(colourLiterals('a { background: rgb(0 0 0 / var(--tint-hover)); }')).toEqual([
      'rgb(0 0 0 / var(--tint-hover))'
    ]);
    expect(
      colourLiterals(
        'a { color: hsl(0 0% 0%); background: oklch(98% 0.01 280); border-color: HWB(250 98% 0%); }'
      )
    ).toEqual(['hsl(0 0% 0%)', 'oklch(98% 0.01 280)', 'HWB(250 98% 0%)']);
    expect(
      colourLiterals(
        'a { color: lab(50% 40 59); fill: oklab(59% 0.1 0.1); stroke: color(display-p3 1 0 0); }'
      )
    ).toEqual(['lab(50% 40 59)', 'oklab(59% 0.1 0.1)', 'color(display-p3 1 0 0)']);
    expect(colourLiterals('a { outline-color: lch(calc(50% + 2%) 72 50); }')).toEqual([
      'lch(calc(50% + 2%) 72 50)'
    ]);
    expect(
      colourLiterals(
        'a { box-shadow: 0 1px 3px rgb(var(--shadow-rgb) / 8%); background: color-mix(in srgb, var(--accent-fill) 12%, transparent); }'
      )
    ).toEqual([]);
    expect(colourLiterals('<p>it&#8217;s</p> #root {} url(#face)')).toEqual(['#face']);

    expect(
      namedColours('a { color: white; } b { box-shadow: 0 0 1px black; border: 1px solid var(--x, Red); }')
    ).toEqual(['white', 'black', 'Red']);
    expect(namedColours('a { background: Canvas; color: CanvasText; }')).toEqual(['Canvas', 'CanvasText']);
    expect(
      namedColours(
        "a { white-space: nowrap; color: currentColor; background: transparent; border-color: inherit; } b { font-family: 'Gold Sans', serif; color: var(--cat-red); animation: lock-spin 1s; }"
      )
    ).toEqual([]);
    expect(NAMED_COLOURS.size).toBe(148 + 19);
  });

  it('notices a colour set from code, so the checks below can fail', () => {
    expect(svgPaints(`<path fill="red" /> { fill: 'none', stroke: 'currentColor' } stroke={'#fff'}`)).toEqual(
      ['red', '#fff']
    );
    expect(
      inlineStyleKeys(
        "style={{ margin: 0, borderBottomColor: 'red', '--x': 1 }} el.style.color = 'red'; el.style.setProperty('outline-color', x)"
      ).map((k) => k.key)
    ).toEqual(['margin', 'borderBottomColor', '--x', 'color', 'outline-color']);
  });

  it('writes no colour in app.css outside the token blocks', () => {
    expect(colourLiterals(OUTSIDE_TOKENS)).toEqual([]);
    expect(namedColours(OUTSIDE_TOKENS)).toEqual([]);
  });

  it('writes no colour in the renderer code', () => {
    const offenders = SOURCES.flatMap(({ file, text }) =>
      [...colourLiterals(text), ...svgPaints(text)].map((c) => `${file}: ${c}`)
    );
    expect(offenders).toEqual([]);
  });

  it('sets no colour in an inline style, so a theme reaches every colour through app.css', () => {
    const offenders = SOURCES.flatMap(({ file, text }) =>
      inlineStyleKeys(text)
        .filter(({ key }) => COLOUR_KEY.test(key))
        .map(({ key, at }) => `${file}: ${key} in ${at}`)
    );
    expect(offenders).toEqual([]);
  });

  it('defines every custom property a var() names', () => {
    const defined = new Set(definedTokens(CSS));
    const used = new Set(
      [CSS, ...SOURCES.map((s) => s.text)].flatMap((text) =>
        [...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] ?? '')
      )
    );
    expect(defined).toContain('--cat');
    expect(used).toContain('--tint-pending');
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('uses every category token it defines', () => {
    const categories = TOKEN_BLOCKS.flatMap(definedTokens).filter((name) => name.startsWith('--cat-'));
    expect(categories.length).toBeGreaterThan(0);
    const unused = [...new Set(categories)].filter((name) => !OUTSIDE_TOKENS.includes(`var(${name})`));
    expect(unused).toEqual([]);
  });

  /* theme.4 kept seven category tokens and deleted the six nothing read, so
     typo took spelling's colour, agreement and tense grammar's, redundancy and
     awkward word-choice's, and formatting other's. polish.16 gave each of the
     thirteen a token of its own, in both blocks, in CHANGE_CATEGORIES' order. */
  it('keeps a colour token for each of the thirteen categories, in both blocks (polish.16)', () => {
    for (const block of TOKEN_BLOCKS) {
      const categories = definedTokens(block).filter((name) => name.startsWith('--cat-'));
      expect(categories).toEqual(CHANGE_CATEGORIES.map((category) => `--cat-${category}`));
    }
    expect(TOKEN_BLOCKS).toHaveLength(2);
  });

  it('gives every change category its own colour through its class, borrowing none (polish.16)', () => {
    const light = new Set(definedTokens(TOKEN_BLOCKS[0] ?? ''));
    const borrowed = CHANGE_CATEGORIES.filter((category) => {
      const value = declsFor(`.cat-${category}`).get('--cat');
      return value !== `var(--cat-${category})` || !light.has(`--cat-${category}`);
    });
    expect(borrowed).toEqual([]);
    // One rule per class: a list such as `.cat-spelling, .cat-typo` would make two share a colour again.
    const shared = RULES.filter((r) => r.selectors.filter((s) => /^\.cat-[a-z-]+$/.test(s)).length > 1).map(
      (r) => r.selectors.join(', ')
    );
    expect(shared).toEqual([]);
  });

  it('fills primary buttons and the active Setup tab from --accent-fill with --on-accent text, and keeps --accent for text', () => {
    for (const selector of ['button.primary', '.setup__tab--active']) {
      const decls = declsFor(selector);
      expect(decls.get('background')).toBe('var(--accent-fill)');
      expect(decls.get('border-color')).toBe('var(--accent-fill)');
      expect(decls.get('color')).toBe('var(--on-accent)');
    }
    // Hover and press darken both the same way, in one rule each (theme.12 keeps
    // them in the fill's family). The rules' `:not(:disabled, ...)` holds a
    // comma, so they are found by how their selectors start.
    for (const [state, token] of [
      ['hover', '--accent-hover'],
      ['active', '--accent-active']
    ] as const) {
      const rule = RULES.find((r) =>
        ['button.primary', 'button.setup__tab--active'].every((button) =>
          r.selectors.some((s) => s.startsWith(`${button}:${state}:not(`))
        )
      );
      expect(rule?.decls.get('background')).toBe(`var(${token})`);
      expect(rule?.decls.get('border-color')).toBe(`var(${token})`);
    }
    expect(declsFor('button.link').get('color')).toBe('var(--accent)');
  });

  it("draws the paragraph box's border and glow in --accent, not the buttons' fill (theme.12)", () => {
    // One colour round the box: the turquoise of the buttons beside a blue border read as two.
    const shadow = (selector: string): string =>
      (declsFor(selector).get('box-shadow') ?? '').replace(/\s+/g, ' ');
    expect(declsFor('.para-editor__area').get('border')).toBe('1px solid var(--accent)');
    expect(shadow('.para-editor__area')).toBe('0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent)');
    expect(shadow('.para-editor__area:focus')).toBe(
      '0 0 0 3px color-mix(in srgb, var(--accent) 24%, transparent)'
    );
  });
});

describe('dark block (theme.5)', () => {
  const blocks = tokenBlocks(APP_CSS);
  /** Colour tokens: everything but the fonts, which are the same in both themes and live in the light block only. */
  const colourTokens = (scheme: Scheme): string[] =>
    [...blocks[scheme].tokens.keys()].filter((name) => !name.startsWith('--font-'));

  it('finds the dark block inside @media (prefers-color-scheme: dark), declaring the dark color-scheme', () => {
    expect(blocks.light.colorScheme).toBe('light');
    expect(blocks.dark.colorScheme).toBe('dark');
    expect(TOKEN_BLOCKS).toHaveLength(2);
  });

  it('gives every light token a dark value and has none of its own', () => {
    const light = colourTokens('light');
    const dark = colourTokens('dark');
    expect(light.length).toBeGreaterThan(40);
    expect(light.filter((name) => !dark.includes(name))).toEqual([]);
    expect(dark.filter((name) => !light.includes(name))).toEqual([]);
    expect([...blocks.dark.tokens.keys()].filter((name) => name.startsWith('--font-'))).toEqual([]);
  });

  it('notices a token missing from either block, so the parity check can fail', () => {
    const one = tokenBlocks(
      ':root { --bg: #fff; --x: #000; color-scheme: light; } @media (prefers-color-scheme: dark) { :root { --bg: #000; } }'
    );
    expect([...one.light.tokens.keys()].filter((name) => !one.dark.tokens.has(name))).toEqual(['--x']);
    expect(() => tokenBlocks(':root { --bg: #fff; }')).toThrow(/dark/);
  });

  it('colours links, visited or not, with --accent', () => {
    expect(declsFor('a').get('color')).toBe('var(--accent)');
    expect(declsFor('a:visited').get('color')).toBe('var(--accent)');
  });

  it("gives form controls the theme's ink and the password field a panel, with no weight of their own", () => {
    expect(CSS).toMatch(/:where\(select, input, textarea\) \{\s*color: var\(--ink\);\s*\}/);
    expect(declsFor(":where(input[type='password'])").get('background-color')).toBe('var(--panel)');
    expect(declsFor('body').get('accent-color')).toBe('var(--accent-fill)');
  });

  it('frames the password field like the other text fields, since its background turns off the browser frame', () => {
    // With a background of its own the field is no longer drawn by the browser
    // and falls back to a 2 px inset border, dark above and light below.
    const password = declsFor(":where(input[type='password'])");
    const textField = declsFor("input[type='text']");
    expect(password.get('border')).toBe('1px solid var(--border)');
    for (const property of ['border', 'border-radius', 'padding']) {
      expect(password.get(property)).toBe(textField.get(property));
    }
    // .modal__key-input gives the key its monospace font, which a `font` here would undo.
    expect([...password.keys()].filter((property) => property.startsWith('font'))).toEqual([]);
  });

  it('sets the active find match in --find-active-ink', () => {
    expect(declsFor('::highlight(find-active)').get('color')).toBe('var(--find-active-ink)');
  });

  it('rings a focused suggestion in the active paragraph within the 2 px the focus already takes (theme.8)', () => {
    // The focus yellow on the active paragraph's yellow is 1.05:1 in light.
    const shadow = (selector: string): string =>
      (declsFor(selector).get('box-shadow') ?? '').replace(/\s+/g, ' ');
    expect(shadow('.hunk--focused')).toBe('0 0 0 2px var(--focus-bg)');
    expect(shadow('.para--active .hunk--focused')).toBe(
      '0 0 0 1px var(--focus-bg), 0 0 0 2px var(--active-ring)'
    );
  });

  it('tells the page before the stylesheet loads that both schemes are supported', () => {
    const html = readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta name="color-scheme" content="light dark" \/>/);
  });
});

/* polish.1: selected text has the app's own band, `--selection-bg`, with
   `--selection-ink`; the prose has a faint band of its own,
   `--selection-prose-bg`, where the text keeps its own colour (so the active
   find match keeps its dark ink on the dark orange), except in a text field,
   the paragraph box, which takes the first (the polish.1 review); and a filled
   button has no band. themeContrast.test.ts holds the pairs and how plainly
   each band shows. */
describe('selection (polish.1)', () => {
  const FILLED = [
    'button.primary::selection',
    'button.primary ::selection',
    '.setup__tab--active::selection',
    '.setup__tab--active ::selection'
  ];
  const PROSE_FIELDS = ['.prose input::selection', '.prose textarea::selection'];

  it('paints every selection in the band with --selection-ink', () => {
    const decls = declsFor('::selection');
    expect(decls.get('background-color')).toBe('var(--selection-bg)');
    expect(decls.get('color')).toBe('var(--selection-ink)');
  });

  it("keeps the prose in its own colour on the prose's faint band", () => {
    expect([...declsFor('.prose ::selection')]).toEqual([
      ['background-color', 'var(--selection-prose-bg)'],
      ['color', 'currentColor']
    ]);
  });

  it('gives the paragraph box, a field in the prose, the band of every other field', () => {
    const rule = RULES.find((r) => PROSE_FIELDS.every((s) => r.selectors.includes(s)));
    expect(rule?.selectors).toEqual(PROSE_FIELDS);
    // `.prose textarea::selection` outweighs `.prose ::selection` by one element.
    expect([...(rule?.decls ?? [])]).toEqual([
      ['background-color', 'var(--selection-bg)'],
      ['color', 'var(--selection-ink)']
    ]);
  });

  it('draws no band on a filled button or the active Setup tab, whose text keeps --on-accent', () => {
    const rule = RULES.find((r) => FILLED.every((s) => r.selectors.includes(s)));
    expect(rule?.selectors).toEqual(FILLED);
    expect(rule?.decls.get('background-color')).toBe('transparent');
    expect(rule?.decls.get('color')).toBe('currentColor');
  });

  it('has no other ::selection rule', () => {
    const selections = RULES.flatMap((r) => r.selectors).filter((s) => s.includes('::selection'));
    expect(selections.sort()).toEqual(
      ['::selection', '.prose ::selection', ...PROSE_FIELDS, ...FILLED].sort()
    );
  });

  it('keeps ghost text out of every selection', () => {
    // A ghost drawn over the prose's band is the reason that band is light (11.3 e).
    expect(declsFor('.hunk__ghost').get('user-select')).toBe('none');
    expect(declsFor('.para__rail').get('user-select')).toBe('none');
  });
});

/* polish.2: every scroller has the app's own scrollbar, the author's pick (the
   sheet's D, its thumb a shade darker): a 16 px gutter in --scrollbar-track
   with a 1 px --border line on its inner edge, a square thumb in the three
   thumb tokens, and an arrow at each end in --ink-faint, --ink-soft under the
   pointer. themeContrast.test.ts holds the thumb to its bands and the arrows to
   3:1. */
describe('scrollbars (polish.2)', () => {
  const SCROLLBAR_SELECTORS = RULES.flatMap((r) => r.selectors).filter((s) =>
    s.includes('::-webkit-scrollbar')
  );
  /* Each end's arrow: where its 78 degree wedge opens, from its point on the
     edge the arrow points to, and the box it is drawn in, 8 by 5 px, 5 by 8
     sideways. Without the box the wedge fills the whole 16 px button. */
  const ARROWS: Record<string, { from: string; size: string }> = {
    'vertical:decrement': { from: 'from 141deg at 50% 0', size: '8px 5px' },
    'vertical:increment': { from: 'from -39deg at 50% 100%', size: '8px 5px' },
    'horizontal:decrement': { from: 'from 51deg at 0 50%', size: '5px 8px' },
    'horizontal:increment': { from: 'from 231deg at 100% 50%', size: '5px 8px' }
  };
  const ENDS = Object.keys(ARROWS);

  it('draws every scrollbar 16 px wide in its gutter, with a square thumb in the thumb tokens', () => {
    expect([...declsFor('::-webkit-scrollbar')]).toEqual([
      ['width', '16px'],
      ['height', '16px'],
      ['background', 'var(--scrollbar-track)']
    ]);
    // 10 px of thumb between 3 px of clear track on each side, with square corners.
    expect([...declsFor('::-webkit-scrollbar-thumb')]).toEqual([
      ['background-color', 'var(--scrollbar-thumb)'],
      ['background-clip', 'padding-box'],
      ['border', '3px solid transparent'],
      ['border-radius', '0']
    ]);
    expect(declsFor('::-webkit-scrollbar-thumb:hover').get('background-color')).toBe(
      'var(--scrollbar-thumb-hover)'
    );
    expect(declsFor('::-webkit-scrollbar-thumb:active').get('background-color')).toBe(
      'var(--scrollbar-thumb-active)'
    );
    expect(declsFor('::-webkit-scrollbar-track:vertical').get('border-left')).toBe('1px solid var(--border)');
    expect(declsFor('::-webkit-scrollbar-track:horizontal').get('border-top')).toBe(
      '1px solid var(--border)'
    );
    expect(declsFor('::-webkit-scrollbar-corner').get('background')).toBe('var(--scrollbar-track)');
  });

  it('draws one arrow at each end, in --ink-faint and in --ink-soft under the pointer', () => {
    // One 16 px button at each end on the gutter, its arrow drawn once in the middle.
    expect([...declsFor('::-webkit-scrollbar-button:single-button')]).toEqual([
      ['display', 'block'],
      ['width', '16px'],
      ['height', '16px'],
      ['background-color', 'var(--scrollbar-track)'],
      ['background-repeat', 'no-repeat'],
      ['background-position', 'center']
    ]);
    // The gutter's 1 px line runs on through the buttons to both ends of the bar.
    expect([...declsFor('::-webkit-scrollbar-button:single-button:vertical')]).toEqual([
      ['border-left', '1px solid var(--border)']
    ]);
    expect([...declsFor('::-webkit-scrollbar-button:single-button:horizontal')]).toEqual([
      ['border-top', '1px solid var(--border)']
    ]);
    for (const [end, { from, size }] of Object.entries(ARROWS)) {
      const at = `::-webkit-scrollbar-button:single-button:${end}`;
      expect([...declsFor(at)]).toEqual([
        ['background-image', `conic-gradient(${from}, var(--ink-faint) 78deg, transparent 0)`],
        ['background-size', size]
      ]);
      expect([...declsFor(`${at}:hover`)]).toEqual([
        ['background-image', `conic-gradient(${from}, var(--ink-soft) 78deg, transparent 0)`]
      ]);
    }
  });

  it("never scopes a scrollbar rule with :root, which drops the thumb's hover and the arrows", () => {
    expect(SCROLLBAR_SELECTORS.length).toBeGreaterThanOrEqual(10 + 2 * ENDS.length);
    expect(SCROLLBAR_SELECTORS.filter((s) => /:root|:scope/.test(s))).toEqual([]);
    // The bar is the bare rules for every scroller; a scroller's own rules only round its corners.
    const own = RULES.filter((r) =>
      r.selectors.some((s) => s.includes('::-webkit-scrollbar') && !s.startsWith('::-webkit-scrollbar'))
    );
    expect([...new Set(own.flatMap((r) => [...r.decls.keys()]))].sort()).toEqual([
      'border-bottom-right-radius',
      'border-radius',
      'border-top-right-radius'
    ]);
  });

  it('gives the bar of a scroller with rounded corners the corners of its box, inside its border', () => {
    // Drawn square, the gutter showed past a dialog's curve.
    const rounded = SCROLLERS.filter((s) => !/^0(px)?$/.test(declsFor(s).get('border-radius') ?? '0'));
    expect([...rounded].sort()).toEqual(['.diagnostics__text', '.legend', '.modal']);
    for (const s of rounded) {
      const decls = declsFor(s);
      const r = parseFloat(decls.get('border-radius') ?? '') - parseFloat(decls.get('border') ?? '');
      expect(declsFor(`${s}::-webkit-scrollbar`).get('border-radius')).toBe(`0 ${r}px ${r}px 0`);
      const button = `${s}::-webkit-scrollbar-button:single-button:vertical`;
      expect(declsFor(`${button}:decrement`).get('border-top-right-radius')).toBe(`${r}px`);
      expect(declsFor(`${button}:increment`).get('border-bottom-right-radius')).toBe(`${r}px`);
    }
  });

  it('rounds the bar and the resize handle of a field that can be made taller to the field', () => {
    // A text field scrolls without an overflow rule; its lower corner is the handle's.
    const fields = [
      ...new Set(
        RULES.filter((r) => /^(vertical|both)$/.test(r.decls.get('resize') ?? '')).flatMap((r) => r.selectors)
      )
    ];
    expect(fields.sort()).toEqual(['.editor__area', '.paste-field textarea']);
    for (const s of fields) {
      const decls = declsFor(s);
      const r = `${parseFloat(decls.get('border-radius') ?? '') - parseFloat(decls.get('border') ?? '')}px`;
      expect(declsFor(`${s}::-webkit-scrollbar`).get('border-top-right-radius')).toBe(r);
      expect(
        declsFor(`${s}::-webkit-scrollbar-button:single-button:vertical:decrement`).get(
          'border-top-right-radius'
        )
      ).toBe(r);
      expect(declsFor(`${s}::-webkit-scrollbar-corner`).get('border-bottom-right-radius')).toBe(r);
      expect(declsFor(`${s}::-webkit-resizer`).get('border-bottom-right-radius')).toBe(r);
    }
  });

  it("draws the corner as the gutter and the resize handle in --ink-faint, not the browser's framed one", () => {
    expect([...declsFor('::-webkit-scrollbar-corner')]).toEqual([
      ['background', 'var(--scrollbar-track)'],
      ['border-left', '1px solid var(--border)']
    ]);
    const handle = (declsFor('::-webkit-resizer').get('background') ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')');
    expect(handle).toMatch(/^linear-gradient\(135deg, .*\) right 3px bottom 3px \/ 9px 9px no-repeat$/);
    expect([...handle.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])).toEqual([
      '--ink-faint',
      '--ink-faint'
    ]);
  });

  it("leaves every scroller to these rules: no scrollbar-color, and scrollbar-width only to hide the chips' row's", () => {
    // Either one, but for `auto`, gives the element the browser's own bar instead.
    expect(RULES.filter((r) => r.decls.has('scrollbar-color')).map((r) => r.selectors.join(', '))).toEqual(
      []
    );
    expect(
      RULES.filter((r) => r.decls.has('scrollbar-width')).map((r) => [
        r.selectors.join(', '),
        r.decls.get('scrollbar-width')
      ])
    ).toEqual([['.chips', 'none']]);
  });
});

/**
 * Every light value. theme.4 changed nothing in light, so a light screenshot is
 * read against theme.4's list of deliberate light differences in PLAN.md. The
 * contrast pairs and WINDOW_BACKGROUND notice only some changes (a lighter
 * --panel-alt or another --border passes both), so a light value changes here
 * and on that list together, on purpose.
 */
const LIGHT_VALUES: Record<string, string> = {
  // From before theme.4 (db32abe), unchanged.
  '--bg': '#f7f5f1',
  '--panel': '#fffdfa',
  '--panel-alt': '#f1eee8',
  '--border': '#ddd7cc',
  '--border-strong': '#c6bfb2',
  '--ink': '#23201c',
  '--ink-soft': '#6d675e',
  '--accent': '#3b5bdb',
  '--accept': '#2f7a4a',
  '--danger': '#b3261e',
  '--font-ui': "'Segoe UI', system-ui, -apple-system, sans-serif",
  '--font-prose': "Literata, Georgia, 'Times New Roman', serif",
  '--cat-spelling': '#b3261e',
  '--cat-grammar': '#1f6f8b',
  '--cat-punctuation': '#7a4fb5',
  '--cat-consistency': '#2f7a4a',
  // Darker since theme.5, as Appendix D question 9 approved: --ink-faint was
  // #9b948a, --dismiss #a1998c, --warn and --cat-word-choice #8a6d1f.
  '--ink-faint': '#8a8378',
  '--dismiss': '#8a8378',
  '--warn': '#84681c',
  '--cat-word-choice': '#84681c',
  // The icon's turquoise since theme.12, deepened under white text: --accent-fill
  // was #3b5bdb (added by theme.4, the --accent blue), --accent-hover #2d49b8
  // and --accent-active #243c9a.
  '--accent-fill': '#147a86',
  '--accent-hover': '#116670',
  '--accent-active': '#0e555e',
  // Added by theme.4 (PLAN 11.3 e), each equal to the literal it replaced.
  '--on-accent': '#ffffff',
  '--focus-bg': '#fff3bf',
  '--para-active-bg': '#fff8dd',
  '--para-flash-bg': '#fff6c9',
  '--selected-bg': '#e7ecff',
  '--active-ring': '#f2dd93',
  '--badge-pending-bg': '#fff3bf',
  '--badge-pending-border': '#f0dfa0',
  '--badge-pending-ink': '#6b5600',
  '--find-bg': '#ffe9a8',
  '--find-active-bg': '#ffb64d',
  '--find-active-ink': 'var(--ink)',
  '--warn-bg': '#fdf8ec',
  '--warn-bg-strong': '#fdf7e2',
  '--warn-border': '#e5d49a',
  '--danger-bg': '#fdeceb',
  '--editor-bg': '#fbfaff',
  '--shadow-rgb': '35 32 28',
  '--backdrop': 'rgb(35 32 28 / 42%)',
  '--modal-shadow': 'rgb(0 0 0 / 22%)',
  '--hover-overlay': 'rgb(0 0 0 / 8%)',
  '--tint-pending': '9%',
  '--tint-hover': '18%',
  '--tint-decided-hover': '16%',
  '--tint-small': '16%',
  '--tint-small-hover': '26%',
  // Added by apply.4: the unsaved dot and count, in ember (it was the --accent blue dot).
  '--unsaved': '#ad4b0d',
  // Added by files.11: the conflict copy badge in the chapter list.
  '--badge-conflict-bg': '#fde8e6',
  '--badge-conflict-border': '#f0c4bf',
  '--badge-conflict-ink': '#9c2a1f',
  // Added by polish.1: selected text, which had the browser's blue band and white text;
  // two bands since its review, the prose's the faint one.
  '--selection-bg': 'rgb(0 190 200 / 45%)',
  '--selection-prose-bg': 'rgb(70 255 255 / 20%)',
  '--selection-ink': 'var(--ink)',
  // Added by polish.2: the scrollbar's gutter and thumb, where the browser drew its own bar.
  '--scrollbar-track': 'var(--panel-alt)',
  '--scrollbar-thumb': '#d0cabe',
  '--scrollbar-thumb-hover': '#c5beb0',
  '--scrollbar-thumb-active': '#b7b0a2',
  // Added by polish.12: the accepted tick on a suggestion row, which was --accept.
  '--accept-strong': '#12873b',
  // Added by polish.14: how much of --ink-faint a decided row's other two buttons keep,
  // where polish.12 drew them a thinner stroke in --ink-faint itself.
  '--row-fade': '35%',
  // polish.16: a colour for each category. Homophone was #a3341c, a red beside
  // spelling's, and other #6d675e, the comments' --ink-soft; typo took spelling's
  // colour, agreement and tense grammar's, redundancy and awkward word-choice's,
  // and formatting other's.
  '--cat-typo': '#576909',
  '--cat-homophone': '#016dba',
  '--cat-agreement': '#aa5106',
  '--cat-tense': '#9f3887',
  '--cat-redundancy': '#2e756e',
  '--cat-awkward': '#c11e59',
  '--cat-formatting': '#905f4d',
  '--cat-other': '#484e70'
};

/**
 * Every dark value: PLAN 11.3 (e)'s starting values, with --find-bg darkened by
 * theme.5. theme.8 looked at every surface in both themes and kept them all,
 * the tint shares included (11.3 e says why), theme.12 turned the filled
 * buttons turquoise, and polish.16 gave each category a colour of its own. A
 * value changes here and in 11.3 (e) together.
 */
const DARK_VALUES: Record<string, string> = {
  '--bg': '#1c1a17',
  '--panel': '#24221e',
  '--panel-alt': '#2d2a25',
  '--border': '#3b3731',
  '--border-strong': '#575148',
  '--ink': '#ebe6dc',
  '--ink-soft': '#bdb5a8',
  '--ink-faint': '#968e82',
  '--accent': '#9db1ff',
  // theme.12: the icon's dots and rim under near-black text; they were #4263eb,
  // #3653d6 and #2c45b8 under #ffffff.
  '--accent-fill': '#4fd8e0',
  '--accent-hover': '#4dc5ce',
  '--accent-active': '#39b1bc',
  '--on-accent': '#16130f',
  '--accept': '#6cc28b',
  // polish.12: the accepted tick on a suggestion row, a stronger green than --accept.
  '--accept-strong': '#4fd483',
  '--dismiss': '#968e82',
  '--danger': '#ff8a80',
  '--warn': '#e0b955',
  // apply.4: the ember of the logo's original palette (11.3 o).
  '--unsaved': '#ff8a3d',
  '--focus-bg': '#4a3f14',
  '--para-active-bg': '#2f2a1a',
  '--para-flash-bg': '#3d3415',
  '--selected-bg': '#26304f',
  '--active-ring': '#8a7426',
  '--badge-pending-bg': '#3d3415',
  '--badge-pending-border': '#5c4f1f',
  '--badge-pending-ink': '#e8c95a',
  // files.11: the conflict copy badge.
  '--badge-conflict-bg': '#42221e',
  '--badge-conflict-border': '#6b3530',
  '--badge-conflict-ink': '#ff9e94',
  // #5e4b10 in the starting values; --ink-faint on it gave 2.61:1.
  '--find-bg': '#52420e',
  '--find-active-bg': '#e09a3a',
  '--find-active-ink': '#16130f',
  '--warn-bg': '#33291a',
  '--warn-bg-strong': '#33291a',
  '--warn-border': '#5c4a22',
  '--danger-bg': '#3a1f1c',
  '--editor-bg': '#20222b',
  // polish.1: the selection bands, the dots' hue deep, and the ink.
  '--selection-bg': 'rgb(0 120 128 / 55%)',
  '--selection-prose-bg': 'rgb(0 90 95 / 20%)',
  '--selection-ink': 'var(--ink)',
  // polish.2: the scrollbar's gutter, and its thumb a shade off it in three steps.
  '--scrollbar-track': 'var(--panel-alt)',
  '--scrollbar-thumb': '#454139',
  '--scrollbar-thumb-hover': '#4e4940',
  '--scrollbar-thumb-active': '#585248',
  '--shadow-rgb': '0 0 0',
  '--backdrop': 'rgb(0 0 0 / 60%)',
  '--modal-shadow': 'rgb(0 0 0 / 45%)',
  '--hover-overlay': 'rgb(255 255 255 / 10%)',
  '--tint-pending': '9%',
  '--tint-hover': '18%',
  '--tint-decided-hover': '16%',
  '--tint-small': '16%',
  '--tint-small-hover': '26%',
  // polish.14: a decided row's other two buttons, as in light.
  '--row-fade': '35%',
  '--cat-spelling': '#ff7b72',
  '--cat-grammar': '#5cc0e0',
  '--cat-punctuation': '#b994f5',
  '--cat-word-choice': '#d9b44a',
  '--cat-consistency': '#6cc28b',
  // polish.16: a colour for each category, on the hues light has; homophone was
  // #f2875e and other #a8a092, and the other six borrowed as in light.
  '--cat-typo': '#b6c973',
  '--cat-homophone': '#30a9ff',
  '--cat-agreement': '#ef8e3e',
  '--cat-tense': '#fe9dee',
  '--cat-redundancy': '#34b7af',
  '--cat-awkward': '#ff78a8',
  '--cat-formatting': '#f5b89c',
  '--cat-other': '#a2a0ba'
};

describe('token values (theme.4, theme.5)', () => {
  const blocks = tokenBlocks(APP_CSS);

  it("keeps every light value, so a change in light is one made on purpose and put on theme.4's list", () => {
    expect(Object.fromEntries(blocks.light.tokens)).toEqual(LIGHT_VALUES);
  });

  it('keeps the dark values of PLAN 11.3 (e)', () => {
    expect(Object.fromEntries(blocks.dark.tokens)).toEqual(DARK_VALUES);
  });
});

const scrolls = (decls: Map<string, string>): boolean =>
  ['overflow', 'overflow-x', 'overflow-y'].some((p) => /\b(auto|scroll)\b/.test(decls.get(p) ?? ''));

const SCROLLERS = [...new Set(RULES.filter((r) => scrolls(r.decls)).flatMap((r) => r.selectors))].sort();

/**
 * Why a scroller's background is not an opaque colour from a token, or null
 * when it is: it must be one `var()` of a token whose value, followed through
 * other tokens, is a colour with alpha 1 in light and in dark. A translucent
 * token such as `--hover-overlay`, a share such as `--tint-pending`, which is
 * no colour, and anything but one `var()` all fail (C.48).
 */
function opaqueBackgroundProblem(background: string, blocks: Record<Scheme, TokenBlock>): string | null {
  const token = /^var\((--[\w-]+)\)$/.exec(background)?.[1];
  if (!token) return `not one colour token: ${background || '(none)'}`;
  for (const scheme of SCHEMES) {
    let alpha: number;
    try {
      alpha = parseColour(resolveToken(blocks, scheme, token)).a;
    } catch {
      return `${scheme}: ${token} is not a colour`;
    }
    if (alpha !== 1) return `${scheme}: ${token} has alpha ${alpha}`;
  }
  return null;
}

describe('scrollers (theme.1, panel.1)', () => {
  const blocks = tokenBlocks(APP_CSS);

  it('finds the scrollers the plan names', () => {
    for (const name of [
      '.center',
      '.body--single',
      '.setup',
      '.rows',
      '.side__lower',
      '.side__body',
      '.side__focus-body',
      // The category chips' one row, sideways (polish.6).
      '.chips'
    ]) {
      expect(SCROLLERS).toContain(name);
    }
  });

  it('gives every scroller an opaque background from a colour token, in both themes', () => {
    const problems = SCROLLERS.flatMap((selector) => {
      const decls = declsFor(selector);
      const background = decls.get('background') ?? decls.get('background-color') ?? '';
      const problem = opaqueBackgroundProblem(background, blocks);
      return problem ? [`${selector}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it('notices a scroller background that is not opaque, so the check above can fail', () => {
    expect(opaqueBackgroundProblem('var(--bg)', blocks)).toBeNull();
    // Light's value is var(--ink), followed to its colour.
    expect(opaqueBackgroundProblem('var(--find-active-ink)', blocks)).toBeNull();
    expect(opaqueBackgroundProblem('var(--hover-overlay)', blocks)).toMatch(
      /^light: --hover-overlay has alpha/
    );
    expect(opaqueBackgroundProblem('var(--backdrop)', blocks)).toMatch(/^light: --backdrop has alpha/);
    expect(opaqueBackgroundProblem('var(--tint-pending)', blocks)).toBe(
      'light: --tint-pending is not a colour'
    );
    expect(opaqueBackgroundProblem('var(--no-such-token)', blocks)).toBe(
      'light: --no-such-token is not a colour'
    );
    expect(opaqueBackgroundProblem('transparent', blocks)).toBe('not one colour token: transparent');
    expect(opaqueBackgroundProblem('', blocks)).toBe('not one colour token: (none)');
    expect(opaqueBackgroundProblem('color-mix(in srgb, var(--bg) 50%, transparent)', blocks)).toMatch(
      /^not one colour token/
    );
    const darkOnly = tokenBlocks(
      ':root { --x: #ffffff; color-scheme: light; } @media (prefers-color-scheme: dark) { :root { --x: rgb(0 0 0 / 50%); } }'
    );
    expect(opaqueBackgroundProblem('var(--x)', darkOnly)).toBe('dark: --x has alpha 0.5');
  });

  it('keeps the side panel itself from scrolling, so two scrollbars never sit side by side', () => {
    const side = declsFor('.side');
    expect(side.get('overflow')).toBe('clip');
    // `clip` is no scroll container, so this is what keeps the panel to its grid row.
    expect(side.get('min-height')).toBe('0');
    expect(scrolls(side)).toBe(false);
    // The list is a region of the panel now, not a box with its own cap inside a scrolling panel.
    expect(declsFor('.rows').has('max-height')).toBe(false);
  });

  it('makes the panel one scroller on the window height, which no chapter changes', () => {
    // A query on the panel's own height switched layouts between chapters in the
    // same window, as the filter chips then wrapped onto one to three rows above
    // the panel (PLAN C.49), and the status bar still takes one row or two.
    // From the polish.12 review to polish.17 one container read the panel's
    // width, to leave the rows' status word out of a narrow panel; it went
    // with the word, and there is none again.
    expect(CSS).not.toMatch(/@container/);
    expect(CSS).not.toMatch(/(^|[\s;{])container(-type|-name)?\s*:/);
    expect(declsFor('.side').has('container')).toBe(false);
    const block = /@media \(height < (\d+)px\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(block?.[1]).toBe('540');
    expect(block?.[2]).toMatch(/\.side__body \{[^}]*overflow-y: auto/);
    expect(block?.[2]).toMatch(/\.side__lower \{[^}]*overflow: visible/);
  });
});
