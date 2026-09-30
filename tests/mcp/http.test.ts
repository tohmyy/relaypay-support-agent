import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../../services/mcp/src/server';
import { createFakeStore, type FakeStore } from './fake-store';
import { conversationIdFromHeader } from '../../services/mcp/src/server';

const TOKEN = 'test-token-123';
let server: Server;
let url: string;
let store: FakeStore;

beforeAll(async () => {
  store = createFakeStore();
  server = createHttpServer({ store, authToken: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function connect(token = TOKEN, extraHeaders: Record<string, string> = {}) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}`, ...extraHeaders } },
    }),
  );
  return client;
}

describe('MCP over HTTP', () => {
  it('rejects requests without a valid bearer token', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    expect((await fetch(`${url}/mcp`, { method: 'POST', headers, body })).status).toBe(401);
    const wrong = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer nope' },
      body,
    });
    expect(wrong.status).toBe(401);
    await expect(connect('nope')).rejects.toThrow();
  });

  it('serves a health check and 404s other paths', async () => {
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/other`)).status).toBe(404);
  });

  it('lists the six tools and runs one', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_escalation',
      'create_support_ticket',
      'log_conversation_event',
      'lookup_customer',
      'lookup_payout',
      'lookup_transaction',
    ]);

    const ok = await client.callTool({ name: 'lookup_transaction', arguments: { transaction_id: 'TXN-9001' } });
    expect(ok.isError).toBe(false);
    expect(ok.structuredContent).toMatchObject({ found: true, status: 'processing', amount: 2400 });

    const missing = await client.callTool({ name: 'lookup_transaction', arguments: {} });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ error: { code: 'invalid_input' } });
    await client.close();
  });

  it('ties tool calls to the conversation named in X-Conversation-Id', async () => {
    const before = store.toolCalls.length;
    const client = await connect(TOKEN, { 'X-Conversation-Id': 'conv_header-1' });
    await client.callTool({ name: 'lookup_customer', arguments: { customer_id: 'CUS-1001' } });
    await client.close();
    const row = store.toolCalls.at(-1)!;
    expect(store.toolCalls.length).toBe(before + 1);
    expect(row).toMatchObject({ tool_name: 'lookup_customer', conversation_id: 'conv_header-1' });
    expect(store.conversations.has('conv_header-1')).toBe(true);
  });

  it('prefers the conversation id in the tool input over the header', async () => {
    const client = await connect(TOKEN, { 'X-Conversation-Id': 'conv_header-2' });
    await client.callTool({
      name: 'log_conversation_event',
      arguments: { conversation_id: 'conv_input-2', event_type: 'x', summary: 's' },
    });
    await client.close();
    expect(store.toolCalls.at(-1)).toMatchObject({ conversation_id: 'conv_input-2' });
  });

  it('ignores malformed conversation headers', () => {
    expect(conversationIdFromHeader('conv_ok-1')).toBe('conv_ok-1');
    expect(conversationIdFromHeader(['a', 'b'])).toBe('a');
    for (const bad of ['', 'x'.repeat(65), 'bad id!', "a'; drop table", undefined]) {
      expect(conversationIdFromHeader(bad)).toBeUndefined();
    }
  });
});
