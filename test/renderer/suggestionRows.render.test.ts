import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { Legend } from '../../src/renderer/components/StatusBar';
import { useApp } from '../../src/renderer/state/store';
import { defaultSettings } from '../../src/shared/settings';
import type { Hunk, Review, Settings } from '../../src/shared/types';
import { YOU_CHIP } from '../../src/shared/ui/chips';
import { TAG_ABBREVIATIONS, TAG_KEYS, tagName } from '../../src/shared/ui/suggestions';

/* polish.12: the suggestions list's rows. Each has a tag of its chip in the
   chip's colour, the button of its decision stands out and the others fade,
   and the heading counts the decided ones. Show states, which wrote ACCEPTED
   or DISMISSED on the decided rows, went in polish.17: the buttons say it.
   Rendered with react-dom/server; how app.css draws them is in
   suggestionRows.test.ts, and the window checks in PLAN (polish.12 and
   polish.17) have the rest. */

const TEXT = 'The river had began to climb, and she ran for the bridge.';
const at = (needle: string): number => TEXT.indexOf(needle);

function h(id: string, original: string, replacement: string, extra: Partial<Hunk> = {}): Hunk {
  const start = at(original);
  return {
    id,
    start,
    end: start + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'grammar',
    reason: `Reason ${id}.`,
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...extra
  };
}

const PENDING = h('pending', 'began', 'begun');
const ACCEPTED = h('accepted', 'climb', 'rise', { category: 'word-choice', status: 'accepted' });
const DISMISSED = h('dismissed', 'ran', 'raced', { category: 'punctuation', status: 'dismissed' });
const MINE = h('mine', 'bridge', 'old bridge', { category: 'other', source: 'manual', status: 'accepted' });
const REWORDED = h('reworded', 'river', 'stream', { category: 'spelling', edited: true });

function review(hunks: Hunk[]): Review {
  return {
    version: 1,
    id: 'chapter--2026-10-23T09-00-00-000Z',
    sourcePath: 'C:/vault/Chapter.md',
    createdAt: '2026-10-23T09:00:00.000Z',
    updatedAt: '2026-10-23T09:00:00.000Z',
    base: { text: TEXT, hash: 'h', eol: 'lf', bom: false, trailingNewline: true },
    generator: { kind: 'manual' },
    hunks,
    comments: []
  };
}

const ALL = [PENDING, ACCEPTED, DISMISSED, MINE, REWORDED];

type AppState = ReturnType<typeof useApp.getState>;
/** The store's initial state as the file found it, which every test leaves it as. */
const PRISTINE: AppState = { ...useApp.getInitialState() };
let restore: Partial<AppState> = {};

/** The server render reads the store's initial state; a test puts what it needs there, and it goes back after.
    A key put there twice in one test goes back to what it was before the first time (polish.17 review). */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  for (const k of Object.keys(patch) as (keyof AppState)[]) {
    if (!(k in restore)) restore = { ...restore, [k]: initial[k] };
  }
  Object.assign(initial, patch);
}

/* polish.17 review: a test that called storeWith twice for one key left the
   first value in the store for every test after it, as the helper kept the
   value it found the second time. Each test now checks that the store is as
   the file found it; one that leaves a key changed fails, and the key goes
   back so the tests after it start clean. */
afterEach(() => {
  const now = useApp.getInitialState();
  Object.assign(now, restore);
  restore = {};
  const keys = [...new Set([...Object.keys(PRISTINE), ...Object.keys(now)])] as (keyof AppState)[];
  const left = keys.filter((k) => !Object.is(now[k], PRISTINE[k]));
  for (const k of left) {
    if (k in PRISTINE) Object.assign(now, { [k]: PRISTINE[k] });
    else Reflect.deleteProperty(now, k);
  }
  expect(left, 'store keys left changed').toEqual([]);
});

const render = (hunks: Hunk[] = ALL): string =>
  renderToStaticMarkup(
    createElement(SidePanel, { review: review(hunks), onSetCommentStatus: () => undefined })
  );

interface Row {
  id: string;
  cls: string;
  name: string | null;
  tag: string;
  tagCls: string;
  tagTitle: string | null;
  /** what the row's main button shows as text: its tag's letters, then its change */
  shown: string;
  acts: { cls: string; label: string | null; title: string | null; svg: string }[];
}

