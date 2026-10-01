import type { Store } from '../db/store';
import { errorResult, SAFE_UNAVAILABLE, ToolError, type ToolErrorResult } from '../utils/errors';
import { logTechnical, summarizeInput } from '../utils/logging';
import { redactPii } from '../utils/redact';
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
  const startedAt = Date.now();
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
        logTechnical(`${tool.name} failed`, error, { conversation_id: conversationId });
        result = errorResult('temporarily_unavailable', SAFE_UNAVAILABLE);
      }
    }
  }

  await recordCall(
    tool,
    rawInput,
    result,
    technicalError,
    conversationId,
    store,
    Date.now() - startedAt,
  );
  return result;
}

async function recordCall(
  tool: ToolDef<never>,
  rawInput: unknown,
  result: ToolResult,
  technicalError: string | null,
  conversationId: string | undefined,
  store: Store,
  durationMs: number,
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
      purpose: tool.purpose,
      duration_ms: durationMs,
      result_summary: failed ? `error: ${result.error.code}` : safeSummary(tool, result),
      status: failed ? 'failed' : notFound ? 'not_found' : 'success',
      error: technicalError ? redactPii(technicalError).slice(0, 500) : null,
    });
  } catch (error) {
    logTechnical(`could not record tool call ${tool.name}`, error);
  }
}

/** The tool's own summary, with a safe fallback if it ever throws. */
function safeSummary(tool: ToolDef<never>, result: ToolResult): string {
  try {
    return tool.summarize(result as Record<string, unknown>).slice(0, 200);
  } catch {
    return 'ok';
  }
}
