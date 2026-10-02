import { describe, expect, it } from 'vitest';
import { addTypedTurn, applyTranscript, reconcileDurable, type ConversationTurn } from '@/lib/transcript';

const t = (over: Partial<ConversationTurn> & Pick<ConversationTurn, 'id' | 'speaker' | 'text'>): ConversationTurn => ({
  final: true,
  timestamp: 1,
  source: 'live',
  ...over,
});

describe('applyTranscript', () => {
  it('keeps one assistant bubble for partial then final in the same reply', () => {
    const first = applyTranscript([], { role: 'assistant', text: 'Transaction TXN minus', final: false }, 1);
    const next = applyTranscript(first, { role: 'assistant', text: 'Transaction TXN minus 9 00 1 is processing.', final: true }, 2);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      speaker: 'assistant',
      text: 'Transaction TXN minus 9 00 1 is processing.',
      final: true,
    });
  });

  it('reopens a premature final when more same-role text arrives before the other speaker', () => {
    const closed = applyTranscript([], { role: 'assistant', text: 'I checked TXN-9001.', final: true }, 1);
    const continued = applyTranscript(closed, { role: 'assistant', text: 'It is still processing.', final: true }, 2);
    expect(continued).toHaveLength(1);
    expect(continued[0].text).toContain('TXN-9001');
    expect(continued[0].text).toContain('still processing');
  });

  it('dedupes an out-of-order chunk that is a prefix of the current text', () => {
    const first = applyTranscript([], { role: 'assistant', text: 'Transaction TXN-9001 is processing.', final: false }, 1);
    const dup = applyTranscript(first, { role: 'assistant', text: 'Transaction TXN-9001', final: false }, 2);
    expect(dup).toHaveLength(1);
    expect(dup[0].text).toBe('Transaction TXN-9001 is processing.');
  });
});

describe('reconcileDurable', () => {
  it('replaces a live bubble with the canonical display text, including TXN-9001', () => {
    const live: ConversationTurn[] = [
      t({ id: 1, speaker: 'user', text: 'Where is TXN minus 9 00 1?', source: 'live' }),
      t({ id: 2, speaker: 'assistant', text: 'Transaction TXN minus 9 00 1 is processing.', source: 'live' }),
    ];
    const next = reconcileDurable(live, [
      {
        id: 'u-1',
        role: 'user',
        displayText: 'Where is TXN-9001?',
        createdAt: '2026-10-01T12:00:00.000Z',
      },
      {
        id: 'u-1a',
        role: 'assistant',
        displayText: 'Transaction TXN-9001 is processing.',
        spokenText: 'Transaction TXN minus 9 00 1 is processing.',
        createdAt: '2026-10-01T12:00:01.000Z',
      },
    ]);
    expect(next.map((turn) => turn.displayText)).toEqual(['Where is TXN-9001?', 'Transaction TXN-9001 is processing.']);
    expect(next.every((turn) => turn.source === 'durable')).toBe(true);
  });

  it('appends missing durable turns without duplicating', () => {
    const live: ConversationTurn[] = [t({ id: 1, speaker: 'user', text: 'Hello', source: 'typed' })];
    const next = reconcileDurable(live, [
      { id: 'u-1', role: 'user', displayText: 'Hello', createdAt: '2026-10-01T12:00:00.000Z' },
      { id: 'u-2', role: 'assistant', displayText: 'Hi there.', createdAt: '2026-10-01T12:00:01.000Z' },
    ]);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({ displayText: 'Hi there.', source: 'durable' });
  });
});

describe('addTypedTurn', () => {
  it('marks the customer turn as typed so a reconnect can match client_msg_id / text', () => {
    const next = addTypedTurn([], 'Where is TXN-9001?', 10);
    expect(next[0]).toMatchObject({ speaker: 'user', text: 'Where is TXN-9001?', source: 'typed', final: true });
  });
});
