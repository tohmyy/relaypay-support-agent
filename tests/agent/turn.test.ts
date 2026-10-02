import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runTurn, type AgentDeps } from '../../services/agent/src/agent';
import { LEAK_FALLBACK } from '../../services/agent/src/guard';

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the parts of supabase-js the agent uses. */
function fakeDb() {
  const tables: Record<string, Row[]> = { conversations: [], conversation_turns: [], conversation_events: [] };
  const from = (name: string) => {
    const rows = tables[name];
    let filters: [string, unknown][] = [];
    let order: { col: string; asc: boolean } | undefined;
    const matching = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const builder: Record<string, unknown> = {
      upsert(row: Row, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const key = opts?.onConflict ?? 'id';
        if (!rows.some((r) => r[key] === row[key])) rows.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Row) {
        rows.push(row);
        return Promise.resolve({ data: null, error: null });
      },
      select() {
        return builder;
      },
      eq(col: string, value: unknown) {
        filters.push([col, value]);
        return builder;
      },
      order(col: string, o: { ascending: boolean }) {
        order = { col, asc: o.ascending };
        return builder;
      },
      update(patch: Row) {
        return {
          eq: (col: string, value: unknown) => {
            rows.filter((r) => r[col] === value).forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      then(resolve: (v: unknown) => void) {
        let out = matching();
        if (order) out = [...out].sort((a, b) => (Number(a[order!.col]) - Number(b[order!.col])) * (order!.asc ? 1 : -1));
        filters = [];
        resolve({ data: out, error: null });
      },
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

/** Scripted stand-in for the SDK's query(): yields the given messages and records the call. */
function scriptedQuery(messages: unknown[]) {
  const calls: { prompt: string; options: Record<string, unknown> }[] = [];
  const query = ((params: { prompt: string; options: Record<string, unknown> }) => {
    calls.push(params);
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as NonNullable<AgentDeps['query']>;
  return { query, calls };
}

const result = (answer: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  structured_output: answer,
  result: '',
  ...extra,
});
const toolUse = (id: string, name: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: `mcp__relaypay__${name}`, input: {} }] },
});
const toolResult = (id: string, payload: unknown) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify(payload) }] }] },
});

const chunk = { documentId: 'd', title: 'Why Is My Payment Delayed?', section: 's', category: 'faq', version: '2.4', content: 'c', score: 1 };
const retrieve = async () => ({ chunks: [chunk] });

let env: ReturnType<typeof fakeDb>;
beforeEach(() => {
  env = fakeDb();
});
const deps = (query: AgentDeps['query']): AgentDeps => ({
  query,
  db: env.db,
  retrieve,
  mcpUrl: 'http://localhost:4000/mcp',
  mcpToken: 'tok',
});

