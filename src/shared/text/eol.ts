import type { Eol } from '../types';

export interface TextShape {
  eol: Eol;
  bom: boolean;
  trailingNewline: boolean;
}

export interface NormalizedText extends TextShape {
  /** LF-only, BOM stripped, final newline removed (it lives in `trailingNewline`) */
  text: string;
}

export const BOM = '\uFEFF';

/**
 * Split a file's decoded contents into the LF-normalized text every offset in a
 * review refers to, plus the three flags needed to write the file back exactly
 * as the author's editor left it.
 *
 * A file counts as CRLF when it contains at least one CRLF pair. Mixed files are
 * therefore written back as pure CRLF; that is the same rule Obsidian applies.
 */
export function normalizeText(raw: string): NormalizedText {
  const bom = raw.startsWith(BOM);
  const withoutBom = bom ? raw.slice(BOM.length) : raw;
  const eol: Eol = withoutBom.includes('\r\n') ? 'crlf' : 'lf';
  const lf = withoutBom.replace(/\r\n?/g, '\n');
  const trailingNewline = lf.endsWith('\n');
  const text = trailingNewline ? lf.slice(0, -1) : lf;
  return { text, eol, bom, trailingNewline };
}

/** Inverse of `normalizeText`. */
export function restoreText(text: string, shape: TextShape): string {
  const withNewline = shape.trailingNewline ? `${text}\n` : text;
  const withEol = shape.eol === 'crlf' ? withNewline.replace(/\n/g, '\r\n') : withNewline;
  return shape.bom ? BOM + withEol : withEol;
}

export function shapeOf(value: TextShape): TextShape {
  return { eol: value.eol, bom: value.bom, trailingNewline: value.trailingNewline };
}
