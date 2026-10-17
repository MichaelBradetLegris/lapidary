import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The two token blocks of `src/renderer/styles/app.css` (PLAN 11.3 e): the light
 * one, the top-level `:root { ... }`, and the dark one, the `:root { ... }` inside
 * `@media (prefers-color-scheme: dark)`.
 */

export type Scheme = 'light' | 'dark';

export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

export const APP_CSS = readFileSync(path.join(__dirname, '../../src/renderer/styles/app.css'), 'utf8');

export interface TokenBlock {
  /** Custom properties in the order written, `--bg` to `#1c1a17`. */
  tokens: Map<string, string>;
  /** The block's `color-scheme` declaration. */
  colorScheme: string | undefined;
}

function block(body: string): TokenBlock {
  const tokens = new Map<string, string>();
  let colorScheme: string | undefined;
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const name = decl.slice(0, colon).trim();
    const value = decl.slice(colon + 1).trim();
    if (name.startsWith('--')) tokens.set(name, value);
    else if (name === 'color-scheme') colorScheme = value;
  }
  return { tokens, colorScheme };
}

/** Both blocks of a stylesheet, comments removed first. Throws when either is missing. */
export function tokenBlocks(css: string): Record<Scheme, TokenBlock> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light = /^:root\s*\{([^{}]*)\}/m.exec(text)?.[1];
  const dark = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^{}]*)\}\s*\}/.exec(text)?.[1];
  if (light === undefined) throw new Error('app.css has no top-level :root block');
  if (dark === undefined)
    throw new Error('app.css has no :root block inside @media (prefers-color-scheme: dark)');
  return { light: block(light), dark: block(dark) };
}

/**
 * A token's value with `var()` references to other tokens followed: in the same
 * block first, then in the light block, as the cascade would find them.
 */
export function resolveToken(blocks: Record<Scheme, TokenBlock>, scheme: Scheme, name: string): string {
  let current = name;
  for (let depth = 0; depth < 10; depth += 1) {
    const value = blocks[scheme].tokens.get(current) ?? blocks.light.tokens.get(current);
    if (value === undefined) throw new Error(`${scheme}: ${current} is not defined`);
    const next = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    if (!next) return value;
    current = next;
  }
  throw new Error(`${scheme}: ${name} refers to itself`);
}
