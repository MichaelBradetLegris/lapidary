import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TIGHT_P, toRoyalRoadHtml } from '../../src/shared/text/royalroad';
import { decodeEntities, previewText, previewTree, type PreviewNode } from '../../src/shared/ui/preview';

/* rr.2: Preview reads the HTML Export HTML gives back into a tree the page
   draws with its own elements: only what the converter writes is kept, each
   attribute it writes turned into a class or a plain value, and the words
   are the HTML's words. */

/** The tree without its words: tags, classes and values, for comparing shapes. */
function shape(nodes: readonly PreviewNode[]): unknown[] {
  return nodes.map((node) =>
    typeof node === 'string'
      ? node
      : {
          tag: node.tag,
          ...(node.className ? { className: node.className } : {}),
          ...(node.start !== undefined ? { start: node.start } : {}),
          ...(node.href !== undefined ? { href: node.href } : {}),
          ...(node.alt !== undefined ? { alt: node.alt } : {}),
          children: shape(node.children)
        }
  );
}

/** The words of HTML as a page shows them, tags taken out and entities read, for the property. */
function htmlWords(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, '');
}

describe('previewTree', () => {
  it('keeps the paragraphs, a tight block s lines as tight, the rule and the headings', () => {
    const html = toRoyalRoadHtml('# One\n\nIntro.\n\n[Status]\nName: Mara\nLevel: 5\n\n***\n\n## Two');
    expect(shape(previewTree(html))).toEqual([
      { tag: 'h1', children: ['One'] },
      { tag: 'p', children: ['Intro.'] },
      { tag: 'p', className: 'rr-tight', children: ['[Status]'] },
      { tag: 'p', className: 'rr-tight', children: ['Name: Mara'] },
      { tag: 'p', children: ['Level: 5'] },
      { tag: 'hr', children: [] },
      { tag: 'h2', children: ['Two'] }
    ]);
    expect(html).toContain(TIGHT_P);
  });

  it('keeps emphasis, quotes, lists with their first number and tables with their alignment', () => {
    const html = toRoyalRoadHtml(
      'A **bold** and *em* and ~~gone~~ word.\n\n> Quoted.\n\n3. three\n4. four\n\n- a\n\n| A | B |\n| :-: | --: |\n| 1 | 2 |'
    );
    const tree = previewTree(html);
    expect(shape(tree)).toEqual([
      {
        tag: 'p',
        children: [
          'A ',
          { tag: 'strong', children: ['bold'] },
          ' and ',
          { tag: 'em', children: ['em'] },
          ' and ',
          { tag: 's', children: ['gone'] },
          ' word.'
        ]
      },
      { tag: 'blockquote', children: [{ tag: 'p', children: ['Quoted.'] }] },
      {
        tag: 'ol',
        start: 3,
        children: [
          { tag: 'li', children: ['three'] },
          { tag: 'li', children: ['four'] }
        ]
      },
      { tag: 'ul', children: [{ tag: 'li', children: ['a'] }] },
      {
        tag: 'table',
        children: [
          {
            tag: 'thead',
            children: [
              {
                tag: 'tr',
                children: [
                  { tag: 'th', className: 'rr-align-center', children: ['A'] },
                  { tag: 'th', className: 'rr-align-right', children: ['B'] }
                ]
              }
            ]
          },
          {
            tag: 'tbody',
            children: [
              {
                tag: 'tr',
                children: [
                  { tag: 'td', className: 'rr-align-center', children: ['1'] },
                  { tag: 'td', className: 'rr-align-right', children: ['2'] }
                ]
              }
            ]
          }
        ]
      }
    ]);
  });

  it('keeps a link s address and an image s words, never as markup of the chapter s', () => {
    const html = toRoyalRoadHtml(
      'See [the map](https://example.com/a"b) and ![a "mill"](https://example.com/m.png).'
    );
    expect(shape(previewTree(html))).toEqual([
      {
        tag: 'p',
        children: [
          'See ',
          { tag: 'a', href: 'https://example.com/a"b', children: ['the map'] },
          ' and ',
          { tag: 'img', href: 'https://example.com/m.png', alt: 'a "mill"', children: [] },
          '.'
        ]
      }
    ]);
  });

  it('reads the chapter s own angle brackets and ampersands as the characters they are', () => {
    const html = toRoyalRoadHtml('A <script>alert(1)</script> & <b>bold</b> <u>under</u>.');
    const tree = previewTree(html);
    expect(previewText(tree)).toBe('A <script>alert(1)</script> & <b>bold</b> under.');
    expect(shape(tree)).toEqual([
      {
        tag: 'p',
        children: ['A <script>alert(1)</script> & <b>bold</b> ', { tag: 'u', children: ['under'] }, '.']
      }
    ]);
  });

  it('leaves out an element the converter never writes, keeps its words, and closes what is left open', () => {
    expect(shape(previewTree('<p>a <span class="x">b</span> <script>c</script></p><div>d'))).toEqual([
      { tag: 'p', children: ['a b c'] },
      'd'
    ]);
    expect(shape(previewTree('<p style="color: red">x</p><td style="text-align: justify">y</td>'))).toEqual([
      { tag: 'p', children: ['x'] },
      { tag: 'td', children: ['y'] }
    ]);
    expect(shape(previewTree('</p>a < b<br>c'))).toEqual(['a < b', { tag: 'br', children: [] }, 'c']);
  });

  it('reads entities, and leaves one it does not know as it is', () => {
    expect(decodeEntities('&lt;&gt;&amp;&quot;&#39;&#x2014;&amp;lt; &nope; &#0;')).toBe(
      '<>&"\'—&lt; &nope; &#0;'
    );
  });

  it('draws the same words as the HTML holds, for any chapter', () => {
    const word = fc.constantFrom(
      'Mara',
      'the',
      '*mill*',
      '**wheel**',
      '~~race~~',
      '->',
      '--',
      '<u>x</u>',
      'a&b',
      '<tag>',
      '"q"',
      '[[Link|alias]]',
      '[map](https://example.com/x)',
      '`code`',
      '%%note%%'
    );
    const line = fc.array(word, { minLength: 1, maxLength: 6 }).map((w) => w.join(' '));
    const block = fc.oneof(
      line,
      line.map((l) => `# ${l}`),
      line.map((l) => `> ${l}`),
      line.map((l) => `- ${l}`),
      fc.array(line, { minLength: 2, maxLength: 4 }).map((ls) => ls.join('\n')),
      fc.constant('***')
    );
    fc.assert(
      fc.property(fc.array(block, { minLength: 1, maxLength: 6 }), (blocks) => {
        const html = toRoyalRoadHtml(blocks.join('\n\n'));
        expect(previewText(previewTree(html)).replace(/\s+/g, '')).toBe(htmlWords(html));
      }),
      { numRuns: 300 }
    );
  });
});
