import { describe, expect, it } from 'vitest';
import {
  channelBadge,
  conversationOutcomeBadge,
  queueStateBadge,
  workStatusBadge,
} from '@/lib/dashboard/badges';

describe('shared badges', () => {
  it('uses one vocabulary for conversation outcomes', () => {
    expect(conversationOutcomeBadge({ ended_at: null, final_status: null }).label).toBe('In progress');
    expect(conversationOutcomeBadge({ ended_at: 'x', final_status: 'resolved' })).toEqual({ label: 'Resolved', tone: 'success' });
    expect(conversationOutcomeBadge({ ended_at: 'x', final_status: 'escalated' })).toEqual({ label: 'Escalated', tone: 'danger' });
    expect(conversationOutcomeBadge({ ended_at: 'x', final_status: 'escalated' }, 'customer')).toEqual({
      label: 'Passed to our team',
      tone: 'neutral',
    });
    expect(conversationOutcomeBadge({ ended_at: 'x', final_status: 'abandoned' }).tone).toBe('warning');
    expect(conversationOutcomeBadge({ ended_at: 'x', final_status: 'error' }).tone).toBe('danger');
  });

  it('uses one vocabulary for ticket and escalation status, and for channel', () => {
    expect(workStatusBadge('open')).toEqual({ label: 'Open', tone: 'warning' });
    expect(workStatusBadge('in_progress')).toEqual({ label: 'In progress', tone: 'neutral' });
    expect(workStatusBadge('closed')).toEqual({ label: 'Closed', tone: 'success' });
    expect(channelBadge('voice').label).toBe('Voice');
    expect(channelBadge('text').label).toBe('Text');
    expect(queueStateBadge('waiting')).toEqual({ label: 'Waiting for staff', tone: 'warning' });
  });
});
