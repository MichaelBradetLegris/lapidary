import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * release.7: .github/workflows/release.yml per PLAN 11.3 (n) and C.93. A
 * pushed version tag builds the installer and makes a draft release of four
 * files. `build` checks the tag before npm ci, runs the checks, packages and
 * verifies with a token that can only read; `release` holds the only token
 * that can write and runs nothing but gh. The live run on a throwaway branch
 * is recorded in the PLAN tick; this pins what that run proved, so that a
 * later edit cannot quietly undo it.
 *
 * The workflow is read by its lines, as scripts/verify-package.ts reads
 * latest.yml, so the test needs no YAML package. That works because the file
 * is prettier's: two spaces per level, jobs at 2, steps at 6, step keys at 8.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

const notes = require('../../scripts/release-notes.cjs') as {
  versionFromTag(tag: unknown): string | null;
};

const TEXT = readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const LINES = TEXT.split(/\r?\n/);

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlankOrComment = (line: string): boolean => line.trim() === '' || line.trim().startsWith('#');

/** A scalar as written, without a trailing comment or the quotes round it. */
function scalar(value: string): string {
  const bare = value.replace(/\s+#.*$/, '').trim();
  return /^'.*'$|^".*"$/.test(bare) ? bare.slice(1, -1) : bare;
}

/** The lines below `start` that are indented further than it (comments and blanks kept). */
function childLines(lines: readonly string[], start: number): string[] {
  const own = indentOf(lines[start] ?? '');
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() !== '' && !line.trim().startsWith('#') && indentOf(line) <= own) break;
    out.push(line);
  }
  return out;
}

/** `key: value` pairs at one indent, for a simple mapping such as `permissions`. */
function mapping(lines: readonly string[], indent: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (isBlankOrComment(line) || indentOf(line) !== indent) continue;
    const match = /^\s*([\w-]+):\s*(.*)$/.exec(line);
    if (match?.[1]) out[match[1]] = scalar(match[2] ?? '');
  }
  return out;
}

/** The index of the line `<indent spaces><key>:` (with or without a value) in `lines`. */
function keyAt(lines: readonly string[], key: string, indent: number): number {
  return lines.findIndex((line) => line.startsWith(`${' '.repeat(indent)}${key}:`));
}

/** The mapping under `key` at `indent`, or undefined when the key is missing. */
function mappingUnder(lines: readonly string[], key: string, indent: number) {
  const at = keyAt(lines, key, indent);
  if (at === -1) return undefined;
  const inline = scalar((lines[at] ?? '').slice(indent + key.length + 1));
  if (inline === '{}') return {};
  return mapping(childLines(lines, at), indent + 2);
}

interface Step {
  uses?: string;
  usesComment?: string;
  name?: string;
  id?: string;
  run?: string;
  with: Record<string, string>;
  env: Record<string, string>;
}

/** The lines of a job, from its `  <name>:` line to the next job. */
function jobLines(name: string): string[] {
  const jobs = keyAt(LINES, 'jobs', 0);
  const at = LINES.findIndex((line, i) => i > jobs && line === `  ${name}:`);
  if (jobs === -1 || at === -1) throw new Error(`release.yml has no job "${name}"`);
  return childLines(LINES, at);
}

function jobNames(): string[] {
  const jobs = keyAt(LINES, 'jobs', 0);
  return childLines(LINES, jobs)
    .filter((line) => !isBlankOrComment(line) && indentOf(line) === 2)
    .map((line) => line.trim().replace(/:$/, ''));
}

/** The job's steps, each read from its `      - ` line to the next. */
function stepsOf(job: readonly string[]): Step[] {
  const at = keyAt(job, 'steps', 4);
  if (at === -1) return [];
  const steps: string[][] = [];
  for (const line of childLines(job, at)) {
    if (line.startsWith('      - ')) steps.push([line.replace('      - ', '        ')]);
    else if (steps.length > 0) steps[steps.length - 1]?.push(line);
  }
  return steps.map((lines) => {
    const step: Step = { with: {}, env: {} };
    lines.forEach((line, i) => {
      if (isBlankOrComment(line) || indentOf(line) !== 8) return;
      const match = /^\s*([\w-]+):\s*(.*)$/.exec(line);
      const key = match?.[1];
      const value = match?.[2] ?? '';
      if (key === 'with' || key === 'env') {
        step[key] = mapping(childLines(lines, i), 10);
      } else if (key === 'run') {
        step.run =
          value === '|'
            ? childLines(lines, i)
                .map((l) => l.slice(10))
                .join('\n')
                .trimEnd()
            : scalar(value);
      } else if (key === 'uses') {
        step.uses = scalar(value);
        step.usesComment = /\s#\s*(.*)$/.exec(value)?.[1];
      } else if (key === 'name' || key === 'id') {
        step[key] = scalar(value);
      }
    });
    return step;
  });
}

const build = jobLines('build');
const release = jobLines('release');
const buildSteps = stepsOf(build);
const releaseSteps = stepsOf(release);
const allSteps = [...buildSteps, ...releaseSteps];

