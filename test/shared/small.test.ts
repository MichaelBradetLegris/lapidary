import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trimCommonAffixes } from '../../src/shared/diff/trim';
import { hunkFaces } from '../../src/shared/render';
import type { Hunk, HunkStatus } from '../../src/shared/types';
import {
  changeInContext,
  characterName,
  isSmallChange,
  isSmallLive,
  isSmallText,
  sideText,
  whitespaceName
} from '../../src/shared/ui/small';

/* small.3 (PLAN 11.7): what counts as a small change, and the names the page
   gives characters that are hard or impossible to see. */

const STATUSES: HunkStatus[] = ['pending', 'accepted', 'dismissed'];

function hunk(original: string, replacement: string, status: HunkStatus = 'pending'): Hunk {
  return {
    id: 'h',
    start: 10,
    end: 10 + original.length,
    baseSide: 'original',
    original,
    replacement,
    paragraph: 0,
    category: 'punctuation',
    source: 'claude',
    status,
    anchor: 'exact'
  };
}

describe('isSmallText', () => {
  it('takes one code point, or up to three with no letter or digit', () => {
    for (const text of ['', ',', ' ', 'i', 'I', '7', '--', '...', '?!', ' \u00a0 ', '\n\n', '\u2014']) {
      expect(isSmallText(text), JSON.stringify(text)).toBe(true);
    }
    for (const text of ['an', 'it', '----', 'I,', '12', ', a', 'the', '\n\n\n\n']) {
      expect(isSmallText(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('counts code points, not UTF-16 units, and leaves out combining marks', () => {
    expect(isSmallText('\u{1F600}')).toBe(true);
    expect(isSmallText('e\u0301')).toBe(true);
    expect(isSmallText('\u00e9')).toBe(true);
    expect(isSmallText('e\u0301e')).toBe(false);
  });
});

/** The shapes of PLAN 11.7's table, and what each surface says of them by status. */
const SHAPES: {
  name: string;
  original: string;
  replacement: string;
  change: boolean;
  live: Record<HunkStatus, boolean>;
}[] = [
  {
    name: 'comma inserted',
    original: '',
    replacement: ',',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'comma deleted',
    original: ',',
    replacement: '',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'doubled space deleted',
    original: ' ',
    replacement: '',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'full stop to comma',
    original: '.',
    replacement: ',',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'hyphen to space',
    original: '-',
    replacement: ' ',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'one-letter word',
    original: 'i',
    replacement: 'I',
    change: true,
    live: { pending: true, accepted: true, dismissed: true }
  },
  {
    name: 'paragraphs joined',
    original: '\n\n',
    replacement: ' ',
    change: true,
    live: { pending: false, accepted: true, dismissed: false }
  },
  {
    name: 'a one-letter word made a word',
    original: 'a',
    replacement: 'the',
    change: false,
    live: { pending: true, accepted: false, dismissed: true }
  },
  {
    name: 'a word',
    original: 'began',
    replacement: 'begun',
    change: false,
    live: { pending: false, accepted: false, dismissed: false }
  },
  {
    name: 'words inserted',
    original: '',
    replacement: 'most of ',
    change: false,
    live: { pending: true, accepted: false, dismissed: true }
  }
];

describe('isSmallLive and isSmallChange', () => {
  for (const shape of SHAPES) {
    for (const status of STATUSES) {
      it(`${shape.name}, ${status}: capsule ${shape.live[status]}, change ${shape.change}`, () => {
        const h = hunk(shape.original, shape.replacement, status);
        expect(isSmallLive(h)).toBe(shape.live[status]);
        expect(isSmallChange(h)).toBe(shape.change);
      });
    }
  }

  it('asks of the live face what hunkFaces puts in the line', () => {
    for (const shape of SHAPES) {
      for (const status of STATUSES) {
        const h = hunk(shape.original, shape.replacement, status);
        const live = hunkFaces(h).live;
        expect(isSmallLive(h)).toBe(isSmallText(live) && !live.includes('\n'));
      }
    }
  });
});

describe('whitespaceName', () => {
  it('names what cannot be seen', () => {
    expect(whitespaceName(' ')).toBe('space');
    expect(whitespaceName('  ')).toBe('2 spaces');
    expect(whitespaceName('     ')).toBe('5 spaces');
    expect(whitespaceName('\u00a0')).toBe('no-break space');
    expect(whitespaceName('\u202f')).toBe('narrow no-break space');
    expect(whitespaceName('\t')).toBe('tab');
    expect(whitespaceName('\t\t')).toBe('2 tabs');
    expect(whitespaceName('\n')).toBe('line break');
    expect(whitespaceName(' \n ')).toBe('line break');
    expect(whitespaceName('\n\n')).toBe('paragraph break');
    expect(whitespaceName('\r\n\r\n')).toBe('paragraph break');
    expect(whitespaceName('\r\n')).toBe('line break');
    expect(whitespaceName('\u200b')).toBe('zero-width space');
    expect(whitespaceName('\u00ad')).toBe('soft hyphen');
    expect(whitespaceName(' \u00a0')).toBe('space and no-break space');
    expect(whitespaceName('\u2005')).toBe('space');
  });

  it('names nothing that can be seen, and not the empty string', () => {
    for (const text of ['', ',', ' ,', 'a', '-', '\u2014', ' a ']) expect(whitespaceName(text)).toBeNull();
  });
});

describe('characterName', () => {
  it('names small punctuation', () => {
    expect(characterName('-')).toBe('hyphen');
    expect(characterName(',')).toBe('comma');
    expect(characterName('.')).toBe('full stop');
    expect(characterName('\u2013')).toBe('en dash');
    expect(characterName('\u2014')).toBe('em dash');
    expect(characterName("'")).toBe('straight apostrophe');
    expect(characterName('\u2019')).toBe('curly apostrophe');
    expect(characterName('\u201c')).toBe('opening double quote');
    expect(characterName('\u2026')).toBe('ellipsis');
    expect(characterName('--')).toBe('two hyphens');
    expect(characterName('...')).toBe('three full stops');
    expect(characterName(',"')).toBe('comma and straight double quote');
    expect(characterName('?! ')).toBe('question mark, exclamation mark and space');
  });

  it('names no letter, no digit, nothing long and nothing that cannot be seen', () => {
    for (const text of ['', 'i', 'I', '7', 'a,', '----', ' ', '\n\n', 'word']) {
      expect(characterName(text), JSON.stringify(text)).toBeNull();
    }
  });
});

describe('sideText', () => {
  it('keeps "(nothing)" for the empty string only', () => {
    expect(sideText('')).toBe('(nothing)');
    expect(sideText(' ')).toBe('(space)');
    expect(sideText('  ')).toBe('(2 spaces)');
    expect(sideText('\n\n')).toBe('(paragraph break)');
    expect(sideText('-')).toBe('- (hyphen)');
    expect(sideText(',')).toBe(', (comma)');
    expect(sideText('i')).toBe('i');
    expect(sideText('begun')).toBe('begun');
    expect(sideText('Drop this.\n\n')).toBe('Drop this.\n\n');
  });

  it('reads case 1 of PLAN 11.7 as a swap, not a deletion', () => {
    const h = hunk('-', ' ', 'accepted');
    expect(`${sideText(h.original)} -> ${sideText(h.replacement)}`).toBe('- (hyphen) -> (space)');
  });
});

describe('changeInContext', () => {
  const BASE =
    'Title\n\nBy the time she caught up with Mira who had already crossed the bridge, the rain had stopped.\n\nNext.';

  it('puts a few words of the line on either side of the change', () => {
    const at = BASE.indexOf(' who');
    expect(changeInContext(BASE, { start: at, end: at, original: '', replacement: ',' })).toEqual({
      before: '\u2026with Mira',
      original: null,
      replacement: ', (comma)',
      after: ' who had\u2026'
    });
  });

  it('reads case 1 in its line', () => {
    const base = 'They called it a double-standard, and said so.';
    const at = base.indexOf('-');
    expect(changeInContext(base, { start: at, end: at + 1, original: '-', replacement: ' ' })).toEqual({
      before: '\u2026a double',
      original: '- (hyphen)',
      replacement: '(space)',
      after: 'standard, and\u2026'
    });
  });

  it('never crosses a line break, and adds no ellipsis where the line ends', () => {
    const start = BASE.indexOf('By');
    expect(changeInContext(BASE, { start, end: start + 2, original: 'By', replacement: 'At' }).before).toBe(
      ''
    );
    const end = BASE.indexOf('stopped.') + 'stopped'.length;
    const tail = changeInContext(BASE, { start: end, end: end + 1, original: '.', replacement: '!' });
    expect(tail).toMatchObject({ before: '\u2026had stopped', after: '' });
    const join = BASE.indexOf('\n\nNext');
    expect(changeInContext(BASE, { start: join, end: join + 2, original: '\n\n', replacement: ' ' })).toEqual(
      {
        before: '\u2026had stopped.',
        original: '(paragraph break)',
        replacement: '(space)',
        after: 'Next.'
      }
    );
  });

  it('keeps the whitespace that touches the change, and cuts a long word', () => {
    const base = 'Then Supercalifragilisticexpialidocious and more words after it';
    const at = base.indexOf(' and');
    const result = changeInContext(base, { start: at + 1, end: at + 1, original: '', replacement: ',' });
    expect(result.before).toBe('\u2026pialidocious ');
    expect(result.before.length).toBeLessThanOrEqual(14);
    expect(result.after).toBe('and more\u2026');
  });

  it('takes its context from outside the span, whichever side the base holds', () => {
    const base = 'one two, three four';
    const at = base.indexOf(',');
    const saved = changeInContext(base, { start: at, end: at + 1, original: '', replacement: ',' });
    expect(saved).toMatchObject({ before: 'one two', after: ' three four' });
  });
});

/* Property, through the real trim: one punctuation or whitespace insertion,
   deletion or swap at a word boundary always trims to a small change; one
   letter changed inside a word of two or more letters never does. The
   apostrophes and the underscore are left out of the punctuation, as trim.ts
   counts them as part of a word. */

const PUNCTUATION = [
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  '-',
  '\u2013',
  '\u2014',
  '"',
  '\u201c',
  '\u201d',
  '(',
  ')',
  '\u2026'
];
const BLANKS = [' ', '\u00a0', '\t'];
const NON_WORD = [...PUNCTUATION, ...BLANKS];
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /[\p{L}\p{N}_'\u2019]/u.test(ch);

const word = fc.string({
  unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzMIRA'),
  minLength: 2,
  maxLength: 9
});
const prose = fc
  .array(fc.tuple(word, fc.constantFrom('', '', '', ',', '.', ';', ' -', ':')), {
    minLength: 2,
    maxLength: 12
  })
  .map((words) => words.map(([w, p]) => w + p).join(' '));

/** Every position not between two word characters. */
function boundaries(text: string): number[] {
  const at: number[] = [];
  for (let i = 0; i <= text.length; i += 1) if (!(isWordChar(text[i - 1]) && isWordChar(text[i]))) at.push(i);
  return at;
}

const trimmed = (before: string, after: string): Pick<Hunk, 'original' | 'replacement'> => {
  const t = trimCommonAffixes(before, after);
  return { original: t.original, replacement: t.replacement };
};

describe('a small edit at a word boundary trims to a small change (property)', () => {
  it('holds for insertions', () => {
    fc.assert(
      fc.property(prose, fc.nat(), fc.constantFrom(...NON_WORD), (text, n, ch) => {
        const spots = boundaries(text);
        const i = spots[n % spots.length] ?? 0;
        const after = text.slice(0, i) + ch + text.slice(i);
        expect(isSmallChange(trimmed(text, after))).toBe(true);
      })
    );
  });

  it('holds for deletions of a character that joins no two word characters', () => {
    fc.assert(
      fc.property(prose, fc.nat(), (text, n) => {
        const spots = [...text]
          .map((_, i) => i)
          .filter(
            (i) => NON_WORD.includes(text[i] ?? '') && !(isWordChar(text[i - 1]) && isWordChar(text[i + 1]))
          );
        fc.pre(spots.length > 0);
        const i = spots[n % spots.length] ?? 0;
        const after = text.slice(0, i) + text.slice(i + 1);
        expect(isSmallChange(trimmed(text, after))).toBe(true);
      })
    );
  });

  it('holds for swaps of punctuation or whitespace', () => {
    fc.assert(
      fc.property(prose, fc.nat(), fc.constantFrom(...NON_WORD), (text, n, ch) => {
        const spots = [...text]
          .map((_, i) => i)
          .filter((i) => NON_WORD.includes(text[i] ?? '') && text[i] !== ch);
        fc.pre(spots.length > 0);
        const i = spots[n % spots.length] ?? 0;
        const after = text.slice(0, i) + ch + text.slice(i + 1);
        expect(isSmallChange(trimmed(text, after))).toBe(true);
      })
    );
  });

  it('never holds for one letter changed inside a word of two or more letters', () => {
    fc.assert(
      fc.property(
        prose,
        fc.nat(),
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzAEIOU'),
        (text, n, letter) => {
          const spots = [...text]
            .map((_, i) => i)
            .filter((i) => /[a-zA-Z]/.test(text[i] ?? '') && text[i] !== letter);
          fc.pre(spots.length > 0);
          const i = spots[n % spots.length] ?? 0;
          const after = text.slice(0, i) + letter + text.slice(i + 1);
          expect(isSmallChange(trimmed(text, after))).toBe(false);
        }
      )
    );
  });
});
