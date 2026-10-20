import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_CATEGORIES } from '../../src/shared/types';
import { APP_CSS, tokenBlocks, type Scheme } from '../helpers/themeTokens';

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

  it('keeps seven category colours, without the six tokens that nothing used', () => {
    const categories = definedTokens(TOKEN_BLOCKS[0] ?? '').filter((name) => name.startsWith('--cat-'));
    expect(categories).toEqual([
      '--cat-spelling',
      '--cat-homophone',
      '--cat-grammar',
      '--cat-punctuation',
      '--cat-word-choice',
      '--cat-consistency',
      '--cat-other'
    ]);
  });

  it('gives every change category a colour through its class, typo and the rest borrowing a shared one', () => {
    const light = new Set(definedTokens(TOKEN_BLOCKS[0] ?? ''));
    const colourless = CHANGE_CATEGORIES.filter((category) => {
      const value = declsFor(`.cat-${category}`).get('--cat') ?? '';
      const token = /^var\((--cat-[a-z-]+)\)$/.exec(value)?.[1];
      return !token || !light.has(token);
    });
    expect(colourless).toEqual([]);
  });

  it('fills blue buttons from --accent-fill with --on-accent text, and keeps --accent for text', () => {
    for (const selector of ['button.primary', '.setup__tab--active']) {
      const decls = declsFor(selector);
      expect(decls.get('background')).toBe('var(--accent-fill)');
      expect(decls.get('border-color')).toBe('var(--accent-fill)');
      expect(decls.get('color')).toBe('var(--on-accent)');
    }
    expect(declsFor('button.link').get('color')).toBe('var(--accent)');
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
  '--accent-hover': '#2d49b8',
  '--accent-active': '#243c9a',
  '--accept': '#2f7a4a',
  '--danger': '#b3261e',
  '--font-ui': "'Segoe UI', system-ui, -apple-system, sans-serif",
  '--font-prose': "Literata, Georgia, 'Times New Roman', serif",
  '--cat-spelling': '#b3261e',
  '--cat-homophone': '#a3341c',
  '--cat-grammar': '#1f6f8b',
  '--cat-punctuation': '#7a4fb5',
  '--cat-consistency': '#2f7a4a',
  '--cat-other': '#6d675e',
  // Darker since theme.5, as Appendix D question 9 approved: --ink-faint was
  // #9b948a, --dismiss #a1998c, --warn and --cat-word-choice #8a6d1f.
  '--ink-faint': '#8a8378',
  '--dismiss': '#8a8378',
  '--warn': '#84681c',
  '--cat-word-choice': '#84681c',
  // Added by theme.4 (PLAN 11.3 e), each equal to the literal it replaced.
  '--accent-fill': '#3b5bdb',
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
  '--badge-conflict-ink': '#9c2a1f'
};

/**
 * Every dark value: PLAN 11.3 (e)'s starting values, with --find-bg darkened by
 * theme.5. theme.8 looked at every surface in both themes and kept them all,
 * the tint shares included (11.3 e says why). A value changes here and in
 * 11.3 (e) together.
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
  '--accent-fill': '#4263eb',
  '--accent-hover': '#3653d6',
  '--accent-active': '#2c45b8',
  '--on-accent': '#ffffff',
  '--accept': '#6cc28b',
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
  '--shadow-rgb': '0 0 0',
  '--backdrop': 'rgb(0 0 0 / 60%)',
  '--modal-shadow': 'rgb(0 0 0 / 45%)',
  '--hover-overlay': 'rgb(255 255 255 / 10%)',
  '--tint-pending': '9%',
  '--tint-hover': '18%',
  '--tint-decided-hover': '16%',
  '--tint-small': '16%',
  '--tint-small-hover': '26%',
  '--cat-spelling': '#ff7b72',
  '--cat-homophone': '#f2875e',
  '--cat-grammar': '#5cc0e0',
  '--cat-punctuation': '#b994f5',
  '--cat-word-choice': '#d9b44a',
  '--cat-consistency': '#6cc28b',
  '--cat-other': '#a8a092'
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

describe('scrollers (theme.1, panel.1)', () => {
  it('finds the scrollers the plan names', () => {
    for (const name of [
      '.center',
      '.body--single',
      '.setup',
      '.rows',
      '.side__lower',
      '.side__body',
      '.side__focus-body'
    ]) {
      expect(SCROLLERS).toContain(name);
    }
  });

  it('gives every scroller an opaque background from a colour token', () => {
    const transparent = SCROLLERS.filter((selector) => {
      const decls = declsFor(selector);
      const background = decls.get('background') ?? decls.get('background-color') ?? '';
      return !/^var\(--[a-z-]+\)$/.test(background);
    });
    expect(transparent).toEqual([]);
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
    // same window, as the filter chips wrap onto one to three rows (PLAN C.49).
    expect(CSS).not.toMatch(/@container/);
    const block = /@media \(height < (\d+)px\) \{([\s\S]*?)\n\}/.exec(CSS);
    expect(block?.[1]).toBe('540');
    expect(block?.[2]).toMatch(/\.side__body \{[^}]*overflow-y: auto/);
    expect(block?.[2]).toMatch(/\.side__lower \{[^}]*overflow: visible/);
  });
});
