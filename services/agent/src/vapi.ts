import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureConversation } from './history';
import { callEndedMetadata, recordError } from './observability';
import { endReasonFromVapi } from './session/end-reason';
import { endConversation } from './session/persist';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_SUMMARY_CHARS = 1000;

export const SLOW_FILLER = 'One moment while I check that. ';
export const SAFE_SPOKEN_ERROR =
  "I'm having trouble right now. Let me pass this to a specialist who can follow up with you.";

interface ChatBody {
  messages?: { role?: string; content?: unknown }[];
  metadata?: { conversation_id?: unknown } | null;
  call?: CallInfo | null;
  stream?: unknown;
}
interface CallInfo {
  id?: unknown;
  metadata?: { conversation_id?: unknown } | null;
}

/** Text of an OpenAI-style message content: a string, or an array of {type:'text', text} parts. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '',
      )
      .join('');
  }
  return '';
}

/** The customer's latest utterance: the last non-empty `user` message. */
export function extractUserMessage(body: ChatBody): string | undefined {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    const text = contentText(messages[i].content).trim();
    if (text) return text;
  }
  return undefined;
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

/**
 * Conversation id for a call. An id the application tagged the call with wins (metadata.conversation_id);
 * otherwise Vapi's own call id (prefixed `vapi_`); otherwise the X-Conversation-Id header.
 * Anything that does not match the allowed pattern is ignored.
 */
export function resolveConversationId(input: {
  metadata?: { conversation_id?: unknown } | null;
  call?: CallInfo | null;
  header?: string | string[];
}): string | undefined {
  const fromMetadata =
    clean(input.metadata?.conversation_id) ?? clean(input.call?.metadata?.conversation_id);
  if (fromMetadata) return fromMetadata;
  const callId = clean(input.call?.id);
  if (callId) return `vapi_${callId}`.slice(0, 64);
  return clean(Array.isArray(input.header) ? input.header[0] : input.header);
}

/** Vapi's own call id from a chat body, when present (used to hang up the call). */
export function extractCallId(body: ChatBody): string | undefined {
  return clean(body.call?.id);
}

export function resolveFromChatBody(body: ChatBody, header?: string | string[]) {
  return resolveConversationId({ metadata: body.metadata, call: body.call, header });
}

// --- OpenAI-compatible response shapes ---

const MODEL_NAME = 'relaypay-support-agent';

export function completionJson(id: string, content: string) {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: MODEL_NAME,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
}

export function sseChunk(
  id: string,
  delta: { role?: 'assistant'; content?: string },
  finish?: 'stop',
) {
  const payload = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL_NAME,
    choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = 'data: [DONE]\n\n';

// --- Vapi server-message webhook ---

export interface VapiEventResult {
  handled: boolean;
  conversationId?: string;
  finalStatus?: string;
}

/**
 * Keeps conversation lifecycle in sync with the call: a started call gets a conversation row; an ended call gets
 * `ended_at`, a final status (an escalated call stays escalated) and Vapi's summary when present.
 * Unknown message types are acknowledged and ignored.
 */
export async function handleVapiEvent(
  db: SupabaseClient,
  payload: unknown,
): Promise<VapiEventResult> {
  const message = (payload as { message?: Record<string, unknown> } | null)?.message;
  if (!message || typeof message.type !== 'string') return { handled: false };

  const call = (message.call ?? null) as CallInfo | null;
  const conversationId = resolveConversationId({ call });
  if (!conversationId) return { handled: false };

  try {
    return await handleResolved(db, message, conversationId);
  } catch (error) {
    await recordError(db, conversationId, 'vapi.webhook', error);
    throw error;
  }
}

async function handleResolved(
  db: SupabaseClient,
  message: Record<string, unknown>,
  conversationId: string,
): Promise<VapiEventResult> {
  if (message.type === 'status-update') {
    if (message.status === 'in-progress') await ensureConversation(db, conversationId);
    return { handled: true, conversationId };
  }

  if (message.type === 'end-of-call-report') {
    await ensureConversation(db, conversationId);
    const summary =
      typeof message.summary === 'string' ? message.summary.slice(0, MAX_SUMMARY_CHARS) : undefined;
    // First reason wins: a controller-initiated end (silence, time limit, "that's all") is already recorded.
    const { finalStatus } = await endConversation(
      db,
      conversationId,
      endReasonFromVapi(message.endedReason) ?? null,
      { summary },
    );
    // How the call ended: whitelisted fields only, nothing from the transcript.
    const ended = await db.from('conversation_events').insert({
      conversation_id: conversationId,
      event_type: 'call_ended',
      summary: `call ended (${finalStatus})`,
      metadata: callEndedMetadata(message),
    });
    if (ended.error) throw new Error(`record call end: ${ended.error.message}`);
    return { handled: true, conversationId, finalStatus };
  }

  // speech-update carries no state of its own; the Session Controller consumes it (server.ts).
  if (message.type === 'speech-update') return { handled: true, conversationId };

  return { handled: false, conversationId };
}
