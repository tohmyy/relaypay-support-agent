import { z } from 'zod';

const nonEmpty = z.string().min(1);

const schema = z.object({
  ANTHROPIC_API_KEY: nonEmpty,
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  MCP_SERVER_URL: z.string().url(),
  MCP_SERVER_AUTH_TOKEN: nonEmpty,
});

export type Env = z.infer<typeof schema>;

// Reports variable names only, never values, so secrets cannot leak into logs.
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
  }
  return result.data;
}

// Call once at process start; exits non-zero with the offending names.
export function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
