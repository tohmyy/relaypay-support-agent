import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACK_TEMPLATES, AckRotation } from '../../services/agent/src/acks';
import type { TurnInput } from '../../services/agent/src/agent';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';
import { SLOW_FILLER } from '../../services/agent/src/vapi';

const TOKEN = 'agent-token-0123456789';
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
let server: Server | undefined;

/** A database whose every call succeeds; records timing updates so they can be inspected. */
function recordingDb(opts: { failUpdates?: boolean } = {}) {
  const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const chain = (filters: [string, unknown][] = [], patch?: Record<string, unknown>): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              if (patch) updates.push({ patch, filters });
              resolve({ data: [], error: opts.failUpdates && patch ? { message: 'db down' } : null });
            };
          }
          if (prop === 'update') return (p: Record<string, unknown>) => chain(filters, p);
          if (prop === 'eq') return (col: string, v: unknown) => chain([...filters, [col, v]], patch);
          return () => chain(filters, patch);
        },
      },
    );
  return { db: { from: () => chain() } as never, updates };
}

async function start(opts: Partial<AgentServerOptions> = {}) {
  server = createAgentServer({
    apiToken: TOKEN,
    runTurn: async (input) => ({ response: `echo: ${input.userMessage}`, turnNumber: 4 }),
    ...opts,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const body = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ call: { id: 'call1' }, messages: [{ role: 'user', content: text }], ...extra });

async function speakLines(url: string, text: string, extra: Record<string, unknown> = { stream: true }) {
  const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body(text, extra) });
  const raw = await r.text();
  return raw
    .split('\n\n')
    .filter((e) => e.startsWith('data: {'))
    .map((e) => JSON.parse(e.slice(6)).choices[0].delta.content as string | undefined)
    .filter((c): c is string => Boolean(c));
}

