import Link from 'next/link';
import { notFound } from 'next/navigation';
import TranscriptView from '@/components/shell/TranscriptView';
import { Card, PageTitle } from '@/components/shell/ui';
import { canAccessConversation } from '@/lib/auth/access';
import { requireCustomer } from '@/lib/auth/dal';
import { conversationOutcome } from '@/lib/dashboard/customer';
import { getConversation, getConversationTicket, getStaffProfiles, getTranscript } from '@/lib/dashboard/data.server';
import { formatDate } from '@/lib/dashboard/format';
import { CONVERSATION_ID_PATTERN } from '@/lib/conversation-state';
import { SHELL_COPY } from '@/lib/shell-copy';

export const dynamic = 'force-dynamic';

/**
 * A customer's own past conversation. Anything that is not theirs, does not exist or has a malformed id looks the
 * same (not found), so ids cannot be used to find out what exists.
 */
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  const user = await requireCustomer(`/support/${encodeURIComponent(conversationId)}`);
  if (!CONVERSATION_ID_PATTERN.test(conversationId)) notFound();
  const conversation = await getConversation(conversationId);
  if (!conversation || !canAccessConversation(user, conversation)) notFound();
  const [turns, ticket] = await Promise.all([getTranscript(conversationId), getConversationTicket(conversationId)]);
  const copy = SHELL_COPY.support;
  const staffNames = Object.fromEntries(
    [...(await getStaffProfiles(turns.map((t) => t.staff_user_id ?? '')).catch(() => new Map()))].map(([id, a]) => [id, a.name]),
  );
  return (
    <>
      <PageTitle sub={`${formatDate(conversation.started_at)} · ${conversationOutcome(conversation)}`}>{copy.transcriptTitle}</PageTitle>
      <Card>
        <TranscriptView
          turns={turns}
          customerLabel={copy.you}
          supportLabel={copy.support}
          emptyText={copy.transcriptEmpty}
          staffNames={staffNames}
        />
        {ticket?.ticket_id && (
          <p className="mt-4 text-sm text-ink-secondary">
            {copy.ticket}: <span className="font-medium text-ink">{ticket.ticket_id}</span>
          </p>
        )}
      </Card>
      <Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {copy.back}
      </Link>
    </>
  );
}