describe('runTurn', () => {
  it('runs a turn, records it, and reports sources and answer type', async () => {
    const { query, calls } = scriptedQuery([
      result({ answer_type: 'direct_answer', spoken_response: 'Delays can happen for a few reasons.', confidence_note: 'kb' }),
    ]);
    const r = await runTurn({ conversationId: 'test-1', userMessage: 'Why is my payment late?' }, deps(query));
    expect(r).toEqual({
      response: 'Delays can happen for a few reasons.',
      answerType: 'direct_answer',
      sources: ['Why Is My Payment Delayed?'],
      toolsUsed: [],
      escalated: false,
      turnNumber: 1,
    });
    expect(calls[0].prompt).toContain('Why is my payment late?');
    expect(calls[0].options.tools).toEqual([]);
    expect(env.tables.conversations).toHaveLength(1);
    expect(env.tables.conversation_turns[0]).toMatchObject({
      conversation_id: 'test-1',
      turn_number: 1,
      user_transcript: 'Why is my payment late?',
      assistant_response: 'Delays can happen for a few reasons.',
      answer_type: 'direct_answer',
      confidence_note: 'kb',
    });
  });

  it('passes history to the next turn and increments the turn number', async () => {
    const first = scriptedQuery([result({ answer_type: 'clarification', spoken_response: 'Outgoing or incoming?' })]);
    await runTurn({ conversationId: 'test-2', userMessage: 'My payment is stuck' }, deps(first.query));
    const second = scriptedQuery([result({ answer_type: 'direct_answer', spoken_response: 'Thanks.' })]);
    await runTurn({ conversationId: 'test-2', userMessage: 'Outgoing' }, deps(second.query));
    expect(second.calls[0].prompt).toContain('Customer: My payment is stuck');
    expect(second.calls[0].prompt).toContain('Assistant: Outgoing or incoming?');
    expect(env.tables.conversation_turns.map((t) => t.turn_number)).toEqual([1, 2]);
  });

  it('records tool use and flags a created escalation even if the model mislabels it', async () => {
    const { query } = scriptedQuery([
      toolUse('t1', 'create_escalation'),
      toolResult('t1', { escalation_id: 'ESC-000009', status: 'open' }),
      result({ answer_type: 'direct_answer', spoken_response: 'A specialist will call you.' }),
    ]);
    const r = await runTurn({ conversationId: 'test-3', userMessage: 'My account is restricted' }, deps(query));
    expect(r.toolsUsed).toEqual(['create_escalation']);
    expect(r.answerType).toBe('escalation');
    expect(r.escalated).toBe(true);
    expect(env.tables.conversations[0].final_status).toBe('escalated');
  });

  it('marks later prompts once an escalation has been raised', async () => {
    const a = scriptedQuery([
      toolUse('t1', 'create_escalation'),
      toolResult('t1', { escalation_id: 'ESC-000010', status: 'open' }),
      result({ answer_type: 'escalation', spoken_response: 'A specialist will help.' }),
    ]);
    await runTurn({ conversationId: 'test-4', userMessage: 'Account suspended' }, deps(a.query));
    const b = scriptedQuery([result({ answer_type: 'escalation', spoken_response: 'It is with the team.' })]);
    await runTurn({ conversationId: 'test-4', userMessage: 'Any update?' }, deps(b.query));
    expect(b.calls[0].prompt).toContain('<escalation_already_raised>');
    expect(a.calls[0].prompt).not.toContain('<escalation_already_raised>');
  });

  it('does not mark the handoff as raised while details are still being collected', async () => {
    const a = scriptedQuery([result({ answer_type: 'escalation', spoken_response: 'May I have your name?' })]);
    await runTurn({ conversationId: 'test-4b', userMessage: 'I want a refund' }, deps(a.query));
    const b = scriptedQuery([result({ answer_type: 'escalation', spoken_response: 'Thanks.' })]);
    await runTurn({ conversationId: 'test-4b', userMessage: 'My name is Sam' }, deps(b.query));
    expect(b.calls[0].prompt).not.toContain('<escalation_already_raised>');
    expect(env.tables.conversations[0].final_status).toBeUndefined();
  });

  it('replaces a response that repeats support notes returned by a tool', async () => {
    const notes = 'Account is under compliance review. Escalate account-specific questions.';
    const { query } = scriptedQuery([
      toolUse('t1', 'lookup_customer'),
      toolResult('t1', { found: true, support_notes: notes }),
      result({ answer_type: 'direct_answer', spoken_response: `Your notes say: ${notes}` }),
    ]);
    const r = await runTurn({ conversationId: 'test-5', userMessage: 'I am AccraStack' }, deps(query));
    expect(r.response).toBe(LEAK_FALLBACK);
    expect(r.answerType).toBe('escalation');
    expect(JSON.stringify(env.tables.conversation_turns)).not.toContain('Escalate account-specific');
  });

  it('degrades to a safe decline when the model output is unusable', async () => {
    const { query } = scriptedQuery([{ type: 'result', subtype: 'success', result: 'not json at all' }]);
    const r = await runTurn({ conversationId: 'test-6', userMessage: 'hello' }, deps(query));
    expect(r.answerType).toBe('decline');
    expect(r.response).not.toContain('not json');
  });

  it('records how long the reply took and what it cost', async () => {
    const { query } = scriptedQuery([
      result({ answer_type: 'direct_answer', spoken_response: 'Fine.' }, { total_cost_usd: 0.0421 }),
    ]);
    await runTurn({ conversationId: 'test-7', userMessage: 'hello' }, deps(query));
    const row = env.tables.conversation_turns[0];
    expect(row.cost_usd).toBe(0.0421);
    expect(typeof row.latency_ms).toBe('number');
    expect(row.latency_ms as number).toBeGreaterThanOrEqual(0);
  });

  it('stores null cost when the SDK reports none', async () => {
    const { query } = scriptedQuery([result({ answer_type: 'direct_answer', spoken_response: 'Fine.' })]);
    await runTurn({ conversationId: 'test-8', userMessage: 'hello' }, deps(query));
    expect(env.tables.conversation_turns[0].cost_usd).toBeNull();
  });

  it('leaves an error event behind when a turn fails, and still raises the error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = (() => {
      throw new Error('model unreachable for ada@example.com');
    }) as unknown as NonNullable<AgentDeps['query']>;
    await expect(runTurn({ conversationId: 'test-9', userMessage: 'hello' }, deps(failing))).rejects.toThrow(/unreachable/);
    expect(env.tables.conversation_events).toHaveLength(1);
    expect(env.tables.conversation_events[0]).toMatchObject({
      conversation_id: 'test-9',
      event_type: 'error',
      metadata: { source: 'agent.runTurn', message: 'model unreachable for [email]' },
    });
    expect(env.tables.conversation_turns).toHaveLength(0);
    spy.mockRestore();
  });

  it('rejects empty, oversized and id-less input before doing any work', async () => {
    const { query, calls } = scriptedQuery([]);
    await expect(runTurn({ conversationId: 'c', userMessage: '   ' }, deps(query))).rejects.toThrow(/required/);
    await expect(runTurn({ conversationId: 'c', userMessage: 'x'.repeat(2001) }, deps(query))).rejects.toThrow(/too long/);
    await expect(runTurn({ conversationId: '', userMessage: 'hi' }, deps(query))).rejects.toThrow(/conversationId/);
    expect(calls).toHaveLength(0);
    expect(env.tables.conversations).toHaveLength(0);
  });

  it('reports a missing API key by name when no fake model is injected', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        runTurn({ conversationId: 'c', userMessage: 'hi' }, { db: env.db, retrieve, mcpUrl: 'http://x/mcp', mcpToken: 't' }),
      ).rejects.toThrow('ANTHROPIC_API_KEY');
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
