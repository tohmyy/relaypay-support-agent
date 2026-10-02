'use client';

import { formatWait } from '@/lib/human/notify';
import type { Role } from '@/lib/auth/token';
import { workingQueue } from '@/lib/dashboard/staff';
import { STAFF_COPY } from '@/lib/shell-copy';
import QueueTable from './QueueTable';
import { useStaffInbox } from './StaffInbox';
import { Stat } from './ui';

function AlertToggles() {
  const inbox = useStaffInbox();
  const copy = STAFF_COPY.alerts;
  const blocked = inbox.desktopPermission === 'denied';
  return (
    <fieldset className="mb-6 rounded-lg border border-line bg-surface p-4">
      <legend className="px-1 text-sm font-medium text-ink">{copy.group}</legend>
      <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
        <input type="checkbox" checked={inbox.soundOn} onChange={(e) => inbox.setSound(e.target.checked)} className="h-5 w-5" />
        {copy.sound}
      </label>
      {inbox.desktopPermission !== 'unsupported' && (
        <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={inbox.desktopOn && !blocked}
            disabled={blocked}
            onChange={(e) => void inbox.setDesktop(e.target.checked)}
            className="h-5 w-5"
          />
          {copy.desktop}
        </label>
      )}
      {blocked && <p className="text-sm text-ink-muted">{copy.desktopBlocked}</p>}
    </fieldset>
  );
}

/**
 * The staff queue, kept current. `queue` is the working view (counts and the open work, with alert settings);
 * `all` lists every conversation this person may open.
 */
export default function LiveQueue({ variant, role }: { variant: 'queue' | 'all'; role: Role }) {
  const { data, trouble } = useStaffInbox();
  const copy = STAFF_COPY.queue;
  if (!data) return <p className="text-sm text-ink-secondary">{copy.empty}</p>;
  const items = variant === 'queue' ? workingQueue(data.items, role) : data.items;
  return (
    <>
      {variant === 'queue' && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat label={copy.open} value={data.counts.open} />
            <Stat
              label={copy.waiting}
              value={data.counts.waiting}
              note={(() => {
                const oldest = data.items.filter((i) => i.waitingSince).map((i) => i.waitingSince as string).sort()[0];
                return oldest ? STAFF_COPY.chat.waitingSince.replace('{time}', formatWait(oldest)) : null;
              })()}
            />
            <Stat label={copy.inProgress} value={data.counts.inProgress} />
            <Stat label={copy.escalated} value={data.counts.escalated} />
            <Stat label={copy.resolvedToday} value={data.counts.resolvedToday} />
          </div>
          <AlertToggles />
        </>
      )}
      {trouble && (
        <p role="status" className="mb-3 text-sm text-ink-muted">
          {copy.trouble}
        </p>
      )}
      <QueueTable items={items} caption={variant === 'queue' ? copy.title : STAFF_COPY.conversations.title} />
    </>
  );
}
