import type { Store } from '../db/store';
import {
  errorResult,
  SAFE_UNAVAILABLE,
  ToolError,
  type ToolErrorResult,
} from '../utils/errors';
import { logTechnical, summarizeInput } from '../utils/logging';
import { createEscalation } from './create-escalation';
import { createSupportTicket } from './create-support-ticket';
import { logConversationEvent } from './log-conversation-event';
import { lookupCustomer } from './lookup-customer';
import { lookupPayout } from './lookup-payout';
import { lookupTransaction } from './lookup-transaction';
import type { ToolDef } from './types';

export const tools: ToolDef<never>[] = [
  lookupCustomer,
  lookupTransaction,
  lookupPayout,
  createSupportTicket,
  createEscalation,
  logConversationEvent,
] as unknown as ToolDef<never>[];

export type ToolResult = Record<string, unknown> | ToolErrorResult;

export function isErrorResult(r: ToolResult): r is ToolErrorResult {
  return 'error' in r && typeof r.error === 'object';
}

export interface ToolContext {
  /** Conversation id supplied by the caller (for example the X-Conversation-Id header). */
  conversationId?: string;
}

/** validate -> execute -> normalize -> log -> return. Never throws and never leaks raw errors. */
export async function executeTool(
  tool: ToolDef<never>,
  rawInput: unknown,
  store: Store,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  let result: ToolResult;
  let technicalError: string | null = null;
  // The tool input's own conversation id wins; otherwise fall back to the request context.
  let conversationId: string | undefined = ctx.conversationId;

  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    result = errorResult('invalid_input', message);
  } else {
    conversationId = tool.conversationId?.(parsed.data) ?? ctx.conversationId;
    try {
      result = await tool.run(parsed.data, store, ctx);
    } catch (error) {
      if (error instanceof ToolError) {
        result = errorResult(error.code, error.message);
      } else {
        technicalError = error instanceof Error ? error.message : String(error);
        logTechnical(`${tool.name} failed`, error);
        result = errorResult('temporarily_unavailable', SAFE_UNAVAILABLE);
      }
    }
  }

  await recordCall(tool, rawInput, result, technicalError, conversationId, store);
  return result;
}

async function recordCall(
  tool: ToolDef<never>,
  rawInput: unknown,
  result: ToolResult,
  technicalError: string | null,
  conversationId: string | undefined,
  store: Store,
) {
  const failed = isErrorResult(result);
  const notFound = !failed && result.found === false;
  try {
    // tool_calls.conversation_id is a foreign key; only set it after the row exists.
    if (conversationId) await store.ensureConversation(conversationId);
    await store.recordToolCall({
      conversation_id: conversationId ?? null,
      tool_name: tool.name,
      input_summary: summarizeInput(rawInput),
      result_summary: failed ? `error: ${result.error.code}` : notFound ? 'not found' : 'ok',
      status: failed ? 'failed' : notFound ? 'not_found' : 'success',
      error: technicalError,
    });
  } catch (error) {
    logTechnical(`could not record tool call ${tool.name}`, error);
  }
}
