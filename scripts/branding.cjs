/**
 * The branding constants, for the consumers that cannot import TypeScript:
 * package.json (through sync-branding.cjs) and the electron-builder config.
 *
 * `src/shared/branding.ts` stays the single place they are written down
 * (CLAUDE.md, Stack). This reads them rather than repeating them, so renaming
 * the app is one edit in one file.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'src', 'shared', 'branding.ts');

/** The string value of `export const <name> = '...'` in branding.ts. */
function constant(name) {
  const source = readFileSync(SOURCE, 'utf8');
  const match = new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(source);
  if (!match || !match[1]) {
    throw new Error(`Could not find ${name} in ${SOURCE}`);
  }
  return match[1];
}

function appName() {
  return constant('APP_NAME');
}

function appId() {
  return constant('APP_ID');
}

/** `{owner, repo, slug}` for `APP_REPOSITORY`, which is written `owner/repo`. */
function appRepository() {
  const slug = constant('APP_REPOSITORY');
  const [owner, repo, ...rest] = slug.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`APP_REPOSITORY must be "owner/repo", got "${slug}"`);
  }
  return { owner, repo, slug };
}

module.exports = { appName, appId, appRepository, constant, SOURCE };
