import { describe, expect, it, vi } from 'vitest';
import { executeTool, flushToolRecords, tools } from '../../services/mcp/src/tools';
import { createFakeStore } from './fake-store';

const tool = (name: string) => tools.find((t) => t.name === name)!;

/** A store whose tool-call write waits until the test lets it finish. */
function gatedStore() {
  const store = createFakeStore();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const original = store.recordToolCall.bind(store);
  store.recordToolCall = async (record) => {
    await gate;
    return original(record);
  };
  return { store, release };
}

describe('recording tool calls in the background', () => {
  it('returns the result without waiting for the tool_calls row', async () => {
    const { store, release } = gatedStore();
    const result = await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store, {
      conversationId: 'vapi_a',
      background: true,
    });
    expect(result).toMatchObject({ found: true, transaction_id: 'TXN-9001' });
    expect(store.toolCalls).toHaveLength(0); // the write is still waiting
    release();
    await flushToolRecords();
    expect(store.toolCalls).toHaveLength(1);
    expect(store.toolCalls[0]).toMatchObject({
      conversation_id: 'vapi_a',
      tool_name: 'lookup_transaction',
      status: 'success',
    });
  });

  it('writes the same row as the awaited path', async () => {
    const awaited = createFakeStore();
    const background = createFakeStore();
    await executeTool(tool('lookup_payout'), { payout_id: 'PAY-7001' }, awaited, { conversationId: 'vapi_a' });
    await executeTool(tool('lookup_payout'), { payout_id: 'PAY-7001' }, background, { conversationId: 'vapi_a', background: true });
    await flushToolRecords();
    const strip = (r: Record<string, unknown>) => ({ ...r, duration_ms: 0 });
    expect(strip(background.toolCalls[0] as never)).toEqual(strip(awaited.toolCalls[0] as never));
  });

  it('is the awaited path by default, so existing callers see the row straight away', async () => {
    const store = createFakeStore();
    await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store, { conversationId: 'vapi_a' });
    expect(store.toolCalls).toHaveLength(1);
  });

  it('never lets a failed write reach the model', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createFakeStore();
    store.recordToolCall = async () => {
      throw new Error('db down');
    };
    const result = await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store, {
      conversationId: 'vapi_a',
      background: true,
    });
    expect(result).toMatchObject({ found: true });
    await expect(flushToolRecords()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('records failures and misses too', async () => {
    const store = createFakeStore();
    await executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-0000' }, store, { background: true });
    await executeTool(tool('lookup_transaction'), {}, store, { background: true });
    await flushToolRecords();
    expect(store.toolCalls.map((c) => c.status).sort()).toEqual(['failed', 'not_found']);
  });

  it('can be flushed repeatedly and when nothing is pending', async () => {
    await expect(flushToolRecords()).resolves.toBeUndefined();
    const store = createFakeStore();
    await executeTool(tool('lookup_customer'), { customer_id: 'CUS-1001' }, store, { background: true });
    await flushToolRecords();
    await flushToolRecords();
    expect(store.toolCalls).toHaveLength(1);
  });

  it('keeps writes of several calls independent', async () => {
    const store = createFakeStore();
    await Promise.all([
      executeTool(tool('lookup_transaction'), { transaction_id: 'TXN-9001' }, store, { conversationId: 'vapi_a', background: true }),
      executeTool(tool('lookup_customer'), { customer_id: 'CUS-1001' }, store, { conversationId: 'vapi_b', background: true }),
    ]);
    await flushToolRecords();
    expect(store.toolCalls.map((c) => c.conversation_id).sort()).toEqual(['vapi_a', 'vapi_b']);
  });
});
