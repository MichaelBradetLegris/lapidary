import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeReview } from '../../src/shared/diff/compose';
import { createDiffReview } from '../../src/shared/review';
import { TIGHT_P, toRoyalRoadHtml } from '../../src/shared/text/royalroad';

/* rr.1: Royal Road HTML for Copy HTML. One group per rule of the task
   (PLAN M11, rr.1), the Obsidian sample chapter whole, the composed text, and
   two properties: the words a reader sees survive the conversion, and no
   chapter can put markup it did not mean into the page. What the converter
   settled where the plan left it open is C.111. */

const html = toRoyalRoadHtml;
const p = (words: string): string => `<p>${words}</p>`;
const tight = (words: string): string => `${TIGHT_P}${words}</p>`;
const lines = (...each: string[]): string => each.join('\n');

describe('rule 1: paragraphs from lines', () => {
  it('makes each paragraph between blank lines a plain <p>', () => {
    expect(html('One.\n\nTwo.')).toBe(lines(p('One.'), p('Two.')));
    // Several blank lines, some with spaces in them, are one break.
    expect(html('One.\n\n \n\t\nTwo.\n')).toBe(lines(p('One.'), p('Two.')));
  });

  it('makes a run of lines with no blank line between them a tight block, every line but the last held close', () => {
    expect(TIGHT_P).toBe('<p style="margin-bottom: 0">');
    expect(html('Name: Mara\nLevel: 5\nClass: Miller\n\nShe looked up.')).toBe(
      lines(tight('Name: Mara'), tight('Level: 5'), p('Class: Miller'), p('She looked up.'))
    );
  });

  it('reads CRLF line breaks and leaves out a byte order mark', () => {
    expect(html('\uFEFFOne\r\nTwo\r\n\r\nThree\r\n')).toBe(lines(tight('One'), p('Two'), p('Three')));
  });

  it('trims each line and makes runs of spaces and tabs one space', () => {
    expect(html('   Indented  with \t gaps   ')).toBe(p('Indented with gaps'));
    expect(html('\tA tab first')).toBe(p('A tab first'));
  });

  it('gives nothing for nothing', () => {
    expect(html('')).toBe('');
    expect(html('\n\n  \n')).toBe('');
  });
});

describe('rule 2: headings', () => {
  it('makes # to ###### and a space <h1> to <h6>', () => {
    expect(html('# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six')).toBe(
      lines('<h1>One</h1>', '<h2>Two</h2>', '<h3>Three</h3>', '<h4>Four</h4>', '<h6>Six</h6>')
    );
  });

  it('leaves out the closing #s CommonMark allows, and a heading with no words', () => {
    expect(html('## The letter ##')).toBe('<h2>The letter</h2>');
    expect(html('# C#')).toBe('<h1>C#</h1>');
    expect(html('#\n\nText')).toBe(p('Text'));
  });

  it('is no heading without the space, and ends a tight block', () => {
    expect(html('#7 is a number')).toBe(p('#7 is a number'));
    expect(html('Before\n# Title\nAfter')).toBe(lines(p('Before'), '<h1>Title</h1>', p('After')));
  });
});

describe('rule 3: emphasis', () => {
  it('makes ***, ** and * <strong><em>, <strong> and <em>', () => {
    expect(html('***both*** **bold** *em*')).toBe(
      p('<strong><em>both</em></strong> <strong>bold</strong> <em>em</em>')
    );
  });

  it('makes ___, __ and _ the same when they pair, and leaves _ inside a word alone', () => {
    expect(html('___both___ __bold__ _em_')).toBe(
      p('<strong><em>both</em></strong> <strong>bold</strong> <em>em</em>')
    );
    expect(html('snake_case_name and a_b')).toBe(p('snake_case_name and a_b'));
    // * may open and close inside a word; _ may not.
    expect(html('un*frigging*believable un_frigging_believable')).toBe(
      p('un<em>frigging</em>believable un_frigging_believable')
    );
  });

  it('nests, and leaves markers that do not pair as they are', () => {
    expect(html('*a **b** c*')).toBe(p('<em>a <strong>b</strong> c</em>'));
    expect(html('**open only and a * b')).toBe(p('**open only and a * b'));
    expect(html('**bold*')).toBe(p('*<em>bold</em>'));
  });

  it("follows CommonMark's rule of three", () => {
    expect(html('*foo**bar*')).toBe(p('<em>foo**bar</em>'));
    expect(html('*foo**bar**baz*')).toBe(p('<em>foo<strong>bar</strong>baz</em>'));
  });

  it('pairs markers on one line only', () => {
    expect(html('*starts here\nends here*')).toBe(lines(tight('*starts here'), p('ends here*')));
  });

  it('makes ~~ <s>, and leaves a single ~ or three as they are', () => {
    expect(html('~~gone~~ ~one~ x ~~~ y')).toBe(p('<s>gone</s> ~one~ x ~~~ y'));
  });

  it("gives == the words alone, as Royal Road's keeping <mark> is not known yet", () => {
    expect(html('==marked== and a == b')).toBe(p('marked and a == b'));
  });
});

