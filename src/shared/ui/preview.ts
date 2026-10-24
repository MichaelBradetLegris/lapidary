/**
 * Preview's page (rr.2): the HTML Export HTML gives (`toRoyalRoadHtml`, rr.1)
 * read back into a tree the page draws with its own elements, so the author
 * sees the tight blocks, the rules, the headings and the rest as Royal Road's
 * readers will, and nothing of the chapter's can reach the page as markup.
 *
 * The converter writes a small set of elements, and every `<`, `>`, `&` and
 * `"` of the chapter's own as `&lt;`, `&gt;`, `&amp;` and `&quot;`; only those
 * elements are kept, with only the attributes it writes, each turned into a
 * class or a plain value: a tight paragraph's `style="margin-bottom: 0"`, a
 * table cell's `text-align`, a list's `start`, a link's address and an
 * image's words. An element it does not write is left out, its words kept.
 *
 * Pure (CLAUDE.md rule 4).
 */

/** The elements the converter writes. */
export type PreviewTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'strong'
  | 'em'
  | 's'
  | 'u'
  | 'sub'
  | 'sup'
  | 'br'
  | 'hr'
  | 'blockquote'
  | 'ul'
  | 'ol'
  | 'li'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'a'
  | 'img';

const TAGS: ReadonlySet<string> = new Set<PreviewTag>([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  's',
  'u',
  'sub',
  'sup',
  'br',
  'hr',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'img'
]);

/** Elements with nothing inside them. */
const VOID: ReadonlySet<string> = new Set(['br', 'hr', 'img']);

/** Elements that hold blocks, where white space between tags means nothing and is left out. */
const BLOCK_HOLDERS: ReadonlySet<string> = new Set([
  'blockquote',
  'ul',
  'ol',
  'table',
  'thead',
  'tbody',
  'tr'
]);

export interface PreviewElement {
  tag: PreviewTag;
  /** `rr-tight` on a tight paragraph, `rr-align-center` and the like on a table cell */
  className?: string;
  /** a numbered list's first number, when it is not 1 */
  start?: number;
  /** a link's address, or an image's */
  href?: string;
  /** an image's words */
  alt?: string;
  children: PreviewNode[];
}

/** Words, or an element. */
export type PreviewNode = string | PreviewElement;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The characters the converter's entities stand for; any other `&...;` is left as it is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** One tag as written: `<name attr="value">`, `</name>` or `<name />`. */
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>/;
const ATTRIBUTE = /([a-zA-Z-]+)(?:="([^"]*)")?/g;

function attributesOf(written: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of written.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (name) attributes.set(name.toLowerCase(), decodeEntities(match[2] ?? ''));
  }
  return attributes;
}

/** The element for a tag the converter writes, from its attributes. */
function elementFor(tag: PreviewTag, attributes: Map<string, string>): PreviewElement {
  const element: PreviewElement = { tag, children: [] };
  if (tag === 'p' && /^margin-bottom:\s*0;?$/.test(attributes.get('style')?.trim() ?? '')) {
    element.className = 'rr-tight';
  }
  if (tag === 'th' || tag === 'td') {
    const align = /^text-align:\s*(left|center|right);?$/.exec(attributes.get('style')?.trim() ?? '')?.[1];
    if (align) element.className = `rr-align-${align}`;
  }
  if (tag === 'ol') {
    const start = Number(attributes.get('start'));
    if (Number.isSafeInteger(start) && start !== 1) element.start = start;
  }
  if (tag === 'a') {
    const href = attributes.get('href');
    if (href) element.href = href;
  }
  if (tag === 'img') {
    const src = attributes.get('src');
    if (src) element.href = src;
    element.alt = attributes.get('alt') ?? '';
  }
  return element;
}

/**
 * The page Preview draws, from the converter's HTML. Unknown elements give
 * their words to the element round them, a closing tag nothing opened is
 * ignored, and anything still open at the end is closed there.
 */
export function previewTree(html: string): PreviewNode[] {
  const root: PreviewElement = { tag: 'p', children: [] };
  const stack: { element: PreviewElement; name: string }[] = [{ element: root, name: '' }];
  const top = (): PreviewElement => (stack[stack.length - 1] ?? stack[0])?.element ?? root;

  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    const textEnd = lt < 0 ? html.length : lt;
    if (textEnd > at) top().children.push(decodeEntities(html.slice(at, textEnd)));
    if (lt < 0) break;

    const match = TAG.exec(html.slice(lt));
    if (!match) {
      // A lone `<`, which the converter never writes: kept as the character it is.
      top().children.push('<');
      at = lt + 1;
      continue;
    }
    at = lt + match[0].length;
    const closing = match[1] === '/';
    const name = (match[2] ?? '').toLowerCase();

    if (closing) {
      const open = stack.map((s) => s.name).lastIndexOf(name);
      if (open > 0) stack.length = open;
      continue;
    }
    if (!TAGS.has(name)) continue;
    const element = elementFor(name as PreviewTag, attributesOf(match[3] ?? ''));
    top().children.push(element);
    if (!VOID.has(name) && match[4] !== '/') stack.push({ element, name });
  }
  return tidy(root.children, true);
}

/** Words joined where an unknown tag split them, and white space between blocks left out. */
function tidy(nodes: readonly PreviewNode[], blocks: boolean): PreviewNode[] {
  const out: PreviewNode[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') {
      if (blocks && node.trim() === '') continue;
      const last = out[out.length - 1];
      if (typeof last === 'string') out[out.length - 1] = last + node;
      else out.push(node);
      continue;
    }
    out.push({ ...node, children: tidy(node.children, BLOCK_HOLDERS.has(node.tag)) });
  }
  return out;
}

/** The words of a tree, as a reader sees them, for tests and the accessible name of a link. */
export function previewText(nodes: readonly PreviewNode[]): string {
  return nodes.map((node) => (typeof node === 'string' ? node : previewText(node.children))).join('');
}
