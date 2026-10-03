import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AckRotation } from '../../services/agent/src/acks';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';

const TOKEN = 'agent-token-0123456789';
let server: Server | undefined;

/** A database whose every call succeeds; records timing updates so they can be inspected. */
function recordingDb() {
  const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const chain = (filters: [string, unknown][] = [], patch?: Record<string, unknown>): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              if (patch) updates.push({ patch, filters });
              resolve({ data: [], error: null });
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

function fakeSession() {
  const calls = { notDelivered: [] as string[] };
  const session = {
    beforeTurn: async () => ({ kind: 'proceed' as const }),
    afterTurn: () => {},
    handleVapiMessage: async () => {},
    consumeSpeechGapMs: () => undefined,
    replyNotDelivered: (id: string) => void calls.notDelivered.push(id),
    dispose: () => {},
  };
  return { session: session as never, calls };
}

async function start(opts: Partial<AgentServerOptions> = {}) {
  server = createAgentServer({
    apiToken: TOKEN,
    runTurn: async (input) => ({ response: `echo: ${input.userMessage}`, turnNumber: 4 }),
    ...opts,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

/** Sends a chat request and drops the connection after `leaveAfterMs`, like a customer talking over the assistant. */
function callAndLeave(port: number, leaveAfterMs: number, stream = true, content = 'check TXN-9001') {
  return new Promise<void>((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/chat/completions', method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } },
      (res) => res.on('data', () => {}).on('error', () => {}),
    );
    req.on('error', () => {});
    req.write(JSON.stringify({ call: { id: 'call1' }, stream, messages: [{ role: 'user', content }] }));
    req.end();
    setTimeout(() => {
      req.destroy();
      resolve();
    }, leaveAfterMs);
  });
}

describe('the customer talks over the assistant mid-turn', () => {
  it('lets the turn finish and be saved exactly as before, and records that nobody heard it', async () => {
    const { db, updates } = recordingDb();
    const { session, calls } = fakeSession();
    let finished = false;
    const port = await start({
      db,
      session,
      fillerAfterMs: 5000,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 120));
        finished = true;
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await callAndLeave(port, 30);
    await settle(250);
    expect(finished).toBe(true); // the turn is not cancelled
    expect(updates).toHaveLength(1);
    expect(updates[0].filters).toEqual([
      ['conversation_id', 'vapi_call1'],
      ['turn_number', 4],
    ]);
    const timings = updates[0].patch.timings as Record<string, unknown>;
    expect(timings.delivered).toBe(false);
    expect(typeof timings.client_closed_ms).toBe('number');
    expect(timings.client_closed_ms as number).toBeLessThan(120);
    expect(calls.notDelivered).toEqual(['vapi_call1']);
  });

  it('does not speak, count or advance the acknowledgement for someone who has gone', async () => {
    const { db, updates } = recordingDb();
    const acks = new AckRotation();
    const { session } = fakeSession();
    const port = await start({
      db,
      session,
      acks,
      fillerAfterMs: 80,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await callAndLeave(port, 25); // gone before the acknowledgement was due
    await settle(300);
    expect(acks.size).toBe(0); // the rotation never moved
    const timings = updates[0].patch.timings as Record<string, unknown>;
    expect(timings.ack_ms).toBeUndefined();
    expect(timings.ack_category).toBeUndefined();
  });

  it('still counts an acknowledgement that really was spoken before the customer left', async () => {
    const { db, updates } = recordingDb();
    const acks = new AckRotation();
    const { session } = fakeSession();
    const port = await start({
      db,
      session,
      acks,
      fillerAfterMs: 20,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 200));
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await callAndLeave(port, 90);
    await settle(300);
    const timings = updates[0].patch.timings as Record<string, unknown>;
    expect(timings.ack_category).toBe('transaction_lookup');
    expect(timings.delivered).toBe(false);
    expect(acks.size).toBe(1);
  });

  it('does the same for a non-streaming request, without writing to the dead connection', async () => {
    const { db, updates } = recordingDb();
    const { session, calls } = fakeSession();
    const port = await start({
      db,
      session,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await callAndLeave(port, 30, false);
    await settle(250);
    expect((updates[0].patch.timings as Record<string, unknown>).delivered).toBe(false);
    expect(calls.notDelivered).toEqual(['vapi_call1']);
  });

  it('records a delivered reply as delivered and tells the controller nothing', async () => {
    const { db, updates } = recordingDb();
    const { session, calls } = fakeSession();
    const port = await start({ db, session, fillerAfterMs: 5000 });
    const res = await fetch(`http://127.0.0.1:${port}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: { id: 'call1' }, stream: true, messages: [{ role: 'user', content: 'hello' }] }),
    });
    await res.text();
    await settle();
    const timings = updates[0].patch.timings as Record<string, unknown>;
    expect(timings.delivered).toBe(true);
    expect(timings.client_closed_ms).toBeUndefined();
    expect(calls.notDelivered).toEqual([]);
  });

  it('survives a controller that is not there', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const port = await start({
      fillerAfterMs: 5000,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { response: 'Done.', turnNumber: 4 };
      },
    });
    await callAndLeave(port, 20);
    await settle(200);
    // The server is still up and answers the next customer.
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    spy.mockRestore();
  });
});

describe('a caller who kept talking while an earlier turn was still running', () => {
  it('skips the queued turn nobody is waiting for: no model call, nothing saved, the next one still answers', async () => {
    const { db, updates } = recordingDb();
    const { session, calls } = fakeSession();
    const ran: string[] = [];
    const port = await start({
      db,
      session,
      fillerAfterMs: 5000,
      runTurn: async (input) => {
        ran.push(input.userMessage);
        await new Promise((r) => setTimeout(r, input.userMessage === 'first' ? 200 : 5));
        return { response: `reply to ${input.userMessage}`, turnNumber: ran.length };
      },
    });
    const ask = (content: string) =>
      fetch(`http://127.0.0.1:${port}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: { id: 'call1' }, stream: true, messages: [{ role: 'user', content }] }),
      }).then((r) => r.text());

    const first = ask('first'); // in flight, slow
    await settle(30);
    await callAndLeave(port, 30, true, 'second'); // queued behind it, then the caller moves on
    const third = ask('third'); // the newer request that carries what was said so far
    const [firstText, thirdText] = await Promise.all([first, third]);
    await settle(80);

    expect(ran).toEqual(['first', 'third']); // 'second' never reached the model
    expect(firstText).toContain('reply to first');
    expect(thirdText).toContain('reply to third');
    expect(calls.notDelivered).toContain('vapi_call1');
    // Timings are only stored for turns that ran.
    expect(updates.map((u) => u.filters.find(([c]) => c === 'turn_number')?.[1])).toEqual([1, 2]);
  });

  it('also skips an abandoned non-streaming request that is still queued', async () => {
    const { session } = fakeSession();
    const ran: string[] = [];
    const port = await start({
      session,
      runTurn: async (input) => {
        ran.push(input.userMessage);
        await new Promise((r) => setTimeout(r, input.userMessage === 'first' ? 150 : 5));
        return { response: 'ok', turnNumber: 1 };
      },
    });
    const first = fetch(`http://127.0.0.1:${port}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: { id: 'call1' }, messages: [{ role: 'user', content: 'first' }] }),
    }).then((r) => r.json());
    await settle(30);
    await callAndLeave(port, 30, false, 'second');
    await first;
    await settle(60);
    expect(ran).toEqual(['first']);
  });
});
