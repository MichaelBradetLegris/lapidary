let counter = 0;

/**
 * Unique-enough id for hunks and comments. Uniqueness only has to hold inside a
 * single review, but the random tail keeps ids distinct when a stored review is
 * reopened and new manual hunks are added in the same session.
 */
export function nextId(prefix: string): string {
  counter += 1;
  const tail = Math.floor(Math.random() * 0xfffff)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${counter.toString(36)}${tail}`;
}

/** Test seam so id sequences are reproducible. */
export function resetIdCounter(value = 0): void {
  counter = value;
}

/** Filesystem-safe slug used for review folder names. */
export function slugify(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'chapter';
}
