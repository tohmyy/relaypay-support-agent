import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Load .env.local so live tests (skipped when unset) can reach Supabase.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  test: { include: ['tests/**/*.test.ts', 'services/**/*.test.ts'] },
});