describe('rule 4: horizontal rules', () => {
  it('makes a line of *, ***, ---, ___ or * * * alone <hr />', () => {
    for (const rule of ['*', '***', '---', '___', '* * *', '- - -', '  ****  ']) {
      expect(html(`Before\n\n${rule}\n\nAfter`), rule).toBe(lines(p('Before'), '<hr />', p('After')));
    }
  });

  it('ends a tight block, and is not ** or a starred word', () => {
    expect(html('A\n*\nB')).toBe(lines(p('A'), '<hr />', p('B')));
    expect(html('**')).toBe(p('**'));
    expect(html('*word*')).toBe(p('<em>word</em>'));
  });
});

describe('rule 5: arrows, dashes and backslash escapes', () => {
  it('makes -> and --> →, --- —, -- – and –- —, and leaves one hyphen alone', () => {
    expect(html('a->b c --> d e---f g--h i–-j well-known 5-10')).toBe(
      p('a→b c → d e—f g–h i—j well-known 5-10')
    );
  });

  it('leaves code and web addresses as they are', () => {
    expect(html('`a--b` https://example.com/a--b')).toBe(
      p('a--b <a href="https://example.com/a--b">https://example.com/a--b</a>')
    );
  });

  it('gives an escaped mark of punctuation as it is, opening nothing', () => {
    expect(html(String.raw`\*not em\* \_nor\_ \#notag \[[no link]] \-\- \<b\> \\ end`)).toBe(
      p(String.raw`*not em* _nor_ #notag [[no link]] -- &lt;b&gt; \ end`)
    );
  });

  it('keeps a backslash before anything else, and leaves out one that ends a line', () => {
    expect(html(String.raw`C:\Novel\Chapter 1`)).toBe(p(String.raw`C:\Novel\Chapter 1`));
    expect(html('First\\\nSecond\\')).toBe(lines(tight('First'), p('Second')));
  });
});

describe('rule 6: quotes', () => {
  it('makes curly quotes straight by default, as the author’s converter does', () => {
    expect(html('“Curly,” she said. ‘Single’ and don’t.')).toBe(
      p("\"Curly,\" she said. 'Single' and don't.")
    );
  });

  it('keeps them with straightQuotes false', () => {
    expect(html('“Curly” don’t', { straightQuotes: false })).toBe(p('“Curly” don’t'));
    expect(html('“Curly” don’t', { straightQuotes: true })).toBe(p('"Curly" don\'t'));
  });
});

