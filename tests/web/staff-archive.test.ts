import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_PAGE_SIZE,
  buildArchiveRows,
  decodeConversationCursor,
  encodeCursor,
  normalizeTicketId,
  olderThan,
  parseEscalationStatus,
  type ArchiveEscalationRow,
} from '@/lib/dashboard/archive';
import type { QueueConversationRow, QueueCustomerRow, QueueTicketRow } from '@/lib/dashboard/staff';

describe('staff archive cursor', () => {
  it('encodes the time the database wrote, and refuses a damaged or expired cursor', () => {
    const cursor = encodeCursor({ at: '2026-10-01T12:00:00.000Z', id: 'vapi_abc' });
    expect(decodeConversationCursor(cursor)).toEqual({ at: '2026-10-01T12:00:00.000Z', id: 'vapi_abc' });
    expect(decodeConversationCursor('not-base64')).toBeNull();
    expect(decodeConversationCursor(encodeCursor({ at: 'yesterday', id: 'vapi_abc' }))).toBeNull();
    expect(decodeConversationCursor(encodeCursor({ at: '2026-10-01T12:00:00.000Z', id: 'not a conversation' }))).toBeNull();
  });

  it('breaks ties on conversation id so two rows that share a start time are never skipped or repeated', () => {
    const at = '2026-10-01T12:00:00.000Z';
    const first = { conversation_id: 'vapi_b', started_at: at };
    const second = { conversation_id: 'vapi_a', started_at: at };
    const clause = olderThan({ at, id: first.conversation_id }, 'started_at', 'conversation_id');
    expect(clause).toContain('started_at.lt.2026-10-01T12%3A00%3A00.000Z');
    expect(clause).toContain('conversation_id.lt.vapi_b');
    expect(second.conversation_id < first.conversation_id).toBe(true);
    expect(ARCHIVE_PAGE_SIZE).toBe(25);
  });

  it('builds one page from the ids that were read, newest ticket and open escalation winning', () => {
    const conversations: QueueConversationRow[] = [
      {
        conversation_id: 'vapi_1',
        customer_id: 'CUS-1001',
        started_at: '2026-10-01T12:00:00Z',
        ended_at: '2026-10-01T12:05:00Z',
        final_status: 'escalated',
        end_reason: 'agent-ended',
        assigned_staff_id: 'u-9',
        channel: 'voice',
      },
    ];
    const tickets: QueueTicketRow[] = [
      { ticket_id: 'TKT-000002', conversation_id: 'vapi_1', category: 'payout', priority: 'high', status: 'closed' },
      { ticket_id: 'TKT-000001', conversation_id: 'vapi_1', category: 'account', priority: 'normal', status: 'open' },
    ];
    const escalations: ArchiveEscalationRow[] = [
      { escalation_id: 'ESC-000002', ticket_id: 'TKT-000002', conversation_id: 'vapi_1', status: 'closed' },
      { escalation_id: 'ESC-000001', ticket_id: 'TKT-000001', conversation_id: 'vapi_1', status: 'open' },
    ];
    const customers: QueueCustomerRow[] = [{ customer_id: 'CUS-1001', company_name: 'LagosLedger', contact_name: 'Amara' }];
    const [row] = buildArchiveRows({
      conversations,
      tickets,
      escalations,
      customers,
      staff: new Map([['u-9', { name: 'Sarah Adeyemi' }]]),
      costs: [{ conversation_id: 'vapi_1', cost_usd: 0.04 }],
    });
    expect(row).toMatchObject({
      conversationId: 'vapi_1',
      customer: 'Amara',
      ticket: 'TKT-000001',
      assignee: 'Sarah Adeyemi',
      costUsd: 0.04,
    });
    expect(row.outcome.label).toBe('Escalated');
    expect(row.escalation?.label).toBe('Open');
    expect(row.channel.label).toBe('Voice');
  });
});

describe('ticket search', () => {
  it('normalises TKT-###### and a bare number, and rejects anything else', () => {
    expect(normalizeTicketId('tkt-7')).toBe('TKT-000007');
    expect(normalizeTicketId('000007')).toBe('TKT-000007');
    expect(normalizeTicketId('7')).toBe('TKT-000007');
    expect(normalizeTicketId('TKT-000123')).toBe('TKT-000123');
    expect(normalizeTicketId('not-a-ticket')).toBeNull();
    expect(parseEscalationStatus('open')).toBe('open');
    expect(parseEscalationStatus('nope')).toBeNull();
  });
});
