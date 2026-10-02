import { abuseLimitsFromEnv, activeEarlierIds, type OpenSessionRow } from '@/lib/session/abuse';
import { restSelect } from '@/lib/supabase.server';

/** Whether this customer may begin another conversation right now (the same limits the link route and the agent enforce). */
export async function startBlocked(customerId: string): Promise<'active-session' | 'rate-limited' | null> {
  const limits = abuseLimitsFromEnv();
  if (limits.maxConcurrentSessions > 0) {
    const others =
      (await restSelect<OpenSessionRow>(
        'conversations',
        `select=conversation_id,started_at,last_activity_at&customer_id=eq.${encodeURIComponent(customerId)}` +
          `&support_mode=eq.ai&ended_at=is.null&limit=20`,
      )) ?? [];
    const open = activeEarlierIds(others, Date.now() + 1, { maxSeconds: limits.sessionMaxSeconds });
    if (open.length >= limits.maxConcurrentSessions) return 'active-session';
  }
  if (limits.sessionRateMax > 0) {
    const since = new Date(Date.now() - limits.sessionRateWindowSeconds * 1000).toISOString();
    const started =
      (await restSelect<{ conversation_id: string }>(
        'conversations',
        `select=conversation_id&customer_id=eq.${encodeURIComponent(customerId)}&started_at=gte.${encodeURIComponent(since)}&limit=${limits.sessionRateMax + 1}`,
      )) ?? [];
    if (started.length >= limits.sessionRateMax) return 'rate-limited';
  }
  return null;
}
