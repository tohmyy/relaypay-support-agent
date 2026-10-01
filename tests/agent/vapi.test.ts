import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  completionJson,
  extractUserMessage,
  handleVapiEvent,
  resolveConversationId,
  sseChunk,
  SSE_DONE,
} from '../../services/agent/src/vapi';

describe('extractUserMessage', () => {
  it('takes the last non-empty user message', () => {
    expect(
      extractUserMessage({
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: '  check TXN-9001  ' },
          { role: 'assistant', content: '' },
        ],
      }),
    ).toBe('check TXN-9001');
  });

  it('accepts array content parts and skips empty user turns', () => {
    expect(
      extractUserMessage({
        messages: [
          { role: 'user', content: 'real' },
          { role: 'user', content: [{ type: 'text', text: 'from ' }, { type: 'text', text: 'parts' }] },
          { role: 'user', content: '   ' },
        ],
      }),
    ).toBe('from parts');
  });

  it('returns undefined when there is no customer speech', () => {
    expect(extractUserMessage({ messages: [{ role: 'system', content: 'x' }] })).toBeUndefined();
    expect(extractUserMessage({})).toBeUndefined();
  });
});

describe('resolveConversationId', () => {
  it('prefers an application-supplied id, then the call id, then the header', () => {
    expect(resolveConversationId({ metadata: { conversation_id: 'conv_abc' }, call: { id: 'call1' } })).toBe('conv_abc');
    expect(resolveConversationId({ call: { id: 'c1', metadata: { conversation_id: 'conv_from_call' } } })).toBe('conv_from_call');
    expect(resolveConversationId({ call: { id: 'c-123' } })).toBe('vapi_c-123');
    expect(resolveConversationId({ header: 'hdr_1' })).toBe('hdr_1');
    expect(resolveConversationId({ header: ['first', 'second'] })).toBe('first');
  });

  it('ignores ids with unsafe characters or excess length', () => {
    expect(resolveConversationId({ metadata: { conversation_id: 'bad id!' }, call: { id: "x'; drop" } })).toBeUndefined();
    expect(resolveConversationId({ metadata: { conversation_id: 'x'.repeat(65) } })).toBeUndefined();
    expect(resolveConversationId({ call: { id: 42 } })).toBeUndefined();
    expect(resolveConversationId({})).toBeUndefined();
  });

  it('keeps prefixed call ids within 64 characters', () => {
    const id = resolveConversationId({ call: { id: 'a'.repeat(60) } })!;
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith('vapi_')).toBe(true);
  });
});

describe('response shapes', () => {
  it('builds an OpenAI chat completion', () => {
    const r = completionJson('id1', 'Hello there');
    expect(r).toMatchObject({ object: 'chat.completion', choices: [{ message: { role: 'assistant', content: 'Hello there' }, finish_reason: 'stop' }] });
  });

  it('builds SSE chunks that parse as JSON and end with [DONE]', () => {
    const chunk = sseChunk('id1', { content: 'Hi' });
    expect(chunk.startsWith('data: ')).toBe(true);
    expect(chunk.endsWith('\n\n')).toBe(true);
    const parsed = JSON.parse(chunk.slice(6));
    expect(parsed).toMatchObject({ object: 'chat.completion.chunk', choices: [{ delta: { content: 'Hi' }, finish_reason: null }] });
    expect(JSON.parse(sseChunk('id1', {}, 'stop').slice(6)).choices[0].finish_reason).toBe('stop');
    expect(SSE_DONE).toBe('data: [DONE]\n\n');
  });
});

