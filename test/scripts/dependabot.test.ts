import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * release.10: .github/dependabot.yml. Four times a year Dependabot proposes
 * openai, electron, electron-builder and electron-updater, and the actions the
 * workflows use; never a new major of the last three, which is a planned task;
 * and nothing merges on its own. docs/RELEASING.md says how each pull request
 * is checked before it is merged by hand.
 *
 * The file is read by a small reader of the YAML it uses (block mappings,
 * block sequences, plain or quoted scalars and flow lists of scalars), so the
 * test needs no YAML package. Anything else in it, such as an anchor, a
 * multi-line string or a key written twice, fails the read rather than being
 * skipped.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = readFileSync(path.join(ROOT, '.github', 'dependabot.yml'), 'utf8');

type Yaml = string | Yaml[] | { [key: string]: Yaml };

interface Line {
  indent: number;
  text: string;
  number: number;
}

/** The lines that hold something, without comments, each with its indent. */
function linesOf(text: string): Line[] {
  const out: Line[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const body = raw.replace(/(^|\s)#.*$/, '').trimEnd();
    if (body.trim() === '') return;
    if (/\t/.test(raw.slice(0, raw.length - raw.trimStart().length)))
      throw new Error(`line ${i + 1}: tab indent`);
    out.push({ indent: body.length - body.trimStart().length, text: body.trim(), number: i + 1 });
  });
  return out;
}

/** A plain or quoted scalar, or a flow list of them. */
function scalar(value: string, line: number): Yaml {
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((part) => scalar(part.trim(), line));
  }
  if (/^'[^']*'$|^"[^"\\]*"$/.test(value)) return value.slice(1, -1);
  if (/^[\w./@-]+$/.test(value)) return value;
  throw new Error(`line ${line}: cannot read "${value}"`);
}

/** The block that starts at `lines[start]`, and the index after it. */
function block(lines: Line[], start: number): [Yaml, number] {
  const first = lines[start];
  if (!first) throw new Error('an empty block');
  const indent = first.indent;
  if (first.text === '-' || first.text.startsWith('- ')) {
    const items: Yaml[] = [];
    let i = start;
    while (i < lines.length && lines[i]?.indent === indent && /^-( |$)/.test(lines[i]?.text ?? '')) {
      const line = lines[i] as Line;
      const rest = line.text.slice(1).trim();
      if (/^[\w-]+:/.test(rest)) {
        // A mapping that starts on the dash's line: its keys sit two further in.
        const copy = [...lines];
        copy[i] = { indent: indent + 2, text: rest, number: line.number };
        const [value, next] = block(copy, i);
        items.push(value);
        i = next;
      } else {
        items.push(scalar(rest, line.number));
        i += 1;
      }
    }
    return [items, i];
  }
  const map: { [key: string]: Yaml } = {};
  let i = start;
  while (i < lines.length && lines[i]?.indent === indent) {
    const line = lines[i] as Line;
    const match = /^([\w-]+):(?:\s+(.*))?$/.exec(line.text);
    if (!match?.[1]) throw new Error(`line ${line.number}: cannot read "${line.text}"`);
    if (match[1] in map) throw new Error(`line ${line.number}: "${match[1]}" twice`);
    if (match[2] !== undefined) {
      map[match[1]] = scalar(match[2], line.number);
      i += 1;
    } else {
      const child = lines[i + 1];
      if (!child || child.indent <= indent)
        throw new Error(`line ${line.number}: "${match[1]}" has no value`);
      const [value, next] = block(lines, i + 1);
      map[match[1]] = value;
      i = next;
    }
  }
  if (i < lines.length && (lines[i]?.indent ?? 0) > indent)
    throw new Error(`line ${lines[i]?.number}: indent`);
  return [map, i];
}

function readYaml(text: string): Yaml {
  const lines = linesOf(text);
  const [value, next] = block(lines, 0);
  if (next !== lines.length) throw new Error(`line ${lines[next]?.number}: not read`);
  return value;
}

