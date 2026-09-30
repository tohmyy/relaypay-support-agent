import { z } from 'zod';

const nonEmpty = z.string().min(1);

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_VAPI_PUBLIC_KEY: nonEmpty,
});

const serverSchema = z.object({
  VAPI_API_KEY: nonEmpty,
  VAPI_ASSISTANT_ID: nonEmpty,
  ANTHROPIC_API_KEY: nonEmpty,
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  MCP_SERVER_URL: z.string().url(),
  MCP_SERVER_AUTH_TOKEN: nonEmpty,
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

// Names only, never values, so secrets cannot leak into logs.
function describeIssues(error: z.ZodError): string {
  const names = [...new Set(error.issues.map((i) => String(i.path[0])))];
  return `Missing or invalid environment variables: ${names.join(', ')}`;
}

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicSchema.safeParse(source);
  if (!result.success) throw new Error(describeIssues(result.error));
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverSchema.safeParse(source);
  if (!result.success) throw new Error(describeIssues(result.error));
  return result.data;
}

// Literal accesses so Next.js can inline NEXT_PUBLIC_* values into the client bundle.
export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_VAPI_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY,
  });
}
