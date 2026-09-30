import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// Use the single repo-root .env.local shared with the services.
loadEnvConfig(path.resolve(__dirname, '../..'));

const nextConfig: NextConfig = {};

export default nextConfig;
