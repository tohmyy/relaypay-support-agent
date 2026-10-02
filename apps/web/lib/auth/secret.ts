import { z } from 'zod';

const schema = z.object({ SESSION_SECRET: z.string().min(32) });

/**
 * The key that signs session cookies. There is deliberately no default: without a real secret nobody can sign in,
 * rather than everyone sharing a guessable one. Errors name the variable and never print its value.
 */
export function getSessionSecret(env: Record<string, string | undefined> = process.env): string {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error('Missing or invalid environment variables: SESSION_SECRET (at least 32 characters)');
  }
  return parsed.data.SESSION_SECRET;
}
