import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../../services/mcp/src/server';
import { createFakeStore } from './fake-store';

const TOKEN = 'test-token-123';
let server: Server;
let url: string;

beforeAll(async () => {
  server = createHttpServer({ store: createFakeStore(), authToken: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function connect(token = TOKEN) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
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
});
