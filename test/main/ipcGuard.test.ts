import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppFailure } from '../../src/main/errors';
import { readChapter } from '../../src/main/files';
import { runHandler } from '../../src/main/ipcEnvelope';
import {
  PATH_FIELDS,
  checkPayload,
  isPlainObject,
  takesNothing,
  type PathFieldTable
} from '../../src/main/ipcGuard';
import { createLogger, type LogLevel } from '../../src/main/log';
import { REQUEST_CHANNELS, type RequestChannel } from '../../src/shared/ipc';

/* hardening.8: what main takes from the page before any handler runs. A
   channel that takes nothing is sent nothing, any other a plain object, and
   no path in it holds a NUL. A refusal names the channel and the field, never
   the path, and reaches the page and the log as `invalid-input`. */

const NUL = '\u0000';
const CHAPTER = 'C:\\Novel\\Chapter 01 - The Flood.md';
/** A path that a call reading up to the NUL would take for the chapter. */
const HIDDEN = `${CHAPTER}${NUL}.exe`;

/** The refusal `checkPayload` throws, or null when it lets the payload through. */
function refusal(channel: RequestChannel, payload: unknown): AppFailure | null {
  try {
    checkPayload(channel, payload);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(AppFailure);
    return err as AppFailure;
  }
}

/** `{a: {b: value}}` for the field `a.b`. */
function payloadWith(field: string, value: unknown): Record<string, unknown> {
  return field
    .split('.')
    .reverse()
    .reduce<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}

/** The channels whose payload type is void, written out here apart from the module's own list. */
const TAKE_NOTHING: readonly RequestChannel[] = [
  'settings:get',
  'settings:effective',
  'files:list',
  'files:watching',
  'reviews:index',
  'guidelines:ensure',
  'guidelines:open',
  'guidelines:status',
  'chatgpt:status',
  'chatgpt:cancel-sign-in',
  'chatgpt:sign-out',
  'app:info',
  'app:diagnostics',
  'app:open-notices',
  'update:get',
  'update:check',
  'update:install'
];
const TAKE_SOMETHING = REQUEST_CHANNELS.filter((channel) => !TAKE_NOTHING.includes(channel));

/** Every field that holds a path or a file name main makes into one, written out apart from the module. */
const EXPECTED_PATH_FIELDS: Record<string, readonly string[]> = {
  'settings:set': ['manuscriptFolder', 'reviewsFolder', 'backupsFolder', 'guidelinesPath'],
  'dialog:pick-folder': ['defaultPath'],
  'dialog:pick-file': ['defaultPath'],
  'files:read': ['path'],
  'files:save': ['path'],
  'files:create': ['name'],
  'reviews:list': ['sourcePath'],
  'reviews:load': ['path'],
  'reviews:load-latest': ['sourcePath'],
  'reviews:save': ['path', 'review.sourcePath', 'review.createdAt'],
  'reviews:shown': ['sourcePath', 'path'],
  'shell:reveal': ['sourcePath', 'name'],
  'drafts:load': ['sourcePath'],
  'drafts:save': ['sourcePath'],
  'drafts:set-aside': ['sourcePath'],
  'ai:review': ['sourcePath'],
  'app:guard-state': ['chapter']
};
const PATH_CASES = Object.entries(EXPECTED_PATH_FIELDS).flatMap(([channel, fields]) =>
  fields.map((field) => [channel as RequestChannel, field] as const)
);

class Box {
  path = CHAPTER;
}

describe('the shape of a payload', () => {
  it('takes nothing on exactly the channels whose payload is void', () => {
    expect(REQUEST_CHANNELS.filter(takesNothing)).toEqual(
      REQUEST_CHANNELS.filter((c) => TAKE_NOTHING.includes(c))
    );
    expect(TAKE_NOTHING.every((channel) => REQUEST_CHANNELS.includes(channel))).toBe(true);
  });

  it('lets a channel that takes nothing be sent nothing, and refuses anything else', () => {
    for (const channel of TAKE_NOTHING) {
      expect(refusal(channel, undefined), channel).toBeNull();
      for (const payload of [{}, null, '', 0, false, [], { path: CHAPTER }]) {
        const error = refusal(channel, payload);
        expect(error?.code, `${channel} ${JSON.stringify(payload)}`).toBe('invalid-input');
        expect(error?.message).toBe(
          `The ${channel} request was refused, because it takes nothing and was sent something. Nothing was done.`
        );
      }
    }
  });

  it('refuses anything but a plain object on a channel that takes something', () => {
    const notPlain: unknown[] = [
      undefined,
      null,
      CHAPTER,
      42,
      true,
      [],
      [{ path: CHAPTER }],
      new Date(),
      new Map([['path', CHAPTER]]),
      new Box(),
      Object.create({ path: CHAPTER }) as unknown
    ];
    for (const channel of TAKE_SOMETHING) {
      for (const payload of notPlain) {
        const error = refusal(channel, payload);
        expect(error?.code, `${channel} ${String(payload)}`).toBe('invalid-input');
        expect(error?.message).toBe(
          `The ${channel} request was refused, because what came with it is not the set of values it takes. Nothing was done.`
        );
        expect(error?.message).not.toContain('Novel');
      }
    }
  });

  it('lets a plain object through, made by a literal or with no prototype', () => {
    for (const channel of TAKE_SOMETHING) {
      expect(refusal(channel, {}), channel).toBeNull();
      expect(refusal(channel, Object.create(null)), channel).toBeNull();
    }
    expect(isPlainObject({ path: CHAPTER })).toBe(true);
    expect(isPlainObject(structuredClone({ review: { sourcePath: CHAPTER } }))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Box())).toBe(false);
  });
});

