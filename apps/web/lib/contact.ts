import { COPY } from './copy';

export interface ContactValues {
  name: string;
  email: string;
  preferredTime: string;
}

export type ContactErrors = Partial<Record<'name' | 'email', string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Name and a valid email are required; the callback time is optional. */
export function validateContact(values: ContactValues): ContactErrors {
  const errors: ContactErrors = {};
  if (!values.name.trim()) errors.name = COPY.escalation.nameRequired;
  if (!values.email.trim()) errors.email = COPY.escalation.emailRequired;
  else if (!EMAIL.test(values.email.trim())) errors.email = COPY.escalation.emailInvalid;
  return errors;
}
