import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  OBSIDIAN_OPEN_PREFIX,
  encodeLinkValue,
  isFullPath,
  isObsidianOpenUrl,
  obsidianLinkPath,
  obsidianOpenUrl,
  obsidianOpensFile
} from '../../src/shared/obsidian';
import {
  MARKUP_CHARS,
  SYNTAX_KINDS,
  SYNTAX_LABELS,
  bodyStart,
  hasMarkupChar,
  syntaxSignature,
  syntaxSpans
} from '../../src/shared/text/obsidian';
import type { SyntaxKind, SyntaxOptions } from '../../src/shared/text/obsidian';
import { splitParagraphs } from '../../src/shared/text/paragraphs';

/* Both Obsidian modules: the Open in Obsidian link (src/shared/obsidian.ts,
   setup.10b) first, then the syntax a review leaves alone
   (src/shared/text/obsidian.ts, files.6). */

/* setup.10b: Open in Obsidian hands the system obsidian://open?path=<full
   path>. Obsidian finds the vault that holds the path itself, so the link
   names no vault, and every value is percent-encoded as Obsidian asks. */

describe('obsidianOpenUrl', () => {
  it('encodes a Windows path whole: drive colon, backslashes and spaces', () => {
    expect(obsidianOpenUrl('C:\\Vault\\Novel One\\GUIDELINES.md')).toBe(
      'obsidian://open?path=C%3A%5CVault%5CNovel%20One%5CGUIDELINES.md'
    );
    expect(obsidianOpenUrl('D:/Writing/Novel One/GUIDELINES.md')).toBe(
      'obsidian://open?path=D%3A%2FWriting%2FNovel%20One%2FGUIDELINES.md'
    );
  });

  it("encodes a POSIX path's slashes as %2F and its spaces as %20, as Obsidian's own example does", () => {
    const linux = '/home/user/my vault/path/to/my note.md'; // check-public: allow
    const mac = '/Users/writer/Documents/Novel/GUIDELINES.md'; // check-public: allow
    expect(obsidianOpenUrl(linux)).toBe(
      'obsidian://open?path=%2Fhome%2Fuser%2Fmy%20vault%2Fpath%2Fto%2Fmy%20note.md'
    );
    expect(obsidianOpenUrl(mac)).toBe(
      'obsidian://open?path=%2FUsers%2Fwriter%2FDocuments%2FNovel%2FGUIDELINES.md'
    );
  });

  it('takes network shares, with or without the long-path prefix', () => {
    expect(obsidianOpenUrl('\\\\nas\\books\\Vault\\GUIDELINES.md')).toBe(
      'obsidian://open?path=%5C%5Cnas%5Cbooks%5CVault%5CGUIDELINES.md'
    );
    expect(obsidianOpenUrl('\\\\?\\C:\\Vault\\GUIDELINES.md')).toBe(
      'obsidian://open?path=%5C%5C%3F%5CC%3A%5CVault%5CGUIDELINES.md'
    );
  });

  it('names no vault: a vault folder of any name is just part of the one path value', () => {
    const url = obsidianOpenUrl('C:\\Users\\writer\\Novel & Notes #1 100% +draft=yes?\\Book\\GUIDELINES.md'); // check-public: allow
    expect(url).toBe(
      'obsidian://open?path=C%3A%5CUsers%5Cwriter%5CNovel%20%26%20Notes%20%231%20100%25%20%2Bdraft%3Dyes%3F%5CBook%5CGUIDELINES.md'
    );
    expect(url).not.toMatch(/[?&](vault|file)=/);
    // One parameter, nothing after it, no space and no plus standing for one.
    const query = url!.slice('obsidian://open?'.length);
    expect(query.split('&')).toHaveLength(1);
    expect(url).not.toMatch(/[#+ ]/);
  });

  it("encodes !'()* too, which encodeURIComponent leaves alone", () => {
    expect(obsidianOpenUrl("/v/It's (nearly) done!*/GUIDELINES.md")).toBe(
      'obsidian://open?path=%2Fv%2FIt%27s%20%28nearly%29%20done%21%2A%2FGUIDELINES.md'
    );
    expect(encodeLinkValue("!'()*~-._")).toBe('%21%27%28%29%2A~-._');
  });

  it('encodes other scripts and accents as UTF-8 and keeps the Unicode form the system gave', () => {
    const composed = '/home/zoé/Romans/Été/GUIDELINES.md'.normalize('NFC'); // check-public: allow
    const decomposed = composed.normalize('NFD');
    expect(obsidianOpenUrl(composed)).toBe(
      'obsidian://open?path=%2Fhome%2Fzo%C3%A9%2FRomans%2F%C3%89t%C3%A9%2FGUIDELINES.md'
    );
    expect(obsidianOpenUrl(decomposed)).toBe(
      'obsidian://open?path=%2Fhome%2Fzoe%CC%81%2FRomans%2FE%CC%81te%CC%81%2FGUIDELINES.md'
    );
    expect(obsidianOpenUrl('C:\\小説\\Роман 📚\\GUIDELINES.md')).toBe(
      'obsidian://open?path=C%3A%5C%E5%B0%8F%E8%AA%AC%5C%D0%A0%D0%BE%D0%BC%D0%B0%D0%BD%20%F0%9F%93%9A%5CGUIDELINES.md'
    );
  });

  it('makes no link for a path that is not a full one, a file that is not .md, or text a link cannot carry', () => {
    expect(obsidianOpenUrl('GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('Novel\\GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('./Novel/GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('C:GUIDELINES.md')).toBeNull();
    expect(obsidianOpenUrl('')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES.txt')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault.md\\GUIDELINES')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\\uD800 notes.md')).toBeNull();
    expect(obsidianOpenUrl('C:\\Vault\\GUIDELINES.MD')).toBe(
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.MD'
    );
  });
});

describe('isFullPath and obsidianOpensFile', () => {
  it('knows a full path from a relative one on Windows and POSIX', () => {
    for (const p of ['C:\\a.md', 'c:/a.md', '\\\\server\\share\\a.md', '/a.md', '//server/share/a.md']) {
      expect(isFullPath(p), p).toBe(true);
    }
    for (const p of ['a.md', '.\\a.md', '..\\a.md', 'C:a.md', '\\a.md', '~/a.md', 'obsidian://open']) {
      expect(isFullPath(p), p).toBe(false);
    }
  });

  it('opens .md files in Obsidian, in any case, and nothing else', () => {
    expect(obsidianOpensFile('C:\\V\\GUIDELINES.md')).toBe(true);
    expect(obsidianOpensFile('/v/Notes.Md')).toBe(true);
    expect(obsidianOpensFile('/v/GUIDELINES.txt')).toBe(false);
    expect(obsidianOpensFile('/v/GUIDELINES.md.bak')).toBe(false);
  });
});

describe('isObsidianOpenUrl', () => {
  it('accepts exactly the links obsidianOpenUrl makes and gives their path back', () => {
    const file = 'C:\\Vault\\Novel One\\GUIDELINES.md';
    const url = obsidianOpenUrl(file)!;
    expect(isObsidianOpenUrl(url)).toBe(true);
    expect(obsidianLinkPath(url)).toBe(file);
  });

  it('refuses any other scheme, action, parameter or spelling of the same path', () => {
    for (const url of [
      'https://example.com/GUIDELINES.md',
      'file:///C:/Vault/GUIDELINES.md',
      'obsidian://new?path=C%3A%5CVault%5CGUIDELINES.md',
      'obsidian://open?vault=Vault&file=GUIDELINES',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.md&vault=Other',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.md#Heading',
      'obsidian://open?path=C:%5CVault%5CGUIDELINES.md',
      'obsidian://open?path=C%3a%5cVault%5cGUIDELINES.md',
      'obsidian://open?path=C%3A%5CVault%5CGUIDELINES.txt',
      'obsidian://open?path=GUIDELINES.md',
      'obsidian://open?path=%E0%A4%A',
      'obsidian://open?path=',
      'OBSIDIAN://open?path=C%3A%5CVault%5CGUIDELINES.md'
    ]) {
      expect(isObsidianOpenUrl(url), url).toBe(false);
    }
  });

  it('round-trips any folder name: one path parameter that decodes to the path it was made from', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 4
        }),
        fc.constantFrom('C:\\', 'D:/', '/', '\\\\nas\\share\\'),
        (folders, root) => {
          const separator = root.includes('/') ? '/' : '\\';
          const clean = folders.map((f) => f.replace(/[\\/]/g, '_'));
          const file = `${root}${clean.join(separator)}${separator}GUIDELINES.md`;
          const url = obsidianOpenUrl(file);
          expect(url).not.toBeNull();
          expect(url!.startsWith(OBSIDIAN_OPEN_PREFIX)).toBe(true);
          expect(url!.slice(OBSIDIAN_OPEN_PREFIX.length)).toMatch(/^(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+$/);
          expect(isObsidianOpenUrl(url!)).toBe(true);
          expect(obsidianLinkPath(url!)).toBe(file);
        }
      )
    );
  });
});

/* files.6: the Obsidian syntax a review leaves alone (PLAN 11.3 k). Offsets
   are exact, into the LF-normalised text: each kind has a positive case, the
   plan's negatives find nothing, and an alias stays prose. */

/** Each span as [kind, start, end, the text it covers]. */
function spansOf(text: string, options?: SyntaxOptions): Array<[SyntaxKind, number, number, string]> {
  return syntaxSpans(text, options).map((s) => [s.kind, s.start, s.end, text.slice(s.start, s.end)]);
}

describe('syntaxSpans: one case per kind, with exact offsets', () => {
  it('frontmatter, with the line break after its closing ---, holding everything in it', () => {
    const text = '---\ntitle: The Flood\n---\nIt rained.';
    expect(spansOf(text)).toEqual([['frontmatter', 0, 25, '---\ntitle: The Flood\n---\n']]);
    expect(bodyStart(text)).toBe(25);
    expect(spansOf('---\ntags: [draft]\nsee: "[[Home]]"\n---\nText #tag')).toEqual([
      ['frontmatter', 0, 38, '---\ntags: [draft]\nsee: "[[Home]]"\n---\n'],
      ['tag', 43, 47, '#tag']
    ]);
  });

  it('code: a fenced block from its opening line to its closing one, and inline code', () => {
    expect(spansOf('Before.\n\n```js\nlet x = [[1]];\n```\n\nAfter.')).toEqual([
      ['code', 9, 33, '```js\nlet x = [[1]];\n```']
    ]);
    expect(spansOf('~~~\n%% not a comment\n~~~~')).toEqual([['code', 0, 25, '~~~\n%% not a comment\n~~~~']]);
    expect(spansOf('  ```\ncode\n  ```')).toEqual([['code', 0, 16, '  ```\ncode\n  ```']]);
    // Spaces may follow a closing fence; the block takes them, as it takes the whole line.
    expect(spansOf('```\ncode\n``` ')).toEqual([['code', 0, 13, '```\ncode\n``` ']]);
    // A fence runs across blank lines.
    expect(spansOf('```\na\n\nb\n```')).toEqual([['code', 0, 12, '```\na\n\nb\n```']]);
    // A fence closes only at its own character, at least as many of it.
    expect(spansOf('````\ncode\n```\nstill code\n````')).toEqual([
      ['code', 0, 29, '````\ncode\n```\nstill code\n````']
    ]);
    // Tildes do not close backticks: the ~~~ line opens a fence of its own, and neither closes.
    expect(spansOf('```\ncode\n~~~')).toEqual([
      ['code', 0, 3, '```'],
      ['code', 9, 12, '~~~']
    ]);
    expect(spansOf('Run `npm test` now.')).toEqual([['code', 4, 14, '`npm test`']]);
    expect(spansOf('A ``tick ` here`` ok')).toEqual([['code', 2, 17, '``tick ` here``']]);
    // A backtick in the info string makes it no fence, so this is inline code.
    expect(spansOf('```js`x```')).toEqual([['code', 0, 10, '```js`x```']]);
  });

  it('comment: %% and HTML comments, across blank lines, holding what is inside', () => {
    expect(spansOf('One %%private%% two')).toEqual([['comment', 4, 15, '%%private%%']]);
    expect(spansOf('%%\nNote.\n\nMore.\n%%\n\nText')).toEqual([['comment', 0, 18, '%%\nNote.\n\nMore.\n%%']]);
    expect(spansOf('a <!-- b --> c')).toEqual([['comment', 2, 12, '<!-- b -->']]);
    // An HTML comment closes from its own third character on, as in CommonMark.
    expect(spansOf('a <!--> b')).toEqual([['comment', 2, 7, '<!-->']]);
    expect(spansOf('a <!---> b')).toEqual([['comment', 2, 8, '<!--->']]);
    expect(spansOf('%% see [[Home]] %%')).toEqual([['comment', 0, 18, '%% see [[Home]] %%']]);
  });

  it('math: $$ blocks, on their own lines or within one', () => {
    expect(spansOf('$$\nE = mc^2\n$$')).toEqual([['math', 0, 14, '$$\nE = mc^2\n$$']]);
    expect(spansOf('So $$x^2$$ here.')).toEqual([['math', 3, 10, '$$x^2$$']]);
    expect(spansOf('$$\nx\n\ny\n$$')).toEqual([['math', 0, 10, '$$\nx\n\ny\n$$']]);
  });

  it('an unclosed %%, <!--, $$ or code fence protects only its opening marker', () => {
    expect(spansOf('%% open\n\nText')).toEqual([['comment', 0, 2, '%%']]);
    expect(spansOf('<!-- open')).toEqual([['comment', 0, 4, '<!--']]);
    expect(spansOf('$$ open')).toEqual([['math', 0, 2, '$$']]);
    expect(spansOf('```\nThe rest is prose.')).toEqual([['code', 0, 3, '```']]);
    // An indented one protects its run, not the spaces before it.
    expect(spansOf('  ```\nprose')).toEqual([['code', 2, 5, '```']]);
  });

  it('embed, whole', () => {
    expect(spansOf('See ![[map.png|300]] here.')).toEqual([['embed', 4, 20, '![[map.png|300]]']]);
  });

  it('internal link, whole when it has no alias', () => {
    expect(spansOf('See [[Chapter 3#The Flood]].')).toEqual([['wikilink', 4, 27, '[[Chapter 3#The Flood]]']]);
  });

  it('leaves the alias of an internal link editable', () => {
    const text = 'See [[Chapter 3|the third chapter]] now.';
    expect(spansOf(text)).toEqual([
      ['wikilink', 4, 16, '[[Chapter 3|'],
      ['wikilink', 33, 35, ']]']
    ]);
    const alias = { start: text.indexOf('the third'), end: text.indexOf(']]') };
    expect(syntaxSpans(text).every((s) => s.end <= alias.start || s.start >= alias.end)).toBe(true);
    // A copyedit of the alias changes no syntax; one of the target does.
    expect(syntaxSignature('See [[Chapter 3|the 3rd chapter]] now.')).toBe(syntaxSignature(text));
    expect(syntaxSignature('See [[Chapter 4|the third chapter]] now.')).not.toBe(syntaxSignature(text));
  });

  it('link: [ and ](destination), with the link text left as prose', () => {
    expect(spansOf('Read [the notes](https://example.com/notes) first.')).toEqual([
      ['link', 5, 6, '['],
      ['link', 15, 43, '](https://example.com/notes)']
    ]);
    expect(spansOf('[map](<Old Mill.md> "The mill")')).toEqual([
      ['link', 0, 1, '['],
      ['link', 4, 31, '](<Old Mill.md> "The mill")']
    ]);
    // An escaped bracket in the link text closes nothing.
    expect(spansOf('[a\\]b](c)')).toEqual([
      ['link', 0, 1, '['],
      ['link', 5, 9, '](c)']
    ]);
    // A destination's parentheses must balance before the space or the end.
    expect(syntaxSpans('[a](b(c )')).toEqual([]);
  });

  it('image, whole', () => {
    expect(spansOf('![A map](map.png)')).toEqual([['image', 0, 17, '![A map](map.png)']]);
  });

  it('footnote: a reference, a definition at the start of a line, and an inline one around its text', () => {
    expect(spansOf('It rained.[^1] Then')).toEqual([['footnote', 10, 14, '[^1]']]);
    expect(spansOf('[^1]: All night.')).toEqual([['footnote', 0, 5, '[^1]:']]);
    expect(spansOf('   [^1]: x')).toEqual([['footnote', 3, 8, '[^1]:']]);
    expect(spansOf('> [^1]: x')).toEqual([
      ['quote', 0, 2, '> '],
      ['footnote', 2, 7, '[^1]:']
    ]);
    expect(spansOf('It rained.^[All night.] Then')).toEqual([
      ['footnote', 10, 12, '^['],
      ['footnote', 22, 23, ']']
    ]);
  });

  it('block ID at the end of a line, after a space or alone on its line', () => {
    expect(spansOf('The river rose. ^river-1')).toEqual([['block-id', 16, 24, '^river-1']]);
    expect(spansOf('Text ^id  ')).toEqual([['block-id', 5, 8, '^id']]);
    expect(spansOf('> A quote.\n\n^quote-1')).toEqual([
      ['quote', 0, 2, '> '],
      ['block-id', 12, 20, '^quote-1']
    ]);
    // Latin letters, digits and dashes only: an underscore or an accent makes it prose.
    expect(syntaxSpans('Text ^a_b')).toEqual([]);
    expect(syntaxSpans('Text ^\u00fcber')).toEqual([]);
  });

  it('tag: after a space or ( or at the start of a line, in any script, with a non-digit', () => {
    expect(spansOf('Draft #todo, then #places/mill and (#y1984).')).toEqual([
      ['tag', 6, 11, '#todo'],
      ['tag', 18, 30, '#places/mill'],
      ['tag', 36, 42, '#y1984']
    ]);
    expect(spansOf('#todo first')).toEqual([['tag', 0, 5, '#todo']]);
    expect(spansOf('Draft #to_do and #mid-draft now')).toEqual([
      ['tag', 6, 12, '#to_do'],
      ['tag', 17, 27, '#mid-draft']
    ]);
    expect(spansOf('Le #caf\u00e9 ouvre.')).toEqual([['tag', 3, 8, '#caf\u00e9']]);
    expect(spansOf('Hot #\u{1F525} now')).toEqual([['tag', 4, 7, '#\u{1F525}']]);
    expect(spansOf('>#todo')).toEqual([
      ['quote', 0, 1, '>'],
      ['tag', 1, 6, '#todo']
    ]);
    expect(spansOf('a\t#tag')).toEqual([['tag', 2, 6, '#tag']]);
  });

  it("tag: the name ends at a curly quote, a dash or an ellipsis, fiction's own punctuation", () => {
    expect(spansOf('See #Mara\u2019s notes')).toEqual([['tag', 4, 9, '#Mara']]);
    expect(spansOf('#Mara\u2019s')).toEqual([['tag', 0, 5, '#Mara']]);
    expect(spansOf('see #draft\u2014then')).toEqual([['tag', 4, 10, '#draft']]);
    expect(spansOf('Then #todo\u2026 later')).toEqual([['tag', 5, 10, '#todo']]);
    expect(spansOf('#wait\u2026')).toEqual([['tag', 0, 5, '#wait']]);
    // The supplemental punctuation block too: a two-em dash.
    expect(spansOf('see #draft\u2E3Athen')).toEqual([['tag', 4, 10, '#draft']]);
  });

  it('callout: [!type] with its fold sign, after the quote markers, the title left as prose', () => {
    expect(spansOf('> [!note] The mill\n> It flooded.')).toEqual([
      ['quote', 0, 2, '> '],
      ['callout', 2, 9, '[!note]'],
      ['quote', 19, 21, '> ']
    ]);
    expect(spansOf('> > [!faq]- Why?')).toEqual([
      ['quote', 0, 4, '> > '],
      ['callout', 4, 11, '[!faq]-']
    ]);
  });

  it('block quote markers, nested ones included, and the space after them', () => {
    expect(spansOf('> She said so.')).toEqual([['quote', 0, 2, '> ']]);
    expect(spansOf('>> Inner.')).toEqual([['quote', 0, 3, '>> ']]);
  });

  it('heading: the #s and the space after them, in a quote too; a tag in a heading is a tag', () => {
    expect(spansOf('## The Flood\nText.')).toEqual([['heading', 0, 3, '## ']]);
    // A # alone on its line is an empty heading; up to three spaces may come first.
    expect(spansOf('#\nText')).toEqual([['heading', 0, 1, '#']]);
    expect(spansOf('   # Title')).toEqual([['heading', 3, 5, '# ']]);
    expect(spansOf('> # In a quote')).toEqual([
      ['quote', 0, 2, '> '],
      ['heading', 2, 4, '# ']
    ]);
    expect(spansOf('## Notes #draft')).toEqual([
      ['heading', 0, 3, '## '],
      ['tag', 9, 15, '#draft']
    ]);
  });

  it('horizontal rule: the line of -, * or _', () => {
    expect(spansOf('Before.\n\n* * *\n\nAfter.')).toEqual([['thematic-break', 9, 14, '* * *']]);
    expect(spansOf('A line\n---')).toEqual([['thematic-break', 7, 10, '---']]);
    expect(spansOf('___')).toEqual([['thematic-break', 0, 3, '___']]);
    // Spaces may follow it; the span stops at its last mark.
    expect(spansOf('***   ')).toEqual([['thematic-break', 0, 3, '***']]);
    expect(spansOf('> ---')).toEqual([
      ['quote', 0, 2, '> '],
      ['thematic-break', 2, 5, '---']
    ]);
  });

  it('web address: without the punctuation that ends the sentence or a ) that closes nothing', () => {
    expect(spansOf('Go to https://example.com/path.')).toEqual([['url', 6, 30, 'https://example.com/path']]);
    expect(spansOf('(see https://en.wikipedia.org/wiki/Mill_(grinding))')).toEqual([
      ['url', 5, 50, 'https://en.wikipedia.org/wiki/Mill_(grinding)']
    ]);
    expect(spansOf('<https://example.com>')).toEqual([['url', 1, 20, 'https://example.com']]);
    // It ends at a pipe, a quote mark or a backtick, and leaves out a ] that closes nothing inside it.
    expect(spansOf('| https://a.com| x')).toEqual([['url', 2, 15, 'https://a.com']]);
    expect(spansOf('a "https://a.com" b')).toEqual([['url', 3, 16, 'https://a.com']]);
    expect(spansOf('https://a.com`x')).toEqual([['url', 0, 13, 'https://a.com']]);
    expect(spansOf('[see https://a.com/x]')).toEqual([['url', 5, 20, 'https://a.com/x']]);
    // Emphasis and strikethrough marks after it are left out too.
    expect(spansOf('See *https://a.com*, _https://b.com_ and ~~https://c.com~~.')).toEqual([
      ['url', 5, 18, 'https://a.com'],
      ['url', 22, 35, 'https://b.com'],
      ['url', 43, 56, 'https://c.com']
    ]);
  });

  it('HTML: real elements whose attributes have values, and any tag with name=value', () => {
    expect(spansOf('<span class="aside">Hush</span><br/>')).toEqual([
      ['html', 0, 20, '<span class="aside">'],
      ['html', 24, 31, '</span>'],
      ['html', 31, 36, '<br/>']
    ]);
    expect(spansOf('<center>The End</center>')).toEqual([
      ['html', 0, 8, '<center>'],
      ['html', 15, 24, '</center>']
    ]);
    expect(spansOf('<x-note data-id="1">')).toEqual([['html', 0, 20, '<x-note data-id="1">']]);
    expect(spansOf('One<BR>two')).toEqual([['html', 3, 7, '<BR>']]);
    // A closing tag carries no attributes.
    expect(syntaxSpans('</span class="x">')).toEqual([]);
  });

  it('HTML: each element name 11.3 (k) lists, in any case, opening and closing, and no other', () => {
    // Copied from PLAN 11.3 (k).
    const names =
      'a, abbr, b, br, blockquote, center, code, del, details, div, em, font, hr, i, iframe, img, ins, kbd, li, mark, ol, p, pre, s, small, source, span, strong, sub, summary, sup, table, td, th, tr, u, ul, video, audio'.split(
        ', '
      );
    expect(names).toHaveLength(39);
    for (const name of names) {
      for (const tag of [`<${name}>`, `<${name.toUpperCase()}>`, `</${name}>`]) {
        expect(spansOf(tag), tag).toEqual([['html', 0, tag.length, tag]]);
      }
    }
    for (const tag of ['<sigh>', '<cite>', '</cite>', '<SIGH>', '</sigh>']) {
      expect(syntaxSpans(tag), tag).toEqual([]);
    }
  });
});

describe('syntaxSpans: prose that only looks like syntax', () => {
  it("finds nothing in the plan's negatives", () => {
    for (const text of [
      '#1984',
      'Room #4',
      '$5 and $10',
      '*em*',
      '==hi==',
      '\tShe kept walking, and the rain kept on.',
      '5 < 6',
      '<Where are you?>',
      '<sigh>'
    ]) {
      expect(syntaxSpans(text), text).toEqual([]);
    }
  });

  it('finds nothing in other prose: dialogue in angle brackets, lone markers, emphasis, lists, indented lines', () => {
    for (const text of [
      '<I know.>',
      '<details open>',
      'C# and F#',
      'issue#5',
      'C#minor, issue#five and "#quoted"',
      'x^2 and ^ alone',
      'E = mc^2',
      '[!note] outside a quote',
      '####### seven is too many',
      '[[]] and [[a\nb]]',
      '[sic] and [He paused.]',
      'don`t',
      '**bold**, ~~struck~~ and ***both***',
      '- a list\n1. an item\n- [ ] a task',
      '| a | b |\n| - | - |',
      '    # not a heading\n    > not a quote',
      '\t# not a heading\n\t---',
      '50% and 20%',
      'a ~ b',
      '-- and --',
      '[a](b c)',
      '^[never closed',
      '[[a[b]]',
      'see http:// now',
      'http://-x'
    ]) {
      expect(syntaxSpans(text), text).toEqual([]);
    }
  });
});

describe('syntaxSpans: what wins', () => {
  it('code, comments and maths hold what is inside them, whichever opens first', () => {
    expect(spansOf('`%% not a comment %%`')).toEqual([['code', 0, 21, '`%% not a comment %%`']]);
    expect(spansOf('%% `not code` %%')).toEqual([['comment', 0, 16, '%% `not code` %%']]);
    expect(spansOf('$$ [[x]] $$')).toEqual([['math', 0, 11, '$$ [[x]] $$']]);
  });

  it('marks inside marks never overlap: a link in an inline footnote, code in link text', () => {
    expect(spansOf('^[See [[Home]].]')).toEqual([
      ['footnote', 0, 2, '^['],
      ['wikilink', 6, 14, '[[Home]]'],
      ['footnote', 15, 16, ']']
    ]);
    expect(spansOf('[a [b] `]` c](u)')).toEqual([
      ['link', 0, 1, '['],
      ['code', 7, 10, '`]`'],
      ['link', 12, 16, '](u)']
    ]);
    expect(spansOf('[https://example.com](https://example.com)')).toEqual([
      ['link', 0, 1, '['],
      ['url', 1, 20, 'https://example.com'],
      ['link', 20, 42, '](https://example.com)']
    ]);
  });

  it('a character escaped with a backslash opens nothing', () => {
    expect(spansOf('\\#draft \\[[Home]] \\`x\\` \\%%a\\%% \\<br>')).toEqual([]);
    expect(spansOf('\\![[map.png]]')).toEqual([['wikilink', 2, 13, '[[map.png]]']]);
    expect(spansOf('\\^[x]')).toEqual([]);
  });

  it('inline code, link text and an inline footnote stop at a blank line, a line of spaces included', () => {
    expect(spansOf('a `b\n\nc` d')).toEqual([]);
    expect(spansOf('[a\n\nb](c)')).toEqual([]);
    expect(spansOf('^[a\n\nb]')).toEqual([]);
    expect(spansOf('a `b\n  \nc` d')).toEqual([]);
  });
});

describe('syntaxSpans: one paragraph read alone, with { frontmatter: false }', () => {
  it('reads the --- lines of a body paragraph as horizontal rules, as its chapter does', () => {
    const paragraph = '---\nThree days later.\n---';
    const chapter = `Para one.\n\n${paragraph}\n\nPara two.`;
    expect(spansOf(chapter)).toEqual([
      ['thematic-break', 11, 14, '---'],
      ['thematic-break', 33, 36, '---']
    ]);
    expect(spansOf(paragraph, { frontmatter: false })).toEqual([
      ['thematic-break', 0, 3, '---'],
      ['thematic-break', 22, 25, '---']
    ]);
    // A copyedit of its prose leaves its signature as it was.
    const edited = paragraph.replace('Three', 'Four');
    expect(syntaxSignature(edited, { frontmatter: false })).toBe(
      syntaxSignature(paragraph, { frontmatter: false })
    );
    expect(syntaxSignature(chapter.replace('Three', 'Four'))).toBe(syntaxSignature(chapter));
  });

  it('without it, the same text starts a note, and its --- block is frontmatter, prose and all', () => {
    const paragraph = '---\nChapter Too\n---';
    expect(spansOf(paragraph)).toEqual([['frontmatter', 0, 19, paragraph]]);
    expect(spansOf(paragraph, { frontmatter: true })).toEqual([['frontmatter', 0, 19, paragraph]]);
    expect(syntaxSignature('---\nChapter Two\n---')).not.toBe(syntaxSignature(paragraph));
    expect(spansOf(paragraph, { frontmatter: false })).toEqual([
      ['thematic-break', 0, 3, '---'],
      ['thematic-break', 16, 19, '---']
    ]);
    expect(syntaxSignature('---\nChapter Two\n---', { frontmatter: false })).toBe(
      syntaxSignature(paragraph, { frontmatter: false })
    );
  });
});

describe('bodyStart', () => {
  it('is 0 without frontmatter, else just past the line break after the closing ---', () => {
    expect(bodyStart('It rained.')).toBe(0);
    expect(bodyStart('---\na: 1\n---\n\nBody')).toBe(13);
    expect(bodyStart('---\na: 1\n---')).toBe(12);
    expect(bodyStart('---\na: 1\n\nno close')).toBe(0);
    expect(bodyStart('Text\n\n---\na: 1\n---')).toBe(0);
  });

  it('agrees with splitParagraphs on where the frontmatter ends', () => {
    for (const text of ['---\na: 1\n---\nBody', '---\na: 1\n---\n\nBody', '---\na: 1\n---']) {
      const front = splitParagraphs(text)[0]!;
      expect(front.isFrontmatter, text).toBe(true);
      expect(text.slice(front.end, bodyStart(text)), text).toBe(front.end < text.length ? '\n' : '');
    }
  });
});

describe('syntaxSignature', () => {
  it("is each span's kind and text, in order", () => {
    expect(syntaxSignature('A #tag and [[B]]')).toBe('[["tag","#tag"],["wikilink","[[B]]"]]');
    expect(syntaxSignature('No syntax here.')).toBe('[]');
  });

  it('stays the same when only the prose around the syntax changes', () => {
    expect(syntaxSignature('See [[Home|the house]] at noon. #draft')).toBe(
      syntaxSignature('We left [[Home|the old house]] at dusk, #draft')
    );
  });

  it('changes when a copyedit would change syntax without touching a span', () => {
    // Two brackets joined make an internal link; a ! before one makes an embed.
    expect(syntaxSignature('a [[Home]] b')).not.toBe(syntaxSignature('a [ [Home]] b'));
    expect(syntaxSignature('a ![[map.png]] b')).not.toBe(syntaxSignature('a [[map.png]] b'));
    // Letters run on into a tag; a backslash taken away makes one.
    expect(syntaxSignature('#draft s')).not.toBe(syntaxSignature('#drafts'));
    expect(syntaxSignature('\\#draft')).not.toBe(syntaxSignature('#draft'));
    // A word after a block ID takes it off the end of its line.
    expect(syntaxSignature('Text ^id')).not.toBe(syntaxSignature('Text ^id more'));
  });
});

describe('MARKUP_CHARS', () => {
  it('are the characters 11.3 (k) lists: [ ] % $ ^ # < > | ~, the backtick and the line break', () => {
    expect([...MARKUP_CHARS].sort()).toEqual(
      ['[', ']', '%', '$', '^', '#', '<', '>', '|', '~', '`', '\n'].sort()
    );
  });

  it('hasMarkupChar finds any of them and nothing else', () => {
    expect(hasMarkupChar('a,b')).toBe(false);
    expect(hasMarkupChar('%ab%')).toBe(true);
    for (const c of MARKUP_CHARS) expect(hasMarkupChar(`word${c}word`), JSON.stringify(c)).toBe(true);
    expect(hasMarkupChar(`It's (nearly) done! *Really* -- = _ "so" / & @ ; : ? \\`)).toBe(false);
    expect(hasMarkupChar('')).toBe(false);
  });
});

describe('SYNTAX_LABELS', () => {
  it('names every kind in plain words for the kept-out note', () => {
    expect(Object.keys(SYNTAX_LABELS).sort()).toEqual([...SYNTAX_KINDS].sort());
    expect(SYNTAX_LABELS).toEqual({
      frontmatter: 'frontmatter',
      code: 'code',
      comment: 'a comment',
      math: 'maths',
      embed: 'an embed',
      wikilink: 'an internal link',
      link: 'a link',
      image: 'an image',
      footnote: 'a footnote',
      'block-id': 'a block ID',
      tag: 'a tag',
      callout: 'a callout',
      quote: 'a block quote',
      heading: 'a heading',
      'thematic-break': 'a horizontal rule',
      url: 'a web address',
      html: 'HTML'
    });
  });
});

describe('syntaxSpans: properties', () => {
  /* Any text, built from pieces heavy in markup: whatever it holds, the spans
     come in order, never overlap, are never empty and lie inside the text,
     and only the frontmatter comes before bodyStart. */
  const PIECES = [
    'a',
    'Mara',
    ' ',
    '\n',
    '\n\n',
    '\t',
    '[',
    ']',
    '(',
    ')',
    '!',
    '^',
    '#',
    '%',
    '$',
    '<',
    '>',
    '/',
    '|',
    '~',
    '`',
    '*',
    '_',
    '-',
    '=',
    ':',
    '"',
    "'",
    '\\',
    '1',
    '\u00e9',
    '\u{1F525}',
    '[[',
    ']]',
    '%%',
    '$$',
    '<!--',
    '-->',
    '```',
    '~~~',
    '---',
    '---\nk: v\n---\n',
    '> ',
    '# ',
    '[!note]',
    '[^1]',
    '^[',
    ' ^id',
    'https://example.com/a',
    '<span>',
    '</b>',
    '<a href="x">'
  ];

  it('spans are in order, never overlap, are never empty and lie inside the text', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...PIECES), { maxLength: 60 }).map((pieces) => pieces.join('')),
        (text) => {
          const found = syntaxSpans(text);
          const body = bodyStart(text);
          let last = 0;
          for (const span of found) {
            expect(SYNTAX_KINDS).toContain(span.kind);
            expect(span.start).toBeGreaterThanOrEqual(last);
            expect(span.end).toBeGreaterThan(span.start);
            expect(span.end).toBeLessThanOrEqual(text.length);
            if (span.kind !== 'frontmatter') expect(span.start).toBeGreaterThanOrEqual(body);
            last = span.end;
          }
          expect(found.filter((s) => s.kind === 'frontmatter')).toEqual(
            body > 0 ? [{ kind: 'frontmatter', start: 0, end: body }] : []
          );
        }
      ),
      { numRuns: 1000 }
    );
  });

  /* A chapter of prose lines and syntax, then one word outside every span
     replaced: every span keeps its kind and text and moves by the change in
     length, or not at all, so the signature is the same. Words in an alias,
     link text, an inline footnote, a heading or a callout's title are among
     those replaced; so are the words of prose that only looks like syntax. */
  const WORDS = ['rain', 'night', 'river', 'Mara', 'lamp', 'stone', 'quiet', 'door'];
  const MARKS = [
    '[[Chapter 2]]',
    '[[Chapter 2|the flood chapter]]',
    '![[map.png]]',
    '![[map.png|300]]',
    '[the mill](https://example.com/mill)',
    '[notes](<Mill notes.md> "Notes")',
    '![a map](map.png)',
    '[^1]',
    '^[a note on the river]',
    '#draft',
    '#places/mill',
    '(#draft)',
    '`code`',
    '``a ` b``',
    '%%a private note%%',
    '<!-- a note -->',
    '$$x^2$$',
    '<span>',
    '</span>',
    '<br/>',
    '<span class="aside">',
    'https://example.com/a_(b)',
    '#1984',
    'Room #4',
    '$5 and $10',
    '*em*',
    '==hi==',
    '5 < 6',
    '<Where are you?>',
    '<sigh>',
    '<I know.>',
    '[sic]',
    '~',
    '%',
    '|'
  ];
  const OPENINGS = ['', '', '', '> ', '## ', '> [!note] ', '[^2]: ', '- ', '1. ', '\t'];
  const ENDINGS = ['', '', ' ^mill-1'];
  const BLOCKS = [
    '---',
    '---\nThree days later.\n---',
    '* * *',
    '```\nlet x = 1;\n```',
    '~~~\ncode\n~~~',
    '%%\nnote\n\nmore\n%%',
    '$$\nx\n$$'
  ];

  const proseLine = fc
    .tuple(
      fc.constantFrom(...OPENINGS),
      fc.array(fc.oneof(fc.constantFrom(...WORDS), fc.constantFrom(...MARKS)), {
        minLength: 1,
        maxLength: 8
      }),
      fc.constantFrom(...ENDINGS)
    )
    .map(([opening, tokens, ending]) => `${opening}${tokens.join(' ')}${ending}`);
  const line = fc.oneof(
    { weight: 4, arbitrary: proseLine },
    { weight: 1, arbitrary: fc.constantFrom(...BLOCKS) }
  );
  const chapter = fc
    .tuple(fc.boolean(), fc.array(fc.tuple(line, fc.boolean()), { minLength: 1, maxLength: 12 }))
    .map(
      ([front, lines]) =>
        (front ? '---\ntitle: The Mill\n---\n' : '') +
        lines.map(([text, blank], k) => (k === 0 ? '' : blank ? '\n\n' : '\n') + text).join('')
    );

  it('a prose edit outside every span moves the spans and changes nothing else', () => {
    fc.assert(
      fc.property(
        chapter,
        fc.nat(),
        fc.constantFrom(...WORDS, 'the rain', 'Mara said'),
        (text, pick, word) => {
          const before = syntaxSpans(text);
          const words = [...text.matchAll(/[A-Za-z]+/g)]
            .map((m) => ({ start: m.index, end: m.index + m[0].length }))
            .filter((w) => before.every((s) => s.end <= w.start || s.start >= w.end));
          fc.pre(words.length > 0);
          const target = words[pick % words.length]!;
          const edited = text.slice(0, target.start) + word + text.slice(target.end);
          const shift = word.length - (target.end - target.start);
          expect(syntaxSpans(edited)).toEqual(
            before.map((s) =>
              s.start >= target.end ? { ...s, start: s.start + shift, end: s.end + shift } : s
            )
          );
          expect(syntaxSignature(edited)).toBe(syntaxSignature(text));
        }
      ),
      { numRuns: 500 }
    );
  });

  /* Each body paragraph of the same chapters, read alone with
     { frontmatter: false } as the guard reads one (files.7): unless a span
     of the chapter crosses its edge, it finds exactly the chapter's spans
     inside it, at its own offsets. The chapters hold --- lines next to
     prose, and comments, fences and maths that run across blank lines. */
  it('a body paragraph read alone finds what its chapter finds there, unless a chapter span crosses its edge', () => {
    let compared = 0;
    fc.assert(
      fc.property(chapter, (text) => {
        const spans = syntaxSpans(text);
        for (const p of splitParagraphs(text)) {
          if (p.isFrontmatter) continue;
          const crossed = spans.some(
            (s) => (s.start < p.start && s.end > p.start) || (s.start < p.end && s.end > p.end)
          );
          if (crossed) continue;
          const inside = spans
            .filter((s) => s.start >= p.start && s.end <= p.end)
            .map((s) => ({ ...s, start: s.start - p.start, end: s.end - p.start }));
          expect(syntaxSpans(p.text, { frontmatter: false }), p.text).toEqual(inside);
          compared += 1;
        }
      }),
      { numRuns: 500 }
    );
    expect(compared).toBeGreaterThan(500);
  });
});
