import { notFound, redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth/dal';
import { normalizeTicketId } from '@/lib/dashboard/archive';
import { getEscalationByTicket } from '@/lib/dashboard/data.server';

export const dynamic = 'force-dynamic';

/**
 * An escalation is worked on in its conversation (transcript, summary, ticket, chat and actions), so its ticket number
 * leads there. A ticket without an escalation, or a malformed number, is not found. The conversation page does its own
 * access check, so this page opens nothing the viewer could not already open.
 */
export default async function StaffEscalationPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  await requireStaff(`/staff/escalations/${encodeURIComponent(ticketId)}`);
  const ticket = normalizeTicketId(ticketId);
  if (!ticket) notFound();
  const escalation = await getEscalationByTicket(ticket);
  if (!escalation) notFound();
  redirect(`/staff/conversations/${encodeURIComponent(escalation.conversation_id)}`);
}
