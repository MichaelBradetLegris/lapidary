import { z } from 'zod';
import { CHANGE_CATEGORIES, COMMENT_CATEGORIES } from '../types';

/**
 * What Claude must return. Kept deliberately shallow: the SDK validates the
 * model's output against the JSON Schema below and retries on a mismatch, and
 * shallow schemas retry far less often.
 */
export const ChangeSchema = z.object({
  paragraph: z
    .int()
    .min(0)
    .describe('Number of the paragraph this change belongs to, as shown in square brackets.'),
  before: z
    .string()
    .min(1)
    .describe('Text copied verbatim from that paragraph. The shortest span that is unique in it.'),
  after: z.string().describe('Replacement text. An empty string deletes the quoted span.'),
  category: z.enum(CHANGE_CATEGORIES),
  reason: z.string().max(240).describe('One short sentence saying what is wrong.')
});

export const CommentSchema = z.object({
  paragraph: z
    .int()
    .min(0)
    .nullable()
    .describe(
      'Number of the paragraph the comment is about, as shown in square brackets, or null for the chapter.'
    ),
  quote: z.string().max(200).optional().describe('Short excerpt the comment refers to.'),
  category: z.enum(COMMENT_CATEGORIES),
  text: z.string().max(1200)
});

export const ReviewOutputSchema = z.object({
  changes: z.array(ChangeSchema),
  comments: z.array(CommentSchema)
});

export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** Draft-07 JSON Schema for the SDK's `outputFormat` option. */
export const reviewOutputJsonSchema: Record<string, unknown> = z.toJSONSchema(ReviewOutputSchema, {
  target: 'draft-07'
});

export interface ParseResult {
  ok: boolean;
  value?: ReviewOutput;
  problem?: string;
}

/** Validate whatever the SDK handed back in `structured_output`. */
export function parseReviewOutput(raw: unknown): ParseResult {
  const parsed = ReviewOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const first = parsed.error.issues[0];
  const where = first ? first.path.join('.') : '';
  const problem = first ? `${where ? `${where}: ` : ''}${first.message}` : 'did not match the schema';
  return { ok: false, problem };
}
