/**
 * Backups before Save to chapter (`apply.10`, PLAN 6.5 and 11.3 h): how a
 * backup is named and which ones are kept. Pure (CLAUDE.md rule 4); the file
 * work is in `src/main/backups.ts`.
 *
 * A backup is named by the local time of the save and the chapter's own file
 * name, `2026-10-14 16.04.33 Chapter 12.md`, so it opens in any editor as the
 * chapter it is a copy of and the folder sorts by time. Dots stand in for the
 * colons Windows refuses in a file name. A second backup in the same second
 * gets `-2` after the time, a third `-3`, and so on.
 */

/** What is kept of a chapter's backups after each save (Appendix D question 10). */
export interface BackupRetention {
  /** the newest this many backups */
  newest: number;
  /** plus the oldest backup of each local calendar day in the last this many days, today included */
  days: number;
}

export const BACKUP_RETENTION: BackupRetention = { newest: 20, days: 30 };

/** A backup file name taken apart. */
export interface BackupName {
  /** the whole file name */
  name: string;
  /** `2026-10-14 16.04.33`, local time, which sorts as the time does */
  stamp: string;
  /** 1 for the first backup in that second, 2 for `-2`, and so on */
  seq: number;
  /** the chapter's file name when the backup was made */
  chapter: string;
  /** the local calendar day, counted in days from 1970-01-01, for comparing days */
  day: number;
}

const DAY_MS = 86_400_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** `2026-10-14 16.04.33` for that moment in the computer's own time zone. */
export function formatLocalStamp(date: Date): string {
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`
  );
}

/** The last segment of a path or file name, whichever separator it uses. */
function fileNameOf(value: string): string {
  const segments = value.split(/[\\/]/);
  return segments[segments.length - 1] ?? '';
}

/**
 * The name of a backup made at `date` of the chapter called `chapterFileName`
 * (a path is cut to its file name). `seq` 2 and above is for a second backup
 * in the same second.
 */
export function backupFileName(date: Date, chapterFileName: string, seq = 1): string {
  const suffix = seq > 1 ? `-${Math.floor(seq)}` : '';
  return `${formatLocalStamp(date)}${suffix} ${fileNameOf(chapterFileName)}`;
}

const NAME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})(?:-(\d{1,6}))? (.+)$/s;

/**
 * A backup name taken apart, or null for anything else in the folder, such as
 * `chapter.json`, a file the author put there, or a name with an impossible
 * date. Retention never deletes a name this cannot read.
 */
export function parseBackupFileName(name: string): BackupName | null {
  const match = NAME.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, seqText, chapter] = match;
  const year = Number(y);
  const month = Number(mo);
  const dayOfMonth = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, dayOfMonth);
  const check = new Date(utc);
  // Date.UTC rolls 31 April over into 1 May; a real stamp never needs that.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== dayOfMonth
  ) {
    return null;
  }
  // The first backup in a second has no count, so `-0` and `-1` are never written.
  const seq = seqText === undefined ? 1 : Number(seqText);
  if (seqText !== undefined && seq < 2) return null;
  if (chapter === undefined || chapter.trim().length === 0) return null;
  return {
    name,
    stamp: `${y}-${mo}-${d} ${h}.${mi}.${s}`,
    seq,
    chapter,
    day: Math.round(utc / DAY_MS)
  };
}

/** Oldest first: by time, then by the `-2` count, then by name. */
export function compareBackups(a: BackupName, b: BackupName): number {
  if (a.stamp !== b.stamp) return a.stamp < b.stamp ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** The local calendar day of `date`, counted as `BackupName.day` is. */
export function localDayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/**
 * The backups to delete from one chapter's folder, oldest first. Kept: the
 * newest `retention.newest`, and the oldest backup of each local day from
 * today back through `retention.days - 1` days before (a day later than today,
 * after the clock was put back, counts as recent). A name that is not a
 * backup's is never returned, so nothing the author put in the folder is lost.
 */
export function backupsToPrune(
  names: readonly string[],
  now: Date,
  retention: BackupRetention = BACKUP_RETENTION
): string[] {
  const backups = names
    .map(parseBackupFileName)
    .filter((b): b is BackupName => b !== null)
    .sort(compareBackups);
  const keep = new Set(backups.slice(Math.max(0, backups.length - retention.newest)).map((b) => b.name));
  const today = localDayNumber(now);
  const seenDays = new Set<number>();
  for (const backup of backups) {
    if (seenDays.has(backup.day)) continue;
    seenDays.add(backup.day);
    if (today - backup.day < retention.days) keep.add(backup.name);
  }
  return backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
}
