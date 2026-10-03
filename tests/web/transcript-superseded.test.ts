import { describe, expect, it } from 'vitest';
import { dropSupersededTurns } from '@/lib/dashboard/superseded';

const row = (id: string, delivered?: boolean) => ({ id, timings: delivered === undefined ? null : { delivered } });

describe('dropSupersededTurns', () => {
  it('drops a turn whose reply was never played when a later turn exists', () => {
    expect(dropSupersededTurns([row('a', false), row('b', true)]).map((r) => r.id)).toEqual(['b']);
  });

  it('drops each abandoned turn in a run of fragments, keeping the one that was answered', () => {
    const rows = [row('a', false), row('b', false), row('c', false), row('d', true)];
    expect(dropSupersededTurns(rows).map((r) => r.id)).toEqual(['d']);
  });

  it('keeps an undelivered last turn: the caller may simply have hung up', () => {
    expect(dropSupersededTurns([row('a', true), row('b', false)]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('keeps delivered turns and turns with no timings recorded', () => {
    expect(dropSupersededTurns([row('a', true), row('b'), row('c', true)]).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('copes with nothing at all', () => {
    expect(dropSupersededTurns([])).toEqual([]);
  });
});
