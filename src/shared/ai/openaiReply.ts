/**
 * The OpenAI reply, both ways: the strict JSON Schema sent with the request and
 * the parsing of what comes back. Main-process only in practice, because it
 * carries the zod schema; kept in src/shared so it is pure and unit-tested
 * (CLAUDE.md rule 4).
 */

import { parseReviewOutput, reviewOutputJsonSchema, type ParseResult } from '../prompt/schema';

/* ------------------------------------------------------------------ */
/* Strict JSON Schema                                                  */
/* ------------------------------------------------------------------ */

const DROPPED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'default'
]);

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `{type: 'string'}` becomes `{type: ['string','null']}`; a union gains a null branch. */
function nullable(schema: Json): Json {
  const type = schema['type'];
  if (typeof type === 'string') return { ...schema, type: [type, 'null'] };
  if (Array.isArray(type)) {
    const types = type as unknown[];
    return types.includes('null') ? schema : { ...schema, type: [...types, 'null'] };
  }
  if (Array.isArray(schema['anyOf'])) {
    const branches = schema['anyOf'] as unknown[];
    const hasNull = branches.some((b) => isObject(b) && b['type'] === 'null');
    return hasNull ? schema : { ...schema, anyOf: [...branches, { type: 'null' }] };
  }
  return { ...schema, anyOf: [schema, { type: 'null' }] };
}

/**
 * Rewrite a JSON Schema into the subset OpenAI's strict structured outputs
 * accepts.
 *
 * Three rules do the work. Every object must list all of its properties in
 * `required` and set `additionalProperties: false`; a property that was optional
 * becomes required and nullable instead, which is the documented way to say
 * "may be absent". Keywords strict mode does not support are dropped rather than
 * sent and rejected: the zod schema still validates the reply on the way back,
 * so nothing is actually lost.
 */
export function toStrictJsonSchema(schema: unknown): Json {
  if (!isObject(schema)) return {};
  const out: Json = {};

  for (const [key, value] of Object.entries(schema)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    if (key === 'properties' || key === '$defs' || key === 'definitions') continue;
    if (key === 'required') continue;
    if (key === 'items') {
      out['items'] = Array.isArray(value) ? value.map(toStrictJsonSchema) : toStrictJsonSchema(value);
      continue;
    }
    if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      out[key] = Array.isArray(value) ? value.map(toStrictJsonSchema) : value;
      continue;
    }
    out[key] = value;
  }

  for (const bag of ['$defs', 'definitions'] as const) {
    const defs = schema[bag];
    if (!isObject(defs)) continue;
    out[bag] = Object.fromEntries(Object.entries(defs).map(([k, v]) => [k, toStrictJsonSchema(v)]));
  }

  const properties = schema['properties'];
  if (isObject(properties)) {
    const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
    const rewritten: Json = {};
    for (const [name, child] of Object.entries(properties)) {
      const strict = toStrictJsonSchema(child);
      rewritten[name] = required.has(name) ? strict : nullable(strict);
    }
    out['properties'] = rewritten;
    out['required'] = Object.keys(properties);
    out['additionalProperties'] = false;
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Parsing the reply                                                   */
/* ------------------------------------------------------------------ */

/**
 * A strict schema turns every optional field into a nullable one, so the model
 * answers `"quote": null` where the zod schema expects the key to be absent.
 * This undoes exactly that, guided by the original schema: a null is dropped
 * only where the original did not list the property as required. A null the
 * original allows on a required property, such as a comment's
 * `"paragraph": null` ("about the whole chapter"), is kept.
 */
export function stripOptionalNulls(value: unknown, schema: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) return value.map((item) => stripOptionalNulls(item, schema['items']));
  if (!isObject(value)) return value;
  const properties = schema['properties'];
  if (!isObject(properties)) return value;
  const required = new Set(Array.isArray(schema['required']) ? (schema['required'] as string[]) : []);
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && !required.has(key)) continue;
    out[key] = stripOptionalNulls(child, properties[key]);
  }
  return out;
}

export interface OpenAiParse extends ParseResult {
  /** the object handed to the zod schema, kept for Review.raw */
  raw?: unknown;
}

/**
 * Turn the model's text into a review output. Two things can go wrong and they
 * need different messages: the text is not JSON at all, or it is JSON of the
 * wrong shape.
 */
export function parseOpenAiText(text: string): OpenAiParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: false, problem: 'the reply was empty' };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, problem: `the reply was not JSON: ${detail}` };
  }

  // `raw` keeps exactly what the model sent; only the validated copy is tidied.
  return { ...parseReviewOutput(stripOptionalNulls(json, reviewOutputJsonSchema)), raw: json };
}
