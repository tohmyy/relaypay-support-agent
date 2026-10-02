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

/** The signed-in customer a conversation is linked to, as the server knows it (never taken from the model). */
export interface CallerIdentity {
  customerId: string;
  userId: string | null;
  /** Account display name and email, for contact fields. Null if the account row could not be read. */
  name: string | null;
  email: string | null;
}

export interface ToolContext {
  /**
   * Set by `executeTool` for account-scoped tools once the conversation's link has been read: the signed-in customer,
   * or null when the conversation is not linked.
   */
  identity?: CallerIdentity | null;
  /** Refuse account-scoped tools for a conversation that is not linked to a signed-in customer (production). */
  requireIdentity?: boolean;
  /** Conversation id supplied by the caller (for example the X-Conversation-Id header). */
  conversationId?: string;
  /**
   * Write the tool_calls row after the result has been returned instead of before. The row is observability, so the
   * model does not wait for its two database writes. Off by default (tests read the row straight after the call).
   */
  background?: boolean;
}

const pendingRecords = new Set<Promise<void>>();

/** Waits for tool-call rows still being written in the background (used on shutdown and in tests). */
export async function flushToolRecords(): Promise<void> {
  await Promise.all([...pendingRecords]);
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
      let runCtx = ctx;
      if (tool.accountScoped) {
        // Who is this conversation for? Read from the database, never from the model's arguments. A failed read fails
        // closed (the tool errors) rather than falling back to an unscoped lookup.
        const identity = conversationId ? await resolveIdentity(store, conversationId) : null;
        if (!identity && ctx.requireIdentity) {
          throw new ToolError(
            'not_authorized',
            'This conversation is not linked to a signed-in customer, so account information cannot be looked up. Tell the customer to sign in and start a new conversation.',
          );
        }
        runCtx = { ...ctx, identity };
      }
      result = await tool.run(parsed.data, store, runCtx);
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

  const recorded = recordCall(
    tool,
    rawInput,
    result,
    technicalError,
    conversationId,
    store,
    Date.now() - startedAt,
  );
  if (ctx.background) {
    // recordCall never rejects, so the set cannot hold a failing promise.
    pendingRecords.add(recorded);
    void recorded.finally(() => pendingRecords.delete(recorded));
  } else {
    await recorded;
  }
  return result;
}

/** Reads the link the web app wrote onto the conversation, plus the account's name and email. */
export async function resolveIdentity(store: Store, conversationId: string): Promise<CallerIdentity | null> {
  const link = await store.getConversationIdentity(conversationId);
  if (!link?.customer_id) return null;
  const user = link.user_id ? await store.getAppUser(link.user_id) : null;
  return {
    customerId: link.customer_id,
    userId: link.user_id,
    name: user?.display_name ?? null,
    email: user?.email ?? null,
  };
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
