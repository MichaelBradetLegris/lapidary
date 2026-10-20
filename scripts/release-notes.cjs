/**
 * The notes of a GitHub release (PLAN 11.3 n, `release.6b`): the body of the
 * version's section in CHANGELOG.md, a rule, and .github/release-footer.md
 * with its placeholders filled in.
 *
 *     node scripts/release-notes.cjs v1.0.0
 *     node scripts/release-notes.cjs v1.0.0 --out notes.md
 *
 * It prints the notes, or writes them to the file `--out` names, as UTF-8 with
 * LF line endings. It exits 1, writing nothing, when the tag is not a release
 * tag, when the CHANGELOG has no dated section for its version, when the
 * section lists no change, or when a placeholder in the footer has no value;
 * and 2 on a malformed command line.
 *
 * The footer's placeholders are `{version}` (1.0.0), `{tag}` (v1.0.0), `{name}`
 * (APP_NAME), `{installer}` (the installer's file name, as electron-builder's
 * `nsis.artifactName` makes it) and `{repo}` (APP_REPOSITORY, owner/repo).
 *
 * Node builtins only: the release workflow runs scripts/check-release.cjs,
 * which reads the CHANGELOG through this file, before `npm ci`.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { appName, appRepository } = require('./branding.cjs');

const ROOT = path.join(__dirname, '..');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const FOOTER = path.join(ROOT, '.github', 'release-footer.md');

/**
 * A release tag: `v` and a SemVer 2.0 version with no leading zeros, which may
 * have a pre-release part (`v0.9.0-rc.1`) but no build metadata. The release
 * workflow starts on any tag matching `v[0-9]+.[0-9]+.[0-9]+*`, which is looser.
 */
const NUMBER = '(?:0|[1-9]\\d*)';
const PRERELEASE_PART = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const TAG_PATTERN = new RegExp(
  `^v(${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?)$`
);

/** The version a release tag names (`v1.0.0` gives `1.0.0`), or null when the tag is malformed. */
function versionFromTag(tag) {
  const match = typeof tag === 'string' ? TAG_PATTERN.exec(tag) : null;
  return match ? match[1] : null;
}

