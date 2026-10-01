const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_NUMBER = /\+?\d[\d\s().-]{7,}\d/g;

/**
 * Best-effort scrub for text that goes into logs. Emails become [email]; phone-like numbers (9 or more digits)
 * become [number]. Reference ids such as TXN-9001 and dates are left alone. A safety net, not a guarantee.
 */
export function redactPii(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(LONG_NUMBER, (m) => (m.replace(/\D/g, '').length >= 9 ? '[number]' : m));
}
