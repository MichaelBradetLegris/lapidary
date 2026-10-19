import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HunkSpan } from '../../src/renderer/components/HunkSpan';
import { hunkFaces } from '../../src/shared/render';
import type { Hunk, HunkStatus } from '../../src/shared/types';

/* small.2 (PLAN 11.7): the text a suggestion puts in the line, once the row
   above it (the ghost, its label, its keycap and the x) is taken away, is
   exactly the live face, for every shape the plan's table names and every
   status. Find, copy and the `data-hunk-start/end` offsets depend on it, and
   the capsule, the keycap and the margin marks of small.6 to small.8 change
   this markup. HunkSpan is rendered with react-dom/server and read by a small
   tag reader, since the tests run without a DOM. This file is type-checked
   with the renderer's project (tsconfig.web.json), as it renders a component. */

interface Element {
  tag: string;
  attrs: Map<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'wbr'
]);

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return String.fromCodePoint(code);
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()] ?? '';
  });
}

/** Reads the markup React writes: elements, attributes in double quotes, and text. */
function parse(html: string): Element {
  const root: Element = { tag: '#root', attrs: new Map(), children: [] };
  const stack: Element[] = [root];
  const token = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of html.matchAll(token)) {
    const top = stack[stack.length - 1]!;
    if (m[1]) {
      const closed = stack.pop();
      if (!closed || closed.tag !== m[1]) throw new Error(`</${m[1]}> closes <${closed?.tag ?? '?'}>`);
    } else if (m[2]) {
      const attrs = new Map<string, string>();
      for (const a of (m[3] ?? '').matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g))
        attrs.set(a[1]!, decode(a[2] ?? ''));
      const el: Element = { tag: m[2], attrs, children: [] };
      top.children.push(el);
      if (m[4] !== '/' && !VOID.has(m[2])) stack.push(el);
    } else if (m[5] !== undefined) {
      top.children.push(decode(m[5]));
    }
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]?.tag}>`);
  return root;
}

const classes = (el: Element): string[] => (el.attrs.get('class') ?? '').split(/\s+/).filter(Boolean);

/** The text under `node`, leaving out every subtree whose element has the class `skip`. */
function textWithout(node: Node, skip: string): string {
  if (typeof node === 'string') return node;
  if (classes(node).includes(skip)) return '';
  return node.children.map((child) => textWithout(child, skip)).join('');
}

function find(node: Node, cls: string): Element[] {
  if (typeof node === 'string') return [];
  return [...(classes(node).includes(cls) ? [node] : []), ...node.children.flatMap((c) => find(c, cls))];
}

/** The shapes of PLAN 11.7's table, and the word-sized ones around them. */
const SHAPES: { name: string; original: string; replacement: string }[] = [
  { name: 'a comma inserted after "Mira"', original: '', replacement: ',' },
  { name: 'a comma deleted', original: ',', replacement: '' },
  { name: 'a doubled space deleted', original: ' ', replacement: '' },
  { name: 'a full stop swapped for a comma', original: '.', replacement: ',' },
  { name: 'a hyphen swapped for a space', original: '-', replacement: ' ' },
  { name: 'a one-letter word', original: 'i', replacement: 'I' },
  { name: 'two paragraphs joined', original: '\n\n', replacement: ' ' },
  { name: 'a no-break space', original: '\u00a0', replacement: ' ' },
  { name: 'a word', original: 'began', replacement: 'begun' },
  { name: 'words inserted', original: '', replacement: 'most of ' },
  { name: 'a word deleted', original: 'the ', replacement: '' },
  { name: 'a paragraph deleted', original: 'Drop this.\n\n', replacement: '' },
  { name: 'text that markup must escape', original: '<b>&"x"</b>', replacement: "'&amp;'" }
];

const STATUSES: HunkStatus[] = ['pending', 'accepted', 'dismissed'];

function hunk(shape: (typeof SHAPES)[number], status: HunkStatus, extra: Partial<Hunk> = {}): Hunk {
  return {
    id: 'h1',
    start: 120,
    end: 120 + shape.original.length,
    baseSide: 'original',
    original: shape.original,
    replacement: shape.replacement,
    paragraph: 4,
    category: 'punctuation',
    reason: 'A reason.',
    source: 'claude',
    status,
    anchor: 'exact',
    ...extra
  };
}

function render(h: Hunk, focused = false, hovered = false): Element {
  const html = renderToStaticMarkup(
    createElement(HunkSpan, {
      hunk: h,
      focused,
      hovered,
      onToggleAccept: () => undefined,
      onToggleDismiss: () => undefined,
      onHover: () => undefined,
      onHoverEnd: () => undefined
    })
  );
  const root = parse(html);
  expect(root.children).toHaveLength(1);
  return root.children[0] as Element;
}

describe('the text a suggestion puts in the line (small.2)', () => {
  for (const shape of SHAPES) {
    for (const status of STATUSES) {
      it(`is the live face alone for ${shape.name}, ${status}`, () => {
        const h = hunk(shape, status);
        for (const [focused, hovered] of [
          [false, false],
          [true, false],
          [false, true],
          [true, true]
        ] as const) {
          const span = render(h, focused, hovered);
          expect(textWithout(span, 'hunk__above')).toBe(hunkFaces(h).live);
          expect(span.attrs.get('data-hunk-start')).toBe(String(h.start));
          expect(span.attrs.get('data-hunk-end')).toBe(String(h.end));
          expect(find(span, 'hunk__above')).toHaveLength(1);
        }
      });
    }
  }

  it('keeps it so for an uncertain anchor and for words the author wrote', () => {
    for (const shape of SHAPES) {
      for (const status of STATUSES) {
        for (const extra of [{ anchor: 'fuzzy' as const }, { source: 'manual' as const }, { edited: true }]) {
          const h = hunk(shape, status, extra);
          expect(textWithout(render(h), 'hunk__above')).toBe(hunkFaces(h).live);
        }
      }
    }
  });

  it('puts the ghost, its label and the x in the row above, none of it in the line', () => {
    const h = hunk(SHAPES[8]!, 'pending');
    const span = render(h);
    const above = find(span, 'hunk__above')[0]!;
    expect(find(above, 'hunk__ghost')).toHaveLength(1);
    expect(find(above, 'hunk__x')).toHaveLength(1);
    expect(textWithout(above, 'nothing')).toContain('begun');
    expect(textWithout(span, 'hunk__above')).toBe('began');
  });

  it('reads markup it is given, so the checks above can fail', () => {
    const el = parse(
      '<span class="hunk"><span class="hunk__above">ghost</span><b>live &amp; &#x27;well&#x27;</b></span>'
    );
    expect(textWithout(el, 'hunk__above')).toBe("live & 'well'");
    expect(textWithout(el, 'nothing')).toBe("ghostlive & 'well'");
    expect(() => parse('<span><b></span>')).toThrow();
  });
});
