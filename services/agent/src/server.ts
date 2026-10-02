import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TurnInput, TurnResult } from './agent';
import { errorMessage, logEvent } from './logger';
import type { SessionController } from './session/controller';
import {
  completionJson,
  extractCallId,
  extractUserMessage,
  handleVapiEvent,
  resolveFromChatBody,
  SAFE_SPOKEN_ERROR,
  SLOW_FILLER,
  SSE_DONE,
  sseChunk,
} from './vapi';

const MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_FILLER_AFTER_MS = 2500;

export interface AgentServerOptions {
  apiToken: string;
  /** Shared secret Vapi sends as X-Vapi-Secret. When empty the webhook route is disabled. */
  webhookSecret?: string;
  runTurn: (input: TurnInput) => Promise<Pick<TurnResult, 'response'> & Partial<TurnResult>>;
  db?: SupabaseClient;
  /** Speak a short filler if the reply takes longer than this. */
  fillerAfterMs?: number;
  /** Session limits, silence and "that's all" handling. Absent means turns run unconditionally (tests, scripts). */
  session?: SessionController;
}

function sameSecret(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearer(header: string | undefined): string | undefined {
  return /^Bearer (.+)$/.exec(header ?? '')?.[1];
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
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

function logTechnical(context: string, error: unknown, conversationId?: string) {
  logEvent('error', context, { conversation_id: conversationId, message: errorMessage(error) });
}

/**
 * HTTP surface of the agent: the Vapi custom-LLM endpoint (POST /chat/completions) and the Vapi server-message
 * webhook (POST /vapi/events). Turns of one call run one at a time so interruptions cannot interleave.
 */
export function createAgentServer(opts: AgentServerOptions): Server {
  const queues = new Map<string, Promise<unknown>>();
  const fillerAfter = opts.fillerAfterMs ?? DEFAULT_FILLER_AFTER_MS;

  function serialized<T>(conversationId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(conversationId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    queues.set(conversationId, next);
    void next
      .finally(() => {
        if (queues.get(conversationId) === next) queues.delete(conversationId);
      })
      .catch(() => undefined);
    return next;
  }

  async function answer(
    conversationId: string,
    userMessage: string,
    callId?: string,
  ): Promise<string> {
    const session = opts.session;
    try {
      const r = await serialized(conversationId, async () => {
        // Deterministic session control first: time limit, "that's all", an ended call. No model call for these.
        const decision = session
          ? await session.beforeTurn({ conversationId, callId, userMessage })
          : ({ kind: 'proceed' } as const);
        if (decision.kind === 'reply') return { response: decision.text };
        try {
          const result = await opts.runTurn({ conversationId, userMessage });
          session?.afterTurn(conversationId, result);
          return result;
        } catch (error) {
          session?.afterTurn(conversationId);
          throw error;
        }
      });
      return r.response;
    } catch (error) {
      logTechnical('runTurn failed', error, conversationId);
      return SAFE_SPOKEN_ERROR;
    }
  }

  async function chatCompletions(req: IncomingMessage, res: ServerResponse) {
    let body: Record<string, unknown>;
    try {
      body = (await readJson(req)) as Record<string, unknown>;
    } catch (error) {
      const tooLarge = error instanceof RangeError;
      return sendJson(res, tooLarge ? 413 : 400, {
        error: tooLarge ? 'body too large' : 'invalid JSON',
      });
    }
    if (process.env.AGENT_DEBUG) {
      // Shape only, never content: which fields Vapi sends, to confirm where the call id arrives.
      const keys = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v) : []);
      console.log(
        `[agent] chat request fields=${keys(body)} call=${keys(body.call)} metadata=${keys(body.metadata)} messages=${Array.isArray(body.messages) ? body.messages.length : 0} stream=${body.stream}`,
      );
    }
    const userMessage = extractUserMessage(body);
    if (!userMessage) return sendJson(res, 400, { error: 'no user message' });
    const conversationId = resolveFromChatBody(body, req.headers['x-conversation-id']);
    if (!conversationId) {
      logTechnical(
        'chat request rejected',
        new Error('no conversation id (call.id, metadata.conversation_id or header)'),
      );
      return sendJson(res, 400, { error: 'conversation id required' });
    }

    const callId = extractCallId(body);
    const id = `chatcmpl-${randomUUID()}`;
    if (body.stream !== true) {
      return sendJson(
        res,
        200,
        completionJson(id, await answer(conversationId, userMessage, callId)),
      );
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const write = (s: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(s);
    };
    write(sseChunk(id, { role: 'assistant' }));
    // Stay audible on slow turns; the filler is transport only and is never stored as the answer.
    const timer = setTimeout(() => write(sseChunk(id, { content: SLOW_FILLER })), fillerAfter);
    const text = await answer(conversationId, userMessage, callId);
    clearTimeout(timer);
    write(sseChunk(id, { content: text }));
    write(sseChunk(id, {}, 'stop'));
    write(SSE_DONE);
    if (!res.writableEnded) res.end();
  }

  async function vapiEvents(req: IncomingMessage, res: ServerResponse) {
    if (!opts.webhookSecret || !opts.db) return sendJson(res, 404, { error: 'not found' });
    const secret = req.headers['x-vapi-secret'];
    if (!sameSecret(Array.isArray(secret) ? secret[0] : secret, opts.webhookSecret)) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }
    let payload: unknown;
    try {
      payload = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    try {
      const result = await handleVapiEvent(opts.db, payload);
      const message = (payload as { message?: Record<string, unknown> } | null)?.message;
      if (opts.session && result.conversationId && message) {
        await opts.session.handleVapiMessage(result.conversationId, message);
      }
    } catch (error) {
      logTechnical('vapi event', error);
    }
    sendJson(res, 200, { ok: true });
  }

  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0];
      if (req.method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true });

      if (path === '/vapi/events') {
        if (req.method !== 'POST')
          return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
        return await vapiEvents(req, res);
      }

      if (path === '/chat/completions' || path === '/v1/chat/completions') {
        if (!sameSecret(bearer(req.headers.authorization), opts.apiToken)) {
          return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        }
        if (req.method !== 'POST')
          return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
        return await chatCompletions(req, res);
      }

      sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      logTechnical('http handler', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    }
  });
  server.on('close', () => opts.session?.dispose());
  return server;
}
