import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionController } from '../../services/agent/src/session/controller';
import { DEFAULT_SESSION_CONFIG, type SessionConfig } from '../../services/agent/src/session/types';
import type { VapiCallControl } from '../../services/agent/src/session/vapi-control';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

function fakeDb() {
  const tables: Record<string, Row[]> = { conversations: [], conversation_turns: [], conversation_events: [] };
  const from = (table: string) => {
    const rows = tables[table];
    const filters: [string, unknown][] = [];
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    const matching = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push([c, v]), b),
      order: () => b,
      update: (p: Row) => ((mode = 'update'), (patch = p), b),
      insert: (row: Row) => (rows.push({ ...row }), Promise.resolve({ data: null, error: null })),
      upsert: (row: Row) => {
        if (!rows.some((r) => r.conversation_id === row.conversation_id)) {
          rows.push({ started_at: new Date().toISOString(), ended_at: null, end_reason: null, final_status: null, ...row });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        if (mode === 'update') {
          matching().forEach((r) => Object.assign(r, patch));
          return resolve({ data: null, error: null });
        }
        return resolve({ data: matching().slice(), error: null });
      },
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, tables };
}

const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, silenceSeconds: 10, countdownSeconds: 10 };
const ID = 'vapi_call1';

function setup() {
  const { db, tables } = fakeDb();
  const control: VapiCallControl = { say: vi.fn(async () => true), endCall: vi.fn(async () => true) };
  const session = new SessionController({ db, control, config });
  const msg = (type: string, extra: Row = {}) => session.handleVapiMessage(ID, { type, call: { id: 'call1' }, ...extra });
  return { session, control, tables, msg };
}

describe('typing activity lease', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('holds silence while the lease is fresh and re-arms it when the lease expires', async () => {
    const s = setup();
    await Promise.resolve(s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } }));
    await s.msg('speech-update', { role: 'assistant', status: 'started' });
    await s.msg('speech-update', { role: 'assistant', status: 'stopped' });

    expect(s.session.recordActivity(ID, 'start')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.session.phaseOf(ID)).toBe('active');

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.session.phaseOf(ID)).toBe('silence-warning');
  });

  it('does not change the hard session deadline', async () => {
    const s = setup();
    await Promise.resolve(s.session.handleVapiMessage(ID, { type: 'status-update', status: 'in-progress', call: { id: 'call1' } }));
    expect(s.session.recordActivity(ID, 'heartbeat')).toBe(true);
    await vi.advanceTimersByTimeAsync(360_000);
    expect(s.tables.conversations[0]?.end_reason === 'session-timeout' || s.session.phaseOf(ID) === 'ended' || s.session.phaseOf(ID) === 'ending').toBe(true);
  });
});