describe('a NUL in a path', () => {
  it('lists the path fields of every channel that names a file', () => {
    expect(PATH_FIELDS).toEqual(EXPECTED_PATH_FIELDS);
    for (const channel of Object.keys(PATH_FIELDS))
      expect(takesNothing(channel as RequestChannel)).toBe(false);
  });

  it.each(PATH_CASES)(
    'is refused in %s %s, naming the channel and the field but not the path',
    (channel, field) => {
      const error = refusal(channel, payloadWith(field, HIDDEN));
      expect(error?.code).toBe('invalid-input');
      expect(error?.message).toBe(
        `The ${channel} request was refused, because its ${field} holds a NUL character, which no path can hold. Nothing was done.`
      );
      expect(error?.message).not.toContain('Novel');
      expect(error?.message).not.toContain(NUL);
      // The same field without the NUL goes through, and so does a NUL anywhere in it.
      expect(refusal(channel, payloadWith(field, CHAPTER))).toBeNull();
      expect(refusal(channel, payloadWith(field, NUL))?.code).toBe('invalid-input');
      expect(refusal(channel, payloadWith(field, `C:\\No${NUL}vel\\Part 1`))?.code).toBe('invalid-input');
    }
  );

  it('is found beside the fields that are fine, whichever path field holds it', () => {
    const fine = { manuscriptFolder: 'C:\\Novel', reviewsFolder: 'D:\\Reviews', theme: 'dark' };
    expect(refusal('settings:set', fine)).toBeNull();
    expect(refusal('settings:set', { ...fine, guidelinesPath: HIDDEN })?.message).toContain('guidelinesPath');
    expect(
      refusal('reviews:save', { path: 'D:\\Reviews\\a.review.json', review: { sourcePath: HIDDEN } })?.message
    ).toContain('review.sourcePath');
    // A review's time names the file a new review is saved in.
    expect(
      refusal('reviews:save', { review: { sourcePath: CHAPTER, createdAt: `2026-10-20T10${NUL}00` } })
        ?.message
    ).toContain('review.createdAt');
  });

  it('reads a nested path as the handler would, through a prototype too', () => {
    const review = Object.create({ sourcePath: HIDDEN }) as unknown;
    expect(refusal('reviews:save', { review })?.message).toContain('review.sourcePath');
  });

  it('leaves a field that is missing, not a string, or not a path to the handler', () => {
    expect(refusal('files:read', {})).toBeNull();
    expect(refusal('files:read', { path: 5 })).toBeNull();
    expect(refusal('files:read', { path: [HIDDEN] })).toBeNull();
    expect(refusal('reviews:save', { review: null })).toBeNull();
    expect(refusal('reviews:save', { review: HIDDEN })).toBeNull();
    // Text may hold anything: a NUL in a chapter, the guidelines or a box is the file's own business.
    expect(refusal('files:save', { path: CHAPTER, text: `It was${NUL} raining.` })).toBeNull();
    expect(refusal('ai:review', { sourcePath: CHAPTER, text: NUL, guidelines: NUL })).toBeNull();
    expect(refusal('drafts:save', { sourcePath: CHAPTER, drafts: [{ text: NUL, initial: NUL }] })).toBeNull();
    // The New chapter dialog's live check answers every name in its own words (checkChapterName).
    expect(refusal('files:check-name', { name: `Chapter${NUL}`, extension: 'md' })).toBeNull();
  });

  it('names only string fields of the payload, which the typecheck holds to', () => {
    const tables: PathFieldTable[] = [
      // @ts-expect-error files:read has no field named folder
      { 'files:read': ['folder'] },
      // @ts-expect-error a review has no field named folder
      { 'reviews:save': ['review.folder'] },
      // @ts-expect-error a review's hunks are not a string
      { 'reviews:save': ['review.hunks'] },
      // @ts-expect-error reviews:shown has no review in it
      { 'reviews:shown': ['review.sourcePath'] },
      // @ts-expect-error settings:get takes nothing, so it has no fields
      { 'settings:get': ['path'] },
      // @ts-expect-error a review is an object, not a path
      { 'reviews:save': ['review'] }
    ];
    expect(tables).toHaveLength(6);
  });
});

