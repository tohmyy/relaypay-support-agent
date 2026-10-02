import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { createSupabase } from '../../services/mcp/src/db/client';
import { createStore } from '../../services/mcp/src/db/store';
import { createHttpServer } from '../../services/mcp/src/server';
import { runTurn, type AgentDeps } from '../../services/agent/src/agent';

// Text harness for the agent: type as the customer, see the reply, answer type, sources and tools used.
// By default it talks to the MCP server at MCP_SERVER_URL (start it with `npm run mcp:dev`).
// With --inprocess-mcp it starts its own MCP server on a random port instead.
const inProcess = process.argv.includes('--inprocess-mcp');
const conversationId = `test-chat-${Date.now()}`;
const deps: AgentDeps = {};

let server: ReturnType<typeof createHttpServer> | undefined;
if (inProcess) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing or invalid environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const token = randomUUID();
  server = createHttpServer({ store: createStore(createSupabase(url, key)), authToken: token, allowUnlinked: true });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  deps.mcpUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  deps.mcpToken = token;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`RelayPay agent text chat (conversation ${conversationId}). Type "exit" to quit.\n`);
try {
  while (true) {
    const line = (await rl.question('you> ')).trim();
    if (!line) continue;
    if (line === 'exit') break;
    try {
      const r = await runTurn({ conversationId, userMessage: line }, deps);
      console.log(`\nagent> ${r.response}`);
      console.log(
        `  [${r.answerType}] sources: ${r.sources.join('; ') || 'none'} | tools: ${r.toolsUsed.join(', ') || 'none'}\n`,
      );
    } catch (error) {
      console.error(`\nerror: ${(error as Error).message}\n`);
    }
  }
} finally {
  rl.close();
  server?.close();
  console.log(`\nNote: rows for ${conversationId} remain in conversation_turns for inspection.`);
  process.exit(0);
}
