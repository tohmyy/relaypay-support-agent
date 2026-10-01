import { existsSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Load .env.local so live tests (skipped when unset) can reach Supabase.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Same alias as apps/web/tsconfig.json so web code can be imported by tests.
    alias: { '@': path.resolve('apps/web') },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'services/**/*.test.ts'],
    // Component tests opt in with `// @vitest-environment jsdom`; everything else runs in Node.
  },
});
