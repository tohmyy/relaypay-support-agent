import type { ZodType } from 'zod';
import type { Store } from '../db/store';
import type { ToolContext } from './index';

export interface ToolDef<I = unknown> {
  name: string;
  description: string;
  /** Advertised to the model. Loose on purpose: `schema` is the authority and returns structured errors. */
  shape: Record<string, ZodType>;
  schema: ZodType<I>;
  run(input: I, store: Store, ctx: ToolContext): Promise<Record<string, unknown>>;
  /** Conversation id to attach to the tool_calls log row, when the input carries one. */
  conversationId?(input: I): string | undefined;
}