describe('runHandler', () => {
  type Line = [LogLevel, string, Readonly<Record<string, unknown>> | undefined];
  const root = mkdtempSync(path.join(os.tmpdir(), 'lapidary-guard-'));
  const chapter = path.join(root, 'Chapter 01 - The Flood.md');
  writeFileSync(chapter, 'It was the third night of rain.\n');
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** A real logger, held in memory, and the calls it was given. */
  function logger(): {
    log: (level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>) => void;
    lines: () => string[];
    calls: Line[];
  } {
    const real = createLogger({
      dir: path.join(root, 'logs'),
      home: os.homedir(),
      schedule: () => undefined
    });
    const calls: Line[] = [];
    return {
      log: (level, event, fields) => {
        calls.push([level, event, fields]);
        real.log(level, event, fields);
      },
      lines: () => real.tail(50),
      calls
    };
  }

  it('never runs the handler for a refused payload, and tells the page and the log why', async () => {
    const { log, lines, calls } = logger();
    const handler = vi.fn(() => Promise.resolve('ran'));
    const answers = [
      await runHandler('files:read', { path: `${chapter}${NUL}.exe` }, handler, log),
      await runHandler('files:read', [chapter], handler, log),
      await runHandler('settings:get', { path: chapter }, handler, log)
    ];
    expect(handler).not.toHaveBeenCalled();
    for (const answer of answers) {
      expect(answer.ok).toBe(false);
      if (!answer.ok) expect(answer.error.code).toBe('invalid-input');
    }
    expect(
      calls.map(([level, event, fields]) => [level, event, fields?.['channel'], fields?.['code']])
    ).toEqual([
      ['warn', 'ipc.failed', 'files:read', 'invalid-input'],
      ['warn', 'ipc.failed', 'files:read', 'invalid-input'],
      ['warn', 'ipc.failed', 'settings:get', 'invalid-input']
    ]);
    const text = lines().join('\n');
    expect(text).toContain(
      'message="The files:read request was refused, because its path holds a NUL character'
    );
    expect(text).not.toContain('Chapter 01');
    expect(text).not.toContain(root);
    expect(text).not.toContain(NUL);
  });

  it('keeps a path with a NUL away from the file system, which would quote it back', async () => {
    const { log, lines } = logger();
    const answer = await runHandler(
      'files:read',
      { path: `${chapter}${NUL}.exe` },
      (payload) => readChapter((payload as { path: string }).path),
      log
    );
    expect(answer).toEqual({
      ok: false,
      error: {
        code: 'invalid-input',
        message:
          'The files:read request was refused, because its path holds a NUL character, which no path can hold. Nothing was done.'
      }
    });
    expect(lines().join('\n')).not.toContain('Chapter 01');
    // The same handler with a clean path reads the chapter.
    const read = await runHandler(
      'files:read',
      { path: chapter },
      (payload) => readChapter((payload as { path: string }).path),
      log
    );
    expect(read.ok && (read.value as { text: string }).text).toBe('It was the third night of rain.');
  });

  it("logs a review's refused payload, though a review's own failure is logged elsewhere", async () => {
    const { log, calls } = logger();
    const handler = vi.fn(() => Promise.reject(new AppFailure('claude-failed', 'Claude Code stopped.')));
    const refused = await runHandler(
      'ai:review',
      { sourcePath: HIDDEN, text: 'It was raining.' },
      handler,
      log
    );
    expect(handler).not.toHaveBeenCalled();
    expect(refused.ok).toBe(false);
    expect(calls).toEqual([
      [
        'warn',
        'ipc.failed',
        {
          channel: 'ai:review',
          code: 'invalid-input',
          message:
            'The ai:review request was refused, because its sourcePath holds a NUL character, which no path can hold. Nothing was done.'
        }
      ]
    ]);
    const failed = await runHandler(
      'ai:review',
      { sourcePath: CHAPTER, text: 'It was raining.' },
      handler,
      log
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(failed).toEqual({ ok: false, error: { code: 'claude-failed', message: 'Claude Code stopped.' } });
    expect(calls).toHaveLength(1);
  });

  it('hands the handler the payload it was sent, once', async () => {
    const { log, calls } = logger();
    const payload = { path: chapter };
    const handler = vi.fn((p: unknown) => Promise.resolve(p));
    expect(await runHandler('files:read', payload, handler, log)).toEqual({ ok: true, value: payload });
    expect(handler).toHaveBeenCalledExactlyOnceWith(payload);
    const nothing = vi.fn(() => Promise.resolve(1));
    expect(await runHandler('files:list', undefined, nothing, log)).toEqual({ ok: true, value: 1 });
    expect(nothing).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });
});
