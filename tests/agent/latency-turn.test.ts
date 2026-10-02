import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { TurnProgress } from '../../services/agent/src/acks';
import { runTurn, type AgentDeps } from '../../services/agent/src/agent';
import { TurnTimer } from '../../services/agent/src/timing';

type Row = Record<string, unknown>;

/** In-memory database that also logs the order in which reads start and finish, to prove they overlap. */
function fakeDb(readDelayMs = 0) {
  const tables: Record<string, Row[]> = { conversations: [], conversation_turns: [], conversation_events: [] };
  const log: string[] = [];
  const from = (name: string) => {
    const rows = tables[name];
    let filters: [string, unknown][] = [];
    const builder: Record<string, unknown> = {
      upsert(row: Row) {
        log.push(`start:upsert:${name}`);
        return new Promise((resolve) =>
          setTimeout(() => {
            if (!rows.some((r) => r.conversation_id === row.conversation_id)) rows.push(row);
            log.push(`end:upsert:${name}`);
            resolve({ data: null, error: null });
          }, readDelayMs),
        );
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
      order() {
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
        log.push(`start:read:${name}`);
        const out = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
        filters = [];
        setTimeout(() => {
          log.push(`end:read:${name}`);
          resolve({ data: out, error: null });
        }, readDelayMs);
      },
    };
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, tables, log };
}

const answer = { answer_type: 'direct_answer', spoken_response: 'Payouts take one to two days.', confidence_note: 'kb' };
const result = { type: 'result', subtype: 'success', structured_output: answer, result: '' };
const toolUse = (id: string, name: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: `mcp__relaypay__${name}`, input: {} }] },
});
const toolResult = (id: string, payload: unknown) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify(payload) }] }] },
});
const chunk = { documentId: 'd', title: 'Payout times', section: 's', category: 'faq', version: '2.4', content: 'c', score: 1 };

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function setup(over: Partial<AgentDeps> = {}, db = fakeDb()) {
  const base: AgentDeps = {
    db: db.db,
    retrieve: async () => ({ chunks: [chunk] }),
    mcpUrl: 'http://localhost:4000/mcp',
    mcpToken: 'tok',
    ...over,
  };
  return { deps: base, ...db };
}

/** A model whose messages arrive after set delays on the fake clock. */
function timedQuery(c: ReturnType<typeof clock>, steps: [number, unknown][]) {
  const calls: unknown[] = [];
  const query = ((params: unknown) => {
    calls.push(params);
    return (async function* () {
      for (const [wait, message] of steps) {
        c.advance(wait);
        yield message;
      }
    })();
  }) as unknown as NonNullable<AgentDeps['query']>;
  return { query, calls };
}

describe('turn timings', () => {
  it('splits a turn into its pieces: start-up, tools, model, and the rest', async () => {
    const c = clock();
    const timer = new TurnTimer(c.now);
    const { query } = timedQuery(c, [
      [1200, { type: 'system', subtype: 'init' }], // process start and handshake
      [400, toolUse('t1', 'lookup_transaction')],
      [300, toolResult('t1', { found: true, transaction_id: 'TXN-9001' })],
      [2000, result],
    ]);
    const { deps } = setup({
      query,
      retrieve: async () => {
        c.advance(80);
        return { chunks: [chunk] };
      },
    });
    const r = await runTurn({ conversationId: 'vapi_a', userMessage: 'check TXN-9001', timer }, { ...deps });
    const t = timer.toJSON();
    expect(t.retrieval_ms).toBe(80);
    expect(t.sdk_start_ms).toBe(1200);
    expect(t.mcp_ms).toBe(300);
    expect(t.tools).toEqual([{ name: 'lookup_transaction', ms: 300 }]);
    expect(t.agent_ms).toBe(3900);
    expect(t.model_ms).toBe(3900 - 1200 - 300);
    expect(t.prewarmed).toBe(false);
    for (const key of ['history_ms', 'save_ms'] as const) expect(typeof t[key]).toBe('number');
    expect(r.turnNumber).toBe(1);
  });

  it('times itself when the caller gave it no stopwatch', async () => {
    const c = clock();
    const { query } = timedQuery(c, [[10, result]]);
    const { deps } = setup({ query });
    await expect(runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps)).resolves.toMatchObject({ turnNumber: 1 });
  });

  it('numbers turns as before', async () => {
    const c = clock();
    const { query } = timedQuery(c, [[1, result]]);
    const { deps, tables } = setup({ query });
    const first = await runTurn({ conversationId: 'vapi_a', userMessage: 'one' }, deps);
    const second = await runTurn({ conversationId: 'vapi_a', userMessage: 'two' }, deps);
    expect([first.turnNumber, second.turnNumber]).toEqual([1, 2]);
    expect(tables.conversation_turns.map((t) => t.turn_number)).toEqual([1, 2]);
  });

  it('keeps latency_ms exactly as before (a plain number on the stored turn)', async () => {
    const c = clock();
    const { query } = timedQuery(c, [[1, result]]);
    const { deps, tables } = setup({ query });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'one' }, deps);
    expect(typeof tables.conversation_turns[0].latency_ms).toBe('number');
  });
});