/** Whether `text` is a real date written YYYY-MM-DD, as Keep a Changelog dates a release. */
function isCalendarDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const SECTION_HEADING = /^##\s+\[([^\]]+)\](.*)$/;
/** A heading that ends a section: the next version's, or the file's own title. */
const SECTION_END = /^#{1,2}\s/;
/** Keep a Changelog's comparison links at the foot of the file, such as `[1.0.0]: https://...`. */
const VERSION_LINK = /^\[(?:unreleased|\d[^\]]*)\]:\s*\S/i;
const FENCE = /^\s*(```|~~~)/;

/**
 * The section of a Keep a Changelog file for `version`, written
 * `## [1.0.0] - 2026-11-02`. Returns `{heading, date, dateText, body}`: the
 * heading line, the date when the heading has a real YYYY-MM-DD one (else
 * null), whatever follows " - " in the heading (else ''), and the lines up to
 * the next `#` or `##` heading or the version links at the foot, with blank
 * lines trimmed from both ends. Returns null when there is no such section and
 * throws when there is more than one. Headings inside code fences are text.
 */
function extractSection(changelog, version) {
  const lines = changelog
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const found = [];
  let current = null;
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : SECTION_HEADING.exec(line);
    if (!fenced && (SECTION_END.test(line) || VERSION_LINK.test(line))) current = null;
    if (heading && heading[1].trim() === version) {
      const dateText = /^\s+-\s+(.*?)\s*$/.exec(heading[2])?.[1] ?? '';
      current = { heading: line, date: isCalendarDate(dateText) ? dateText : null, dateText, lines: [] };
      found.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (found.length > 1) {
    throw new Error(`CHANGELOG.md has ${found.length} sections for ${version}; it should have one.`);
  }
  if (found.length === 0) return null;
  const { heading, date, dateText, lines: body } = found[0];
  while (body.length > 0 && body[0].trim() === '') body.shift();
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  return { heading, date, dateText, body: body.join('\n') };
}

/**
 * Whether a section's body lists at least one change: a Markdown list item
 * with text on its own line. Group headings and prose alone do not count.
 */
function hasEntries(body) {
  return /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/m.test(body);
}

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/**
 * The footer template with each `{word}` replaced by `values[word]`. Throws,
 * naming them, when any `{word}` is left over: one with no value, or with an
 * empty one, or one that a value brought in. Braces around anything else, such
 * as `{ $_ }` in a PowerShell line, are left alone.
 */
function renderFooter(template, values) {
  const text = template.replace(PLACEHOLDER, (whole, word) => {
    const value = Object.prototype.hasOwnProperty.call(values, word) ? values[word] : undefined;
    return typeof value === 'string' && value !== '' ? value : whole;
  });
  const leftover = [...new Set(Array.from(text.matchAll(PLACEHOLDER), (match) => match[0]))];
  if (leftover.length > 0) {
    throw new Error(`The release footer has no value for ${leftover.join(', ')}.`);
  }
  return text;
}

/**
 * The installer's file name, as electron-builder's `nsis.artifactName`,
 * `${productName}-Setup-${version}.${ext}`, makes it.
 */
function installerName(version, name = appName()) {
  return `${name}-Setup-${version}.exe`;
}

/** The values of the footer's placeholders for a version. */
function footerValues(version, name = appName(), slug = appRepository().slug) {
  return { version, tag: `v${version}`, name, installer: installerName(version, name), repo: slug };
}

/**
 * The notes for `values.version`: the body of its CHANGELOG section, a rule,
 * and the rendered footer, ending in one newline. Throws when the section is
 * missing, undated or lists no change, or when the footer has a leftover
 * placeholder.
 */
function releaseNotes(changelog, footer, values) {
  const { version } = values;
  const section = extractSection(changelog, version);
  if (!section) throw new Error(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" section.`);
  if (!section.date) {
    throw new Error(`CHANGELOG.md's section for ${version} is not dated: "${section.heading}".`);
  }
  if (!hasEntries(section.body)) throw new Error(`CHANGELOG.md's section for ${version} lists no change.`);
  const rendered = renderFooter(footer.replace(/\r\n?/g, '\n'), values).trim();
  return `${section.body}\n\n---\n\n${rendered}\n`;
}

const USAGE = 'Usage: node scripts/release-notes.cjs <tag> [--out <file>]';

/** The command line. Returns the exit code. */
function main(args) {
  const rest = [...args];
  let out = null;
  const outAt = rest.indexOf('--out');
  if (outAt !== -1) {
    out = rest[outAt + 1] ?? null;
    if (!out || out.startsWith('--')) {
      console.error(`--out needs a file name.\n${USAGE}`);
      return 2;
    }
    rest.splice(outAt, 2);
  }
  if (rest.length !== 1 || rest[0].startsWith('--')) {
    console.error(USAGE);
    return 2;
  }
  const tag = rest[0];
  const version = versionFromTag(tag);
  if (!version) {
    console.error(
      `"${tag}" is not a release tag: it should be v and a version, such as v1.0.0 or v1.1.0-rc.1.`
    );
    return 1;
  }
  try {
    const notes = releaseNotes(
      readFileSync(CHANGELOG, 'utf8'),
      readFileSync(FOOTER, 'utf8'),
      footerValues(version)
    );
    if (out) {
      writeFileSync(path.resolve(out), notes, 'utf8');
      console.log(`Wrote the notes for ${tag} to ${out}.`);
    } else {
      process.stdout.write(notes);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  TAG_PATTERN,
  versionFromTag,
  isCalendarDate,
  extractSection,
  hasEntries,
  renderFooter,
  installerName,
  footerValues,
  releaseNotes,
  main,
  CHANGELOG,
  FOOTER
};