const slow = (ms: number, extra: (input: TurnInput) => void = () => {}) =>
  (async (input: TurnInput) => {
    extra(input);
    await new Promise((r) => setTimeout(r, ms));
    return { response: 'Done.', turnNumber: 4 };
  }) as AgentServerOptions['runTurn'];

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('contextual acknowledgements', () => {
  it('fits a reference the customer mentioned', async () => {
    const url = await start({ fillerAfterMs: 20, runTurn: slow(120) });
    const spoken = await speakLines(url, 'Can you check transaction TXN-9001?');
    expect(spoken).toHaveLength(2);
    expect(ACK_TEMPLATES.transaction_lookup).toContain(spoken[0].trim());
    expect(spoken[1]).toBe('Done.');
  });

  it('follows what the agent is actually doing, over a guess from the message', async () => {
    const url = await start({
      fillerAfterMs: 20,
      runTurn: slow(120, (input) => {
        input.progress!.toolCategory = 'payout_lookup';
      }),
    });
    const spoken = await speakLines(url, 'Can you check transaction TXN-9001?');
    expect(ACK_TEMPLATES.payout_lookup).toContain(spoken[0].trim());
  });

  it('uses the knowledge cue only when nothing stronger is known', async () => {
    const url = await start({
      fillerAfterMs: 20,
      runTurn: slow(120, (input) => {
        input.progress!.knowledge = true;
      }),
    });
    const spoken = await speakLines(url, 'How long do international payouts take?');
    expect(ACK_TEMPLATES.knowledge_base).toContain(spoken[0].trim());
  });

  it('falls back to the plain filler when it cannot tell what the turn is doing', async () => {
    const url = await start({ fillerAfterMs: 20, runTurn: slow(120) });
    const spoken = await speakLines(url, 'hello');
    expect(ACK_TEMPLATES.generic).toContain(spoken[0].trim());
  });

  it('keeps the original filler available as a generic phrase', () => {
    expect(ACK_TEMPLATES.generic).toContain(SLOW_FILLER.trim());
  });

  it('does not repeat itself back to back within a call', async () => {
    const url = await start({ fillerAfterMs: 20, runTurn: slow(80) });
    const heard: string[] = [];
    for (let i = 0; i < 6; i++) heard.push((await speakLines(url, 'check TXN-9001'))[0].trim());
    for (let i = 1; i < heard.length; i++) expect(heard[i]).not.toBe(heard[i - 1]);
  });

  it('says nothing extra when the reply is quick', async () => {
    const url = await start({ fillerAfterMs: 500, runTurn: slow(5) });
    expect(await speakLines(url, 'check TXN-9001')).toEqual(['Done.']);
  });

  it('is transport only: the stored answer is the reply, not the acknowledgement', async () => {
    const seen: string[] = [];
    const url = await start({
      fillerAfterMs: 20,
      runTurn: async (input) => {
        await new Promise((r) => setTimeout(r, 100));
        seen.push(input.userMessage);
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    const spoken = await speakLines(url, 'check TXN-9001');
    expect(spoken[1]).toBe('Done.');
    expect(seen).toEqual(['check TXN-9001']);
  });

  it('does not interrupt a plain, non-streaming reply', async () => {
    const url = await start({ fillerAfterMs: 20, runTurn: slow(80) });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body('check TXN-9001') });
    expect((await r.json()).choices[0].message.content).toBe('Done.');
  });

  it('forgets a finished call\'s phrases', async () => {
    const acks = new AckRotation();
    const { db } = recordingDb();
    const url = await start({
      acks,
      db,
      webhookSecret: 'whsec-12345678',
      fillerAfterMs: 20,
      runTurn: slow(80),
    });
    await speakLines(url, 'check TXN-9001');
    expect(acks.size).toBe(1);
    await fetch(`${url}/vapi/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vapi-secret': 'whsec-12345678' },
      body: JSON.stringify({ message: { type: 'end-of-call-report', call: { id: 'call1' } } }),
    });
    expect(acks.size).toBe(0);
  });
});

describe('turn timings', () => {
  it('stores the segments after the reply, tied to the right turn', async () => {
    const { db, updates } = recordingDb();
    const url = await start({
      db,
      fillerAfterMs: 20,
      runTurn: async (input) => {
        input.timer!.set('retrieval_ms', 40);
        input.timer!.set('prewarmed', false);
        await new Promise((r) => setTimeout(r, 80));
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await speakLines(url, 'check TXN-9001');
    await settle();
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual([
      ['conversation_id', 'vapi_call1'],
      ['turn_number', 4],
    ]);
    const timings = updates[0].patch.timings as Record<string, unknown>;
    expect(timings).toMatchObject({ retrieval_ms: 40, prewarmed: false, ack_category: 'transaction_lookup' });
    for (const key of ['total_turn_ms', 'queue_ms', 'first_write_ms', 'ack_ms'] as const) {
      expect(typeof timings[key], key).toBe('number');
    }
    // The first thing Vapi could speak was the acknowledgement, well before the whole turn finished.
    expect(timings.first_write_ms as number).toBeLessThan(timings.total_turn_ms as number);
    expect(timings.first_write_ms).toBe(timings.ack_ms);
  });

  it('measures time to first byte as the reply when there was no acknowledgement', async () => {
    const { db, updates } = recordingDb();
    const url = await start({ db, fillerAfterMs: 5000, runTurn: slow(30) });
    await speakLines(url, 'hello');
    await settle();
    const timings = updates[0].patch.timings as Record<string, number>;
    expect(timings.ack_ms).toBeUndefined();
    expect(timings.first_write_ms).toBeGreaterThanOrEqual(25);
  });

  it('also stores them for a non-streaming request', async () => {
    const { db, updates } = recordingDb();
    const url = await start({ db, runTurn: slow(10) });
    await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body('hello') });
    await settle();
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.timings).toMatchObject({ first_write_ms: expect.any(Number), total_turn_ms: expect.any(Number) });
  });

  it('times the session checks and the wait behind an earlier turn', async () => {
    const { db, updates } = recordingDb();
    const session = {
      beforeTurn: async () => {
        await new Promise((r) => setTimeout(r, 25));
        return { kind: 'proceed' as const };
      },
      afterTurn: () => {},
      handleVapiMessage: async () => {},
      consumeSpeechGapMs: () => undefined,
      dispose: () => {},
    } as never;
    const url = await start({ db, session, runTurn: slow(5) });
    await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body('hello') });
    await settle();
    const timings = updates[0].patch.timings as Record<string, number>;
    expect(timings.controller_ms).toBeGreaterThanOrEqual(20);
  });

  it('records how long after the customer stopped speaking the request arrived', async () => {
    const { db, updates } = recordingDb();
    const session = {
      beforeTurn: async () => ({ kind: 'proceed' as const }),
      afterTurn: () => {},
      handleVapiMessage: async () => {},
      consumeSpeechGapMs: () => 450,
      dispose: () => {},
    } as never;
    const url = await start({ db, session });
    await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body('hello') });
    await settle();
    expect((updates[0].patch.timings as Record<string, number>).speech_to_agent_ms).toBe(450);
  });

  it('stores nothing for replies the Session Controller gave itself (no stored turn number)', async () => {
    const { db, updates } = recordingDb();
    const session = {
      beforeTurn: async () => ({ kind: 'reply' as const, text: 'Goodbye.' }),
      afterTurn: () => {},
      handleVapiMessage: async () => {},
      consumeSpeechGapMs: () => undefined,
      dispose: () => {},
    } as never;
    const url = await start({ db, session });
    const spoken = await speakLines(url, "that's all");
    await settle();
    expect(spoken).toEqual(['Goodbye.']);
    expect(updates).toHaveLength(0);
  });

  it('stores nothing and still answers when there is no database', async () => {
    const url = await start({});
    expect(await speakLines(url, 'hello')).toEqual(['echo: hello']);
  });

  it('never lets a failed timings write touch the answer', async () => {
    const { db } = recordingDb({ failUpdates: true });
    const url = await start({ db });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body('hello') });
    expect(r.status).toBe(200);
    expect((await r.json()).choices[0].message.content).toBe('echo: hello');
  });

  it('does not store timings for a turn that failed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, updates } = recordingDb();
    const url = await start({
      db,
      runTurn: async () => {
        throw new Error('boom');
      },
    });
    await speakLines(url, 'hello');
    await settle();
    expect(updates).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('agent process pre-start hooks', () => {
  const post = (url: string, message: Record<string, unknown>) =>
    fetch(`${url}/vapi/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vapi-secret': 'whsec-12345678' },
      body: JSON.stringify({ message }),
    });

  it('warms a process when a call starts and lets it go when the call ends', async () => {
    const warm = { warm: vi.fn(), release: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    const { db } = recordingDb();
    const url = await start({ warm, db, webhookSecret: 'whsec-12345678' });
    await post(url, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } });
    expect(warm.warm).toHaveBeenCalledWith('vapi_call1');
    await post(url, { type: 'end-of-call-report', call: { id: 'call1' } });
    expect(warm.release).toHaveBeenCalledWith('vapi_call1');
  });

  it('ignores other call events', async () => {
    const warm = { warm: vi.fn(), release: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    const { db } = recordingDb();
    const url = await start({ warm, db, webhookSecret: 'whsec-12345678' });
    await post(url, { type: 'status-update', status: 'ringing', call: { id: 'call1' } });
    await post(url, { type: 'speech-update', status: 'started', role: 'user', call: { id: 'call1' } });
    expect(warm.warm).not.toHaveBeenCalled();
    expect(warm.release).not.toHaveBeenCalled();
  });

  it('shuts the pool down with the server', async () => {
    const warm = { warm: vi.fn(), release: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
    await start({ warm });
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    expect(warm.dispose).toHaveBeenCalledOnce();
  });

  it('works exactly as before without a pool', async () => {
    const { db } = recordingDb();
    const url = await start({ db, webhookSecret: 'whsec-12345678' });
    const r = await post(url, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } });
    expect(r.status).toBe(200);
  });
});
