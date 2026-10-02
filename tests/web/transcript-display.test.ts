import { beforeEach, describe, expect, it, vi } from 'vitest';

// Build Plan V4, V4.19 (AC-48.2): the transcript reader selects the canonical columns and prefers display_text.

const h = vi.hoisted(() => ({ restSelect: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase.server', () => ({ restSelect: (...a: unknown[]) => h.restSelect(...a) }));

import { getTranscript } from '@/lib/dashboard/data.server';

beforeEach(() => h.restSelect.mockReset());

describe('getTranscript', () => {
  it('selects the stable id and the display and spoken text', async () => {
    h.restSelect.mockResolvedValue([]);
    await getTranscript('conv_1');
    const [table, query] = h.restSelect.mock.calls[0] as [string, string];
    expect(table).toBe('conversation_turns');
    for (const column of ['turn_uid', 'display_text', 'spoken_text', 'assistant_response']) expect(query).toContain(column);
    expect(query).toContain('conversation_id=eq.conv_1');
  });

  it('shows the canonical display text, and keeps the spoken text beside it', async () => {
    h.restSelect.mockResolvedValue([
      {
        turn_uid: 'u-1',
        turn_number: 1,
        user_transcript: 'Where is my payout?',
        assistant_response: 'Transaction TXN minus 9 00 1 is processing.',
        display_text: 'Transaction TXN-9001 is processing.',
        spoken_text: 'Transaction TXN minus 9 00 1 is processing.',
      },
    ]);
    const [turn] = await getTranscript('conv_1');
    expect(turn).toMatchObject({
      turn_uid: 'u-1',
      assistant_response: 'Transaction TXN-9001 is processing.',
      spoken_text: 'Transaction TXN minus 9 00 1 is processing.',
    });
    expect(turn).not.toHaveProperty('display_text');
  });

  it('falls back to the legacy reply for rows written before display text existed', async () => {
    h.restSelect.mockResolvedValue([
      { turn_number: 1, user_transcript: 'Hi', assistant_response: 'Hello.', display_text: null },
      { turn_number: 2, user_transcript: 'Thanks', assistant_response: 'You are welcome.', display_text: '  ' },
      { turn_number: null, user_transcript: null, assistant_response: null, sender: 'staff', body: 'Hi there' },
    ]);
    const turns = await getTranscript('conv_1');
    expect(turns.map((t) => t.assistant_response)).toEqual(['Hello.', 'You are welcome.', null]);
    expect(turns[2]).toMatchObject({ sender: 'staff', body: 'Hi there' });
  });
});
