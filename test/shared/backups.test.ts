import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_RETENTION,
  backupFileName,
  backupsToPrune,
  compareBackups,
  formatLocalStamp,
  localDayNumber,
  parseBackupFileName
} from '../../src/shared/backups';

/* apply.10: backup names and what is kept (PLAN 6.5, 11.3 h). Dates are built
   with the local-time constructor, so the tests hold in any time zone. */

const CHAPTER = 'Chapter 12.md';

/** A local time, month counted from 1. */
function at(year: number, month: number, day: number, hour = 12, minute = 0, second = 0): Date {
  return new Date(year, month - 1, day, hour, minute, second);
}

describe('formatLocalStamp', () => {
  it('writes the local date and time with dots for colons', () => {
    expect(formatLocalStamp(at(2026, 10, 14, 16, 4, 33))).toBe('2026-10-14 16.04.33');
  });

  it('pads every field', () => {
    expect(formatLocalStamp(at(2027, 1, 2, 3, 4, 5))).toBe('2027-01-02 03.04.05');
    expect(formatLocalStamp(at(2026, 12, 31, 23, 59, 59))).toBe('2026-12-31 23.59.59');
  });
});

describe('backupFileName', () => {
  it('is the time, then the chapter file name', () => {
    expect(backupFileName(at(2026, 10, 14, 16, 4, 33), CHAPTER)).toBe('2026-10-14 16.04.33 Chapter 12.md');
  });

  it('puts the count after the time for a second backup in the same second', () => {
    const date = at(2026, 10, 14, 16, 4, 33);
    expect(backupFileName(date, CHAPTER, 1)).toBe('2026-10-14 16.04.33 Chapter 12.md');
    expect(backupFileName(date, CHAPTER, 2)).toBe('2026-10-14 16.04.33-2 Chapter 12.md');
    expect(backupFileName(date, CHAPTER, 13)).toBe('2026-10-14 16.04.33-13 Chapter 12.md');
  });

  it('keeps only the file name of a path, whichever separator it uses', () => {
    const date = at(2026, 10, 14, 16, 4, 33);
    expect(backupFileName(date, 'C:\\Novel\\Part 1\\Chapter 12.md')).toBe(
      '2026-10-14 16.04.33 Chapter 12.md'
    );
    expect(backupFileName(date, '/novel/notes.txt')).toBe('2026-10-14 16.04.33 notes.txt');
  });
});

describe('parseBackupFileName', () => {
  it('reads back what backupFileName wrote', () => {
    const parsed = parseBackupFileName('2026-10-14 16.04.33-2 Chapter 12.md');
    expect(parsed).toEqual({
      name: '2026-10-14 16.04.33-2 Chapter 12.md',
      stamp: '2026-10-14 16.04.33',
      seq: 2,
      chapter: 'Chapter 12.md',
      day: localDayNumber(at(2026, 10, 14))
    });
    expect(parseBackupFileName('2026-10-14 16.04.33 Chapter 12.md')?.seq).toBe(1);
  });

  it('round-trips any time, chapter name and count', () => {
    const names = fc
      .string({ minLength: 1, maxLength: 30 })
      .filter((s) => !/[\\/]/.test(s) && s.trim().length > 0)
      .map((s) => `${s}.md`);
    fc.assert(
      fc.property(
        fc.date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31), noInvalidDate: true }),
        names,
        fc.integer({ min: 1, max: 999 }),
        (date, chapter, seq) => {
          const name = backupFileName(date, chapter, seq);
          const parsed = parseBackupFileName(name);
          expect(parsed).not.toBeNull();
          expect(parsed?.name).toBe(name);
          expect(parsed?.stamp).toBe(formatLocalStamp(date));
          expect(parsed?.seq).toBe(seq);
          expect(parsed?.chapter).toBe(chapter);
          expect(parsed?.day).toBe(localDayNumber(date));
        }
      )
    );
  });

  it('reads nothing else in the folder as a backup', () => {
    for (const name of [
      'chapter.json',
      'notes.txt',
      'Chapter 12.md',
      '2026-10-14 16.04.33',
      '2026-10-14 16.04.33 ',
      '2026-10-14 16:04:33 Chapter 12.md',
      '2026-10-14T16.04.33 Chapter 12.md',
      '2026-13-01 10.00.00 Chapter 12.md',
      '2026-02-30 10.00.00 Chapter 12.md',
      '2026-04-31 10.00.00 Chapter 12.md',
      '2026-10-14 24.00.00 Chapter 12.md',
      '2026-10-14 16.60.00 Chapter 12.md',
      '2026-10-14 16.04.60 Chapter 12.md',
      '2026-10-14 16.04.33-1 Chapter 12.md',
      '2026-10-14 16.04.33-0 Chapter 12.md',
      '2026-10-14 16.04.33-x Chapter 12.md',
      '.2026-10-14 16.04.33 Chapter 12.md.1a2b3c.tmp'
    ]) {
      expect(parseBackupFileName(name), name).toBeNull();
    }
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseBackupFileName('2028-02-29 10.00.00 a.md')).not.toBeNull();
    expect(parseBackupFileName('2027-02-29 10.00.00 a.md')).toBeNull();
  });

  it('orders by time, then by the count', () => {
    const names = [
      '2026-10-14 16.04.33-2 a.md',
      '2026-10-14 16.04.34 a.md',
      '2026-10-14 16.04.33 a.md',
      '2026-10-14 16.04.33-10 a.md',
      '2025-12-31 23.59.59 a.md'
    ];
    const sorted = names
      .map((n) => parseBackupFileName(n)!)
      .sort(compareBackups)
      .map((b) => b.name);
    expect(sorted).toEqual([
      '2025-12-31 23.59.59 a.md',
      '2026-10-14 16.04.33 a.md',
      '2026-10-14 16.04.33-2 a.md',
      '2026-10-14 16.04.33-10 a.md',
      '2026-10-14 16.04.34 a.md'
    ]);
  });
});

