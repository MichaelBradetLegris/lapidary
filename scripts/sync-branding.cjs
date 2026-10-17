/**
 * Copy the branding constants from src/shared/branding.ts into package.json,
 * which is JSON and cannot import them:
 *
 * - productName, from APP_NAME. Electron reads it for app.getName() and
 *   electron-builder falls back on it.
 * - repository, homepage and bugs, from APP_REPOSITORY.
 *
 * It runs automatically before `npm run package`, and can be run on its own
 * after a rename. It writes package.json only when a field differs, with npm's
 * own formatting. With --check (`npm run branding:check`) it writes nothing: it
 * prints each field that differs and exits 1, or exits 0 when all match.
 *
 *     node scripts/sync-branding.cjs
 *     node scripts/sync-branding.cjs --check
 *
 * The comparison is exported so tests can run it on an object in memory.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { appName, appRepository } = require('./branding.cjs');

const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

/** The package.json fields that branding.ts decides, in the order they are added. */
function brandedFields(name = appName(), slug = appRepository().slug) {
  return {
    productName: name,
    repository: { type: 'git', url: `git+https://github.com/${slug}.git` },
    homepage: `https://github.com/${slug}#readme`,
    bugs: { url: `https://github.com/${slug}/issues` }
  };
}

/** Whether two JSON values are equal, ignoring the order of object keys. */
function sameJson(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameJson(a[key], b[key]));
}

/**
 * Each field of `pkg` that differs from `wanted`, as `{field, have, want}`.
 * `have` is undefined when the field is missing. Empty when `pkg` is in sync.
 */
function differences(pkg, wanted = brandedFields()) {
  return Object.keys(wanted)
    .filter((field) => !sameJson(pkg[field], wanted[field]))
    .map((field) => ({ field, have: pkg[field], want: wanted[field] }));
}

/**
 * A copy of `pkg` with `wanted` applied. A field already present keeps its
 * place; a new one goes at the end. `pkg` itself is not changed.
 */
function synced(pkg, wanted = brandedFields()) {
  return { ...pkg, ...wanted };
}

/** package.json as npm writes it: two-space indent and a trailing newline. */
function format(pkg) {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function describeDifference({ field, have, want }) {
  const was = have === undefined ? 'missing' : JSON.stringify(have);
  return `  ${field}: ${was}, should be ${JSON.stringify(want)}`;
}

/** The command line. Returns the exit code. */
function main(args) {
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(' ')}`);
    console.error('Usage: node scripts/sync-branding.cjs [--check]');
    return 2;
  }
  const check = args.includes('--check');
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const diffs = differences(pkg);

  if (diffs.length === 0) {
    console.log('package.json matches src/shared/branding.ts.');
    return 0;
  }
  if (check) {
    console.error('package.json does not match src/shared/branding.ts:');
    for (const diff of diffs) console.error(describeDifference(diff));
    console.error('Run `node scripts/sync-branding.cjs` to update it.');
    return 1;
  }
  writeFileSync(PACKAGE_JSON, format(synced(pkg)), 'utf8');
  console.log(`package.json updated: ${diffs.map((diff) => diff.field).join(', ')}.`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { brandedFields, differences, synced, format, PACKAGE_JSON };
