/**
 * Whether the author has filled in the style sheet in GUIDELINES.md (setup.10).
 *
 * The reviewer follows the style sheet over its own defaults: spelling variant,
 * character names, invented words. Left as the template has it, the reviewer
 * may "fix" exactly those, so the app points at it until it holds something.
 * Pure (CLAUDE.md rule 4).
 */

export type StyleSheetStatus = 'blank' | 'filled' | 'missing';

const HEADING = /^##\s+style sheet\s*$/i;
const NEXT_HEADING = /^#{1,2}\s/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const EMPTY_BULLET = /^[-*+]$/;
/** The template's own line under the heading; any wording of it. */
const INSTRUCTION = /^fill this in\b/i;
/** A template placeholder such as `(US or UK)`. */
const PLACEHOLDER = /^\(.*\)$/;

/**
 * `missing` when the file has no "## Style sheet" section, `blank` when the
 * section holds only the template's labels and placeholders, `filled` as soon
 * as one entry has a value or the author wrote anything of their own there.
 */
export function styleSheetStatus(text: string): StyleSheetStatus {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => HEADING.test(line.trim()));
  if (start < 0) return 'missing';

  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (NEXT_HEADING.test(line)) break;
    if (line === '' || EMPTY_BULLET.test(line) || INSTRUCTION.test(line)) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) return 'filled';
    const entry = (bullet[1] ?? '').trim();
    const colon = entry.indexOf(':');
    if (colon < 0) {
      if (entry !== '' && !PLACEHOLDER.test(entry)) return 'filled';
      continue;
    }
    const value = entry.slice(colon + 1).trim();
    if (value !== '' && !PLACEHOLDER.test(value)) return 'filled';
  }
  return 'blank';
}
