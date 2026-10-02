import { createSupabase } from './db/client';
import { createStore } from './db/store';
import { loadEnv } from './env';
import { createHttpServer } from './server';
import { flushToolRecords } from './tools';

const env = loadEnv();
const store = createStore(createSupabase(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY));
// Account tools always require a conversation linked to a signed-in customer.
const server = createHttpServer({ store, authToken: env.MCP_SERVER_AUTH_TOKEN });

server.listen(env.MCP_PORT, env.MCP_HOST, () => {
  console.log(`RelayPay MCP server listening on http://${env.MCP_HOST}:${env.MCP_PORT}/mcp`);
});

// Let tool-call rows that are still being written finish before the process exits.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void flushToolRecords().finally(() => process.exit(0));
  });
}
