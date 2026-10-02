import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACK_TEMPLATES } from '../../services/agent/src/acks';
import { createAgentServer } from '../../services/agent/src/server';

const TOKEN = 'agent-token-0123456789';
let server: Server | undefined;

async function start(opts: Parameters<typeof createAgentServer>[0] extends infer T ? Partial<T> : never = {}) {
  const calls: { conversationId: string; userMessage: string }[] = [];
  server = createAgentServer({
    apiToken: TOKEN,
    runTurn: async (input) => {
      calls.push(input);
      return { response: `echo: ${input.userMessage}` };
    },
    fillerAfterMs: 20,
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
const say = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    call: { id: 'call1' },
    stream: true,
    messages: [{ role: 'user', content: text }],
    ...extra,
  });

describe('ack admission', () => {
  it('never speaks an acknowledgement or runs the model for a clear closer', async () => {
    const admit = vi.fn(() => 'close' as const);
    const ackEligible = vi.fn(() => false);
    const { url, calls } = await start({
      session: {
        admit,
        ackEligible,
        beforeTurn: async () => ({ kind: 'reply', text: 'Goodbye.' }),
        afterTurn: () => undefined,
        handleVapiMessage: async () => undefined,
        consumeSpeechGapMs: () => undefined,
        dispose: () => undefined,
      } as never,
    });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: say("that'll be all") });
    const text = await r.text();
    expect(text).toContain('Goodbye.');
    expect(calls).toHaveLength(0);
    expect(admit).toHaveBeenCalledWith("that'll be all");
    for (const phrases of Object.values(ACK_TEMPLATES)) {
      for (const p of phrases) expect(text).not.toContain(p);
    }
  });

  it('does not speak an acknowledgement when eligibility is gone by the time the timer fires', async () => {
    const ackEligible = vi.fn(() => false);
    const { url, calls } = await start({
      session: {
        admit: () => 'proceed',
        ackEligible,
        beforeTurn: async () => {
          await new Promise((r) => setTimeout(r, 80));
          return { kind: 'proceed' };
        },
        afterTurn: () => undefined,
        handleVapiMessage: async () => undefined,
        consumeSpeechGapMs: () => undefined,
        dispose: () => undefined,
      } as never,
    });
    const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: auth, body: say('check TXN-9001') });
    const text = await r.text();
    expect(calls).toHaveLength(1);
    expect(ackEligible).toHaveBeenCalled();
    for (const phrases of Object.values(ACK_TEMPLATES)) {
      for (const p of phrases) expect(text).not.toContain(p);
    }
  });
});
