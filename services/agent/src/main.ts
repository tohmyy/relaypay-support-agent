import { buildWarmOptions, runTurn } from './agent';
import { loadEnv } from './env';
import { createAgentServer } from './server';
import { sessionConfigFromEnv } from './session/config';
import { SessionController } from './session/controller';
import { createVapiCallControl } from './session/vapi-control';
import { chatOfferSourceFor } from './chat-offer';
import { getSupabase } from './supabase';
import { WarmPool } from './warm';

// Starts the agent's HTTP server: the Vapi custom-LLM endpoint and the Vapi webhook.
const env = loadEnv();
if (!env.AGENT_API_TOKEN) {
  console.error('Missing or invalid environment variables: AGENT_API_TOKEN');
  process.exit(1);
}

const db = getSupabase();
const sessionConfig = sessionConfigFromEnv(env);
const session = new SessionController({
  db,
  config: sessionConfig,
  control: createVapiCallControl({ apiKey: env.VAPI_API_KEY }),
  methods: () => chatOfferSourceFor(db).methods(),
});

// Optional: keep an agent process started per live call so a turn does not pay for process start. Off by default
// until a measured comparison shows it helps (docs/PERFORMANCE.md).
const warm =
  env.AGENT_PREWARM === '1'
    ? new WarmPool({
        build: (conversationId) => buildWarmOptions(conversationId),
        max: env.PREWARM_MAX,
        ttlMs: env.PREWARM_TTL_SECONDS * 1000,
      })
    : undefined;

const server = createAgentServer({
  apiToken: env.AGENT_API_TOKEN,
  webhookSecret: env.VAPI_WEBHOOK_SECRET,
  runTurn: (input) => runTurn(input, { warm, humanHandoff: env.HUMAN_HANDOFF === '1' }),
  db,
  session,
  warm,
  fillerAfterMs: env.ACK_AFTER_MS,
});

server.listen(env.AGENT_PORT, env.AGENT_HOST, () => {
  console.log(`RelayPay agent listening on http://${env.AGENT_HOST}:${env.AGENT_PORT}`);
  console.log('  POST /chat/completions  (Vapi custom LLM)');
  console.log(
    env.VAPI_WEBHOOK_SECRET
      ? '  POST /vapi/events       (Vapi webhook)'
      : '  /vapi/events disabled: VAPI_WEBHOOK_SECRET not set (silence detection needs speech events)',
  );
  console.log(
    `  latency: acknowledgement after ${env.ACK_AFTER_MS}ms, agent pre-warm ${warm ? `on (max ${env.PREWARM_MAX})` : 'off'}`,
  );
  console.log(
    `  human handoff: ${sessionConfig.humanHandoff ? 'on (signed-in customers move to a text chat with staff after an escalation)' : 'off'}`,
  );
  console.log(
    `  abuse limits: ${sessionConfig.limits.maxAgentCalls || 'off'} agent calls, ${sessionConfig.limits.maxToolCalls || 'off'} tool calls, ${sessionConfig.limits.maxRetrievals || 'off'} retrievals per conversation; ${sessionConfig.limits.maxConcurrentSessions || 'off'} concurrent per customer; session rates ${sessionConfig.limits.sessionRateMax || sessionConfig.limits.globalSessionRateMax ? 'on' : 'off'}`,
  );
  console.log(
    `  session limits: ${sessionConfig.maxSeconds}s max, silence ${sessionConfig.silenceSeconds}s + ${sessionConfig.countdownSeconds}s countdown`,
  );
});