/** Tiny in-memory supabase stand-in for conversations and turns. */
function fakeDb(initial: { final_status?: string | null; turns?: number; failUpdate?: boolean } = {}) {
  const conversations: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const turnCount = initial.turns ?? 0;
  const from = (table: string) => {
    let filter: [string, unknown] | undefined;
    const b: Record<string, unknown> = {
      upsert(row: Record<string, unknown>) {
        if (!conversations.some((c) => c.conversation_id === row.conversation_id)) {
          conversations.push({ ...row, final_status: initial.final_status ?? null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Record<string, unknown>) {
        events.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      select() {
        return b;
      },
      eq(col: string, value: unknown) {
        filter = [col, value];
        return b;
      },
      update(patch: Record<string, unknown>) {
        return {
          eq: (col: string, value: unknown) => {
            if (initial.failUpdate) return Promise.resolve({ error: { message: 'boom at db.internal user a@b.co' } });
            conversations.filter((c) => c[col] === value).forEach((c) => Object.assign(c, patch));
            return Promise.resolve({ error: null });
          },
        };
      },
      then(resolve: (v: unknown) => void) {
        if (table === 'conversations') {
          resolve({ data: conversations.filter((c) => !filter || c[filter[0]] === filter[1]), error: null });
        } else {
          resolve({ data: Array.from({ length: turnCount }, (_, i) => ({ turn_number: i + 1 })), error: null });
        }
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, conversations, events };
}

describe('handleVapiEvent', () => {
  const report = (extra: Record<string, unknown> = {}) => ({
    message: { type: 'end-of-call-report', call: { id: 'call9' }, ...extra },
  });

  it('creates a conversation when a call starts', async () => {
    const { db, conversations } = fakeDb();
    const r = await handleVapiEvent(db, { message: { type: 'status-update', status: 'in-progress', call: { id: 'call9' } } });
    expect(r).toMatchObject({ handled: true, conversationId: 'vapi_call9' });
    expect(conversations).toHaveLength(1);
  });

  it('ends a call with turns as resolved and stores a truncated summary', async () => {
    const { db, conversations } = fakeDb({ turns: 2 });
    const r = await handleVapiEvent(db, report({ summary: 'x'.repeat(5000) }));
    expect(r.finalStatus).toBe('resolved');
    expect(conversations[0].ended_at).toBeTruthy();
    expect((conversations[0].summary as string).length).toBe(1000);
  });

  it('records how the call ended using whitelisted fields only', async () => {
    const { db, events } = fakeDb({ turns: 1 });
    await handleVapiEvent(
      db,
      report({
        endedReason: 'customer-ended-call',
        durationSeconds: 61.23456,
        cost: 0.4321,
        transcript: 'my email is secret@example.com',
        artifact: { messages: ['private'] },
      }),
    );
    const ended = events.find((e) => e.event_type === 'call_ended')!;
    expect(ended).toMatchObject({
      conversation_id: 'vapi_call9',
      metadata: { endedReason: 'customer-ended-call', durationSeconds: 61.235, cost: 0.432 },
    });
    expect(JSON.stringify(ended)).not.toMatch(/secret|private|transcript/);
  });

  it('records an error event, scrubbed, when handling a call event fails', async () => {
    const { db, events } = fakeDb({ turns: 1, failUpdate: true });
    await expect(handleVapiEvent(db, report())).rejects.toThrow(/end conversation/);
    const err = events.find((e) => e.event_type === 'error')!;
    expect(err).toMatchObject({ conversation_id: 'vapi_call9', metadata: { source: 'vapi.webhook' } });
    expect(JSON.stringify(err)).not.toContain('a@b.co');
    expect(JSON.stringify(err)).toContain('[email]');
  });

  it('ends a call with no turns as abandoned', async () => {
    const { db } = fakeDb({ turns: 0 });
    expect((await handleVapiEvent(db, report())).finalStatus).toBe('abandoned');
  });

  it('keeps an escalated call escalated', async () => {
    const { db } = fakeDb({ turns: 3, final_status: 'escalated' });
    expect((await handleVapiEvent(db, report())).finalStatus).toBe('escalated');
  });

  it('ignores unknown, malformed and id-less messages', async () => {
    const { db, conversations } = fakeDb();
    expect((await handleVapiEvent(db, { message: { type: 'speech-update', call: { id: 'c' } } })).handled).toBe(false);
    expect((await handleVapiEvent(db, {})).handled).toBe(false);
    expect((await handleVapiEvent(db, null)).handled).toBe(false);
    expect((await handleVapiEvent(db, { message: { type: 'end-of-call-report' } })).handled).toBe(false);
    expect(conversations).toHaveLength(0);
  });
});
