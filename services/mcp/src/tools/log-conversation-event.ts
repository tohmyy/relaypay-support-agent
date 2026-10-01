import { z } from 'zod';
import { ToolError } from '../utils/errors';
import { logConversationEventSchema } from '../validation/schemas';
import type { ToolDef } from './types';

const SECRET_KEY = /token|key|password|secret|authorization|cookie/i;
const MAX_METADATA_BYTES = 4096;

/** Drops secret-looking keys at any depth. */
export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SECRET_KEY.test(k))
        .map(([k, v]) => [k, sanitizeMetadata(v)]),
    );
  }
  return value;
}

export const logConversationEvent: ToolDef<z.infer<typeof logConversationEventSchema>> = {
  name: 'log_conversation_event',
  purpose: 'Record an important agent action or decision',
  summarize: () => 'event logged',
  description:
    'Record an important agent action or decision. Requires conversation_id, event_type and summary. ' +
    'Do not put personal data or secrets in metadata.',
  shape: {
    conversation_id: z.string().optional(),
    event_type: z.string().optional().describe('e.g. escalation_triggered'),
    summary: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  },
  schema: logConversationEventSchema,
  conversationId: (i) => i.conversation_id,
  async run(input, store) {
    const metadata = sanitizeMetadata(input.metadata) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES) {
      throw new ToolError('invalid_input', `metadata must be under ${MAX_METADATA_BYTES} bytes.`);
    }
    await store.ensureConversation(input.conversation_id);
    await store.insertEvent({ ...input, metadata });
    return { logged: true };
  },
};
