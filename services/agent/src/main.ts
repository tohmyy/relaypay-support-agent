import { runTurn } from './agent';
import { loadEnv } from './env';
import { createAgentServer } from './server';
import { sessionConfigFromEnv } from './session/config';
import { SessionController } from './session/controller';
import { createVapiCallControl } from './session/vapi-control';
import { getSupabase } from './supabase';

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
});

const server = createAgentServer({
  apiToken: env.AGENT_API_TOKEN,
  webhookSecret: env.VAPI_WEBHOOK_SECRET,
  runTurn,
  db,
  session,
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
    `  session limits: ${sessionConfig.maxSeconds}s max, silence ${sessionConfig.silenceSeconds}s + ${sessionConfig.countdownSeconds}s countdown`,
  );
});
