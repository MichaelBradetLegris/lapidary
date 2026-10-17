import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_FILE, ROTATED_LOG_FILE, createLogger } from '../../src/main/log';

/* hardening.2: the log file. */

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lapidary-log-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fixedNow = (): Date => new Date('2026-10-14T12:00:00.000Z');
/** Never flushes on its own, so each test decides when lines reach the disk. */
const manual = (): void => undefined;

describe('createLogger', () => {
  it('writes buffered lines in the documented shape when flushed', () => {
    const dir = scratch();
    const logger = createLogger({ dir, now: fixedNow, schedule: manual });
    logger.log('info', 'app.start', { version: '1.0.0', packaged: false });
    expect(readdirSync(dir)).toEqual([]);
    logger.flush();
    expect(readFileSync(path.join(dir, LOG_FILE), 'utf8')).toBe(
      '2026-10-14T12:00:00.000Z INFO app.start version=1.0.0 packaged=false\n'
    );
  });

  it('drops fields that are not scalar', () => {
    const dir = scratch();
    const logger = createLogger({ dir, now: fixedNow, schedule: manual });
    logger.log('warn', 'review.done', {
      changes: 4,
      chapter: { text: 'It was a dark night.' },
      lines: ['x']
    });
    logger.flush();
    const text = readFileSync(path.join(dir, LOG_FILE), 'utf8');
    expect(text).toContain('changes=4');
    expect(text).not.toContain('dark night');
  });

  it('rotates to main.1.log, keeping at most two files', () => {
    const dir = scratch();
    const logger = createLogger({ dir, now: fixedNow, schedule: manual, maxBytes: 200 });
    for (let i = 0; i < 12; i += 1) {
      logger.log('info', 'tick', { i });
      logger.flush();
    }
    expect(readdirSync(dir).sort()).toEqual([LOG_FILE, ROTATED_LOG_FILE].sort());
    expect(readFileSync(path.join(dir, LOG_FILE), 'utf8').length).toBeLessThanOrEqual(200);
    expect(readFileSync(path.join(dir, LOG_FILE), 'utf8')).toContain('i=11');
  });

  it('never throws when the folder is really a file, and keeps the tail in memory', () => {
    const dir = scratch();
    const notADir = path.join(dir, 'logs');
    writeFileSync(notADir, 'I am a file');
    const logger = createLogger({ dir: notADir, now: fixedNow, schedule: manual });
    expect(() => {
      logger.log('error', 'boom', { code: 'io' });
      logger.flush();
      logger.log('info', 'after');
      logger.flush();
    }).not.toThrow();
    expect(logger.writing()).toBe(false);
    expect(logger.tail(5)).toHaveLength(2);
  });

  it('flushes on its own a moment later', async () => {
    const dir = scratch();
    const logger = createLogger({ dir, now: fixedNow });
    logger.log('info', 'later');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(readFileSync(path.join(dir, LOG_FILE), 'utf8')).toContain('INFO later');
  });

  it('filters the tail by level and keeps the newest lines', () => {
    const logger = createLogger({ dir: scratch(), now: fixedNow, schedule: manual, keep: 3 });
    logger.log('debug', 'a');
    logger.log('warn', 'b');
    logger.log('info', 'c');
    logger.log('error', 'd');
    expect(logger.tail(10)).toHaveLength(3);
    expect(logger.tail(10, 'warn').map((l) => l.split(' ')[2])).toEqual(['b', 'd']);
    expect(logger.tail(1).map((l) => l.split(' ')[2])).toEqual(['d']);
  });

  it('scrubs the home directory and rejects odd event names', () => {
    const dir = scratch();
    const logger = createLogger({ dir, now: fixedNow, schedule: manual, home: 'C:\\Users\\Ann Example' }); // check-public: allow
    logger.log('info', 'chapter text here', { folder: 'C:\\Users\\Ann Example\\Vault' }); // check-public: allow
    logger.flush();
    // A value with a backslash is written JSON-quoted, so the backslash doubles.
    expect(readFileSync(path.join(dir, LOG_FILE), 'utf8')).toBe(
      '2026-10-14T12:00:00.000Z INFO invalid.event folder="~\\\\Vault"\n'
    );
  });
});
