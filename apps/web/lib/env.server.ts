import 'server-only';
import { parseServerEnv, type ServerEnv } from './env';

let cached: ServerEnv | undefined;

// Validated lazily on first use so `next build` works without secrets.
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