describe('progress for the acknowledgement', () => {
  it('notes that knowledge was found, and which tool the model is using', async () => {
    const c = clock();
    const seen: TurnProgress[] = [];
    const progress: TurnProgress = {};
    const { query } = timedQuery(c, [
      [1, toolUse('t1', 'lookup_payout')],
      [1, toolResult('t1', { found: true })],
      [1, result],
    ]);
    const { deps } = setup({ query });
    // Watch the progress object while the model runs.
    const watched = new Proxy(progress, {
      set(target, key, value) {
        seen.push({ ...target, [key]: value } as TurnProgress);
        return Reflect.set(target, key, value);
      },
    });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'where is my payout', progress: watched }, deps);
    expect(progress).toEqual({ knowledge: true, toolCategory: 'payout_lookup' });
    expect(seen[0]).toEqual({ knowledge: true }); // knowledge first, the stronger tool cue later
  });

  it('keeps the last real tool as the category, and ignores bookkeeping tools', async () => {
    const c = clock();
    const progress: TurnProgress = {};
    const { query } = timedQuery(c, [
      [1, toolUse('t1', 'lookup_customer')],
      [1, toolResult('t1', { found: true })],
      [1, toolUse('t2', 'log_conversation_event')],
      [1, toolResult('t2', { logged: true })],
      [1, result],
    ]);
    const { deps } = setup({ query });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'hello', progress }, deps);
    expect(progress.toolCategory).toBe('customer_lookup');
  });

  it('does not claim knowledge when nothing relevant was found', async () => {
    const c = clock();
    const progress: TurnProgress = {};
    const { query } = timedQuery(c, [[1, result]]);
    const { deps } = setup({ query, retrieve: async () => ({ chunks: [] }) });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'weather in paris', progress }, deps);
    expect(progress).toEqual({});
  });
});

describe('safe speedups', () => {
  it('reads the conversation row, the history and the status together, not one after another', async () => {
    const c = clock();
    const { query } = timedQuery(c, [[1, result]]);
    const db = fakeDb(15);
    const { deps, log } = setup({ query }, db);
    await runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps);
    const firstEnd = log.findIndex((e) => e.startsWith('end:'));
    const startsBeforeAnyEnd = log.slice(0, firstEnd).filter((e) => e.startsWith('start:'));
    // upsert, turns read and conversations read were all in flight before the first one finished.
    expect(startsBeforeAnyEnd).toEqual(expect.arrayContaining(['start:upsert:conversations', 'start:read:conversation_turns', 'start:read:conversations']));
  });

  it('does not wait for the knowledge log to start the model, but is sure it has landed before finishing', async () => {
    const c = clock();
    let logged = false;
    let resolveLog!: () => void;
    const loggedPromise = new Promise<void>((resolve) => (resolveLog = () => ((logged = true), resolve())));
    let loggedWhenModelStarted: boolean | undefined;
    const { query } = timedQuery(c, [[1, result]]);
    const wrapped = ((params: unknown) => {
      loggedWhenModelStarted = logged;
      resolveLog(); // the log finishes while the model works
      return query(params as never);
    }) as unknown as NonNullable<AgentDeps['query']>;
    const { deps } = setup({ query: wrapped, retrieve: async () => ({ chunks: [chunk], logged: loggedPromise }) });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps);
    expect(loggedWhenModelStarted).toBe(false);
    expect(logged).toBe(true);
  });

  it('a retrieval that fails still fails the turn, as before', async () => {
    const c = clock();
    const { query } = timedQuery(c, [[1, result]]);
    const { deps, tables } = setup({
      query,
      retrieve: async () => {
        throw new Error('search down');
      },
    });
    await expect(runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps)).rejects.toThrow('search down');
    expect(tables.conversation_events.some((e) => e.event_type === 'error')).toBe(true);
  });
});