const asMap = (value: Yaml | undefined): { [key: string]: Yaml } =>
  value !== undefined && typeof value === 'object' && !Array.isArray(value) ? value : {};
const asList = (value: Yaml | undefined): Yaml[] => (Array.isArray(value) ? value : []);

const CONFIG = asMap(readYaml(TEXT));
const UPDATES = asList(CONFIG['updates']).map(asMap);
const NPM = UPDATES.find((entry) => entry['package-ecosystem'] === 'npm') ?? {};
const ACTIONS = UPDATES.find((entry) => entry['package-ecosystem'] === 'github-actions') ?? {};

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;
const specOf = (name: string): string | undefined => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];

describe('the reader', () => {
  it('reads mappings, sequences of mappings and flow lists, and refuses what it does not know', () => {
    expect(readYaml("a: 1\nb:\n  - c: x\n    d: ['e', f]\n  - g\n")).toEqual({
      a: '1',
      b: [{ c: 'x', d: ['e', 'f'] }, 'g']
    });
    expect(() => readYaml('a: 1\na: 2\n')).toThrow(/twice/);
    expect(() => readYaml('a: &anchor 1\n')).toThrow(/cannot read/);
    expect(() => readYaml('a: |\n  text\n')).toThrow(/cannot read/);
    expect(() => readYaml('a:\n')).toThrow(/no value/);
  });
});

describe('.github/dependabot.yml (release.10)', () => {
  it('has version 2 and exactly two update entries, npm and github-actions, both from the root', () => {
    expect(Object.keys(CONFIG)).toEqual(['version', 'updates']);
    expect(CONFIG['version']).toBe('2');
    expect(UPDATES.map((entry) => entry['package-ecosystem'])).toEqual(['npm', 'github-actions']);
    for (const entry of UPDATES) expect(entry['directory']).toBe('/');
  });

  it('runs both quarterly', () => {
    for (const entry of UPDATES) expect(entry['schedule']).toEqual({ interval: 'quarterly' });
  });

  it('has no key beyond the ones it uses now', () => {
    expect(Object.keys(NPM)).toEqual(['package-ecosystem', 'directory', 'schedule', 'allow', 'ignore']);
    expect(Object.keys(ACTIONS)).toEqual(['package-ecosystem', 'directory', 'schedule']);
  });

  it('allows only openai, electron, electron-builder and electron-updater among the npm packages', () => {
    const allow = asList(NPM['allow']).map(asMap);
    expect(allow).toEqual([
      { 'dependency-name': 'openai' },
      { 'dependency-name': 'electron' },
      { 'dependency-name': 'electron-builder' },
      { 'dependency-name': 'electron-updater' }
    ]);
    // Each is a package the app has, so no entry is a typo that allows nothing.
    for (const entry of allow) {
      const name = entry['dependency-name'];
      expect(typeof name === 'string' ? specOf(name) : undefined, JSON.stringify(name)).toBeDefined();
    }
  });

  it('ignores only the majors of electron, electron-builder and electron-updater', () => {
    expect(asList(NPM['ignore']).map(asMap)).toEqual([
      { 'dependency-name': 'electron', 'update-types': ['version-update:semver-major'] },
      { 'dependency-name': 'electron-builder', 'update-types': ['version-update:semver-major'] },
      { 'dependency-name': 'electron-updater', 'update-types': ['version-update:semver-major'] }
    ]);
    // The three are the exact pins of packageScripts.test.ts; openai, a range, may take a major.
    for (const name of ['electron', 'electron-builder', 'electron-updater'])
      expect(specOf(name)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(specOf('openai')).toMatch(/^\^/);
  });

  it('merges nothing on its own: no workflow turns on auto-merge or approves a pull request', () => {
    const dir = path.join(ROOT, '.github', 'workflows');
    const workflows = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));
    expect(workflows.length).toBeGreaterThan(0);
    for (const name of workflows) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      expect(text, name).not.toMatch(
        /auto-?merge|gh\s+pr\s+(merge|review)|--auto\b|fetch-metadata|enablePullRequestAutoMerge/i
      );
    }
  });
});
