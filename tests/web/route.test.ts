import { beforeEach, describe, expect, it, vi } from 'vitest';

const restSelect = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase.server', () => ({ restSelect: (...args: unknown[]) => restSelect(...args) }));

import { GET } from '@/app/api/conversations/[id]/state/route';

const call = (id: string) => GET(new Request('http://localhost/x'), { params: Promise.resolve({ id }) });

beforeEach(() => {
  restSelect.mockReset();
});

describe('GET /api/conversations/[id]/state', () => {
  it('returns only the public fields and never caches', async () => {
    restSelect.mockImplementation(async (table: string) => {
      if (table === 'conversation_turns') return [{ turn_number: 2, answer_type: 'escalation', user_transcript: 'secret text' }];
      if (table === 'support_tickets') return [{ ticket_id: 'TKT-000007', summary: 'internal summary' }];
      if (table === 'escalations') return [{ preferred_time: 'Friday', user_email: 'a@b.co', user_name: 'Ada' }];
      return [{ ended_at: null }];
    });
    const res = await call('vapi_abc-123');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      answerType: 'escalation',
      ticketReference: 'TKT-000007',
      escalation: { requestedTime: 'Friday' },
      ended: false,
      endReason: null,
    });
    // Exactly the whitelisted fields, nothing from the underlying rows.
    expect(Object.keys(body).sort()).toEqual([
      'answerType', 'endReason', 'ended', 'escalation', 'limits', 'serverTime', 'startedAt', 'supportMode', 'ticketReference',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/secret text|internal summary|a@b\.co|Ada/);
  });

  it('reports why and when a session ended, and the limits the UI counts down against', async () => {
    restSelect.mockImplementation(async (table: string) =>
      table === 'conversations'
        ? [{ ended_at: '2026-10-01T12:00:25Z', end_reason: 'silence-timeout', started_at: '2026-10-01T12:00:00Z' }]
        : [],
    );
    const body = await (await call('vapi_abc-123')).json();
    expect(body).toMatchObject({
      ended: true,
      endReason: 'silence-timeout',
      startedAt: '2026-10-01T12:00:00.000Z',
      limits: { sessionMaxSeconds: 360, warningSeconds: 30, silenceTimeoutSeconds: 15, countdownSeconds: 10 },
    });
    expect(Number.isFinite(Date.parse(body.serverTime))).toBe(true);
    const conversationsQuery = restSelect.mock.calls.find(([t]) => t === 'conversations')![1] as string;
    expect(conversationsQuery).toContain('end_reason');
    expect(conversationsQuery).toContain('started_at');
  });

  it('answers an unknown conversation exactly like an empty one', async () => {
    restSelect.mockResolvedValue([]);
    const res = await call('vapi_does-not-exist');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      answerType: null,
      ticketReference: null,
      escalation: null,
      ended: false,
      endReason: null,
      startedAt: null,
    });
  });

  it('rejects malformed ids before touching the database', async () => {
    for (const bad of ['a b', 'x'.repeat(65), "a'; drop", '..%2Fetc']) {
      const res = await call(bad);
      expect(res.status).toBe(400);
    }
    expect(restSelect).not.toHaveBeenCalled();
  });

  it('encodes the id in the query and scopes every read to it', async () => {
    restSelect.mockResolvedValue([]);
    await call('conv_a.b:c-1');
    expect(restSelect).toHaveBeenCalledTimes(4);
    for (const [, query] of restSelect.mock.calls) expect(query).toContain('conversation_id=eq.conv_a.b%3Ac-1');
  });

  it('fails safely without leaking the technical error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    restSelect.mockRejectedValue(new Error('connect ECONNREFUSED db.internal:5432'));
    const res = await call('vapi_abc');
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/ECONNREFUSED|db\.internal/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
