// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptTurn } from '@/lib/dashboard/data.server';

vi.mock('server-only', () => ({}));

import TranscriptView from '@/components/shell/TranscriptView';

afterEach(cleanup);

const props = { customerLabel: 'You', supportLabel: 'RelayPay Support', emptyText: 'Nothing was said.' };

describe('TranscriptView merges legacy voice turns with specialist-chat rows (AC-32.4)', () => {
  const turns: TranscriptTurn[] = [
    // Voice-era pair: no sender, both sides in one row.
    { turn_number: 1, user_transcript: 'Where is my payout?', assistant_response: 'It is under review.', created_at: '2026-10-05T09:00:00Z' },
    { turn_number: 2, user_transcript: 'I need a person.', assistant_response: 'Connecting you now.', created_at: '2026-10-05T09:01:00Z' },
    // After the handoff: one message per row, with a sender.
    { turn_number: null, user_transcript: null, assistant_response: null, sender: 'system', body: 'You are being connected to a specialist.', created_at: '2026-10-05T09:02:00Z' },
    { turn_number: null, user_transcript: null, assistant_response: null, sender: 'staff', body: 'Hi Amara, I am on it.', staff_user_id: 'u-9', created_at: '2026-10-05T09:03:00Z' },
    { turn_number: null, user_transcript: null, assistant_response: null, sender: 'customer', body: 'Thank you.', created_at: '2026-10-05T09:04:00Z' },
  ];

  it('shows every line in order: voice pairs as two bubbles, chat rows as one each', () => {
    render(<TranscriptView turns={turns} staffNames={{ 'u-9': 'Sarah' }} {...props} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'YouWhere is my payout?',
      'RelayPay SupportIt is under review.',
      'YouI need a person.',
      'RelayPay SupportConnecting you now.',
      'You are being connected to a specialist.',
      'SarahHi Amara, I am on it.',
      'YouThank you.',
    ]);
  });

  it('puts the customer on the right, everyone else on the left, and centres system notes', () => {
    render(<TranscriptView turns={turns} staffNames={{ 'u-9': 'Sarah' }} {...props} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[0].className).toContain('ml-auto');
    expect(items[1].className).not.toContain('ml-auto');
    expect(items[4].className).toContain('text-center');
    expect(items[5].className).not.toContain('ml-auto');
    expect(items[6].className).toContain('ml-auto');
  });

  it('names an unknown specialist generically and skips rows with no text', () => {
    render(
      <TranscriptView
        turns={[
          { turn_number: null, user_transcript: null, assistant_response: null, sender: 'staff', body: 'Hello', staff_user_id: 'u-404' },
          { turn_number: null, user_transcript: null, assistant_response: null, sender: 'staff', body: '   ' },
          { turn_number: 3, user_transcript: '  ', assistant_response: null },
        ]}
        {...props}
      />,
    );
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toBe('Support specialistHello');
  });

  it('shows the empty text when there is nothing', () => {
    render(<TranscriptView turns={[]} {...props} />);
    expect(screen.getByText('Nothing was said.')).toBeTruthy();
  });
});
