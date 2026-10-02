import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadyCheck, mcpHealthUrl, type ReadyResponse } from '../../services/agent/src/ready';
import { PermanentError, withRetry } from '../../services/agent/src/retry';
import { createAgentServer, type AgentServerOptions } from '../../services/agent/src/server';
import { fakeDb } from './fake-db';

describe('agent retry twin', () => {
  it('retries a transient failure once and stops there', async () => {
    const op = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce('ok');
    expect(await withRetry(op, { operation: 't', sleep: async () => {} })).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(bad, { operation: 't', sleep: async () => {} })).rejects.toThrow('down');
    expect(bad).toHaveBeenCalledTimes(2);

    const permanent = vi.fn().mockRejectedValue(new PermanentError());
    await expect(withRetry(permanent, { operation: 't', sleep: async () => {} })).rejects.toThrow();
    expect(permanent).toHaveBeenCalledTimes(1);
  });
});

describe('createReadyCheck', () => {
  const okFetch = (async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;

  it('points at /health on the MCP origin', () => {
    expect(mcpHealthUrl('http://127.0.0.1:4000/mcp')).toBe('http://127.0.0.1:4000/health');
  });

  it('reports ok with timings when MCP and the database answer', async () => {
    const { db } = fakeDb();
    const report = await createReadyCheck({ db, mcpUrl: 'http://x/mcp', fetchImpl: okFetch })();
    expect(report.ok).toBe(true);
    expect(report.checks.mcp.ok).toBe(true);
    expect(report.checks.db.ok).toBe(true);
    expect(typeof report.checks.mcp.ms).toBe('number');
  });

  it('is not ready when the MCP server is down', async () => {
    const { db } = fakeDb();
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const report = await createReadyCheck({ db, mcpUrl: 'http://x/mcp', fetchImpl: down })();
    expect(report).toMatchObject({ ok: false, checks: { mcp: { ok: false }, db: { ok: true } } });
  });

  it('is not ready on a non-200 MCP answer', async () => {
    const { db } = fakeDb();
    const sick = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const report = await createReadyCheck({ db, mcpUrl: 'http://x/mcp', fetchImpl: sick })();
    expect(report.checks.mcp).toMatchObject({ ok: false, error: 'status 500' });
  });

  it('times out a hung dependency', async () => {
    const { db } = fakeDb();
    const hung = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const report = await createReadyCheck({ db, mcpUrl: 'http://x/mcp', fetchImpl: hung, timeoutMs: 30 })();
    expect(report.checks.mcp).toMatchObject({ ok: false, error: 'timeout' });
    expect(report.ok).toBe(false);
  });
});

describe('GET /ready', () => {
  const TOKEN = 'agent-token-0123456789';
  let server: Server | undefined;

  async function start(opts: Partial<AgentServerOptions> = {}) {
    server = createAgentServer({ apiToken: TOKEN, runTurn: async () => ({ response: 'x' }), ...opts });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });
  const auth = { Authorization: `Bearer ${TOKEN}` };

  it('keeps /health as pure liveness', async () => {
    const url = await start({ ready: async () => ({ ok: false, checks: { mcp: { ok: false }, db: { ok: false } } }) });
    const r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('answers 200 with the checks when everything is up', async () => {
    const report: ReadyResponse = { ok: true, checks: { mcp: { ok: true, ms: 3 }, db: { ok: true, ms: 5 } } };
    const url = await start({ ready: async () => report });
    const r = await fetch(`${url}/ready`, { headers: auth });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(report);
  });

  it('answers 503 when a dependency is down', async () => {
    const url = await start({
      ready: async () => ({ ok: false, checks: { mcp: { ok: false, error: 'timeout' }, db: { ok: true } } }),
    });
    const r = await fetch(`${url}/ready`, { headers: auth });
    expect(r.status).toBe(503);
    expect((await r.json()).checks.mcp.ok).toBe(false);
  });

  it('answers 503 (not a crash) when the check itself throws', async () => {
    const url = await start({
      ready: async () => {
        throw new Error('boom');
      },
    });
    expect((await fetch(`${url}/ready`, { headers: auth })).status).toBe(503);
  });

  it('requires the bearer token', async () => {
    const url = await start();
    expect((await fetch(`${url}/ready`)).status).toBe(401);
    expect((await fetch(`${url}/ready`, { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  });
});