describe('rule 7: Obsidian syntax', () => {
  it('leaves out the frontmatter', () => {
    expect(html('---\ntitle: Chapter 2\ntags: [novel]\n---\n\nBody.')).toBe(p('Body.'));
    expect(html('---\ntitle: Only\n---')).toBe('');
  });

  it('leaves out comments, and a line that was only a comment, joining the lines round it', () => {
    expect(html('%% note %%Kept %% and %%here. <!-- gone -->')).toBe(p('Kept here.'));
    expect(html('Line one\n%% a comment line %%\nLine two')).toBe(lines(tight('Line one'), p('Line two')));
    expect(html('Before\n\n%%\nA comment\n\nwith a blank line\n%%\n\nAfter')).toBe(
      lines(p('Before'), p('After'))
    );
    expect(html('<!--\nhidden\n-->\nShown')).toBe(p('Shown'));
  });

  it('keeps a %% or <!-- that nothing closes as typed, as an unclosed $$ is, alone on its line too', () => {
    expect(html('a %% b')).toBe(p('a %% b'));
    expect(html('a <!-- b')).toBe(p('a &lt;!-- b'));
    expect(html('A\n%%\nB')).toBe(lines(tight('A'), tight('%%'), p('B')));
    expect(html('<!--\nB')).toBe(lines(tight('&lt;!--'), p('B')));
  });

  it('gives an internal link its alias, or its target', () => {
    expect(html('[[Chapter 01 - The Flood|the night of the flood]] and [[Millers Lane]]')).toBe(
      p('the night of the flood and Millers Lane')
    );
    expect(html('[[Note#Heading|*the* place]]')).toBe(p('<em>the</em> place'));
  });

  it('makes a link to a web address or an email address <a>, and gives any other link its words', () => {
    expect(
      html('[the map](https://example.org/map?a=1&b=2 "Title") and [write](mailto:mara@example.com)')
    ).toBe(
      p(
        '<a href="https://example.org/map?a=1&amp;b=2">the map</a> and <a href="mailto:mara@example.com">write</a>'
      )
    );
    expect(html('[a note](Other%20note.md) and [no](javascript:alert(1))')).toBe(p('a note and no'));
    expect(html('[*a* b](<https://example.org/a b>)')).toBe(
      p('<a href="https://example.org/a b"><em>a</em> b</a>')
    );
    expect(html('**[bold link](https://example.org)**')).toBe(
      p('<strong><a href="https://example.org">bold link</a></strong>')
    );
    // No link inside a link: an address or a link in a link's words is words.
    expect(html('[see https://example.org/b and [c](https://example.org/c)](https://example.org/a)')).toBe(
      p('<a href="https://example.org/a">see https://example.org/b and c</a>')
    );
    // Words that run onto the next line are words.
    expect(html('[two\nlines](https://example.org)')).toBe(lines(tight('two'), p('lines')));
  });

  it('makes a bare web address a link, without the angle brackets round one', () => {
    expect(html('See https://example.org/a. Or <https://example.org/b>')).toBe(
      p(
        'See <a href="https://example.org/a">https://example.org/a</a>. Or <a href="https://example.org/b">https://example.org/b</a>'
      )
    );
  });

  it('leaves out tags and block IDs, and a line of tags', () => {
    expect(html('Kept #draft here (#todo) ^block-1')).toBe(p('Kept here ()'));
    expect(html('Room #4 and #1984')).toBe(p('Room #4 and #1984'));
    expect(html('One\n#continuity #mara\nTwo')).toBe(lines(tight('One'), p('Two')));
  });

  it("drops a footnote's mark and keeps its words: a definition's where it stands, an inline one's at the end", () => {
    expect(html('The wheel[^1] turned.^[It was rebuilt.] Then *more*.\n\n[^1]: In 1840.')).toBe(
      lines(p('The wheel turned. Then <em>more</em>.'), p('In 1840.'), p('It was rebuilt.'))
    );
    expect(html('One^[across\ntwo lines] end')).toBe(lines(tight('One'), p('end'), p('across two lines')));
  });

  it('makes block quotes <blockquote>, nested ones too, with the lines a quote runs on into', () => {
    expect(html('> Mara. I am in a city.\n> Your brother<br>T.')).toBe(
      lines('<blockquote>', tight('Mara. I am in a city.'), p('Your brother<br />T.'), '</blockquote>')
    );
    expect(html('> one\n>\n> > two\n\n> three')).toBe(
      lines(
        '<blockquote>',
        p('one'),
        '<blockquote>',
        p('two'),
        '</blockquote>',
        '</blockquote>',
        '<blockquote>',
        p('three'),
        '</blockquote>'
      )
    );
    expect(html('> a quote\nruns on')).toBe(
      lines('<blockquote>', tight('a quote'), p('runs on'), '</blockquote>')
    );
  });

  it("makes a callout a <blockquote>, its title in bold, or its type's name when it has none", () => {
    expect(html('> [!info]+ Status\n> Level: 5\n> HP: 10')).toBe(
      lines('<blockquote>', tight('<strong>Status</strong>'), tight('Level: 5'), p('HP: 10'), '</blockquote>')
    );
    expect(html('> [!note]\n> ![[Chapter 02]]')).toBe(
      lines('<blockquote>', p('<strong>Note</strong>'), '</blockquote>')
    );
    // The type's name in title case, as Obsidian shows it, however it was typed.
    for (const [type, name] of [
      ['NOTE', 'Note'],
      ['Tip', 'Tip'],
      ['my-TYPE', 'My-type']
    ]) {
      expect(html(`> [!${type}]\n> body`), type).toBe(
        lines('<blockquote>', tight(`<strong>${name}</strong>`), p('body'), '</blockquote>')
      );
    }
  });

  it('makes - and 1. lists <ul> and <ol>, nested by their indent, with the lines an item runs on into', () => {
    expect(html('- one\n- two\n  - under two\n- three')).toBe(
      lines(
        '<ul>',
        '<li>one</li>',
        '<li>two',
        '<ul>',
        '<li>under two</li>',
        '</ul></li>',
        '<li>three</li>',
        '</ul>'
      )
    );
    expect(html('1. first\n2. second\n\n3. third')).toBe(
      lines('<ol>', '<li>first</li>', '<li>second</li>', '<li>third</li>', '</ol>')
    );
    expect(html('1) one\n2) two')).toBe(lines('<ol>', '<li>one</li>', '<li>two</li>', '</ol>'));
    expect(html('3. three\n4. four')).toBe(
      lines('<ol start="3">', '<li>three</li>', '<li>four</li>', '</ol>')
    );
    // An item indented less than the first is still one of the list; one back
    // out of a nested list joins the list it was nested in.
    expect(html('  - indented\n- not')).toBe(lines('<ul>', '<li>indented</li>', '<li>not</li>', '</ul>'));
    expect(html('- a\n    - b\n  - c\n- d')).toBe(
      lines('<ul>', '<li>a', '<ul>', '<li>b</li>', '<li>c</li>', '</ul></li>', '<li>d</li>', '</ul>')
    );
    expect(html('- one\n1. two')).toBe(
      lines('<ul>', '<li>one</li>', '</ul>', '<ol>', '<li>two</li>', '</ol>')
    );
    expect(html('* star\n+ plus\n- item\nruns on')).toBe(
      lines('<ul>', '<li>star</li>', '<li>plus</li>', '<li>item<br />runs on</li>', '</ul>')
    );
  });

  it('starts no list inside a paragraph with a number but 1, nor with an empty item', () => {
    expect(html('Text\n1984. A year')).toBe(lines(tight('Text'), p('1984. A year')));
    expect(html('Text\n-')).toBe(lines(tight('Text'), p('-')));
    expect(html('Text\n1. One')).toBe(lines(p('Text'), '<ol>', '<li>One</li>', '</ol>'));
  });

  it('makes a | table <table>, with its alignment, an escaped | and a link with an alias in a cell', () => {
    expect(html('| Name | HP |\n| :--- | ---: |\n| Mara | 10 |\n| [[Rook|the rook]] \\| bird |')).toBe(
      lines(
        '<table>',
        '<thead>',
        '<tr><th style="text-align: left">Name</th><th style="text-align: right">HP</th></tr>',
        '</thead>',
        '<tbody>',
        '<tr><td style="text-align: left">Mara</td><td style="text-align: right">10</td></tr>',
        '<tr><td style="text-align: left">the rook | bird</td><td style="text-align: right"></td></tr>',
        '</tbody>',
        '</table>'
      )
    );
    expect(html('a | b\n--- | :-:')).toBe(
      lines(
        '<table>',
        '<thead>',
        '<tr><th>a</th><th style="text-align: center">b</th></tr>',
        '</thead>',
        '</table>'
      )
    );
    expect(html('Not | a table\n---')).toBe(lines(p('Not | a table'), '<hr />'));
  });

  it('gives code and maths their text, as it is, a code block as a tight block without its fences', () => {
    expect(html('```\nLedger, March\n  12 sacks   *barley*\n```\nAfter')).toBe(
      lines(tight('Ledger, March'), p('12 sacks *barley*'), p('After'))
    );
    expect(html('`a *b*` and `` c ` d ``')).toBe(p('a *b* and c ` d'));
    expect(html('$$1852 - 1833 = 19$$')).toBe(p('1852 - 1833 = 19'));
    expect(html('$$\nx = 1\n$$')).toBe(p('x = 1'));
    // Inline code that runs onto the next line is not a code block, even with three backticks.
    expect(html('a ```b\nc``` d')).toBe(lines(tight('a b'), p('c d')));
    // A fence that nothing closes is as typed, and the rest of the chapter is not code.
    expect(html('~~~\n*em*')).toBe(lines(tight('~~~'), p('<em>em</em>')));
  });

  it("gives a code block or maths in a quote or a callout without the quote's >s", () => {
    expect(html('> ```\n> Name: Mara\n> ```')).toBe(lines('<blockquote>', p('Name: Mara'), '</blockquote>'));
    // A status screen in a callout: the title, then the block's lines as a tight block.
    expect(html('> [!info] Status\n> ```\n> Name: Mara\n> Level: 5\n> ```')).toBe(
      lines('<blockquote>', p('<strong>Status</strong>'), tight('Name: Mara'), p('Level: 5'), '</blockquote>')
    );
    // Nested, with an info string, Markdown and a > of its own kept as typed, and a line after it.
    expect(html('> > ```js\n> >   a *b* > c\n> > ```\n> > after')).toBe(
      lines('<blockquote>', '<blockquote>', p('a *b* &gt; c'), p('after'), '</blockquote>', '</blockquote>')
    );
    expect(html('> $$\n> x = 1\n> $$')).toBe(lines('<blockquote>', p('x = 1'), '</blockquote>'));
    // Inline code that runs onto the next line of a quote, and a closing fence with words after it.
    expect(html('> a `b\n> c` d')).toBe(lines('<blockquote>', tight('a b'), p('c d'), '</blockquote>'));
    expect(html('> ```\n> a\n> ``` b')).toBe(lines('<blockquote>', tight('a'), p('b'), '</blockquote>'));
  });

  it('makes an image at a web address <img>, and leaves out embeds and other images', () => {
    expect(html('![the stone](https://example.org/stone.png) ![[Chapter 02]] ![sketch](stone.svg)')).toBe(
      p('<img src="https://example.org/stone.png" alt="the stone" />')
    );
  });
});