/** A backup name at that local time. */
const named = (date: Date, seq = 1): string => backupFileName(date, CHAPTER, seq);

/** What is left after pruning. */
function kept(names: readonly string[], now: Date): string[] {
  const pruned = new Set(backupsToPrune(names, now));
  return names.filter((n) => !pruned.has(n));
}

describe('backupsToPrune', () => {
  it('keeps the newest 20 and the first of each day for 30 days', () => {
    expect(BACKUP_RETENTION).toEqual({ newest: 20, days: 30 });
  });

  it('keeps 21 of 25 saves in one day: the newest 20 and the first of the day', () => {
    const names = Array.from({ length: 25 }, (_, i) => named(at(2026, 10, 14, 9, i, 0)));
    const left = kept(names, at(2026, 10, 14, 18));
    expect(left).toHaveLength(21);
    expect(left).toEqual([names[0], ...names.slice(5)]);
    expect(backupsToPrune(names, at(2026, 10, 14, 18))).toEqual(names.slice(1, 5));
  });

  it('keeps 30 of one save a day for 40 days: the last 30 days', () => {
    const names = Array.from({ length: 40 }, (_, i) => named(at(2026, 9, 1 + i, 10)));
    const now = at(2026, 10, 10, 20); // the day of the 40th
    const left = kept(names, now);
    expect(left).toHaveLength(30);
    expect(left).toEqual(names.slice(10));
  });

  it('prunes nothing at 20 or fewer', () => {
    const names = Array.from({ length: 20 }, (_, i) => named(at(2026, 1, 1 + i)));
    expect(backupsToPrune(names, at(2026, 10, 14))).toEqual([]);
  });

  it('keeps only the newest 20 when every backup is older than 30 days', () => {
    const names = Array.from({ length: 30 }, (_, i) => named(at(2025, 1, 1 + i)));
    expect(kept(names, at(2026, 10, 14))).toEqual(names.slice(10));
  });

  it('keeps the first of each day, not the last', () => {
    const now = at(2026, 10, 14, 20);
    const old = [named(at(2026, 10, 1, 8)), named(at(2026, 10, 1, 9)), named(at(2026, 10, 1, 10))];
    const recent = Array.from({ length: 20 }, (_, i) => named(at(2026, 10, 14, 10, i)));
    expect(kept([...old, ...recent], now)).toEqual([old[0], ...recent]);
  });

  it('counts the 30 days back from today, today included', () => {
    const now = at(2026, 10, 14, 0, 0, 1);
    const recent = Array.from({ length: 20 }, (_, i) => named(at(2026, 10, 14, 0, 0, 2 + i)));
    const day29 = named(at(2026, 9, 15, 23, 59, 59)); // 29 days before: kept
    const day30 = named(at(2026, 9, 14, 23, 59, 59)); // 30 days before: gone
    expect(kept([day30, day29, ...recent], now)).toEqual([day29, ...recent]);
  });

  it('counts calendar days across a month and a year', () => {
    const now = at(2027, 1, 2, 12);
    const days = [at(2026, 12, 31), at(2026, 12, 4), at(2026, 12, 3), at(2026, 10, 25), at(2026, 3, 29)];
    const recent = Array.from({ length: 20 }, (_, i) => named(at(2027, 1, 2, 10, i)));
    const names = [...days.map((d) => named(d)).reverse(), ...recent];
    // 3 December is 30 days before 2 January; 4 December is 29.
    expect(kept(names, now)).toEqual([named(days[1]!), named(days[0]!), ...recent]);
  });

  it('counts calendar days, not elapsed time, across a clock change', () => {
    // Node reads TZ again when it is assigned. In Toronto the clocks go back
    // on 1 November 2026, so 3 October 00:30 is 29 calendar days before
    // 1 November 23:30 but a full 30 times 24 hours before it.
    const previous = process.env.TZ;
    process.env.TZ = 'America/Toronto';
    try {
      const now = at(2026, 11, 1, 23, 30);
      const backup = at(2026, 10, 3, 0, 30);
      expect(backup.getTimezoneOffset()).not.toBe(now.getTimezoneOffset());
      expect(now.getTime() - backup.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000);
      const recent = Array.from({ length: 20 }, (_, i) => named(at(2026, 11, 1, 10, i)));
      expect(kept([named(backup), ...recent], now)).toEqual([named(backup), ...recent]);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('orders a second backup in the same second after the first', () => {
    const date = at(2026, 10, 14, 16, 4, 33);
    const names = [named(date, 3), named(date), named(date, 2)];
    const more = Array.from({ length: 20 }, (_, i) => named(at(2026, 10, 14, 17, i)));
    // The first of the day stays; -2 and -3 are older than the newest 20.
    expect(backupsToPrune([...names, ...more], at(2026, 10, 14, 20))).toEqual([
      named(date, 2),
      named(date, 3)
    ]);
  });

  it('keeps a backup dated after now, as when the clock was put back', () => {
    const now = at(2026, 10, 14, 12);
    const future = named(at(2026, 10, 20, 12));
    const recent = Array.from({ length: 25 }, (_, i) => named(at(2026, 9, 1, 10, i)));
    expect(kept([...recent, future], now)).toContain(future);
  });

  it('never deletes a name it cannot read', () => {
    const now = at(2026, 10, 14, 20);
    const strays = ['chapter.json', 'my notes.txt', '2026-10-14 16.04.33-1 Chapter 12.md', 'Chapter 12.md'];
    const backups = Array.from({ length: 40 }, (_, i) => named(at(2025, 1, 1, 10, i)));
    const pruned = backupsToPrune([...strays, ...backups], now);
    expect(pruned).toHaveLength(20);
    for (const stray of strays) expect(pruned).not.toContain(stray);
  });

  it('returns the pruned names oldest first and never more than were given', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.date({ min: new Date(2026, 0, 1), max: new Date(2026, 11, 31), noInvalidDate: true }),
          {
            maxLength: 80,
            selector: (d) => formatLocalStamp(d)
          }
        ),
        fc.date({ min: new Date(2026, 0, 1), max: new Date(2027, 1, 1), noInvalidDate: true }),
        (dates, now) => {
          const names = dates.map((d) => named(d));
          const pruned = backupsToPrune(names, now);
          const left = kept(names, now);
          expect(left.length).toBe(names.length - pruned.length);
          expect(left.length).toBeGreaterThanOrEqual(Math.min(20, names.length));
          const order = pruned.map((n) => parseBackupFileName(n)!);
          expect([...order].sort(compareBackups)).toEqual(order);
          // The newest 20 are never pruned.
          const newest = names
            .map((n) => parseBackupFileName(n)!)
            .sort(compareBackups)
            .slice(-20)
            .map((b) => b.name);
          for (const name of newest) expect(pruned).not.toContain(name);
        }
      )
    );
  });
});
