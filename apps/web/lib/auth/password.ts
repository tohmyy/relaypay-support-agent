import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (Node's built-in, memory-hard). A hash is stored as one self-describing string,
 * `scrypt$N$r$p$salt$hash` (salt and hash base64url), so the cost can be raised later and old hashes still verify.
 */
export const MAX_PASSWORD_CHARS = 200; // bounds the work an unauthenticated request can cause
export const MIN_PASSWORD_CHARS = 10;

const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;
/** Cost parameters are read back from stored strings, so refuse values that would let a bad row eat the server. */
const MAX_N = 2 ** 20;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...opts, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_CHARS || password.length > MAX_PASSWORD_CHARS) {
    throw new Error(`password must be ${MIN_PASSWORD_CHARS} to ${MAX_PASSWORD_CHARS} characters`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** True only for the right password. A malformed stored hash is simply a failed login, never an error. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_CHARS) return false;
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const valid =
    Number.isInteger(N) && N >= 2 && N <= MAX_N && (N & (N - 1)) === 0 && Number.isInteger(r) && r >= 1 && r <= 32 && Number.isInteger(p) && p >= 1 && p <= 16;
  if (!valid) return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length < 8 || expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, salt, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let decoy: Promise<string> | undefined;

/**
 * Spends the same time as a real check. Used when the email is unknown or the account is disabled, so how long a
 * login takes does not reveal which emails have accounts.
 */
export async function verifyAgainstDecoy(password: string): Promise<false> {
  decoy ??= hashPassword('decoy-password-never-matches');
  await verifyPassword(password, await decoy);
  return false;
}
