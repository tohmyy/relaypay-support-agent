import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';
import { SessionController } from '../../services/agent/src/session/controller';
import { DEFAULT_SESSION_CONFIG, NO_LIMITS, SESSION_TEXT } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import { fakeDb } from './fake-db';

const TOKEN = 'agent-token-0123456789';
let server: Server | undefined;

async function start(opts: Partial<AgentServerOptions> = {}) {
  const calls: { conversationId: string; userMessage: string }[] = [];
  server = createAgentServer({
    apiToken: TOKEN,
    runTurn: async (input) => {
      calls.push(input);
      return { response: `echo: ${input.userMessage}`, answerType: 'direct_answer', toolsUsed: [], retrieved: true };
    },
    ...opts,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls };
}
afterEach(async () => {
  vi.useRealTimers();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const post = (url: string, body: unknown, headers: Record<string, string> = auth) =>
  fetch(`${url}/text-turn`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('POST /text-turn', () => {
  it('requires the bearer token and POST', async () => {
    const { url, calls } = await start();
    expect((await post(url, { conversationId: 'text_a', message: 'hi' }, { 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post(url, { conversationId: 'text_a', message: 'hi' }, { ...auth, Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await fetch(`${url}/text-turn`, { headers: auth })).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('validates the conversation id and the message', async () => {
    const { url, calls } = await start();
    expect((await post(url, 'not json')).status).toBe(400);
    expect((await post(url, { message: 'hi' })).status).toBe(400);
    expect((await post(url, { conversationId: 'a b', message: 'hi' })).status).toBe(400);
    expect((await post(url, { conversationId: 'text_a', message: '   ' })).status).toBe(400);
    expect((await post(url, { conversationId: 'text_a', message: 'x'.repeat(2001) })).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it('runs the typed message as a normal turn and answers with the text', async () => {
    const { url, calls } = await start();
    const r = await post(url, { conversationId: 'text_a', message: '  Where is my payout?  ' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ response: 'echo: Where is my payout?', ended: false });
    expect(calls).toMatchObject([{ conversationId: 'text_a', userMessage: 'Where is my payout?' }]);
  });

  it('answers a failed turn with the safe line, not the error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({
      runTurn: async () => {
        throw new Error('db down at host.internal');
      },
    });
    const body = await (await post(url, { conversationId: 'text_a', message: 'hi' })).json();
    expect(JSON.stringify(body)).not.toContain('host.internal');
    expect(body.response).toBeTruthy();
    spy.mockRestore();
  });
});

describe('typed conversations and the Session Controller (AC-13.2)', () => {
  function withSession() {
    const f = fakeDb({
      conversations: [{ conversation_id: 'text_a', started_at: new Date(Date.now() - 3_600_000).toISOString(), ended_at: null, end_reason: null, final_status: null, support_mode: 'ai', customer_id: 'CUS-1001' }],
    });
    const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
    const session = new SessionController({
      db: f.db,
      control,
      config: { ...DEFAULT_SESSION_CONFIG, maxSeconds: 360, silenceSeconds: 1, countdownSeconds: 1, requireLink: true, linkGraceSeconds: 1, limits: NO_LIMITS },
    });
    return { ...f, control, session };
  }

  it('has no time limit, no silence timer and no link grace (it is already linked and nothing is spoken)', async () => {
    vi.useFakeTimers();
    const w = withSession();
    const { url } = await start({ session: w.session, db: w.db });
    // The conversation began an hour ago: a voice call would be long past its 6 minute cap.
    const r = await post(url, { conversationId: 'text_a', message: 'Where is my payout?' });
    expect((await r.json()).ended).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    const row = w.tables.conversations[0];
    expect(row.end_reason).toBeNull();
    expect(w.control.endCall).not.toHaveBeenCalled();
    expect(w.control.say).not.toHaveBeenCalled();
  });

  it('a closer ends the typed conversation at once as resolved, without trying to hang up a call', async () => {
    const w = withSession();
    const { url } = await start({ session: w.session, db: w.db });
    w.tables.conversation_turns.push({ conversation_id: 'text_a', turn_number: 1 });
    const r = await post(url, { conversationId: 'text_a', message: "That's all, thank you" });
    expect(await r.json()).toEqual({ response: SESSION_TEXT.goodbye, ended: true });
    expect(w.tables.conversations[0]).toMatchObject({ end_reason: 'user-ended', final_status: 'resolved' });
    expect(w.control.endCall).not.toHaveBeenCalled();
    // After that the conversation stays ended.
    const again = await (await post(url, { conversationId: 'text_a', message: 'hello?' })).json();
    expect(again).toEqual({ response: SESSION_TEXT.ended, ended: true });
  });

  it('ends a conversation of noise with the low-confidence reason', async () => {
    const w = withSession();
    const { url } = await start({ session: w.session, db: w.db });
    let last: { response: string; ended: boolean } = { response: '', ended: false };
    for (const m of ['hjkl', 'qwrtp', 'mmm']) {
      last = await (await post(url, { conversationId: 'text_a', message: m })).json();
    }
    expect(last).toEqual({ response: SESSION_TEXT.lowConfidence, ended: true });
    expect(w.tables.conversations[0]).toMatchObject({ end_reason: 'low-confidence' });
  });
});
