import type { RequestChannel, RequestPayload } from '../shared/ipc';
import { hasNul } from '../shared/paths';
import { fail } from './errors';

/**
 * What every request from the page must look like before its handler runs
 * (hardening.8). The page is the app's own, so a request that fails here is
 * a fault in it, but main does not take its word: a channel that takes
 * nothing is sent nothing, any other is sent a plain object (what the page's
 * object literal becomes once it has crossed), and no path in it holds a NUL
 * character, which no file system takes and which a native call could read
 * as the end of the path. `runHandler` (ipcEnvelope.ts) asks this first, so a
 * refusal reaches the page as an `invalid-input` failure and is logged as
 * `ipc.failed`, for `ai:review` too.
 *
 * The refusal names the channel and the field, never the value, since the
 * log keeps an app error's message and a path names the author's files.
 *
 * No electron import, so test/main/ipcGuard.test.ts drives it.
 */

/** The channels whose payload type is `void`. */
type ChannelTakingNothing = {
  [C in RequestChannel]: RequestPayload<C> extends void ? C : never;
}[RequestChannel];

/**
 * Every channel that takes nothing, written as a map so the compiler insists
 * on exactly those: a channel left out, or one that takes something listed,
 * fails the typecheck.
 */
const TAKES_NOTHING = {
  'settings:get': true,
  'settings:effective': true,
  'files:list': true,
  'files:watching': true,
  'reviews:index': true,
  'guidelines:ensure': true,
  'guidelines:open': true,
  'guidelines:status': true,
  'secrets:openai-status': true,
  'secrets:openai-clear': true,
  'chatgpt:status': true,
  'chatgpt:cancel-sign-in': true,
  'chatgpt:sign-out': true,
  'app:info': true,
  'app:diagnostics': true,
  'app:open-notices': true,
  'update:get': true,
  'update:check': true,
  'update:install': true
} as const satisfies Record<ChannelTakingNothing, true>;

export function takesNothing(channel: RequestChannel): boolean {
  return Object.hasOwn(TAKES_NOTHING, channel);
}

type StringKeys<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends string ? K : never;
}[keyof T & string];

type ObjectKeys<T> = {
  [K in keyof T & string]-?: NonNullable<T[K]> extends readonly unknown[]
    ? never
    : NonNullable<T[K]> extends object
      ? K
      : never;
}[keyof T & string];

/** A payload's string fields, and its objects' string fields as `outer.inner`. */
type StringField<T> =
  StringKeys<T> | { [K in ObjectKeys<T>]: `${K}.${StringKeys<NonNullable<T[K]>>}` }[ObjectKeys<T>];

/** For each channel, some of its payload's string fields, as `StringField` names them. */
export type PathFieldTable = { readonly [C in RequestChannel]?: readonly StringField<RequestPayload<C>>[] };

/**
 * The fields that hold a path, or a file name main makes into one, channel by
 * channel: a review's `createdAt` names the file a new review is saved in
 * (`newEntryPath` in reviews.ts). The names are checked against the payload
 * types, so a field that is renamed or is not a string fails the typecheck.
 * `files:check-name` is left out on purpose: it answers any name typed in the
 * New chapter dialog with words of its own, a NUL included ("A file name
 * cannot contain ...").
 */
export const PATH_FIELDS: PathFieldTable = {
  'settings:set': ['manuscriptFolder', 'reviewsFolder', 'guidelinesPath'],
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

/** An object made by `{}` or `Object.create(null)`: not an array, a Date, a Map or a class's instance. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The value at `outer.inner`, read as the handler reads it; undefined when an object on the way is missing. */
function fieldValue(payload: object, field: string): unknown {
  let value: unknown = payload;
  for (const key of field.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Throws an `invalid-input` failure unless `payload` is what `channel` may be
 * sent: nothing for a channel that takes nothing, else a plain object with no
 * NUL in a path field. A path field that is missing or not a string is left
 * for the handler, which refuses it in its own words.
 */
export function checkPayload(channel: RequestChannel, payload: unknown): void {
  if (takesNothing(channel)) {
    if (payload !== undefined) {
      throw fail(
        'invalid-input',
        `The ${channel} request was refused, because it takes nothing and was sent something. Nothing was done.`
      );
    }
    return;
  }
  if (!isPlainObject(payload)) {
    throw fail(
      'invalid-input',
      `The ${channel} request was refused, because what came with it is not the set of values it takes. Nothing was done.`
    );
  }
  for (const field of (PATH_FIELDS[channel] ?? []) as readonly string[]) {
    const value = fieldValue(payload, field);
    if (typeof value === 'string' && hasNul(value)) {
      throw fail(
        'invalid-input',
        `The ${channel} request was refused, because its ${field} holds a NUL character, which no path can hold. Nothing was done.`
      );
    }
  }
}
