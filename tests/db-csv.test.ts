import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../scripts/db/csv';

const load = (name: string) => parseCsv(readFileSync(`supabase/seed/${name}.csv`, 'utf8'));

describe('seed CSV parsing', () => {
  it('turns empty cells into null', () => {
    expect(parseCsv('a,b\n1,\n')).toEqual([{ a: '1', b: null }]);
  });

  it('loads the expected row counts', () => {
    expect(load('customers')).toHaveLength(5);
    expect(load('transactions')).toHaveLength(5);
    expect(load('payouts')).toHaveLength(3);
  });

  it('maps blank fields in the supplied data to null', () => {
    expect(load('payouts').find((p) => p.payout_id === 'PAY-7001')?.failure_reason).toBeNull();
    const t = load('transactions');
    expect(t.find((r) => r.transaction_id === 'TXN-9003')?.estimated_arrival).toBeNull();
    expect(t.find((r) => r.transaction_id === 'TXN-9004')?.estimated_arrival).toBeNull();
  });

  it('keeps foreign keys consistent within the seed files', () => {
    const customers = new Set(load('customers').map((c) => c.customer_id));
    const txns = new Set(load('transactions').map((t) => t.transaction_id));
    for (const t of load('transactions')) expect(customers.has(t.customer_id)).toBe(true);
    for (const p of load('payouts')) {
      expect(customers.has(p.customer_id)).toBe(true);
      expect(txns.has(p.transaction_id)).toBe(true);
    }
  });
});
