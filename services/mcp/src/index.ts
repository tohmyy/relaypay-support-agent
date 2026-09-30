import { createSupabase } from './db/client';
import { createStore } from './db/store';
import { loadEnv } from './env';
import { createHttpServer } from './server';

const env = loadEnv();
const store = createStore(createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
const server = createHttpServer({ store, authToken: env.MCP_SERVER_AUTH_TOKEN });

server.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.log(`RelayPay MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});