/** GitHub's filter pattern for a tag as a regular expression (`*` stops at `/`). */
function filterToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] ?? '';
    if (ch === '[') {
      const end = pattern.indexOf(']', i);
      source += pattern.slice(i, end + 1);
      i = end;
    } else if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i++;
      } else source += '[^/]*';
    } else if (ch === '+' || ch === '?') {
      source += ch;
    } else {
      source += ch.replace(/[.\\^$|(){}]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

describe('the parser this test reads the workflow with', () => {
  it('finds both jobs and every step', () => {
    expect(jobNames()).toEqual(['build', 'release']);
    const stepLines = LINES.filter((line) => line.startsWith('      - ')).length;
    expect(allSteps).toHaveLength(stepLines);
    expect(buildSteps.length).toBeGreaterThan(8);
    expect(releaseSteps).toHaveLength(2);
  });

  it('reads a block run script whole', () => {
    const create = releaseSteps.find((step) => step.name === 'Create the draft release');
    expect(create?.run?.split('\n')[0]).toBe('shopt -s nullglob');
    expect(create?.run).toMatch(/--notes-file release\/notes\.md "\$\{assets\[@\]\}"$/);
  });
});

describe('when it runs (release.7)', () => {
  it('starts on a pushed version tag and on nothing else', () => {
    const on = keyAt(LINES, 'on', 0);
    const body = childLines(LINES, on).filter((line) => !isBlankOrComment(line));
    expect(body).toEqual(['  push:', "    tags: ['v[0-9]+.[0-9]+.[0-9]+*']"]);
  });

  it('starts on every tag check-release accepts, and on no tag without v and three numbers', () => {
    const pattern = /tags: \['([^']+)'\]/.exec(TEXT)?.[1] ?? '';
    const trigger = filterToRegExp(pattern);
    for (const tag of [
      'v1.0.0',
      'v0.9.0-rc.1',
      'v10.20.30',
      'v1.1.0-rc.1',
      'v1.0.0-alpha-beta.2',
      'v1.0.0-0a'
    ]) {
      expect(notes.versionFromTag(tag)).not.toBeNull();
      expect(tag).toMatch(trigger);
    }
    for (const tag of ['1.0.0', 'v1.0', 'v1', 'vx.0.0', 'release-1.0.0', 'v1.0.0/x', 'V1.0.0']) {
      expect(tag).not.toMatch(trigger);
    }
    // Looser than check-release, which refuses these first, before npm ci.
    for (const tag of ['v01.0.0', 'v1.0.0+build.5', 'v1.0.0.0']) {
      expect(tag).toMatch(trigger);
      expect(notes.versionFromTag(tag)).toBeNull();
    }
  });

  it('runs both jobs on windows-latest, with bash, release only after build', () => {
    for (const job of [build, release]) {
      expect(mapping(job, 4)['runs-on']).toBe('windows-latest');
      const at = keyAt(job, 'defaults', 4);
      expect(job.slice(at, at + 3)).toEqual(['    defaults:', '      run:', '        shell: bash']);
    }
    expect(mapping(release, 4).needs).toBe('build');
  });
});

describe('permissions and the token', () => {
  it('gives none by default, read to build, and write to release alone', () => {
    expect(mappingUnder(LINES, 'permissions', 0)).toEqual({});
    expect(mappingUnder(build, 'permissions', 4)).toEqual({ contents: 'read' });
    expect(mappingUnder(release, 'permissions', 4)).toEqual({ contents: 'write' });
    const writes = LINES.filter((line) => !isBlankOrComment(line) && /:\s*write\b/.test(line));
    expect(writes).toEqual(['      contents: write']);
  });

  it('hands the token to one step, the one that creates the release, and uses no secret', () => {
    const tokenLines = LINES.filter((line) => /github\.token|GITHUB_TOKEN|GH_TOKEN|secrets\./.test(line));
    expect(tokenLines.filter((line) => !isBlankOrComment(line))).toEqual([
      '          GH_TOKEN: ${{ github.token }}'
    ]);
    const holders = allSteps.filter((step) => 'GH_TOKEN' in step.env);
    expect(holders.map((step) => step.name)).toEqual(['Create the draft release']);
    expect(releaseSteps).toContain(holders[0]);
  });

  it('leaves the token out of the checkout', () => {
    const checkout = buildSteps.find((step) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with['persist-credentials']).toBe('false');
    expect(allSteps.filter((step) => step.uses?.startsWith('actions/checkout@'))).toHaveLength(1);
  });

  it('runs nothing from the repository or npm where the token can write', () => {
    expect(releaseSteps.map((step) => step.uses?.split('@')[0] ?? 'run')).toEqual([
      'actions/download-artifact',
      'run'
    ]);
    const script = releaseSteps[1]?.run ?? '';
    expect(script).not.toMatch(/\b(npm|npx|node)\b/);
    expect(script).not.toMatch(/\bscripts\//);
  });
});

describe('actions and caches', () => {
  it('pins every action by a full commit SHA, with its version beside it', () => {
    const uses = allSteps.filter((step) => step.uses);
    expect(uses.map((step) => step.uses?.split('@')[0])).toEqual([
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/download-artifact'
    ]);
    for (const step of uses) {
      expect(step.uses).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
      expect(step.usesComment).toMatch(/^v\d+\.\d+\.\d+$/);
    }
    expect(LINES.filter((line) => /\buses:/.test(line))).toHaveLength(uses.length);
  });

  it('restores no cache', () => {
    const setupNode = buildSteps.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(setupNode?.with).toEqual({ 'node-version-file': '.nvmrc', 'package-manager-cache': 'false' });
    expect(TEXT).not.toMatch(/actions\/cache|cache-dependency-path|^\s*cache:/m);
  });
});

describe('the tag in scripts', () => {
  it('reaches the scripts only through the TAG variable', () => {
    expect(mappingUnder(build, 'env', 4)).toEqual({ TAG: '${{ github.ref_name }}' });
    const create = releaseSteps.find((step) => step.name === 'Create the draft release');
    expect(create?.env.TAG).toBe('${{ github.ref_name }}');
    for (const step of allSteps) {
      if (step.run !== undefined) expect(step.run).not.toContain('${{');
    }
  });

  it('quotes it wherever a script uses it', () => {
    for (const step of allSteps) {
      const bare = (step.run ?? '').replace(/"\$TAG"|"\$\{TAG#v\}"/g, '');
      expect(bare).not.toMatch(/\$\{?TAG\b/);
    }
  });
});

describe('the build job', () => {
  const runs = buildSteps.map((step) => step.run ?? `uses ${step.uses?.split('@')[0] ?? ''}`);

  it('checks the tag before npm ci, then lints, tests, packages and verifies the installer', () => {
    expect(runs.slice(0, 9)).toEqual([
      'uses actions/checkout',
      'uses actions/setup-node',
      'node scripts/check-release.cjs "$TAG"',
      'npm ci',
      'npm run branding:check',
      'npm run lint',
      'npm test',
      'npm run package',
      'npm run verify:package -- --installer'
    ]);
  });

  it('hashes the installer, its .blockmap and latest.yml into SHA256SUMS.txt and collects the four files', () => {
    const collect = buildSteps.find((step) => step.id === 'files')?.run ?? '';
    expect(collect).toContain(
      `installer="$(node -p "require('./scripts/release-notes.cjs').installerName(process.argv[1])" "$version")"`
    );
    expect(collect).toContain('sha256sum "$installer" "$installer.blockmap" latest.yml > SHA256SUMS.txt');
    expect(collect).toContain(
      'cp "$installer" "$installer.blockmap" latest.yml SHA256SUMS.txt "$out/assets/"'
    );
    expect(collect).toContain('echo "title=$name $version" >> "$GITHUB_OUTPUT"');
    expect(mappingUnder(build, 'outputs', 4)).toEqual({ title: '${{ steps.files.outputs.title }}' });
  });

  it('writes the notes with --out, not through a redirect', () => {
    const write = buildSteps.find((step) => step.name === 'Write the release notes');
    expect(write?.run).toBe('node scripts/release-notes.cjs "$TAG" --out "$RUNNER_TEMP/release/notes.md"');
  });

  it('hands the files and the notes over for a day, and fails when there are none', () => {
    const upload = buildSteps[buildSteps.length - 1];
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@/);
    expect(upload?.with).toEqual({
      name: 'release',
      path: '${{ runner.temp }}/release',
      'if-no-files-found': 'error',
      'retention-days': '1'
    });
  });
});

describe('the release job', () => {
  const create = releaseSteps.find((step) => step.name === 'Create the draft release');

  it('takes the files build handed over', () => {
    expect(releaseSteps[0]?.with).toEqual({ name: 'release', path: 'release' });
  });

  it('creates a draft for a tag that is on GitHub, from exactly four files', () => {
    const script = create?.run ?? '';
    expect(script).toContain('assets=(release/assets/*)');
    expect(script).toContain('if [ "${#assets[@]}" -ne 4 ]; then');
    expect(script).toMatch(/gh release create "\$TAG" --draft --verify-tag "\$\{prerelease\[@\]\}"/);
    expect(script).toContain('--title "$TITLE" --notes-file release/notes.md "${assets[@]}"');
    expect(script.match(/gh release/g)).toHaveLength(1);
    expect(create?.env).toEqual({
      GH_TOKEN: '${{ github.token }}',
      GH_REPO: '${{ github.repository }}',
      TAG: '${{ github.ref_name }}',
      TITLE: '${{ needs.build.outputs.title }}'
    });
  });

  it('marks a version with a hyphen a prerelease, and only such a version', () => {
    expect(create?.run).toContain('prerelease=()');
    expect(create?.run).toContain('case "${TAG#v}" in *-*) prerelease=(--prerelease) ;; esac');
  });

  it('leaves publishing, and marking the latest release, to the author', () => {
    const script = create?.run ?? '';
    expect(script).not.toMatch(/--latest|--draft=false|gh release edit/);
  });
});
