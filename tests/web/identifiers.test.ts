import { describe, expect, it } from 'vitest';
import { canonicalizeIdentifiers as agentCopy } from '../../services/agent/src/display';
import { canonicalizeIdentifiers as webCopy } from '@/lib/identifiers';

// The web copy shows the live transcript's reference numbers in RelayPay's form; it must behave exactly like the agent's.
const TABLE = [
  'TXN minus 9 00 1',
  't x n minus 9001',
  'txn dash 9001',
  'T X N 9 0 0 1',
  'I checked TXN minus 9 00 1, and it is processing.',
  'Both TXN minus 9001 and PAY minus 7 0 0 2 are fine.',
  'Your ticket is TKT minus 000 007.',
  'TXN minus nine zero zero one',
  'TXN-9001 is already canonical.',
  'We pay 2400 dollars on the 9th.',
  'You can pay 2400 now, or esc 000012 for later.',
  'TXN minus 90',
  'No reference numbers here.',
  '',
];

describe('web canonicalizeIdentifiers', () => {
  it.each(TABLE)('matches the agent copy for %j', (text) => {
    expect(webCopy(text)).toBe(agentCopy(text));
  });

  it('rewrites a spoken reference and leaves an ordinary sentence alone', () => {
    expect(webCopy('It is t x n minus 9001.')).toBe('It is TXN-9001.');
    expect(webCopy('We pay 2400 dollars on the 9th.')).toBe('We pay 2400 dollars on the 9th.');
  });
});
