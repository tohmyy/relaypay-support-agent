import type { Env } from '../env';
import type { SessionConfig } from './types';

export function sessionConfigFromEnv(
  env: Pick<
    Env,
    | 'SESSION_MAX_SECONDS'
    | 'SESSION_WARNING_SECONDS'
    | 'SILENCE_TIMEOUT_SECONDS'
    | 'SILENCE_COUNTDOWN_SECONDS'
    | 'HUMAN_HANDOFF'
    | 'MAX_AGENT_CALLS'
    | 'MAX_TOOL_CALLS'
    | 'MAX_RETRIEVALS'
    | 'MAX_CONCURRENT_SESSIONS'
    | 'SESSION_RATE_MAX'
    | 'SESSION_RATE_WINDOW_SECONDS'
    | 'GLOBAL_SESSION_RATE_MAX'
    | 'GLOBAL_SESSION_RATE_WINDOW_SECONDS'
  >,
): SessionConfig {
  return {
    maxSeconds: env.SESSION_MAX_SECONDS,
    // A warning window as long as the session itself would warn at second zero; keep it inside the limit.
    warningSeconds: Math.min(env.SESSION_WARNING_SECONDS, env.SESSION_MAX_SECONDS - 1),
    silenceSeconds: env.SILENCE_TIMEOUT_SECONDS,
    countdownSeconds: env.SILENCE_COUNTDOWN_SECONDS,
    humanHandoff: env.HUMAN_HANDOFF === '1',
    limits: {
      maxAgentCalls: env.MAX_AGENT_CALLS,
      maxToolCalls: env.MAX_TOOL_CALLS,
      maxRetrievals: env.MAX_RETRIEVALS,
      maxConcurrentSessions: env.MAX_CONCURRENT_SESSIONS,
      sessionRateMax: env.SESSION_RATE_MAX,
      sessionRateWindowSeconds: env.SESSION_RATE_WINDOW_SECONDS,
      globalSessionRateMax: env.GLOBAL_SESSION_RATE_MAX,
      globalSessionRateWindowSeconds: env.GLOBAL_SESSION_RATE_WINDOW_SECONDS,
    },
  };
}
