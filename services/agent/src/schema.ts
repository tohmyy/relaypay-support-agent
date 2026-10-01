import { z } from 'zod';

export const ANSWER_TYPES = [
  'direct_answer',
  'clarification',
  'escalation',
  'decline',
  'tool_result',
] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const answerSchema = z.object({
  answer_type: z.enum(ANSWER_TYPES),
  spoken_response: z.string().min(1),
  confidence_note: z.string().optional(),
});
export type Answer = z.infer<typeof answerSchema>;

/** JSON schema handed to the SDK as the structured output format. */
// The CLI's validator rejects the `$schema` draft URI zod emits, so it is dropped.
const { $schema: _draft, ...schemaBody } = z.toJSONSchema(answerSchema) as Record<string, unknown>;
export const answerJsonSchema: Record<string, unknown> = schemaBody;

export const SAFE_DECLINE =
  "I'm sorry, I'm not able to help with that right now. I can pass this to a specialist who can follow up with you.";

/**
 * Reads the model's answer: SDK structured output first, then JSON in the reply text.
 * Anything unparseable becomes a safe decline, never raw model output.
 */
export function parseAnswer(structured: unknown, text: string | undefined): Answer {
  const candidates: unknown[] = [structured];
  if (text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
    for (const raw of [fenced, text.trim()]) {
      if (!raw) continue;
      try {
        candidates.push(JSON.parse(raw));
      } catch {
        // try the next candidate
      }
    }
  }
  for (const c of candidates) {
    const parsed = answerSchema.safeParse(c);
    if (parsed.success) return parsed.data;
  }
  return {
    answer_type: 'decline',
    spoken_response: SAFE_DECLINE,
    confidence_note: 'unparseable model output',
  };
}