const attr = (html: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(html)?.[1]?.replace(/&#x27;/g, "'") ?? null;

function rows(html: string): Row[] {
  return [...html.matchAll(/<div data-row-id="([^"]+)" class="([^"]*)"[^>]*>([\s\S]*?)<\/div><\/li>/g)].map(
    (m) => {
      const body = m[3] ?? '';
      const main = /<button type="button" class="row__main"([^>]*)>([\s\S]*?)<\/button>/.exec(body);
      const tag = /<span class="(row__cat[^"]*)"([^>]*)>([^<]*)<\/span>/.exec(main?.[2] ?? '');
      const acts = [
        ...body.matchAll(/<button type="button" class="(row__act[^"]*)"([^>]*)>([\s\S]*?)<\/button>/g)
      ];
      return {
        id: m[1] ?? '',
        cls: (m[2] ?? '').replace(/\s+/g, ' ').trim(),
        name: attr(main?.[1] ?? '', 'aria-label'),
        tag: tag?.[3] ?? '',
        tagCls: tag?.[1] ?? '',
        tagTitle: attr(tag?.[2] ?? '', 'title'),
        shown: (main?.[2] ?? '').replace(/<[^>]*>/g, ''),
        acts: acts.map((a) => ({
          cls: a[1] ?? '',
          label: attr(a[2] ?? '', 'aria-label'),
          title: attr(a[2] ?? '', 'title'),
          svg: a[3] ?? ''
        }))
      };
    }
  );
}

