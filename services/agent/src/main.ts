import { runTurn } from './agent';
import { loadEnv } from './env';
import { createAgentServer } from './server';
import { getSupabase } from './supabase';

// Starts the agent's HTTP server: the Vapi custom-LLM endpoint and the Vapi webhook.
const env = loadEnv();
if (!env.AGENT_API_TOKEN) {
  console.error('Missing or invalid environment variables: AGENT_API_TOKEN');
  process.exit(1);
}

const server = createAgentServer({
  apiToken: env.AGENT_API_TOKEN,
  webhookSecret: env.VAPI_WEBHOOK_SECRET,
  runTurn,
  db: getSupabase(),
});

server.listen(env.AGENT_PORT, env.AGENT_HOST, () => {
  console.log(`RelayPay agent listening on http://${env.AGENT_HOST}:${env.AGENT_PORT}`);
  console.log('  POST /chat/completions  (Vapi custom LLM)');
  console.log(
    env.VAPI_WEBHOOK_SECRET
      ? '  POST /vapi/events       (Vapi webhook)'
      : '  /vapi/events disabled: VAPI_WEBHOOK_SECRET not set',
  );
});
