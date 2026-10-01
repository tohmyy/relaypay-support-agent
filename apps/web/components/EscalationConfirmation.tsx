'use client';

import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { COPY } from '@/lib/copy';

/** Success state. Takes focus once so keyboard and screen-reader users land on the result. */
export default function EscalationConfirmation({ requestedTime }: { requestedTime: string | null }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="flex items-start gap-3">
      <Check aria-hidden className="mt-1 h-5 w-5 shrink-0 text-success" />
      <div>
        <h2 ref={ref} tabIndex={-1} className="text-base font-semibold text-ink outline-none">
          {COPY.escalation.confirmed}
        </h2>
        <p className="mt-1 text-sm text-ink-secondary">{COPY.escalation.confirmedBody}</p>
        {requestedTime && (
          <p className="mt-2 text-sm font-medium text-ink">
            {COPY.escalation.requestedCallback}: {requestedTime}
          </p>
        )}
      </div>
    </div>
  );
}
