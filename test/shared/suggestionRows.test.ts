import { describe, expect, it } from 'vitest';
import { decisionCounts } from '../../src/shared/diff/compose';
import { CHANGE_CATEGORIES, type Hunk, type HunkStatus } from '../../src/shared/types';
import { chipKeyOf, YOU_CHIP, type ChipKey } from '../../src/shared/ui/chips';
import {
  DISMISSED_TITLE,
  groupSuggestions,
  rowButtonLook,
  rowLabel,
  rowTag,
  SHOW_STATES_LABEL,
  SHOW_STATES_TITLE,
  suggestionsHeading,
  summaryLine,
  TAG_ABBREVIATIONS,
  TAG_KEYS,
  tagName,
  type RowButton
} from '../../src/shared/ui/suggestions';

/* polish.12: the suggestions list's heading counts the decided rows, every row
   has a tag of its chip, and a row's buttons show its decision. polish.14:
   the tag is three letters, from one table. */

function hunk(partial: Partial<Hunk> & Pick<Hunk, 'id'>): Hunk {
  return {
    start: 0,
    end: 5,
    baseSide: 'original',
    original: 'began',
    replacement: 'begun',
    paragraph: 0,
    category: 'grammar',
    source: 'claude',
    status: 'pending',
    anchor: 'exact',
    ...partial
  };
}

const STATUSES: HunkStatus[] = ['pending', 'accepted', 'dismissed'];
const BUTTONS: RowButton[] = ['edit', 'accept', 'dismiss'];

