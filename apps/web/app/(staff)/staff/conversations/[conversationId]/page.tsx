import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import AcceptConversation from '@/components/shell/AcceptConversation';
import StaffChat from '@/components/shell/StaffChat';
import TranscriptView from '@/components/shell/TranscriptView';
import { Card, PageTitle, StatusBadge } from '@/components/shell/ui';
import { canAccessConversation } from '@/lib/auth/access';
import { requireStaff } from '@/lib/auth/dal';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import {
  getConversation,
  getConversationCost,
  getConversationEscalation,
  getConversationExtras,
  getConversationFeedback,
  getConversationTicket,
  getStaffCustomer,
  getStaffProfiles,
  getTranscript,
} from '@/lib/dashboard/data.server';
import { channelBadge, conversationOutcomeBadge, queueStateBadge, workStatusBadge } from '@/lib/dashboard/badges';
import { formatDateTime } from '@/lib/dashboard/format';
import { formatUsd, issueLabel, queueState } from '@/lib/dashboard/staff';
import { buildConversationSummary } from '@/lib/dashboard/summary';
import { formatWait } from '@/lib/human/notify';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

/**
 * One conversation for staff: the accept card (customer, topic, ticket, escalation age and a labelled summary), the
 * transcript, the chat, and the ticket, escalation and customer facts. The escalation is found by the conversation, never
 * through the ticket. Account notes, verification status and internal summaries are never selected.
 */
export default async function StaffConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const user = await requireStaff(`/staff/conversations/${encodeURIComponent(conversationId)}`);
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) notFound();
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(user, conversation)) notFound();

  const [turns, escalation, customer, feedback, cost, extras, staff] = await Promise.all([
    getTranscript(conversationId),
    getConversationEscalation(conversationId),
    conversation.customer_id ? getStaffCustomer(conversation.customer_id) : Promise.resolve(null),
    // Extras: a failure here must not hide the conversation itself.
    getConversationFeedback(conversationId).catch(() => []),
    getConversationCost(conversationId).catch(() => null),
    getConversationExtras(conversationId).catch(() => null),
    conversation.assigned_staff_id ? getStaffProfiles([conversation.assigned_staff_id]).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  // The escalation's own ticket when there is one, otherwise the conversation's latest.
  const ticket = await getConversationTicket(conversationId, escalation?.ticket_id);
  const copy = STAFF_COPY.detail;
  // Text-chat rows (a sender) belong to the live chat panel; the voice transcript keeps the AI-era turns.
  const voiceTurns = turns.filter((t) => !t.sender);
  const hasChat = conversation.support_mode === 'human' || turns.some((t) => t.sender);
  const customerName = customer?.company_name ?? 'Unknown caller';
  const assignee = conversation.assigned_staff_id ? (staff.get(conversation.assigned_staff_id)?.name ?? null) : null;
  const escalationOpen = Boolean(escalation && escalation.status !== 'closed');
  const facts: [string, ReactNode][] = [
    [copy.customer, customer ? `${customer.company_name ?? '—'} (${customer.contact_name ?? '—'})` : copy.unlinked],
    ...(customer?.contact_email ? ([['Email', customer.contact_email]] as [string, ReactNode][]) : []),
    ...(customer?.plan ? ([['Plan', customer.plan]] as [string, ReactNode][]) : []),
    ...(extras?.channel ? ([[copy.channel, <StatusBadge key="channel" badge={channelBadge(extras.channel)} />]] as [string, ReactNode][]) : []),
    [copy.started, formatDateTime(conversation.started_at)],
    ...(conversation.ended_at ? ([[copy.ended, formatDateTime(conversation.ended_at)]] as [string, ReactNode][]) : []),
    ['Status', <StatusBadge key="state" badge={queueStateBadge(queueState(conversation))} />],
    ...(conversation.ended_at
      ? ([[copy.outcome, <StatusBadge key="outcome" badge={conversationOutcomeBadge(conversation, 'staff')} />]] as [string, ReactNode][])
      : []),
    [copy.cost, cost === null ? STAFF_COPY.queue.costUnknown : `${formatUsd(cost)} (${copy.costNote})`],
    ...(conversation.support_mode === 'human' ? ([['With', 'Support specialist (text chat)']] as [string, ReactNode][]) : []),
    ...(assignee ? ([[copy.assignee, assignee]] as [string, ReactNode][]) : []),
    ...(ticket?.ticket_id
      ? ([
          [copy.ticket, `${ticket.ticket_id} · ${issueLabel(ticket.category)}`],
          [copy.ticketStatus, <StatusBadge key="ticket-status" badge={workStatusBadge(ticket.status)} />],
        ] as [string, ReactNode][])
      : []),
    ...(escalation
      ? ([
          [copy.escalation, `${escalation.escalation_id ?? ''} ${escalation.reason ?? ''}`.trim()],
          [copy.escalationStatus, <StatusBadge key="escalation-status" badge={workStatusBadge(escalation.status)} />],
          [copy.callback, [escalation.user_name, escalation.user_email, escalation.preferred_time].filter(Boolean).join(' · ') || '—'],
        ] as [string, ReactNode][])
      : []),
  ];
  const stageLabel = (stage: 'ai' | 'human') => copy.feedbackStages[stage];
  return (
    <>
      <PageTitle>{copy.title}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {(escalation || conversation.support_mode === 'human') && (
            <AcceptConversation
              conversationId={conversationId}
              customer={customerName}
              topic={issueLabel(ticket?.category ?? escalation?.category)}
              ticket={ticket?.ticket_id ?? escalation?.ticket_id ?? null}
              age={escalationOpen ? formatWait(escalation?.created_at ?? ticket?.created_at) || null : null}
              summary={buildConversationSummary({
                stored: extras?.summary,
                ticketSummary: ticket?.summary,
                escalationReason: escalation?.reason,
                turns,
              })}
              canAccept={conversation.support_mode === 'human' && !conversation.ended_at && !conversation.assigned_staff_id}
              canClose={escalationOpen && Boolean(conversation.ended_at)}
            />
          )}
          <Card title={hasChat ? STAFF_COPY.chat.voiceTranscript : copy.transcript}>
            {hasChat ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-ink">{STAFF_COPY.chat.earlierTitle}</summary>
                <div className="mt-3">
                  <TranscriptView
                    turns={voiceTurns}
                    customerLabel="Customer"
                    supportLabel="Assistant"
                    emptyText={copy.transcriptEmpty}
                  />
                </div>
              </details>
            ) : (
              <TranscriptView
                turns={voiceTurns}
                customerLabel="Customer"
                supportLabel="Assistant"
                emptyText={copy.transcriptEmpty}
              />
            )}
          </Card>
          {hasChat && <StaffChat conversationId={conversationId} />}
          <Card title={copy.feedback}>
            {feedback.length === 0 ? (
              <p className="text-sm text-ink-secondary">{copy.feedbackNone}</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {feedback.map((f) => (
                  <li key={f.stage}>
                    <p className="font-medium text-ink">
                      {stageLabel(f.stage)}: {copy.rating.replace('{n}', String(f.rating))}
                    </p>
                    {f.comment && <p className="mt-1 whitespace-pre-wrap text-ink-secondary">{f.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          <dl className="space-y-3 text-sm">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="font-medium text-ink-secondary">{label}</dt>
                <dd className="text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
      <Link href="/staff/conversations" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {copy.back}
      </Link>
    </>
  );
}
