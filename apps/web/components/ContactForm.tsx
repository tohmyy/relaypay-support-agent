'use client';

import { useRef, useState } from 'react';
import { validateContact, type ContactErrors, type ContactValues } from '@/lib/contact';
import { COPY } from '@/lib/copy';

const FIELD =
  'mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted aria-[invalid=true]:border-danger';

/** Name, email and an optional callback time. Validates inline; nothing is sent until it is valid. */
export default function ContactForm({ onSubmit }: { onSubmit(values: ContactValues): void }) {
  const [values, setValues] = useState<ContactValues>({ name: '', email: '', preferredTime: '' });
  const [errors, setErrors] = useState<ContactErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateContact(values);
    setErrors(found);
    if (found.name) nameRef.current?.focus();
    else if (found.email) emailRef.current?.focus();
    else onSubmit(values);
  }

  const set = (key: keyof ContactValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor="contact-name" className="text-sm font-medium text-ink">
          {COPY.escalation.name}
        </label>
        <input
          id="contact-name"
          ref={nameRef}
          type="text"
          autoComplete="name"
          value={values.name}
          onChange={set('name')}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'contact-name-error' : undefined}
          className={FIELD}
        />
        {errors.name && (
          <p id="contact-name-error" className="mt-1 text-sm text-danger">
            {errors.name}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="contact-email" className="text-sm font-medium text-ink">
          {COPY.escalation.email}
        </label>
        <input
          id="contact-email"
          ref={emailRef}
          type="email"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'contact-email-error' : undefined}
          className={FIELD}
        />
        {errors.email && (
          <p id="contact-email-error" className="mt-1 text-sm text-danger">
            {errors.email}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="contact-time" className="text-sm font-medium text-ink">
          {COPY.escalation.callbackTime}
        </label>
        <input
          id="contact-time"
          type="text"
          value={values.preferredTime}
          onChange={set('preferredTime')}
          aria-describedby="contact-time-hint"
          className={FIELD}
        />
        <p id="contact-time-hint" className="mt-1 text-sm text-ink-muted">
          {COPY.escalation.callbackHint}
        </p>
      </div>
      <button
        type="submit"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-5 py-2.5 text-base font-semibold text-white hover:bg-primary-hover"
      >
        {COPY.buttons.requestSupport}
      </button>
    </form>
  );
}
