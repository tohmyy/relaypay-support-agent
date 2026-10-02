'use client';

import { useActionState } from 'react';
import { SHELL_COPY } from '@/lib/shell-copy';

export interface LoginFormState {
  error: string | null;
}

const FIELD =
  'mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted aria-[invalid=true]:border-danger';

/** Email and password. The error is announced as an alert and never says which of the two was wrong. */
export default function LoginForm({
  action,
  next,
}: {
  action: (previous: LoginFormState, formData: FormData) => Promise<LoginFormState>;
  next: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const copy = SHELL_COPY.signIn;
  return (
    <form action={formAction} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      {state.error && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="login-email" className="text-sm font-medium text-ink">
          {copy.email}
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={state.error ? true : undefined}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="login-password" className="text-sm font-medium text-ink">
          {copy.password}
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={state.error ? true : undefined}
          className={FIELD}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-5 py-2.5 text-base font-semibold text-white hover:bg-primary-hover disabled:opacity-70"
      >
        {pending ? copy.submitting : copy.submit}
      </button>
    </form>
  );
}
