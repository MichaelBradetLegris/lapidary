import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatFields, type ScrubContext } from '../shared/diagnostics/redact';

/**
 * The app's log file (PLAN 11.3 m): `<userData>/logs/main.log`, rotated to
 * `main.1.log` at about 1 MiB, so at most two files ever exist.
 *
 * A line is `<ISO time> <LEVEL> <event> k=v ...`. Fields are scalar and scrubbed
 * by `formatFields`, and errors go through `loggableErrorFields`, so the log never
 * holds chapter text, prompts, guidelines, model replies, keys or the account
 * email. A caller cannot hand it an object to dump.
 *
 * Lines are buffered and written together a moment later; `flushLog` writes them
 * at once, which quitting does. Nothing here throws: a log that cannot be written
 * must never take the app down with it, so writing simply stops and the lines
 * stay in the in-memory tail.
 *
 * No electron import. `initLog` is called at startup with the userData folder.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LoggerOptions {
  /** folder for main.log and main.1.log */
  dir: string;
  /** rotate once main.log would pass this many bytes */
  maxBytes?: number;
  /** lines kept in memory for `tail` */
  keep?: number;
  /** scrubbed out of every value as `~` */
  home?: string | null;
  now?: () => Date;
  /** called after the buffer is filled; the default writes on the next tick */
  schedule?: (flush: () => void) => void;
}

export interface Logger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
  flush(): void;
  tail(n: number, minLevel?: LogLevel): string[];
  /** false once a write has failed and file logging is off */
  writing(): boolean;
}

export const LOG_FILE = 'main.log';
export const ROTATED_LOG_FILE = 'main.1.log';
const DEFAULT_MAX_BYTES = 1024 * 1024;

export function createLogger(options: LoggerOptions): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = options.keep ?? 500;
  const ctx: ScrubContext = { home: options.home ?? null };
  const now = options.now ?? ((): Date => new Date());
  const schedule = options.schedule ?? ((fn: () => void): void => void setTimeout(fn, 0));
  const file = path.join(options.dir, LOG_FILE);
  const rotated = path.join(options.dir, ROTATED_LOG_FILE);

  const recent: { level: LogLevel; line: string }[] = [];
  let pending: string[] = [];
  let scheduled = false;
  let enabled = true;
  let prepared = false;

  function prepare(): void {
    if (prepared) return;
    prepared = true;
    mkdirSync(options.dir, { recursive: true });
  }

  function sizeOf(target: string): number {
    try {
      return statSync(target).size;
    } catch {
      return 0;
    }
  }

  function flush(): void {
    scheduled = false;
    if (pending.length === 0) return;
    const chunk = `${pending.join('\n')}\n`;
    pending = [];
    if (!enabled) return;
    try {
      prepare();
      const bytes = Buffer.byteLength(chunk, 'utf8');
      if (sizeOf(file) > 0 && sizeOf(file) + bytes > maxBytes) renameSync(file, rotated);
      appendFileSync(file, chunk, 'utf8');
    } catch {
      enabled = false;
    }
  }

  function log(level: LogLevel, event: string, fields: Readonly<Record<string, unknown>> = {}): void {
    const name = /^[A-Za-z][\w.-]*$/.test(event) ? event : 'invalid.event';
    const rest = formatFields(fields, ctx);
    const line = `${now().toISOString()} ${level.toUpperCase()} ${name}${rest ? ` ${rest}` : ''}`;
    recent.push({ level, line });
    if (recent.length > keep) recent.splice(0, recent.length - keep);
    pending.push(line);
    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  }

  function tail(n: number, minLevel: LogLevel = 'debug'): string[] {
    const floor = LEVELS.indexOf(minLevel);
    return recent
      .filter((entry) => LEVELS.indexOf(entry.level) >= floor)
      .slice(-Math.max(0, n))
      .map((entry) => entry.line);
  }

  return { log, flush, tail, writing: () => enabled };
}

/* The app's one logger. Lines logged before `initLog` are kept in memory and
   written once it runs. */
let current: Logger | null = null;
const early: { level: LogLevel; event: string; fields: Readonly<Record<string, unknown>> }[] = [];

export function initLog(dir: string, options: Omit<LoggerOptions, 'dir'> = {}): Logger {
  current = createLogger({ home: os.homedir(), ...options, dir });
  for (const entry of early.splice(0)) current.log(entry.level, entry.event, entry.fields);
  return current;
}

export function log(level: LogLevel, event: string, fields: Readonly<Record<string, unknown>> = {}): void {
  if (current) current.log(level, event, fields);
  else if (early.length < 200) early.push({ level, event, fields });
}

export function flushLog(): void {
  current?.flush();
}

export function tail(n: number, minLevel: LogLevel = 'debug'): string[] {
  return current?.tail(n, minLevel) ?? [];
}

/** False before `initLog`, and once a write has failed and the file is no longer written. */
export function logWriting(): boolean {
  return current?.writing() ?? false;
}
