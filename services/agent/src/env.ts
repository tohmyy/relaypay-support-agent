import { z } from 'zod';

const nonEmpty = z.string().min(1);
const blank = (v: unknown) => (v === '' ? undefined : v);

const schema = z.object({
  ANTHROPIC_API_KEY: nonEmpty,
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  MCP_SERVER_URL: z.string().url(),
  MCP_SERVER_AUTH_TOKEN: nonEmpty,
  // Voice server (Vapi). Blank values count as unset.
  AGENT_API_TOKEN: z.preprocess(blank, z.string().min(16).optional()),
  VAPI_WEBHOOK_SECRET: z.preprocess(blank, z.string().min(8).optional()),
  AGENT_PORT: z.preprocess(blank, z.coerce.number().int().min(0).max(65535).default(4100)),
  AGENT_HOST: z.preprocess(blank, z.string().default('127.0.0.1')),
  AGENT_PUBLIC_URL: z.preprocess(blank, z.string().url().optional()),
  // Session lifecycle (seconds). Enforced by the Session Controller, never by the model.
  SESSION_MAX_SECONDS: z.preprocess(blank, z.coerce.number().int().min(10).default(360)),
  SESSION_WARNING_SECONDS: z.preprocess(blank, z.coerce.number().int().min(1).default(30)),
  SILENCE_TIMEOUT_SECONDS: z.preprocess(blank, z.coerce.number().int().min(1).default(15)),
  SILENCE_COUNTDOWN_SECONDS: z.preprocess(blank, z.coerce.number().int().min(1).default(10)),
  // Private Vapi API key, used only to end a live call from the server.
  VAPI_API_KEY: z.preprocess(blank, z.string().min(1).optional()),
  // Optional model override; blank means the default model is used.
  AGENT_MODEL: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
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
