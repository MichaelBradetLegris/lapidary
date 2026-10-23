import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SidePanel } from '../../src/renderer/components/SidePanel';
import { Legend } from '../../src/renderer/components/StatusBar';
import { saveRowStates } from '../../src/renderer/state/rowStates';
import type { SettingIo } from '../../src/renderer/state/settingWrites';
import { useApp } from '../../src/renderer/state/store';
import { defaultSettings, normalizeSettings } from '../../src/shared/settings';
import type { Hunk, Review, Settings } from '../../src/shared/types';
import { YOU_CHIP } from '../../src/shared/ui/chips';
import { TAG_ABBREVIATIONS, TAG_KEYS, tagName } from '../../src/shared/ui/suggestions';

/* polish.12: the suggestions list's rows. Each has a tag of its chip in the
   chip's colour, the button of its decision stands out and the others fade,
   Show states writes ACCEPTED or DISMISSED on the decided rows, and the
   heading counts the decided ones. Rendered with react-dom/server; how
   app.css draws them is in suggestionRows.test.ts, and the window check in
   PLAN (polish.12) has the rest. */

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
let restore: Partial<AppState> = {};

/** The server render reads the store's initial state; a test puts what it needs there, and it goes back after. */
function storeWith(patch: Partial<AppState>): void {
  const initial = useApp.getInitialState();
  restore = Object.fromEntries(Object.keys(patch).map((k) => [k, initial[k as keyof AppState]]));
  Object.assign(initial, patch);
}

afterEach(() => {
  Object.assign(useApp.getInitialState(), restore);
  restore = {};
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
  status: string | null;
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
        status: /<span class="row__status">([^<]*)<\/span>/.exec(main?.[2] ?? '')?.[1] ?? null,
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

const withStates = (showRowStates: boolean): Settings => ({ ...defaultSettings(), showRowStates });

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

describe('Show states (polish.12)', () => {
  it('writes ACCEPTED and DISMISSED on the decided rows while on, which it is by default', () => {
    const html = render();
    expect(rows(html).map((r) => r.status)).toEqual([null, null, 'accepted', 'dismissed', 'accepted']);
    expect(html).toMatch(
      /<label class="side__states" title="Write ACCEPTED or DISMISSED on the rows you have decided"><input type="checkbox" checked=""\/>Show states<\/label>/
    );
  });

  it('leaves the words off when off, and the rows still say their decision to a screen reader', () => {
    storeWith({ settings: withStates(false) });
    const html = render();
    expect(rows(html).map((r) => r.status)).toEqual([null, null, null, null, null]);
    expect(byId(html, 'accepted').name).toBe('word-choice, climb \u2192 rise, accepted');
    expect(byId(html, 'dismissed').name).toBe('punctuation, ran \u2192 raced, dismissed');
    expect(html).toMatch(/<input type="checkbox"\/>Show states<\/label>/);
    // The buttons say it still.
    expect(byId(html, 'accepted').acts[1]?.cls).toBe('row__act row__act--accepted');
  });

  it('is kept in settings through the writes the split uses (a close waits for them: closeGuard.test.ts)', async () => {
    useApp.setState({ settings: withStates(true) });
    let disk = withStates(true);
    const patches: Partial<Settings>[] = [];
    const io: SettingIo = {
      setSettings: (patch) => {
        patches.push(patch);
        disk = normalizeSettings({ ...disk, ...patch });
        return Promise.resolve(disk);
      }
    };
    const written = saveRowStates(false, io);
    // The list follows at once.
    expect(useApp.getState().settings?.showRowStates).toBe(false);
    await written;
    expect(patches).toEqual([{ showRowStates: false }]);
    expect(disk.showRowStates).toBe(false);
    // The value on screen writes nothing.
    await saveRowStates(false, io);
    expect(patches).toHaveLength(1);
    useApp.setState({ settings: null });
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

  it('shares a line with Show states', () => {
    expect(render()).toMatch(/<div class="side__list-head"><h3>[^<]*<\/h3><label class="side__states"/);
  });
});