describe('rule 8: HTML', () => {
  it('passes <u>, <sub> and <sup> with their closing tags, and <br>', () => {
    expect(html('<u>wrok</u> H<sub>2</sub>O x<SUP>2</SUP> one<br>two<BR/>three')).toBe(
      p('<u>wrok</u> H<sub>2</sub>O x<sup>2</sup> one<br />two<br />three')
    );
  });

  it('escapes every other <, > and &, angle-bracket dialogue and other tags among them', () => {
    expect(html('<I know.> <span class="aside">x</span> <i>y</i> AT&T 3 < 4 &amp;')).toBe(
      p(
        '&lt;I know.&gt; &lt;span class="aside"&gt;x&lt;/span&gt; &lt;i&gt;y&lt;/i&gt; AT&amp;T 3 &lt; 4 &amp;amp;'
      )
    );
  });

  it('escapes a " in an address or an image\'s words, so it cannot end the attribute', () => {
    expect(html('[x](https://e.com/a"b)')).toBe(p('<a href="https://e.com/a&quot;b">x</a>'));
    expect(html('![x "y"](https://e.com/a"b.png)')).toBe(
      p('<img src="https://e.com/a&quot;b.png" alt="x &quot;y&quot;" />')
    );
  });

  it('escapes a tag that has no closing tag on its line', () => {
    expect(html('<u>open\nclose</u> and </sup>')).toBe(
      lines(tight('&lt;u&gt;open'), p('close&lt;/u&gt; and &lt;/sup&gt;'))
    );
  });
});

