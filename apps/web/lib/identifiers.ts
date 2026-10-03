/**
 * Canonical display text for reference numbers, web copy. Twin of services/agent/src/display.ts: keep them in step
 * (tests/web/identifiers.test.ts runs both over the same table). The live transcript shows what the voice said ("t x n
 * minus 9001"); this puts reference numbers back in the form RelayPay shows them ("TXN-9001").
 */

/** Reference prefixes and how many digits follow them. A match is rewritten only when exactly that many digits are found. */
const PREFIX_DIGITS: Record<string, number> = { TXN: 4, PAY: 4, CUS: 4, TKT: 6, ESC: 6 };

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

// "TXN", or its letters spelled out ("T X N"); then a spoken or written dash, or just a space.
const PREFIX = Object.keys(PREFIX_DIGITS)
  .map((p) => p.split('').join('[ .]?'))
  .join('|');
const SEPARATOR = '(?:\\s*(?:minus|dash|hyphen|[-\\u2013\\u2014])\\s*|\\s+)';
const REFERENCE = new RegExp(`\\b(${PREFIX})${SEPARATOR}(?=[0-9]|${Object.keys(DIGIT_WORDS).join('|')})`, 'gi');
const TOKEN = new RegExp(`^(?:(\\d+)|(${Object.keys(DIGIT_WORDS).join('|')}))(?:[\\s,.-]+|(?=\\W|$))`, 'i');

/** Reads digit groups ("9 00 1", "nine zero zero one", "9001") from the start of `rest`; null unless exactly `want` digits. */
function takeDigits(rest: string, want: number): { digits: string; length: number } | null {
  let digits = '';
  let used = 0;
  while (digits.length < want) {
    const m = TOKEN.exec(rest.slice(used));
    if (!m) return null;
    digits += m[1] ?? DIGIT_WORDS[m[2].toLowerCase()];
    used += m[0].length;
  }
  if (digits.length !== want) return null;
  // Do not swallow the separator that ended the last group ("TXN 9001, and").
  const trailing = /[\s,.-]+$/.exec(rest.slice(0, used));
  return { digits, length: trailing ? used - trailing[0].length : used };
}

/**
 * Rewrites spoken forms of RelayPay reference numbers to their display form, for example "TXN minus 9 00 1" to
 * "TXN-9001". Text that is already canonical, and numbers that do not have the right number of digits, are left alone.
 */
export function canonicalizeIdentifiers(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(REFERENCE)) {
    const start = m.index ?? 0;
    if (start < last) continue;
    // Lower case counts only when the reference is clearly spoken: a "minus"/"dash"/"hyphen" or a written dash after it,
    // or its letters spelled out ("t x n"). A bare lowercase "pay 2400" is just a sentence.
    const written = m[1];
    const spoken = /[ .]/.test(written) || /minus|dash|hyphen|[-–—]/i.test(m[0].slice(written.length));
    if (!spoken && written !== written.toUpperCase()) continue;
    const prefix = written.replace(/[ .]/g, '').toUpperCase();
    const taken = takeDigits(text.slice(start + m[0].length), PREFIX_DIGITS[prefix]);
    if (!taken) continue;
    out += `${text.slice(last, start)}${prefix}-${taken.digits}`;
    last = start + m[0].length + taken.length;
  }
  return out + text.slice(last);
}
