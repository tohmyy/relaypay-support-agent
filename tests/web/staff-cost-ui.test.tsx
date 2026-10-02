// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LiveQueue from '@/components/shell/LiveQueue';
import QueueTable from '@/components/shell/QueueTable';
import { StaffInboxProvider, type InboxData } from '@/components/shell/StaffInbox';
import type { QueueItem } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (id: string, cost: number | null, over: Partial<QueueItem> = {}): QueueItem => ({
  conversationId: id,
  state: 'resolved',
  statusLabel: 'Conversation resolved',
  customer: 'LagosLedger',
  issue: 'General question',
  ticket: null,
  started: '5 Oct 2026',
  waitingSince: null,
  unread: false,
  assignedToMe: false,
  estimatedCostUsd: cost,
  ...over,
});

describe('QueueTable cost column (AC-12.1, AC-12.4)', () => {
  it('shows each conversation’s estimated cost, under an "estimated" heading', () => {
    render(<QueueTable items={[item('a', 0.05), item('b', 0), item('c', 12.5)]} caption="Queue" />);
    expect(screen.getByRole('columnheader', { name: STAFF_COPY.queue.columns.cost })).toBeTruthy();
    expect(STAFF_COPY.queue.columns.cost.toLowerCase()).toContain('est');
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('$0.05')).toBeTruthy();
    expect(within(rows[1]).getByText('$0.00')).toBeTruthy();
    expect(within(rows[2]).getByText('$12.50')).toBeTruthy();
  });

  it('says when a cost is not available instead of showing zero', () => {
    render(<QueueTable items={[item('a', null)]} caption="Queue" />);
    expect(screen.getByText(STAFF_COPY.queue.costUnknown)).toBeTruthy();
  });

  it('labels "Resolved" as the conversation’s outcome, not a closed ticket', () => {
    render(<QueueTable items={[item('a', 0)]} caption="Queue" />);
    expect(screen.getByText('Conversation resolved')).toBeTruthy();
  });
});

describe('LiveQueue day total (AC-12.2, AC-12.4)', () => {
  const data = (todayCostUsd: number | null): InboxData => ({
    counts: { open: 0, waiting: 0, inProgress: 0, escalated: 0, resolvedToday: 1 },
    items: [item('a', 0.05)],
    todayCostUsd,
    waitingCount: 0,
    unreadCount: 0,
  });
  const show = (todayCostUsd: number | null) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    render(
      <StaffInboxProvider initial={data(todayCostUsd)} pollMs={3_600_000} hiddenPollMs={3_600_000}>
        <LiveQueue variant="queue" role="support_admin" />
      </StaffInboxProvider>,
    );
  };

  it('shows today’s estimated total, marked as an estimate and not a bill', () => {
    show(0.1535);
    const tile = screen.getByText(STAFF_COPY.queue.todayCost).closest('div')!;
    expect(within(tile).getByText('$0.1535')).toBeTruthy();
    expect(within(tile).getByText(STAFF_COPY.queue.todayCostNote)).toBeTruthy();
    expect(STAFF_COPY.queue.todayCostNote).toMatch(/not a bill/i);
    expect(STAFF_COPY.queue.todayCostNote).toMatch(/UTC/);
  });

  it('says the total is not available when it could not be read', () => {
    show(null);
    const tile = screen.getByText(STAFF_COPY.queue.todayCost).closest('div')!;
    expect(within(tile).getByText(STAFF_COPY.queue.costUnknown)).toBeTruthy();
  });
});