describe('the Obsidian sample chapter (files.9)', () => {
  const read = (name: string): string =>
    readFileSync(new URL(`../../samples/manuscript/${name}`, import.meta.url), 'utf8');

  it('comes out as Royal Road should show it', () => {
    expect(html(read('Chapter 03 - Obsidian.md'))).toBe(
      lines(
        '<h1>Obsidian</h1>',
        p(
          "The silt had dried into a crust that cracked under her boots, and beneath it the field was still soft. She found the stone on the third morning of clearing the lower wall, half buried where the gate had been. It was black and smooth and as cold as well water, and when she held it up to the light it was'nt black at all but the deep green of an old bottle."
        ),
        p(
          "She thought of the night of the flod, of the rope going soft in her brother's hands, and of the summer that came after. Nothing in either had told her that a river could carry glass."
        ),
        '<blockquote>',
        p('<strong>Where chapter two left off</strong>'),
        '</blockquote>',
        p(
          'She carried the stone up to the house in her apron and set it on the sill. The ewes watched her from the yard as if she had done something <em>realy</em> foolish, and perhaps she had. It had laid in the mud for a week and was still the coldest thing in the kitchen.'
        ),
        p(
          'The light came round in the afternoon and went through it, and threw a green coin onto the table.'
        ),
        '<hr />',
        '<h2>The leter</h2>',
        p(
          'The letter came in October with the carrier from Millers Lane, folded small and gone soft at the corners. Her brother had never wrote a letter in his life. She read it standing up.'
        ),
        '<blockquote>',
        tight(
          'Mara. I am in a city with more people in one street than in the whole valley. There is <u>wrok</u> here for anyone who will carry things, and I carry things. They pay $5 a week and $2 for the bed in Room #4, which leaves me 3 dollars and alot of evenings. I think of the field. Do not sell the ewes.'
        ),
        p('Your brother<br />T.'),
        '</blockquote>',
        p('She read it twice more and put it under the stone.'),
        '<blockquote>',
        tight("<strong>Check the carrier's route agianst the tithe map</strong>"),
        p(
          'Use <a href="https://example.org/tithe-map">teh tithe map</a> for the route and <a href="https://example.org/parish/regsiters">https://example.org/parish/regsiters</a> for the ages. Search the draft for recieved once the ledger scene is in.'
        ),
        '</blockquote>',
        p(
          'The miller had kept a ledger of every sack that passed the wheel. In the back of it, in a hand she did not know, someone had written the price of a stone like hers.'
        ),
        tight('Ledger, March'),
        tight('12 sacks barley recieved'),
        p('1 black glass paid 2s'),
        p('1852 - 1833 = 19'),
        p(
          'The next morning she went back to where she fond it and dug until noon, and found nothing but silt.'
        ),
        p('The wheel was rebuilt in 1840, wich is why the ledger begins that year.'),
        p("The ledger is the only record of the mill's last years; the parish copies was lost in a fire.")
      )
    );
  });

  it('gives the two plain chapters a paragraph each, in CRLF with a byte order mark or not', () => {
    const one = html(read('Chapter 01 - The Flood.md'));
    expect(one.split('\n')).toHaveLength(10);
    expect(one.split('\n').every((line) => /^<p>[^<>]+<\/p>$/.test(line))).toBe(true);
    expect(one.startsWith('<p>It was the third night of rain,')).toBe(true);
    const two = html(read('Chapter 02 - After.md'));
    expect(two.split('\n')).toHaveLength(3);
    expect(two).not.toContain('title:');
  });
});

