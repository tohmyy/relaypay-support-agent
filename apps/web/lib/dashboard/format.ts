/** Small, pure presentation helpers shared by the customer and staff pages. */

export function greeting(now: Date, name: string): string {
  const hour = now.getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** Customer-friendly wording for the status values in the data ("review required" is internal phrasing). */
const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  processing: 'Processing',
  delayed: 'Delayed',
  failed: 'Failed',
  'review required': 'Under review',
  pending: 'Pending',
  scheduled: 'Scheduled',
};

export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger';

const STATUS_TONES: Record<string, StatusTone> = {
  completed: 'success',
  processing: 'neutral',
  scheduled: 'neutral',
  pending: 'neutral',
  delayed: 'warning',
  'review required': 'warning',
  failed: 'danger',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  const known = STATUS_LABELS[status.trim().toLowerCase()];
  if (known) return known;
  const text = status.trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function statusTone(status: string | null | undefined): StatusTone {
  return STATUS_TONES[(status ?? '').trim().toLowerCase()] ?? 'neutral';
}

export function formatMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  const code = /^[A-Z]{3}$/.test(currency ?? '') ? (currency as string) : null;
  const number = value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return code ? `${code} ${number}` : number;
}

/** "16 Aug 2026". Accepts a date or timestamp string; anything unreadable is a dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  return new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "16 Aug 2026, 14:05 UTC": the full moment, for the staff tables where the day alone is not enough. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '—';
  return `${formatDate(value)}, ${new Date(time).toISOString().slice(11, 16)} UTC`;
}

const TYPE_LABELS: Record<string, string> = {
  'outgoing payout': 'Outgoing payout',
  'invoice payment': 'Invoice payment',
  'incoming transfer': 'Incoming transfer',
};

export function typeLabel(type: string | null | undefined): string {
  if (!type) return 'Payment';
  const known = TYPE_LABELS[type.trim().toLowerCase()];
  return known ?? type.charAt(0).toUpperCase() + type.slice(1);
}