/** A small seeded generator, so a failure can be run again. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('the heading (polish.12)', () => {
  it('counts the decided rows in the comments form, and only the total while none is decided', () => {
    const rows = [
      hunk({ id: 'a', status: 'accepted' }),
      hunk({ id: 'b', status: 'dismissed' }),
      hunk({ id: 'c' }),
      hunk({ id: 'd' })
    ];
    expect(suggestionsHeading(rows)).toBe('Suggestions (2 of 4 decided)');
    expect(suggestionsHeading(rows.map((h) => ({ ...h, status: 'pending' as const })))).toBe(
      'Suggestions (4)'
    );
    expect(suggestionsHeading(rows.map((h) => ({ ...h, status: 'accepted' as const })))).toBe(
      'Suggestions (4 of 4 decided)'
    );
    expect(suggestionsHeading([])).toBe('Suggestions (0)');
    expect(suggestionsHeading([hunk({ id: 'x', status: 'dismissed' })])).toBe('Suggestions (1 of 1 decided)');
  });

  it('counts the rows the list shows: a hidden chip is out of both numbers', () => {
    const hunks = [
      hunk({ id: 'g1', status: 'accepted' }),
      hunk({ id: 'g2' }),
      hunk({ id: 'p1', category: 'punctuation', status: 'dismissed' }),
      hunk({ id: 'y1', category: 'other', source: 'manual', status: 'accepted' }),
      hunk({ id: 's1', anchor: 'stale', status: 'accepted' })
    ];
    expect(suggestionsHeading(groupSuggestions(hunks).inline)).toBe('Suggestions (3 of 4 decided)');
    expect(suggestionsHeading(groupSuggestions(hunks, ['punctuation']).inline)).toBe(
      'Suggestions (2 of 3 decided)'
    );
    expect(suggestionsHeading(groupSuggestions(hunks, ['grammar', YOU_CHIP]).inline)).toBe(
      'Suggestions (1 of 1 decided)'
    );
    expect(suggestionsHeading(groupSuggestions(hunks, ['punctuation', YOU_CHIP]).inline)).toBe(
      'Suggestions (1 of 2 decided)'
    );
  });

  it('agrees with decisionCounts over any list of rows', () => {
    const next = random(12);
    for (let run = 0; run < 300; run += 1) {
      const rows = Array.from({ length: Math.floor(next() * 30) }, (_, i) =>
        hunk({ id: `h${i}`, status: STATUSES[Math.floor(next() * 3)] ?? 'pending' })
      );
      const { pending, accepted, dismissed } = decisionCounts(rows);
      const decided = accepted + dismissed;
      const heading = suggestionsHeading(rows);
      expect(heading).toBe(
        decided === 0 ? `Suggestions (${rows.length})` : `Suggestions (${decided} of ${rows.length} decided)`
      );
      expect(pending + decided).toBe(rows.length);
    }
  });
});

describe('the three letters of a tag (polish.14)', () => {
  it('are the table the author gave', () => {
    expect(TAG_ABBREVIATIONS).toEqual({
      spelling: 'SPE',
      typo: 'TYP',
      homophone: 'HOM',
      grammar: 'GRM',
      agreement: 'AGR',
      tense: 'TEN',
      punctuation: 'PUN',
      'word-choice': 'WRD',
      redundancy: 'RED',
      awkward: 'AWK',
      consistency: 'CON',
      formatting: 'FMT',
      other: 'OTH',
      you: 'YOU'
    });
  });

  it('give every change category one, and YOU the author, three capitals each, no two the same', () => {
    const keys: ChipKey[] = [...CHANGE_CATEGORIES, YOU_CHIP];
    expect(Object.keys(TAG_ABBREVIATIONS).sort()).toEqual([...keys].sort());
    for (const key of keys) expect(TAG_ABBREVIATIONS[key], key).toMatch(/^[A-Z]{3}$/);
    const letters = keys.map((key) => TAG_ABBREVIATIONS[key]);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it('are listed for the legend in the order of the chips, each with its name', () => {
    expect(TAG_KEYS).toEqual([...CHANGE_CATEGORIES, YOU_CHIP]);
    expect(TAG_KEYS.map(tagName)).toEqual([...CHANGE_CATEGORIES, 'your own edits']);
  });
});

describe('the tag (polish.12)', () => {
  it("writes each category in its three letters, and the author's own words YOU, the name in full as the tooltip and spoken (polish.14)", () => {
    for (const category of CHANGE_CATEGORIES) {
      expect(rowTag(hunk({ id: 'x', category }))).toEqual({
        key: category,
        text: TAG_ABBREVIATIONS[category],
        title: category.charAt(0).toUpperCase() + category.slice(1),
        spoken: category
      });
    }
    expect(rowTag(hunk({ id: 'g', category: 'word-choice' }))).toMatchObject({
      text: 'WRD',
      title: 'Word-choice',
      spoken: 'word-choice'
    });
    expect(rowTag(hunk({ id: 'm', category: 'other', source: 'manual' }))).toEqual({
      key: YOU_CHIP,
      text: 'YOU',
      title: 'Your own words',
      spoken: 'you'
    });
    // A manual review's suggestion has no category and is under other, as its chip is.
    expect(rowTag(hunk({ id: 'd', category: undefined, source: 'diff' })).key).toBe('other');
  });

  it("is the chip's for every suggestion, so the list and the chips agree", () => {
    const next = random(7);
    const sources = ['claude', 'diff', 'manual'] as const;
    for (let run = 0; run < 300; run += 1) {
      const h = hunk({
        id: 'r',
        source: sources[Math.floor(next() * 3)] ?? 'claude',
        category: next() < 0.1 ? undefined : CHANGE_CATEGORIES[Math.floor(next() * CHANGE_CATEGORIES.length)],
        edited: next() < 0.3
      });
      expect(rowTag(h).key).toBe(chipKeyOf(h));
    }
  });

  it("keeps a reworded suggestion's category, and says the words are the author's", () => {
    const reworded = hunk({ id: 'r', category: 'grammar', edited: true });
    expect(rowTag(reworded)).toEqual({
      key: 'grammar',
      text: 'GRM',
      title: 'Grammar, reworded by you',
      spoken: 'grammar, reworded by you'
    });
    // The author's own edit is YOU, rewritten or not.
    expect(rowTag({ ...reworded, source: 'manual' }).text).toBe('YOU');
  });
});

describe("a row's name (polish.12)", () => {
  it('is its tag, its change and its decision', () => {
    expect(rowLabel(hunk({ id: 'p' }))).toBe('grammar, began → begun');
    expect(rowLabel(hunk({ id: 'a', status: 'accepted', category: 'word-choice' }))).toBe(
      'word-choice, began → begun, accepted'
    );
    expect(rowLabel(hunk({ id: 'd', status: 'dismissed', source: 'manual', category: 'other' }))).toBe(
      'you, began → begun, dismissed'
    );
    expect(rowLabel(hunk({ id: 'r', edited: true }))).toBe('grammar, reworded by you, began → begun');
    // A small change is spoken by its names, as summaryLine writes them.
    const comma = hunk({ id: 'c', original: '', replacement: ',', category: 'punctuation', end: 0 });
    expect(rowLabel(comma)).toBe(`punctuation, ${summaryLine(comma)}`);
    expect(summaryLine(comma)).toBe('(nothing) → , (comma)');
  });
});

describe("a row's buttons (polish.12)", () => {
  it('are plain on a pending row', () => {
    for (const button of BUTTONS) expect(rowButtonLook('pending', button)).toBe('plain');
  });

  it("put the decision's own button on and fade the other two", () => {
    expect(BUTTONS.map((b) => rowButtonLook('accepted', b))).toEqual(['faded', 'on', 'faded']);
    expect(BUTTONS.map((b) => rowButtonLook('dismissed', b))).toEqual(['faded', 'faded', 'on']);
  });

  it('say what the dismissed x does, and name the toggle', () => {
    expect(DISMISSED_TITLE).toBe('Dismissed. Click to put it back');
    expect(SHOW_STATES_LABEL).toBe('Show states');
    expect(SHOW_STATES_TITLE).toBe('Write ACCEPTED or DISMISSED on the rows you have decided');
  });
});
