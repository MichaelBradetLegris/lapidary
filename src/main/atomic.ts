import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** How long to wait before each retry of a refused rename: about 1.5 s in all. */
export const RENAME_BACKOFF_MS: readonly number[] = [50, 100, 200, 400, 800];

/** What a rename can fail with while another program briefly holds the file. */
const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * What the target looks like before a retry: unchanged, changed by someone
 * else (stop: the caller must rebase), or too locked to read (retry anyway).
 */
export type TargetCheck = 'same' | 'changed' | 'unreadable';

export interface AtomicWriteOptions {
  rename?: (from: string, to: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  /** run before each retry; without it a retry never stops early */
  beforeRetry?: () => Promise<TargetCheck>;
  platform?: NodeJS.Platform;
  /**
   * Off Windows, the file's permission bits, whatever the target's were: 0o600
   * for secrets.json, which only its owner may read (codex.2). Left out, the
   * temp file takes the target's.
   */
  mode?: number;
}

export type AtomicWriteOutcome = 'written' | 'stale';

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Write bytes by creating a sibling temp file and renaming over the target.
 * Same-directory rename is atomic on NTFS, so a crash mid-write can never
 * leave a half-written manuscript behind (CLAUDE.md rule 1).
 *
 * Antivirus scanners, OneDrive and Obsidian itself hold a file open for a
 * moment after touching it, and Windows then refuses the rename. So a refused
 * rename is retried after 50, 100, 200, 400 and 800 ms (files.4, PLAN 11.3 h
 * step 6). Before each retry `beforeRetry` looks at the target: if someone
 * else changed it meanwhile, the write stops with 'stale' and their bytes
 * stay; if it cannot even be read, that round's rename is skipped. Off
 * Windows the temp file takes the target's permission bits, so a save never
 * changes who may read the chapter.
 */
export async function atomicWriteFile(
  target: string,
  bytes: Buffer,
  options: AtomicWriteOptions = {}
): Promise<AtomicWriteOutcome> {
  const rename = options.rename ?? ((from: string, to: string): Promise<void> => fs.rename(from, to));
  const sleep = options.sleep ?? delay;
  const platform = options.platform ?? process.platform;
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`
  );
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'wx');
    await handle.writeFile(bytes);
    if (platform !== 'win32') {
      if (options.mode === undefined) await copyMode(target, handle);
      else await handle.chmod(options.mode);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;

    let refused: unknown;
    /** True once renamed; false when the target is locked; throws anything else. */
    const attempt = async (): Promise<boolean> => {
      try {
        await rename(tmp, target);
        return true;
      } catch (err) {
        if (!LOCKED.has(errorCode(err) ?? '')) throw err;
        refused = err;
        return false;
      }
    };
    if (await attempt()) return 'written';
    for (const wait of RENAME_BACKOFF_MS) {
      await sleep(wait);
      const check = options.beforeRetry ? await options.beforeRetry() : 'same';
      if (check === 'changed') {
        await removeTemp(tmp, sleep);
        return 'stale';
      }
      if (check === 'unreadable') continue;
      if (await attempt()) return 'written';
    }
    throw refused;
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await removeTemp(tmp, sleep);
    throw err;
  }
}

/** Keep the target's permission bits (POSIX only); a new file keeps the default. */
async function copyMode(target: string, handle: FileHandle): Promise<void> {
  try {
    const { mode } = await fs.stat(target);
    await handle.chmod(mode & 0o7777);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') throw err;
  }
}

/** Remove the temp file, retrying briefly when the scanner that held the target holds it too. */
async function removeTemp(tmp: string, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (const wait of [0, ...RENAME_BACKOFF_MS.slice(0, 3)]) {
    if (wait > 0) await sleep(wait);
    try {
      await fs.rm(tmp, { force: true });
      return;
    } catch (err) {
      if (!LOCKED.has(errorCode(err) ?? '')) return;
    }
  }
}
