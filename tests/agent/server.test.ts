import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';
import { ACK_TEMPLATES } from '../../services/agent/src/acks';
import { SAFE_SPOKEN_ERROR, SLOW_FILLER } from '../../services/agent/src/vapi';

const TOKEN = 'agent-token-0123456789';
let server: Server | undefined;

async function start(opts: Partial<AgentServerOptions> = {}) {
  const calls: { conversationId: string; userMessage: string }[] = [];
  server = createAgentServer({
    apiToken: TOKEN,
    runTurn: async (input) => {
      calls.push(input);
      return { response: `echo: ${input.userMessage}` };
    },
    ...opts,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls };
}

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const body = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    call: { id: 'call1' },
    messages: [
      { role: 'system', content: 'vapi prompt' },
      { role: 'user', content: 'check TXN-9001' },
    ],
    ...extra,
  });

describe('POST /chat/completions', () => {
  it('requires the bearer token', async () => {
    const { url, calls } = await start();
    const bad: Record<string, string>[] = [{}, { Authorization: 'Bearer wrong' }, { Authorization: TOKEN }];
    for (const headers of bad) {
      const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: body() });
      expect(r.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('answers a non-streaming request in OpenAI format using the last user message', async () => {
    const { url, calls } = await start();
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body() });
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.choices[0].message).toEqual({ role: 'assistant', content: 'echo: check TXN-9001' });
    // The turn also carries its stopwatch and progress, which are not part of what Vapi sent.
    expect(calls).toMatchObject([{ conversationId: 'vapi_call1', userMessage: 'check TXN-9001' }]);
  });

  it('also serves /v1/chat/completions', async () => {
    const { url } = await start();
    const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: auth, body: body() });
    expect(r.status).toBe(200);
  });

  it('streams SSE chunks ending with [DONE]', async () => {
    const { url } = await start();
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body({ stream: true }) });
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const text = await r.text();
    const events = text.split('\n\n').filter(Boolean);
    expect(events.at(-1)).toBe('data: [DONE]');
    const chunks = events.slice(0, -1).map((e) => JSON.parse(e.slice(6)));
    expect(chunks[0].choices[0].delta.role).toBe('assistant');
    expect(chunks.map((c) => c.choices[0].delta.content ?? '').join('')).toBe('echo: check TXN-9001');
    expect(chunks.at(-1).choices[0].finish_reason).toBe('stop');
    // A fast turn is not interrupted by any acknowledgement.
    for (const phrases of Object.values(ACK_TEMPLATES)) for (const p of phrases) expect(text).not.toContain(p);
    expect(text).not.toContain(SLOW_FILLER);
  });

  it('speaks a filler only when the turn is slow', async () => {
    const { url } = await start({
      fillerAfterMs: 20,
      runTurn: async () => {
        await new Promise((r) => setTimeout(r, 120));
        return { response: 'Done.' };
      },
    });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body({ stream: true }) });
    const text = await r.text();
    const spoken = text
      .split('\n\n')
      .filter((e) => e.startsWith('data: {'))
      .map((e) => JSON.parse(e.slice(6)).choices[0].delta.content ?? '')
      .join('');
    // The request mentions TXN-9001, so the acknowledgement fits a transaction lookup.
    expect(spoken.endsWith(' Done.')).toBe(true);
    const ack = spoken.slice(0, -'Done.'.length).trimEnd();
    expect(ACK_TEMPLATES.transaction_lookup).toContain(ack);
  });

  it('turns failures into a safe spoken message without leaking the error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({
      runTurn: async () => {
        throw new Error('connect ECONNREFUSED db.internal:5432 password=hunter2');
      },
    });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body() });
    expect(r.status).toBe(200);
    const text = JSON.stringify(await r.json());
    expect(text).toContain(SAFE_SPOKEN_ERROR.slice(0, 20));
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|db\.internal/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects malformed requests', async () => {
    const { url, calls } = await start();
    const post = (b: string, headers: Record<string, string> = auth) =>
      fetch(`${url}/chat/completions`, { method: 'POST', headers, body: b });
    expect((await post('{not json')).status).toBe(400);
    expect((await post(JSON.stringify({ call: { id: 'c' }, messages: [{ role: 'system', content: 'x' }] }))).status).toBe(400);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }))).status).toBe(400);
    spy.mockRestore();
    expect((await post('x'.repeat(300 * 1024))).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('runs turns of the same call one at a time, in arrival order', async () => {
    const order: string[] = [];
    const { url } = await start({
      runTurn: async ({ userMessage }) => {
        order.push(`start ${userMessage}`);
        await new Promise((r) => setTimeout(r, userMessage === 'one' ? 60 : 5));
        order.push(`end ${userMessage}`);
        return { response: userMessage };
      },
    });
    const send = (msg: string) =>
      fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ call: { id: 'same' }, messages: [{ role: 'user', content: msg }] }),
      });
    const first = send('one');
    await new Promise((r) => setTimeout(r, 15));
    await Promise.all([first, send('two')]);
    expect(order).toEqual(['start one', 'end one', 'start two', 'end two']);
  });
});

