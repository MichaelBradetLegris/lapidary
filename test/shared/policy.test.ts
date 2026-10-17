import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* setup.4: rules about Claude that hold for the whole source tree (CLAUDE.md
   rule 2a). A test rather than a review comment, so a change that breaks one
   fails before it lands. */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx|cjs|mjs|js)$/.test(entry.name) ? [full] : [];
  });
}

const FILES = sources(SRC).map((file) => ({
  file: path.relative(SRC, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8')
}));

/** A value import, re-export or require of child_process; `import type` erases to nothing. */
const CHILD_PROCESS = [
  /^\s*import\s+(?!type\b)[^;]*?from\s+['"](node:)?child_process['"]/m,
  /^\s*export\s+[^;]*?from\s+['"](node:)?child_process['"]/m,
  /require\(\s*['"](node:)?child_process['"]\s*\)/,
  /import\(\s*['"](node:)?child_process['"]\s*\)/
];

describe('the source tree', () => {
  it('has been found', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('starts processes only from claudeBinary.ts', () => {
    const importers = FILES.filter(({ text }) => CHILD_PROCESS.some((pattern) => pattern.test(text))).map(
      (f) => f.file
    );
    expect(importers).toEqual(['main/providers/claudeBinary.ts']);
  });

  it('never names Claude Code s credential file, a token command or a sign-out', () => {
    for (const forbidden of [/\.credentials\.json/i, /setup-token/i, /logout/i]) {
      expect(FILES.filter(({ text }) => forbidden.test(text)).map((f) => f.file)).toEqual([]);
    }
  });
});
