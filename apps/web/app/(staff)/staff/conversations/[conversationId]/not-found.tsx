import Link from 'next/link';
import { STAFF_COPY } from '@/lib/shell-copy';

export default function StaffConversationNotFound() {
  return (
    <div role="alert" className="rounded-lg border border-line bg-surface p-6 shadow-card">
      <h1 className="text-lg font-semibold text-ink">{STAFF_COPY.detail.notFound}</h1>
      <Link href="/staff/conversations" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {STAFF_COPY.detail.back}
      </Link>
    </div>
  );
}