describe('from the composed text (Copy HTML)', () => {
  it('reads a pending suggestion as its original and an accepted one as its replacement, as Copy result does', () => {
    const review = createDiffReview({
      originalRaw: 'The river had began to climb.\n\nShe should of known.',
      correctedRaw: 'The river had begun to climb.\n\nShe should have known.'
    });
    expect(review.hunks).toHaveLength(2);
    expect(html(composeReview(review))).toBe(
      lines(p('The river had began to climb.'), p('She should of known.'))
    );
    const accepted = {
      ...review,
      hunks: review.hunks.map((h, i) => (i === 0 ? { ...h, status: 'accepted' as const } : h))
    };
    expect(html(composeReview(accepted))).toBe(
      lines(p('The river had begun to climb.'), p('She should of known.'))
    );
  });
});

// --- Properties -------------------------------------------------------------------

/** What a reader sees of the HTML: blocks and line breaks as spaces, other tags as nothing, entities read. */
function readerText(out: string): string {
  return out
    .replace(
      /<\/?(?:p|h[1-6]|blockquote|ul|ol|li|table|thead|tbody|tr|th|td)\b[^>]*>|<(?:br|hr|img)\b[^>]*>/g,
      ' '
    )
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+/gu) ?? [];

/** A piece of a chapter: its Markdown, the words a reader sees of it there, and its footnotes' words, which go to the end. */
interface Bit {
  md: string;
  seen: string;
  notes: string[];
}

const bit = (md: string, seen: string, notes: string[] = []): Bit => ({ md, seen, notes });
const joined = (bits: readonly Bit[], separator: string, prefix = (_: number): string => ''): Bit => ({
  md: bits.map((b, i) => `${prefix(i)}${b.md}`).join(separator),
  seen: bits.map((b) => b.seen).join(' '),
  notes: bits.flatMap((b) => b.notes)
});

const WORDS = ['river', 'mill', 'Mara', 'stone', 'été', 'naïve', 'x1', 'ewes', 'Øre', 'glass'];
const word = fc.constantFrom(...WORDS);

/** One piece of a line, from every kind of syntax the rules read. */
const piece: fc.Arbitrary<Bit> = fc.oneof(
  word.map((w) => bit(w, w)),
  fc
    .tuple(fc.constantFrom('*', '**', '***', '_', '__', '___', '~~', '=='), word)
    .map(([m, w]) => bit(`${m}${w}${m}`, w)),
  fc.tuple(word, word).map(([a, b]) => bit(`[[${a} ${b}]]`, `${a} ${b}`)),
  fc.tuple(word, word).map(([target, alias]) => bit(`[[${target}|${alias}]]`, alias)),
  word.map((w) => bit(`[${w}](https://example.com/${w})`, w)),
  word.map((w) => bit(`https://example.com/${w}`, `https://example.com/${w}`)),
  word.map((w) => bit(`#${w}`, '')),
  word.map((w) => bit(`%%${w}%%`, '')),
  word.map((w) => bit(`<!-- ${w} -->`, '')),
  fc.constant(bit('[^1]', '')),
  word.map((w) => bit(`^[${w} note]`, '', [`${w} note`])),
  word.map((w) => bit(`\`${w} ${w}\``, `${w} ${w}`)),
  fc.tuple(fc.constantFrom('u', 'sub', 'sup'), word).map(([t, w]) => bit(`<${t}>${w}</${t}>`, w)),
  fc.constant(bit('<br>', ' ')),
  word.map((w) => bit(`\\*${w}\\*`, `*${w}*`)),
  fc
    .tuple(word, word, fc.constantFrom('--', '---', '->'))
    .map(([a, b, d]) => bit(`${a}${d}${b}`, `${a} ${b}`)),
  word.map((w) => bit(`<I ${w}.>`, `<I ${w}.>`)),
  word.map((w) => bit(`“${w}”`, `"${w}"`)),
  word.map((w) => bit(`AT&T ${w}`, `AT&T ${w}`))
);