describe('pre-started agent process', () => {
  const warmQuery = (steps: unknown[]) => ({
    query: vi.fn((_prompt: string) =>
      (async function* () {
        for (const s of steps) yield s;
      })(),
    ),
    close: vi.fn(),
  });

  it('uses the warm process instead of starting one, and prepares the next one afterwards', async () => {
    const c = clock();
    const cold = timedQuery(c, [[1, result]]);
    const warmed = warmQuery([result]);
    const warm = { take: vi.fn(async () => warmed as never), warm: vi.fn() };
    const timer = new TurnTimer(c.now);
    const { deps } = setup({ query: cold.query, warm });
    await runTurn({ conversationId: 'vapi_a', userMessage: 'hi there', timer }, deps);
    expect(warm.take).toHaveBeenCalledWith('vapi_a');
    expect(warmed.query).toHaveBeenCalledOnce();
    expect(warmed.query.mock.calls[0][0]).toContain('hi there');
    expect(cold.calls).toHaveLength(0);
    expect(timer.get('prewarmed')).toBe(true);
    expect(warm.warm).toHaveBeenCalledWith('vapi_a');
  });

  it('starts one itself when there is none, exactly as without the feature', async () => {
    const c = clock();
    const cold = timedQuery(c, [[1, result]]);
    const warm = { take: vi.fn(async () => undefined), warm: vi.fn() };
    const timer = new TurnTimer(c.now);
    const { deps } = setup({ query: cold.query, warm });
    const r = await runTurn({ conversationId: 'vapi_a', userMessage: 'hi there', timer }, deps);
    expect(cold.calls).toHaveLength(1);
    expect((cold.calls[0] as { options: { mcpServers: unknown } }).options.mcpServers).toBeTruthy();
    expect(timer.get('prewarmed')).toBe(false);
    expect(r.response).toBe(answer.spoken_response);
  });

  it('gives the same answer either way', async () => {
    const c = clock();
    const coldRun = await runTurn(
      { conversationId: 'vapi_a', userMessage: 'hi there' },
      setup({ query: timedQuery(c, [[1, result]]).query }).deps,
    );
    const warmRun = await runTurn(
      { conversationId: 'vapi_b', userMessage: 'hi there' },
      setup({ warm: { take: async () => warmQuery([result]) as never, warm: vi.fn() } }).deps,
    );
    expect(warmRun.response).toBe(coldRun.response);
    expect(warmRun.answerType).toBe(coldRun.answerType);
  });

  it('prepares the next process even when the turn fails, and still reports the failure', async () => {
    const warm = { take: vi.fn(async () => undefined), warm: vi.fn() };
    const failing = (() =>
      (async function* () {
        yield { type: 'system' };
        throw new Error('model unavailable');
      })()) as unknown as NonNullable<AgentDeps['query']>;
    const { deps } = setup({ query: failing, warm });
    await expect(runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps)).rejects.toThrow('model unavailable');
    expect(warm.warm).toHaveBeenCalledWith('vapi_a');
  });

  it('does not claim a warm process when the turn fails before the model (nothing is stranded)', async () => {
    const warm = { take: vi.fn(async () => warmQuery([result]) as never), warm: vi.fn() };
    const { deps } = setup({
      warm,
      retrieve: async () => {
        throw new Error('search down');
      },
    });
    await expect(runTurn({ conversationId: 'vapi_a', userMessage: 'hi there' }, deps)).rejects.toThrow('search down');
    expect(warm.take).not.toHaveBeenCalled();
  });
});
