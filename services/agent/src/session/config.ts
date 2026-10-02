import type { Env } from '../env';
import type { SessionConfig } from './types';

export function sessionConfigFromEnv(
  env: Pick<
    Env,
    | 'SESSION_MAX_SECONDS'
    | 'SESSION_WARNING_SECONDS'
    | 'SILENCE_TIMEOUT_SECONDS'
    | 'SILENCE_COUNTDOWN_SECONDS'
  >,
): SessionConfig {
  return {
    maxSeconds: env.SESSION_MAX_SECONDS,
    // A warning window as long as the session itself would warn at second zero; keep it inside the limit.
    warningSeconds: Math.min(env.SESSION_WARNING_SECONDS, env.SESSION_MAX_SECONDS - 1),
    silenceSeconds: env.SILENCE_TIMEOUT_SECONDS,
    countdownSeconds: env.SILENCE_COUNTDOWN_SECONDS,
  };
}
