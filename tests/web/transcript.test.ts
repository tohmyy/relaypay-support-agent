import { describe, expect, it } from 'vitest';
import { addTypedTurn, applyTranscript, hydrateDurable, reconcileDurable, type ConversationTurn } from '@/lib/transcript';

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

describe('applyTranscript partial revisions', () => {
  const feed = (role: 'user' | 'assistant', events: Array<[string, boolean]>) =>
    events.reduce(
      (turns, [text, final], i) => applyTranscript(turns, { role, text, final }, i + 1),
      [] as ConversationTurn[],
    );

  it('replaces the open partial when the recognizer revises earlier words', () => {
    const turns = feed('user', [
      ["Hi. I'm not", false],
      ["Hi. I'd like to, uh, know", false],
      ["Hi. I'd like to, um, know more information about my transactions", false],
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("Hi. I'd like to, um, know more information about my transactions");
  });

  it('does the same for the assistant', () => {
    const turns = feed('assistant', [
      ["Let's", false],
      ['Let me check the', false],
      ['Let me check the relevant RelayPay information.', false],
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('Let me check the relevant RelayPay information.');
  });

  it('continues one bubble after a premature final without repeating the partial', () => {
    const turns = feed('assistant', [
      ['I checked TXN-9001.', true],
      ['It is still', false],
      ['It is still processing.', true],
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('I checked TXN-9001. It is still processing.');
  });

  it('does not repeat a segment that restates everything finished so far', () => {
    const turns = feed('assistant', [
      ['Hello there.', true],
      ['Hello there. How can I help?', true],
    ]);
    expect(turns[0].text).toBe('Hello there. How can I help?');
  });

  it('starts a new bubble when the speaker changes', () => {
    const turns = applyTranscript(feed('user', [['Hi', true]]), { role: 'assistant', text: 'Hello', final: false }, 9);
    expect(turns.map((t) => t.speaker)).toEqual(['user', 'assistant']);
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

describe('live bubbles stay the transcript while a call is going', () => {
  const durable = [
    { id: 'u1:user', role: 'user' as const, displayText: 'T x n dash 9', createdAt: '2026-10-02T12:00:01.000Z' },
    {
      id: 'u1:assistant',
      role: 'assistant' as const,
      displayText: "Thanks, I only caught the start of that. Could you read me the rest of the numbers?",
      createdAt: '2026-10-02T12:00:02.000Z',
    },
    { id: 'u2:user', role: 'user' as const, displayText: 'TXN-9001', createdAt: '2026-10-02T12:00:05.000Z' },
    {
      id: 'u2:assistant',
      role: 'assistant' as const,
      displayText: "Thanks, Amara. I've checked TXN-9001: it's an outgoing payout of 2,400 US dollars.",
      createdAt: '2026-10-02T12:00:06.000Z',
    },
  ];

  it('does not merge saved rows beside live bubbles, so nothing is doubled or split', () => {
    let turns: ConversationTurn[] = [];
    turns = applyTranscript(turns, { role: 'user', text: 'T x n dash 9', final: true }, 1000);
    turns = hydrateDurable(turns, durable); // a poll lands between the two things the caller said
    turns = applyTranscript(turns, { role: 'user', text: 'T x n dash 9 double 0, 1.', final: true }, 3000);
    turns = applyTranscript(
      turns,
      { role: 'assistant', text: "Just a moment while I look into that. I've checked t x n minus 9001. It's an outgoing payout of 2 4 0 0 US dollars.", final: true },
      4000,
    );
    turns = hydrateDurable(turns, durable);
    expect(turns.map((t) => t.speaker)).toEqual(['user', 'assistant']);
    expect(turns[0].displayText).toBe('T x n dash 9 double 0, 1.'); // one bubble for what was said once
    expect(turns[1].displayText).toContain('TXN-9001'); // the reference shows exactly
    expect(turns[1].displayText).toContain('Just a moment'); // and what was spoken stays
  });

  it('uses the saved rows when there is nothing live (a reload)', () => {
    const turns = hydrateDurable([], durable);
    expect(turns).toHaveLength(4);
    expect(turns.every((t) => t.source === 'durable')).toBe(true);
  });

  it('keeps typed bubbles too', () => {
    const typed = addTypedTurn([], 'Where is TXN-9001?', 5);
    expect(hydrateDurable(typed, durable)).toBe(typed);
  });

  it('shows the assistant live text with its references restored, and leaves what the customer said alone', () => {
    const a = applyTranscript([], { role: 'assistant', text: 'It is t x n minus 9001.', final: true }, 1);
    expect(a[0].displayText).toBe('It is TXN-9001.');
    expect(a[0].text).toBe('It is t x n minus 9001.');
    const u = applyTranscript([], { role: 'user', text: 'T x n dash 9 double 0, 1.', final: true }, 1);
    expect(u[0].displayText).toBe('T x n dash 9 double 0, 1.');
  });
});