const line = fc.array(piece, { minLength: 1, maxLength: 6 }).map((bits) => joined(bits, ' '));
const someLines = fc.array(line, { minLength: 1, maxLength: 3 });
const plainLine = fc.array(word, { minLength: 1, maxLength: 4 }).map((ws) => ws.join(' '));

/** One block of a chapter, of every kind the rules read. */
const block: fc.Arbitrary<Bit> = fc.oneof(
  someLines.map((ls) => joined(ls, '\n')),
  fc.tuple(fc.integer({ min: 1, max: 6 }), line).map(([n, l]) => joined([l], '', () => `${'#'.repeat(n)} `)),
  someLines.map((ls) => joined(ls, '\n', () => '> ')),
  // A callout's title starts with a word, so it is never the type's name.
  fc.tuple(word, line, someLines).map(([w, title, body]) => {
    const head = bit(`[!note] ${w} ${title.md}`, `${w} ${title.seen}`, title.notes);
    return joined([head, ...body], '\n', () => '> ');
  }),
  fc
    .tuple(fc.boolean(), someLines)
    .map(([ordered, ls]) => joined(ls, '\n', (i) => (ordered ? `${i + 1}. ` : '- '))),
  fc.constantFrom('*', '***', '---', '___', '* * *').map((md) => bit(md, '')),
  fc
    .tuple(fc.array(word, { minLength: 1, maxLength: 3 }), fc.array(word, { minLength: 1, maxLength: 3 }))
    .map(([head, row]) => {
      const cells = head.map((_, c) => row[c] ?? 'mill');
      return bit(
        [
          `| ${head.join(' | ')} |`,
          `|${head.map(() => ' --- ').join('|')}|`,
          `| ${cells.join(' | ')} |`
        ].join('\n'),
        [...head, ...cells].join(' ')
      );
    }),
  fc
    .array(plainLine, { minLength: 1, maxLength: 3 })
    .map((ls) => bit(['```', ...ls, '```'].join('\n'), ls.join(' '))),
  // A code block in a quote, whose lines' >s are not words.
  fc
    .array(plainLine, { minLength: 1, maxLength: 3 })
    .map((ls) => bit(['```', ...ls, '```'].map((l) => `> ${l}`).join('\n'), ls.join(' '))),
  plainLine.map((l) => bit(`%%\n${l}\n%%`, ''))
);

const chapter = fc
  .tuple(fc.boolean(), fc.array(block, { minLength: 1, maxLength: 6 }))
  .map(([frontmatter, blocks]) => {
    // A chapter that opens with a `---` rule and has another `---` line later
    // opens with frontmatter, as Obsidian and `frontmatterRange` read it.
    const first = blocks[0]?.md.startsWith('---') ? [bit('river', 'river')] : [];
    const body = joined([...first, ...blocks], '\n\n');
    return frontmatter ? { ...body, md: `---\ntitle: Chapter 3 - river\n---\n\n${body.md}` } : body;
  });

describe('a property: the words a reader sees survive the conversion', () => {
  it('in order, the inline footnotes last, for chapters made of every kind of syntax', () => {
    fc.assert(
      fc.property(chapter, (doc) => {
        const expected = words([doc.seen, ...doc.notes].join(' '));
        expect(words(readerText(html(doc.md)))).toEqual(expected);
      }),
      { numRuns: 500 }
    );
  });

  it('for the sample chapters, against their text with the syntax taken out by hand', () => {
    const read = (name: string): string =>
      readFileSync(new URL(`../../samples/manuscript/${name}`, import.meta.url), 'utf8');
    for (const name of ['Chapter 01 - The Flood.md', 'Chapter 02 - After.md']) {
      const text = read(name);
      const body = text.slice(text.indexOf('---', 4) + 3);
      expect(words(readerText(html(text))), name).toEqual(words(body));
    }
  });
});

