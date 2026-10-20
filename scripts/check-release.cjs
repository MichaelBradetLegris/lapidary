/**
 * The release workflow's first step (PLAN 11.3 n, `release.6b`): before
 * `npm ci`, it checks that a pushed tag can become a release.
 *
 *     node scripts/check-release.cjs v1.0.0
 *     npm run release:check -- v1.0.0
 *
 * - The tag is `v` and a SemVer version, such as v1.0.0 or v1.1.0-rc.1.
 * - package.json's version is the tag's, and so are package-lock.json's two,
 *   its own and its root package's. `npm version` sets all three.
 * - CHANGELOG.md has one section for that version, dated as Keep a Changelog
 *   dates one (`## [1.0.0] - 2026-11-02`, a real date), that lists at least
 *   one change.
 *
 * It prints each problem and exits 1, or prints one line and exits 0; 2 on a
 * malformed command line. It reads the files beside it, in the repository it
 * belongs to, and writes nothing.
 *
 * Node builtins only, since it runs before `npm ci`; the CHANGELOG is read
 * through scripts/release-notes.cjs, which uses builtins only too.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { versionFromTag, extractSection, hasEntries } = require('./release-notes.cjs');

const ROOT = path.join(__dirname, '..');

/** The three files the check reads, as text, each null when it cannot be read. */
function readReleaseFiles(root = ROOT) {
  const read = (name) => {
    try {
      return readFileSync(path.join(root, name), 'utf8');
    } catch {
      return null;
    }
  };
  return {
    packageJson: read('package.json'),
    packageLock: read('package-lock.json'),
    changelog: read('CHANGELOG.md')
  };
}

/** `text` parsed as a JSON object, or a problem saying why it is not one. */
function parseJsonObject(name, text) {
  if (text === null) return { problem: `${name} could not be read.` };
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return { value };
  } catch {
    return { problem: `${name} is not valid JSON.` };
  }
  return { problem: `${name} does not hold a JSON object.` };
}

/** A value as the problems show it. */
function quoted(value) {
  return typeof value === 'string' ? `"${value}"` : value === undefined ? 'missing' : JSON.stringify(value);
}

/**
 * Every reason `tag` cannot be released from these files (`readReleaseFiles`'s
 * shape), in the order above. Empty when it can.
 */
function checkRelease(tag, files) {
  const version = versionFromTag(tag);
  if (!version) {
    return [
      `The tag ${quoted(tag)} is not a release tag: it should be v and a version, such as v1.0.0 or v1.1.0-rc.1, with no leading zeros and no build metadata.`
    ];
  }
  const problems = [];

  const pkg = parseJsonObject('package.json', files.packageJson);
  if (pkg.problem) problems.push(pkg.problem);
  else if (pkg.value.version !== version) {
    problems.push(`package.json's version is ${quoted(pkg.value.version)}, not "${version}".`);
  }

  const lock = parseJsonObject('package-lock.json', files.packageLock);
  if (lock.problem) problems.push(lock.problem);
  else {
    if (lock.value.version !== version) {
      problems.push(`package-lock.json's version is ${quoted(lock.value.version)}, not "${version}".`);
    }
    const root = lock.value.packages?.[''];
    if (typeof root !== 'object' || root === null) {
      problems.push('package-lock.json has no root package entry (packages[""]).');
    } else if (root.version !== version) {
      problems.push(`package-lock.json's root package version is ${quoted(root.version)}, not "${version}".`);
    }
  }

  if (files.changelog === null) problems.push('CHANGELOG.md could not be read.');
  else {
    let section = null;
    try {
      section = extractSection(files.changelog, version);
      if (!section) problems.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.`);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (section && !section.date) {
      problems.push(
        `CHANGELOG.md's section for ${version} is not dated: "${section.heading}" should end in " - YYYY-MM-DD", a real date.`
      );
    }
    if (section && !hasEntries(section.body)) {
      problems.push(
        `CHANGELOG.md's section for ${version} lists no change: it needs at least one line starting "- ".`
      );
    }
  }
  return problems;
}

const USAGE = 'Usage: node scripts/check-release.cjs <tag>';

/** The command line. Returns the exit code. */
function main(args, root = ROOT) {
  if (args.length !== 1 || args[0].startsWith('--')) {
    console.error(USAGE);
    return 2;
  }
  const [tag] = args;
  const files = readReleaseFiles(root);
  const problems = checkRelease(tag, files);
  if (problems.length > 0) {
    console.error(`${tag} cannot be released:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  const { date } = extractSection(files.changelog, versionFromTag(tag));
  console.log(`${tag}: package.json, package-lock.json and the CHANGELOG section dated ${date} agree.`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { checkRelease, readReleaseFiles, main, ROOT };
