import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMessage, logEvent, safeFields } from '../../services/agent/src/logger';
import { callEndedMetadata, recordError } from '../../services/agent/src/observability';
import { redactPii as agentRedact } from '../../services/agent/src/redact';
import { executeTool, tools } from '../../services/mcp/src/tools';
import { logTechnical, pick } from '../../services/mcp/src/utils/logging';
import { redactPii as mcpRedact } from '../../services/mcp/src/utils/redact';
import { createFakeStore } from '../mcp/fake-store';

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['agent', agentRedact],
  ['mcp', mcpRedact],
])('redactPii (%s)', (_name, redactPii) => {
  it('masks emails and long numbers', () => {
    expect(redactPii('mail me at Ada.Lovelace+x@example.co.uk please')).toBe('mail me at [email] please');
    expect(redactPii('call +234 801 234 5678 or 08012345678')).toBe('call [number] or [number]');
    expect(redactPii('a@b.co and c@d.io')).toBe('[email] and [email]');
  });

  it('leaves reference ids, dates and short numbers alone', () => {
    const text = 'TXN-9001 PAY-7002 TKT-000012 CUS-1001 on 2026-08-19 for 2400 USD, 5 days';
    expect(redactPii(text)).toBe(text);
  });

  it('is idempotent', () => {
    const once = redactPii('x@y.com 08012345678');
    expect(redactPii(once)).toBe(once);
  });
});

describe('agent structured logger', () => {
  it('drops secret-looking fields and scrubs strings', () => {
    const out = safeFields({
      conversation_id: 'vapi_1',
      message: 'failed for a@b.co',
      api_key: 'sk-secret',
      authToken: 't',
      password: 'p',
      count: 3,
    });
    expect(out).toEqual({ conversation_id: 'vapi_1', message: 'failed for [email]', count: 3 });
  });

  it('emits one JSON line per event with the conversation id', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logEvent('error', 'runTurn failed', { conversation_id: 'vapi_9', message: 'boom 08012345678', secret: 'x' });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: 'error', service: 'agent', event: 'runTurn failed', conversation_id: 'vapi_9' });
    expect(line.message).toBe('boom [number]');
    expect(line.secret).toBeUndefined();
    expect(typeof line.ts).toBe('string');
  });

  it('sends info to stdout and normalizes error values', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    logEvent('info', 'started');
    expect(log).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('mcp logger', () => {
  it('writes redacted JSON to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logTechnical('lookup_customer failed', new Error('db down for ada@example.com'), { conversation_id: 'c1' });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ service: 'mcp', level: 'error', event: 'lookup_customer failed', conversation_id: 'c1' });
    expect(line.message).toBe('db down for [email]');
  });
});

/** Minimal supabase stand-in that records inserts and can fail them. */
function fakeDb(opts: { failInsert?: boolean } = {}) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const db = {
    from: (table: string) => ({
      upsert: () => Promise.resolve({ error: null }),
      insert: (row: Record<string, unknown>) => {
        if (opts.failInsert) return Promise.resolve({ error: { message: 'insert failed' } });
        inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return { db, inserts };
}

describe('recordError', () => {
  it('stores a scrubbed, truncated error event', async () => {
    const { db, inserts } = fakeDb();
    await recordError(db, 'vapi_1', 'agent.runTurn', new Error(`bad input a@b.co ${'x'.repeat(600)}`));
    expect(inserts).toHaveLength(1);
    const row = inserts[0].row as { event_type: string; summary: string; metadata: { source: string; message: string } };
    expect(inserts[0].table).toBe('conversation_events');
    expect(row).toMatchObject({ conversation_id: 'vapi_1', event_type: 'error', summary: 'agent.runTurn failed' });
    expect(row.metadata.message.startsWith('bad input [email]')).toBe(true);
    expect(row.metadata.message.length).toBeLessThanOrEqual(300);
  });

  it('never throws; it falls back to the log when the write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({ failInsert: true });
    await expect(recordError(db, 'vapi_1', 'vapi.webhook', new Error('boom'))).resolves.toBeUndefined();
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: 'could not record error event', source: 'vapi.webhook', conversation_id: 'vapi_1' });
  });
});

describe('callEndedMetadata', () => {
  it('keeps only whitelisted, well-formed fields', () => {
    expect(
      callEndedMetadata({
        endedReason: 'customer-ended-call',
        durationSeconds: 12.34567,
        cost: 0.12345,
        transcript: 'private',
        messages: [{ content: 'private' }],
      }),
    ).toEqual({ endedReason: 'customer-ended-call', durationSeconds: 12.346, cost: 0.123 });
  });

  it('drops malformed values', () => {
    expect(callEndedMetadata({ endedReason: 'bad <script>', durationSeconds: 'soon', cost: NaN })).toEqual({});
    expect(callEndedMetadata({ endedReason: 'x'.repeat(200) })).toEqual({});
  });
});

describe('tool call logging', () => {
  const tool = (name: string) => tools.find((t) => t.name === name)!;

  it('gives every tool a fixed purpose', () => {
    for (const t of tools) {
      expect(t.purpose.length).toBeGreaterThan(10);
      expect(typeof t.summarize).toBe('function');
    }
    expect(new Set(tools.map((t) => t.purpose)).size).toBe(tools.length);
  });

  it('records purpose, duration and an id-and-status summary for a lookup', async () => {
    const store = createFakeStore();
    await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store);
    expect(store.toolCalls[0]).toMatchObject({
      tool_name: 'lookup_transaction',
      status: 'success',
      purpose: 'Look up a transaction to report its status',
      result_summary: 'found TXN-9001, status processing',
    });
    expect(store.toolCalls[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('summarizes not-found and failures without free text', async () => {
    const store = createFakeStore();
    await executeTool(tool('lookup_customer'), { customer_id: 'CUS-0000' }, store);
    await executeTool(tool('lookup_transaction'), {}, store);
    expect(store.toolCalls.map((c) => c.result_summary)).toEqual(['not found', 'error: invalid_input']);
  });

  it('never puts names, emails or reasons in the summary of a write', async () => {
    const store = createFakeStore();
    await executeTool(
      tool('create_escalation'),
      { user_name: 'Ada Lovelace', user_email: 'ada@example.com', category: 'account', reason: 'my card 4111111111111111 was stolen' },
      store,
    );
    const rec = store.toolCalls[0];
    expect(rec.result_summary).toBe('escalation ESC-000001 created');
    expect(JSON.stringify(rec)).not.toMatch(/Ada|ada@|4111|stolen/);
  });

  it('scrubs the stored technical error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = Object.assign(createFakeStore(), {
      getTransaction: async () => {
        throw new Error('connection refused for ada@example.com');
      },
    });
    const r = await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store);
    expect(r).toMatchObject({ error: { code: 'temporarily_unavailable' } });
    const rec = store.toolCalls.at(-1)!;
    expect(rec.status).toBe('failed');
    expect(rec.error).toBe('connection refused for [email]');
  });

  it('pick() keeps ids and statuses and strips everything else', () => {
    expect(pick('review required')).toBe('review required');
    expect(pick('TXN-9001')).toBe('TXN-9001');
    expect(pick('<script>alert(1)</script>')).toBe('scriptalert1script');
    expect(pick(undefined)).toBe('unknown');
    expect(pick('a@b.co')).toBe('email');
  });
});
