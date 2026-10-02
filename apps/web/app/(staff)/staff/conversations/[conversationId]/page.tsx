import Link from 'next/link';
import { notFound } from 'next/navigation';
import StaffChat from '@/components/shell/StaffChat';
import TranscriptView from '@/components/shell/TranscriptView';
import { Card, PageTitle } from '@/components/shell/ui';
import { canAccessConversation } from '@/lib/auth/access';
import { requireStaff } from '@/lib/auth/dal';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import {
  getConversation,
  getConversationCost,
  getConversationEscalation,
  getConversationFeedback,
  getConversationTicket,
  getStaffCustomer,
  getTranscript,
} from '@/lib/dashboard/data.server';
import { formatDate } from '@/lib/dashboard/format';
import { formatUsd, issueLabel, queueState } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

/**
 * Read-only view of one conversation for staff: transcript, ticket, escalation and the customer's company and
 * contact. Account notes, verification status and internal summaries are never selected. Replying, assigning and
 * closing belong to the staff messaging work.
 */
export default async function StaffConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const user = await requireStaff(`/staff/conversations/${encodeURIComponent(conversationId)}`);
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) notFound();
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(user, conversation)) notFound();

  const [turns, ticket, customer, feedback, cost] = await Promise.all([
    getTranscript(conversationId),
    getConversationTicket(conversationId),
    conversation.customer_id ? getStaffCustomer(conversation.customer_id) : Promise.resolve(null),
    // Extras: a failure here must not hide the conversation itself.
    getConversationFeedback(conversationId).catch(() => []),
    getConversationCost(conversationId).catch(() => null),
  ]);
  const escalation = ticket?.ticket_id ? await getConversationEscalation(ticket.ticket_id) : null;
  const copy = STAFF_COPY.detail;
  // Text-chat rows (a sender) belong to the live chat panel; the voice transcript keeps the AI-era turns.
  const voiceTurns = turns.filter((t) => !t.sender);
  const hasChat = conversation.support_mode === 'human' || turns.some((t) => t.sender);
  const facts: [string, string][] = [
    [copy.customer, customer ? `${customer.company_name ?? '—'} (${customer.contact_name ?? '—'})` : copy.unlinked],
    ...(customer?.contact_email ? ([['Email', customer.contact_email]] as [string, string][]) : []),
    ...(customer?.plan ? ([['Plan', customer.plan]] as [string, string][]) : []),
    ['Started', formatDate(conversation.started_at)],
    ['Status', queueState(conversation)],
    [copy.cost, cost === null ? STAFF_COPY.queue.costUnknown : `${formatUsd(cost)} (${copy.costNote})`],
    ...(conversation.support_mode === 'human' ? ([['With', 'Support specialist (text chat)']] as [string, string][]) : []),
    ...(ticket?.ticket_id ? ([[copy.ticket, `${ticket.ticket_id} · ${issueLabel(ticket.category)}`]] as [string, string][]) : []),
    ...(escalation
      ? ([
          [copy.escalation, `${escalation.escalation_id ?? ''} ${escalation.reason ?? ''}`.trim()],
          [copy.callback, [escalation.user_name, escalation.user_email, escalation.preferred_time].filter(Boolean).join(' · ') || '—'],
        ] as [string, string][])
      : []),
  ];
  const stageLabel = (stage: 'ai' | 'human') => copy.feedbackStages[stage];
  return (
    <>
      <PageTitle>{copy.title}</PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <Card title={hasChat ? STAFF_COPY.chat.voiceTranscript : copy.transcript}>
            <TranscriptView
              turns={voiceTurns}
              customerLabel="Customer"
              supportLabel="Assistant"
              emptyText={copy.transcriptEmpty}
            />
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
