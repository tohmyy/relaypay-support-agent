'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_MESSAGE_CHARS } from '@/lib/human/messages';

/**
 * A labelled message box with a Send button, shared by the customer and staff chats. Enter sends, Shift+Enter makes a
 * new line. The text stays in the box when sending fails, so nothing typed is lost.
 */
export default function Composer({
  label,
  placeholder,
  sendLabel,
  sendingLabel,
  sending,
  disabled,
  errorText,
  tooLongText,
  onSend,
  onType,
  onTypingChange,
}: {
  label: string;
  placeholder?: string;
  sendLabel: string;
  sendingLabel: string;
  sending: boolean;
  disabled?: boolean;
  errorText?: string | null;
  tooLongText: string;
  onSend: (text: string) => Promise<boolean>;
  onType?: () => void;
  onTypingChange?: (active: boolean) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const tooLong = text.length > MAX_MESSAGE_CHARS;
  const empty = text.trim().length === 0;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (empty || tooLong || sending || disabled) return;
    if (await onSend(text)) {
      setText('');
      onTypingChange?.(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        rows={3}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={tooLong || errorText ? true : undefined}
        aria-describedby={errorText ? `${id}-error` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const active = Boolean(e.target.value.trim());
          if (active) onType?.();
          onTypingChange?.(active);
        }}
        onBlur={() => onTypingChange?.(false)}
        onKeyDown={onKeyDown}
        className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted aria-[invalid=true]:border-danger disabled:opacity-60"
      />
      {(errorText || tooLong) && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-danger">
          {errorText ?? tooLongText}
        </p>
      )}
      <button
        type="submit"
        disabled={empty || tooLong || sending || disabled}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 py-2.5 text-base font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
      >
        {sending ? sendingLabel : sendLabel}
      </button>
    </form>
  );
}
