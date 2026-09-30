import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Store } from './db/store';
import { executeTool, isErrorResult, tools } from './tools';
import { isAuthorized } from './utils/auth';
import { logTechnical } from './utils/logging';

const MAX_BODY_BYTES = 100 * 1024;

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer({ name: 'relaypay-support', version: '0.1.0' });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.shape },
      async (args: unknown) => {
        const result = await executeTool(tool, args, store);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
          isError: isErrorResult(result),
        };
      },
    );
  }
  return server;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RangeError('body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface HttpServerOptions {
  store: Store;
  authToken: string;
}

/** Stateless Streamable HTTP MCP endpoint at POST /mcp, guarded by a bearer token. */
export function createHttpServer({ store, authToken }: HttpServerOptions): Server {
  return createServer(async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
      if (path !== '/mcp') return send(res, 404, { error: 'not found' });

      if (!isAuthorized(req.headers.authorization, authToken)) {
        return send(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });

      let body: unknown;
      try {
        body = await readJson(req);
      } catch (error) {
        const tooLarge = error instanceof RangeError;
        return send(res, tooLarge ? 413 : 400, { error: tooLarge ? 'body too large' : 'invalid JSON' });
      }

      const mcp = createMcpServer(store);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      logTechnical('http handler', error);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    }
  });
}
