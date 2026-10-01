import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Use the single repo-root .env.local shared with the services. Next has already loaded (and cached)
// the env files of apps/web by now, so a plain call would return that cache; forceReload loads the root.
loadEnvConfig(path.resolve(__dirname, '../..'), process.env.NODE_ENV !== 'production', console, true);

const nextConfig: NextConfig = {
  // Lets a second copy run beside an existing dev server (for example for tests): NEXT_DIST_DIR=.next-test
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
