import Link from 'next/link';
import { SHELL_COPY } from '@/lib/shell-copy';

export default function ConversationNotFound() {
  const copy = SHELL_COPY.notFound;
  return (
    <div role="alert" className="rounded-lg border border-line bg-surface p-6 shadow-card">
      <h1 className="text-lg font-semibold text-ink">{copy.title}</h1>
      <p className="mt-1 text-sm text-ink-secondary">{copy.body}</p>
      <Link href="/dashboard" className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">
        {copy.action}
      </Link>
    </div>
  );
}