describe('Session Controller integration', () => {
  type Decision = { kind: 'proceed' } | { kind: 'reply'; text: string };
  function fakeSession(decide: (msg: string) => Decision = () => ({ kind: 'proceed' })) {
    const log = {
      before: [] as { conversationId: string; callId?: string; userMessage: string }[],
      after: [] as unknown[],
      vapi: [] as { id: string; message: Record<string, unknown> }[],
      disposed: false,
    };
    const session = {
      beforeTurn: async (i: { conversationId: string; callId?: string; userMessage: string }) => {
        log.before.push(i);
        return decide(i.userMessage);
      },
      afterTurn: (...args: unknown[]) => void log.after.push(args),
      handleVapiMessage: async (id: string, message: Record<string, unknown>) => void log.vapi.push({ id, message }),
      consumeSpeechGapMs: () => undefined,
      dispose: () => void (log.disposed = true),
    };
    return { session: session as never, log };
  }
  const say = (text: string) =>
    body({ messages: [{ role: 'user', content: text }] });

  it('answers a closer itself: the agent is not run, the reply is spoken as normal', async () => {
    const { session, log } = fakeSession((m) => (m === "that's all" ? { kind: 'reply', text: 'Goodbye.' } : { kind: 'proceed' }));
    const { url, calls } = await start({ session });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: say("that's all") });
    expect((await r.json()).choices[0].message.content).toBe('Goodbye.');
    expect(calls).toHaveLength(0);
    expect(log.after).toHaveLength(0);
    expect(log.before[0]).toEqual({ conversationId: 'vapi_call1', callId: 'call1', userMessage: "that's all", textOnly: false });
  });

  it('keeps the SSE contract for controller replies', async () => {
    const { session } = fakeSession(() => ({ kind: 'reply', text: 'Goodbye.' }));
    const { url } = await start({ session });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body({ stream: true }) });
    const text = await r.text();
    expect(text).toContain('Goodbye.');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('runs the agent for normal turns and reports the result back', async () => {
    const { session, log } = fakeSession();
    const { url, calls } = await start({ session });
    await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body() });
    expect(calls).toHaveLength(1);
    expect(log.after).toEqual([['vapi_call1', { response: 'echo: check TXN-9001' }]]);
  });

  it('reports a failed turn too, so silence is not held forever, and still answers safely', async () => {
    const { session, log } = fakeSession();
    const { url } = await start({
      session,
      runTurn: async () => {
        throw new Error('boom');
      },
    });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: body() });
    expect((await r.json()).choices[0].message.content).toBe(SAFE_SPOKEN_ERROR);
    expect(log.after).toEqual([['vapi_call1']]);
  });

  it('forwards Vapi speech and status messages to the controller', async () => {
    const { session, log } = fakeSession();
    const { url } = await start({ session, webhookSecret: 'whsec-12345678', db: {} as never });
    const message = { type: 'speech-update', status: 'stopped', role: 'assistant', call: { id: 'call1' } };
    const r = await fetch(`${url}/vapi/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vapi-secret': 'whsec-12345678' },
      body: JSON.stringify({ message }),
    });
    expect(r.status).toBe(200);
    expect(log.vapi).toEqual([{ id: 'vapi_call1', message }]);
  });

  it('clears the controller timers when the server closes', async () => {
    const { session, log } = fakeSession();
    await start({ session });
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    expect(log.disposed).toBe(true);
  });
});

describe('other routes', () => {
  it('serves /health without auth and 404s unknown paths', async () => {
    const { url } = await start();
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/nope`)).status).toBe(404);
    expect((await fetch(`${url}/chat/completions`, { headers: auth })).status).toBe(405);
  });

  it('disables the webhook unless a secret is configured', async () => {
    const { url } = await start();
    const r = await fetch(`${url}/vapi/events`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(404);
  });

  it('checks the webhook secret and acknowledges events', async () => {
    const { url } = await start({ webhookSecret: 'whsec-12345678', db: {} as never });
    const post = (headers: Record<string, string>) =>
      fetch(`${url}/vapi/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ message: { type: 'speech-update' } }) });
    expect((await post({})).status).toBe(401);
    expect((await post({ 'x-vapi-secret': 'wrong' })).status).toBe(401);
    expect((await post({ 'x-vapi-secret': 'whsec-12345678' })).status).toBe(200);
  });
});
