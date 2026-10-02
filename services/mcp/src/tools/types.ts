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
  /**
   * Reads or writes one customer's account. Always scoped to the signed-in customer the conversation is linked to; a
   * conversation that is not linked, or whose account has no name or email, is refused before the tool runs.
   */
  accountScoped?: boolean;
  /** Creates records. Refused without a linked account even where a read-only tool may run unlinked (`allowUnlinked`). */
  mutates?: boolean;
  run(input: I, store: Store, ctx: ToolContext): Promise<Record<string, unknown>>;
  /** Conversation id to attach to the tool_calls log row, when the input carries one. */
  conversationId?(input: I): string | undefined;
}
