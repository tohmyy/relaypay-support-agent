'use client';

import { useState } from 'react';
import type { ContactMethods } from '@/lib/settings/contact-methods';
import { STAFF_COPY } from '@/lib/shell-copy';
import { Card } from './ui';

interface Props {
  initial: ContactMethods;
  staffOnline: boolean;
  /** Who last changed it and when, already worded for reading ("4 Oct 2026, 12:00"), or null if never changed. */
  lastChanged: { when: string; who: string | null } | null;
}

type Notice = { kind: 'saved' | 'failed'; text: string } | null;

function Method({
  id,
  label,
  help,
  checked,
  disabled,
  statusText,
  note,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  statusText: string;
  note?: string;
  onChange?: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 py-4">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 h-5 w-5"
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-base font-medium text-ink">
          {label}
          <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-ink-secondary">{statusText}</span>
        </label>
        <p id={`${id}-help`} className="mt-1 text-sm text-ink-secondary">
          {help}
        </p>
        {note && <p className="mt-1 text-sm text-ink-muted">{note}</p>}
      </div>
    </div>
  );
}

/**
 * The administrator's choice of which ways of reaching a person the assistant offers. Changes are saved with one button
 * (not on every click), at least one method must stay on, and the live phone call is shown but cannot be switched on yet.
 */
export default function ContactMethodsSettings({ initial, staffOnline, lastChanged }: Props) {
  const copy = STAFF_COPY.settings;
  const [saved, setSaved] = useState<ContactMethods>(initial);
  const [draft, setDraft] = useState<ContactMethods>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const dirty = draft.textChat !== saved.textChat || draft.callback !== saved.callback;
  const noneOn = !draft.textChat && !draft.callback;

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/staff/settings/contact-methods', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaved(draft);
      setNotice({ kind: 'saved', text: copy.saved });
    } catch {
      setNotice({ kind: 'failed', text: copy.failed });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <p className="text-sm text-ink-secondary">{copy.intro}</p>
      <p className="mt-2 text-sm text-ink-muted">{staffOnline ? copy.online : copy.offline}</p>
      <p className="mt-1 text-sm text-ink-muted">
        {lastChanged ? copy.lastChanged.replace('{when}', lastChanged.when).replace('{who}', lastChanged.who ?? '—') : copy.neverChanged}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !noneOn && !saving) void save();
        }}
        className="mt-4"
      >
        <fieldset>
          <legend className="text-sm font-semibold text-ink">{copy.groupLegend}</legend>
          <div className="divide-y divide-line">
            <Method
              id="method-text-chat"
              label={copy.textChat.label}
              help={copy.textChat.help}
              checked={draft.textChat}
              statusText={draft.textChat ? copy.status.on : copy.status.off}
              note={draft.textChat ? undefined : copy.offNote}
              onChange={(on) => {
                setDraft((d) => ({ ...d, textChat: on }));
                setNotice(null);
              }}
            />
            <Method
              id="method-callback"
              label={copy.callback.label}
              help={copy.callback.help}
              checked={draft.callback}
              statusText={draft.callback ? copy.status.on : copy.status.off}
              note={draft.callback ? undefined : copy.offNote}
              onChange={(on) => {
                setDraft((d) => ({ ...d, callback: on }));
                setNotice(null);
              }}
            />
            <Method id="method-phone" label={copy.phone.label} help={copy.phone.help} checked={false} disabled statusText={copy.status.soon} />
          </div>
        </fieldset>

        {noneOn && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {copy.mustKeepOne}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!dirty || noneOn || saving}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-base font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {saving ? copy.saving : copy.save}
          </button>
          <p role="status" aria-live="polite" className={`text-sm ${notice?.kind === 'failed' ? 'text-danger' : 'text-ink-secondary'}`}>
            {notice?.text ?? (dirty && !noneOn ? copy.unsaved : '')}
          </p>
        </div>
      </form>
    </Card>
  );
}
