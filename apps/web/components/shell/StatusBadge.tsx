import type { ReactNode } from 'react';
import type { Badge } from '@/lib/dashboard/badges';
import type { StatusTone } from '@/lib/dashboard/format';

const TONES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  neutral: 'bg-surface-subtle text-ink-secondary',
  warning: 'bg-surface-subtle text-warning',
  danger: 'bg-danger-soft text-danger',
};

/**
 * The one status pill. Give it a `badge` from lib/dashboard/badges.ts (label and tone together), or a tone and your own
 * text where the wording carries extra detail, such as "In progress · Yours".
 */
export function StatusBadge({ badge, tone, children }: { badge?: Badge; tone?: StatusTone; children?: ReactNode }) {
  const resolved = tone ?? badge?.tone ?? 'neutral';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[resolved]}`}>
      {children ?? badge?.label}
    </span>
  );
}

export default StatusBadge;