/** The tags the converter writes, each with the attributes it may carry. */
const ALLOWED: ReadonlyMap<string, RegExp> = new Map([
  ['p', /^(?: style="margin-bottom: 0")?$/],
  ['h1', /^$/],
  ['h2', /^$/],
  ['h3', /^$/],
  ['h4', /^$/],
  ['h5', /^$/],
  ['h6', /^$/],
  ['strong', /^$/],
  ['em', /^$/],
  ['s', /^$/],
  ['u', /^$/],
  ['sub', /^$/],
  ['sup', /^$/],
  ['a', /^ href="[^"<>]*"$/],
  ['blockquote', /^$/],
  ['ul', /^$/],
  ['ol', /^(?: start="\d+")?$/],
  ['li', /^$/],
  ['table', /^$/],
  ['thead', /^$/],
  ['tbody', /^$/],
  ['tr', /^$/],
  ['th', /^(?: style="text-align: (?:left|center|right)")?$/],
  ['td', /^(?: style="text-align: (?:left|center|right)")?$/],
  ['hr', /^ \/$/],
  ['br', /^ \/$/],
  ['img', /^ src="[^"<>]*" alt="[^"<>]*" \/$/]
]);
const VOID = new Set(['hr', 'br', 'img']);

/** What is wrong with the HTML as markup: a tag not on the list, attributes it may not carry, a tag not closed in order, or a <, > or & that is not markup. */
function problems(out: string): string[] {
  const found: string[] = [];
  const open: string[] = [];
  const text = (between: string): void => {
    if (/[<>]/.test(between)) found.push(`a bare < or > in ${JSON.stringify(between)}`);
    if (/&(?!(?:amp|lt|gt|quot);)/.test(between)) found.push(`a bare & in ${JSON.stringify(between)}`);
  };
  let last = 0;
  for (const tag of out.matchAll(/<(\/?)([a-z][a-z0-9]*)([^<>]*)>/g)) {
    text(out.slice(last, tag.index));
    last = tag.index + tag[0].length;
    const [, closing, name = '', attributes = ''] = tag;
    const allowed = ALLOWED.get(name);
    if (!allowed) found.push(`the tag ${name}`);
    else if (!closing && !allowed.test(attributes)) found.push(`${name} with${attributes}`);
    if (VOID.has(name)) {
      if (closing) found.push(`a closing ${name}`);
    } else if (!closing) open.push(name);
    else if (open.pop() !== name) found.push(`${name} closed out of order`);
  }
  text(out.slice(last));
  if (open.length > 0) found.push(`unclosed ${open.join(', ')}`);
  return found;
}

/** How many of each letter and digit, in lower case. */
function letterCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of text.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

const BITS = [
  'a',
  'b',
  'é',
  '7',
  ' ',
  ' ',
  '\n',
  '\n\n',
  '\t',
  '*',
  '**',
  '_',
  '~~',
  '==',
  '#',
  '# ',
  '[',
  ']',
  '(',
  ')',
  '!',
  '^',
  '%%',
  '<',
  '>',
  '/',
  '|',
  '`',
  '\\',
  '-',
  '--',
  ':',
  '"',
  '“',
  '’',
  '&',
  '$$',
  '<u>',
  '</u>',
  '<sub>',
  '</sup>',
  '<br>',
  '<span class="x">',
  '<I a.>',
  '[[',
  ']]',
  '](',
  'https://e.com/',
  '[w](https://e.com/"w)',
  '![w "x"](https://e.com/"w)',
  '<!--',
  '-->',
  '> ',
  '- ',
  '1. ',
  '[!note]',
  '```',
  '~~~',
  '---',
  '| --- |',
  '[^1]',
  '^[',
  '![',
  '&amp;'
];

describe('a property: no chapter puts markup it did not mean into the page', () => {
  it('writes only its own tags, closed in order, every other <, > and & escaped, and no letter that was not there', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...BITS), { maxLength: 60 }), (bits) => {
        const text = bits.join('');
        const out = html(text);
        expect(problems(out)).toEqual([]);
        const had = letterCounts(text);
        for (const [c, n] of letterCounts(readerText(out))) expect(n, c).toBeLessThanOrEqual(had.get(c) ?? 0);
      }),
      { numRuns: 1000 }
    );
  });

  it('holds for the sample chapters', () => {
    for (const name of ['Chapter 01 - The Flood.md', 'Chapter 02 - After.md', 'Chapter 03 - Obsidian.md']) {
      const text = readFileSync(new URL(`../../samples/manuscript/${name}`, import.meta.url), 'utf8');
      expect(problems(html(text)), name).toEqual([]);
    }
  });
});
