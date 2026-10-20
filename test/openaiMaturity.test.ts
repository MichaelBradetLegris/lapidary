import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { OPENAI_MATURITIES, OPENAI_MATURITY } from '../src/shared/ai/openai';

/*
 * hardening.11: OpenAI ships labelled experimental, and every label that says
 * so reads `OPENAI_MATURITY` in src/shared/ai/openai.ts, so that the flip to
 * `tested` (hardening.11b) is one edit and leaves no label behind. This guard
 * fails when any string in the app's source spells the word anywhere else:
 * a string, template or regular expression literal or JSX text in a .ts or
 * .tsx file, or anything outside a comment in a .html or .css file. Comments
 * may name it; tests are not scanned, since they pin the labels on purpose.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORD = /\bexperimental\b/i;

/** The declarations in openai.ts that may spell it: the constant and the list its type comes from. */
const ALLOWED = ['src/shared/ai/openai.ts OPENAI_MATURITIES', 'src/shared/ai/openai.ts OPENAI_MATURITY'];

/** Files under `dir`, recursively, whose extension is in `exts`, as forward-slash paths from the root. */
function filesIn(dir: string, exts: readonly string[]): string[] {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(full)) {
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...filesIn(rel, exts));
    else if (exts.includes(path.extname(entry).toLowerCase())) out.push(rel);
  }
  return out;
}

/** The name of the variable whose declaration holds `node`, or null. */
function declaredIn(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (ts.isVariableDeclaration(at)) return at.name.getText();
  }
  return null;
}

function isText(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node) ||
    ts.isRegularExpressionLiteral(node) ||
    ts.isJsxText(node)
  );
}

/**
 * Every literal or piece of JSX text in a TypeScript source that spells the
 * word, as "<file> <variable it is declared in>" or "<file>:<line>" when it
 * is in none.
 */
function spellingsInScript(file: string, text: string): string[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isText(node) && WORD.test(node.getText(source))) {
      const name = declaredIn(node);
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      hits.push(name ? `${file} ${name}` : `${file}:${line}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

/** Every line of a .html or .css file that spells the word outside a comment. */
function spellingsInMarkup(file: string, text: string): string[] {
  const blank = (comment: string): string => comment.replace(/[^\n]/g, ' ');
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  return bare.split('\n').flatMap((line, index) => (WORD.test(line) ? [`${file}:${index + 1}`] : []));
}

function scannedFiles(): string[] {
  return filesIn('src', ['.ts', '.tsx', '.html', '.css']);
}

function spellings(): string[] {
  return scannedFiles().flatMap((file) => {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    return /\.tsx?$/.test(file) ? spellingsInScript(file, text) : spellingsInMarkup(file, text);
  });
}

describe('OpenAI experimental label (hardening.11)', () => {
  it('ships labelled experimental', () => {
    expect(OPENAI_MATURITY).toBe('experimental');
    expect(OPENAI_MATURITIES).toEqual(['experimental', 'tested']);
  });

  it('no string in the source spells the word but the constant and its list', () => {
    expect(spellings()).toEqual(ALLOWED);
  });

  it('scans every source file the labels and the dialogs live in', () => {
    const files = scannedFiles();
    for (const file of [
      'src/shared/ai/openai.ts',
      'src/shared/types.ts',
      'src/shared/ui/welcome.ts',
      'src/renderer/components/ReviewDialog.tsx',
      'src/renderer/components/SettingsDialog.tsx',
      'src/renderer/components/WelcomeScreen.tsx',
      'src/renderer/index.html',
      'src/renderer/styles/app.css'
    ]) {
      expect(files).toContain(file);
    }
  });

  it('finds the word in each kind of literal, in JSX text, and in markup outside comments', () => {
    const script = [
      "const a = 'OpenAI (experimental)';",
      'const b = `Use OpenAI (Experimental)`;',
      'const c = `${a} is experimental ${b}.`;',
      'const d = /experimental/;',
      'function E() { return <p>OpenAI is experimental</p>; }',
      "const f = <option title='experimental' />;",
      '// a comment may say experimental',
      '/* and so may this one: experimental */',
      "const g = 'experimentally', h = 'tested';"
    ].join('\n');
    expect(spellingsInScript('x.tsx', script)).toEqual([
      'x.tsx a',
      'x.tsx b',
      'x.tsx c',
      'x.tsx d',
      'x.tsx:5',
      'x.tsx f'
    ]);
    expect(spellingsInScript('x.ts', 'export const OPENAI_MATURITY = `experimental`;')).toEqual([
      'x.ts OPENAI_MATURITY'
    ]);
    const css = '/* "Use OpenAI (experimental)"\n wraps */\n.x::after { content: "experimental"; }\n';
    expect(spellingsInMarkup('a.css', css)).toEqual(['a.css:3']);
    expect(spellingsInMarkup('a.html', '<!-- experimental -->\n<p>experimental</p>')).toEqual(['a.html:2']);
  });
});
