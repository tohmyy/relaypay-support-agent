import type { ZodType } from 'zod';
import type { Store } from '../db/store';
import type { ToolContext } from './index';

export interface ToolDef<I = unknown> {
  name: string;
  /** Why this tool exists, written to tool_calls.purpose. Fixed text, never built from input. */
  purpose: string;
  /** Safe one-line summary of a result for tool_calls.result_summary: ids and statuses only. */
  summarize(result: Record<string, unknown>): string;
  description: string;
  /** Advertised to the model. Loose on purpose: `schema` is the authority and returns structured errors. */
  shape: Record<string, ZodType>;
  schema: ZodType<I>;
  run(input: I, store: Store, ctx: ToolContext): Promise<Record<string, unknown>>;
  /** Conversation id to attach to the tool_calls log row, when the input carries one. */
  conversationId?(input: I): string | undefined;
}