const byId = (html: string, id: string): Row => {
  const row = rows(html).find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

describe('a tag on every row (polish.12)', () => {
  it("names the chip the suggestion is under in three letters (polish.14), in that chip's colour, where the dot was", () => {
    const html = render();
    expect(rows(html).map((r) => [r.id, r.tag, r.tagCls])).toEqual([
      ['reworded', 'SPE', 'row__cat cat-spelling'],
      ['pending', 'GRM', 'row__cat cat-grammar'],
      ['accepted', 'WRD', 'row__cat cat-word-choice'],
      ['dismissed', 'PUN', 'row__cat cat-punctuation'],
      ['mine', 'YOU', `row__cat cat-${YOU_CHIP}`]
    ]);
    expect(html).not.toContain('row__dot');
    expect(html).not.toContain('row__you');
  });

  it("gives the name in full as the tooltip, and says whose words they are on the author's own and on a reworded suggestion", () => {
    const html = render();
    expect(rows(html).map((r) => [r.id, r.tagTitle])).toEqual([
      ['reworded', 'Spelling, reworded by you'],
      ['pending', 'Grammar'],
      ['accepted', 'Word-choice'],
      ['dismissed', 'Punctuation'],
      ['mine', 'Your own words']
    ]);
  });

  it('reads the tag as the category, then the change and its decision', () => {
    const html = render();
    expect(rows(html).map((r) => r.name)).toEqual([
      'spelling, reworded by you, river \u2192 stream',
      'grammar, began \u2192 begun',
      'word-choice, climb \u2192 rise, accepted',
      'punctuation, ran \u2192 raced, dismissed',
      'you, bridge \u2192 old bridge, accepted'
    ]);
  });
});

describe("a row's buttons show its decision (polish.12)", () => {
  it('leaves a pending row as it was', () => {
    const row = byId(render(), 'pending');
    expect(row.acts.map((a) => [a.cls, a.label, a.title])).toEqual([
      ['row__act', 'Edit this suggestion', 'Edit'],
      ['row__act', 'Accept suggestion', 'Accept'],
      ['row__act', 'Dismiss suggestion', 'Dismiss']
    ]);
  });

  it('puts the accepted tick on and fades the pencil and the x', () => {
    for (const id of ['accepted', 'mine']) {
      const row = byId(render(), id);
      expect(row.acts.map((a) => [a.cls, a.label, a.title])).toEqual([
        ['row__act row__act--faded', 'Edit this suggestion', 'Edit'],
        ['row__act row__act--accepted', 'Undo accept', 'Undo accept'],
        ['row__act row__act--faded', 'Dismiss suggestion', 'Dismiss']
      ]);
    }
  });

  it('keeps the dismissed x an x, in red, saying a click puts it back, and fades the other two', () => {
    const row = byId(render(), 'dismissed');
    expect(row.acts.map((a) => [a.cls, a.label, a.title])).toEqual([
      ['row__act row__act--faded', 'Edit this suggestion', 'Edit'],
      ['row__act row__act--faded', 'Accept suggestion', 'Accept'],
      ['row__act row__act--dismissed', 'Undismiss suggestion', 'Dismissed. Click to put it back']
    ]);
    // The same x as a pending row's, not the undo arrow it used to turn into.
    const pendingX = byId(render(), 'pending').acts[2]?.svg;
    expect(row.acts[2]?.svg).toBe(pendingX);
    expect(row.acts[2]?.svg).toContain('M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5');
  });

  /* polish.14 review: a faded button's ink is translucent, and each shape of
     an icon is painted on its own, so where two meet the ink builds up. The
     pencil, drawn as two paths, showed two darker spots on every faded row,
     1.90:1 in light and 2.43 in dark where its x and tick are 1.47 and 1.74.
     One path's stroke is painted once, its subpaths and the x's crossing
     included. */
  it('draws every icon as one path, so a faded one is one even ink (polish.14 review)', () => {
    const acts = rows(render()).flatMap((r) => r.acts);
    expect(acts).toHaveLength(ALL.length * 3);
    expect(acts.filter((a) => a.cls === 'row__act row__act--faded')).toHaveLength(6);
    for (const a of acts) {
      expect(a.svg.match(/<(path|line|polyline|polygon|circle|ellipse|rect|use|g|text)\b/g)).toEqual([
        '<path'
      ]);
    }
    // The pencil's ferrule is a subpath of its outline's path.
    expect(acts[0]?.svg).toContain('M11.2 2.6 13.4 4.8 5.6 12.6 2.8 13.2 3.4 10.4zM9.8 4 12 6.2');
  });
});

/* polish.17: Show states went, and with it the ACCEPTED and DISMISSED it
   wrote on the decided rows ("With the new styles, it is unneeded", the
   author). The tick and the x say the decision, and so does the row's name. */
describe('no decision in words on a row (polish.17)', () => {
  it('shows a decided row as a pending one, its tag and its change, and its buttons say the decision', () => {
    const html = render();
    expect(rows(html).map((r) => [r.id, r.shown])).toEqual([
      ['reworded', 'SPEriver \u2192 stream'],
      ['pending', 'GRMbegan \u2192 begun'],
      ['accepted', 'WRDclimb \u2192 rise'],
      ['dismissed', 'PUNran \u2192 raced'],
      ['mine', 'YOUbridge \u2192 old bridge']
    ]);
    expect(html).not.toContain('row__status');
    expect(html).not.toMatch(/>\s*(accepted|dismissed)\s*</i);
    expect(byId(html, 'accepted').acts[1]?.cls).toBe('row__act row__act--accepted');
    expect(byId(html, 'mine').acts[1]?.cls).toBe('row__act row__act--accepted');
    expect(byId(html, 'dismissed').acts[2]?.cls).toBe('row__act row__act--dismissed');
  });

  it("still says the decision to a screen reader, in the row's name", () => {
    const html = render();
    expect(byId(html, 'accepted').name).toBe('word-choice, climb \u2192 rise, accepted');
    expect(byId(html, 'dismissed').name).toBe('punctuation, ran \u2192 raced, dismissed');
    expect(byId(html, 'mine').name).toBe('you, bridge \u2192 old bridge, accepted');
    expect(byId(html, 'pending').name).toBe('grammar, began \u2192 begun');
  });

  /* polish.17 review: the stale key goes into the store as it is, past
     normalizeSettings, which drops it (settings.test.ts holds that), so the
     panel is the one shown to ignore it. */
  it('has no Show states box, and settings that still hold its key change nothing', () => {
    const usual = render();
    expect(usual).not.toContain('Show states');
    expect(usual).not.toContain('side__states');
    expect(usual).not.toContain('type="checkbox"');
    storeWith({ settings: defaultSettings() });
    const withSettings = render();
    expect(withSettings).not.toContain('type="checkbox"');
    for (const showRowStates of [true, false]) {
      storeWith({ settings: { ...defaultSettings(), showRowStates } as unknown as Settings });
      expect(useApp.getInitialState().settings).toHaveProperty('showRowStates', showRowStates);
      expect(render(), String(showRowStates)).toBe(withSettings);
    }
  });
});

describe('the legend lists the tags (polish.14)', () => {
  it('draws every tag as a row does, in the order of the chips, each with its name', () => {
    const html = renderToStaticMarkup(createElement(Legend, { onClose: () => undefined }));
    const item =
      /<li><span class="legend__swatch legend__swatch--tag"><\/span> <b>Tags\.<\/b>([\s\S]*?)<\/li>/.exec(
        html
      );
    expect(item).not.toBeNull();
    const listed = [
      ...(item?.[1] ?? '').matchAll(
        /<span class="legend__tag"><span class="row__cat cat-([\w-]+)">([A-Z]{3})<\/span>([^<]*)<\/span>/g
      )
    ].map((m) => [m[1], m[2], m[3]]);
    expect(listed).toEqual(TAG_KEYS.map((key) => [key, TAG_ABBREVIATIONS[key], tagName(key)]));
    expect(listed).toHaveLength(14);
    expect(item?.[1]).toContain('Three letters name the category');
    expect(item?.[1]).toContain('The pointer on a tag shows its name.');
  });
});

describe('the heading (polish.12)', () => {
  it('counts the decided rows, as the comments heading counts the resolved', () => {
    expect(render()).toContain('<h3>Suggestions (3 of 5 decided)</h3>');
    expect(render([PENDING, REWORDED])).toContain('<h3>Suggestions (2)</h3>');
    expect(render([])).toContain('<h3>Suggestions (0)</h3>');
  });

  it('counts the rows shown when a chip is hidden', () => {
    storeWith({ hiddenCategories: [YOU_CHIP, 'grammar'] });
    expect(render()).toContain('<h3>Suggestions (2 of 3 decided)</h3>');
  });

  it('is alone on its line at the top of the list, where Show states sat beside it until polish.17', () => {
    expect(render()).toContain(
      '<section class="side__section side__list" id="side-suggestions"><h3>Suggestions (3 of 5 decided)</h3><ul class="rows">'
    );
    expect(render()).not.toContain('side__list-head');
  });
});
