import { z } from 'zod';

const nonEmpty = z.string().min(1);

const schemas = {
  migrate: z.object({ SUPABASE_DB_URL: nonEmpty }),
  seed: z.object({ SUPABASE_DB_URL: nonEmpty }),
  verify: z.object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  }),
};

// Reports variable names only, never values.
export function loadDbEnv<K extends keyof typeof schemas>(
  script: K,
): z.infer<(typeof schemas)[K]> {
  const result = schemas[script].safeParse(process.env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    console.error(`Missing or invalid environment variables: ${names.join(', ')}`);
    process.exit(1);
  }
  return result.data as z.infer<(typeof schemas)[K]>;
}
