import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AckRotation, chooseAckCategory, type TurnProgress } from './acks';
import type { TurnInput, TurnResult } from './agent';
import { recordTurnTimings } from './history';
import { errorMessage, logEvent } from './logger';
import type { ReadyResponse } from './ready';
import type { SessionController, TurnDecision } from './session/controller';
import { reopenConversation } from './session/persist';
import { TurnTimer } from './timing';
import {
  completionJson,
  extractCallId,
  extractUserMessage,
  handleVapiEvent,
  resolveConversationId,
  resolveFromChatBody,
  SAFE_SPOKEN_ERROR,
  SSE_DONE,
  sseChunk,
} from './vapi';
import type { WarmPool } from './warm';

const MAX_BODY_BYTES = 256 * 1024;
/** Same cap the agent applies to any customer message. */
const MAX_TEXT_CHARS = 2000;
export const DEFAULT_FILLER_AFTER_MS = 2500;

export interface AgentServerOptions {
  apiToken: string;
  /** Shared secret Vapi sends as X-Vapi-Secret. When empty the webhook route is disabled. */
  webhookSecret?: string;
  runTurn: (input: TurnInput) => Promise<Pick<TurnResult, 'response'> & Partial<TurnResult>>;
  db?: SupabaseClient;
  /** Speak a short acknowledgement if the reply takes longer than this. */
  fillerAfterMs?: number;
  /** Session limits, silence and "that's all" handling. Absent means turns run unconditionally (tests, scripts). */
  session?: SessionController;
  /** Pre-started agent processes: warmed when a call starts, released when it ends. Absent means none. */
  warm?: Pick<WarmPool, 'warm' | 'release' | 'dispose'>;
  /** Phrase rotation for the spoken acknowledgements. Defaults to a fresh one. */
  acks?: AckRotation;
  /** Dependency readiness for GET /ready (MCP + database). Absent means /ready reports ready. */
  ready?: () => Promise<ReadyResponse>;
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

interface Answered {
  text: string;
  /** Stored turn number, when the agent ran (controller replies have none). */
  turnNumber?: number;
}

/**
 * HTTP surface of the agent: the Vapi custom-LLM endpoint (POST /chat/completions) and the Vapi server-message
 * webhook (POST /vapi/events). Turns of one call run one at a time so interruptions cannot interleave.
 */
export function createAgentServer(opts: AgentServerOptions): Server {
  const queues = new Map<string, Promise<unknown>>();
  const fillerAfter = opts.fillerAfterMs ?? DEFAULT_FILLER_AFTER_MS;
  const acks = opts.acks ?? new AckRotation();

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
    callId: string | undefined,
    timer: TurnTimer,
    progress: TurnProgress,
    textOnly = false,
  ): Promise<Answered> {
    const session = opts.session;
    try {
      const r = await serialized(conversationId, async () => {
        // Time from the request arriving to this turn actually starting (it waits behind any earlier turn).
        timer.set('queue_ms', timer.elapsed());
        // Deterministic session control first: time limit, "that's all", an ended call. No model call for these.
        const decision: TurnDecision = session
          ? await timer.span('controller_ms', () =>
              session.beforeTurn({ conversationId, callId, userMessage, textOnly }),
            )
          : { kind: 'proceed' };
        if (decision.kind === 'reply')
          return { response: decision.text } as Pick<TurnResult, 'response'> & Partial<TurnResult>;
        try {
          const result = await opts.runTurn({ conversationId, userMessage, timer, progress });
          session?.afterTurn(conversationId, result);
          return result;
        } catch (error) {
          session?.afterTurn(conversationId);
          throw error;
        }
      });
      return { text: r.response, turnNumber: r.turnNumber };
    } catch (error) {
      logTechnical('runTurn failed', error, conversationId);
      return { text: SAFE_SPOKEN_ERROR };
    }
  }

  /** Stores the finished turn's timings. After the reply has gone out; never awaited; a failure only logs. */
  function persistTimings(conversationId: string, answered: Answered, timer: TurnTimer) {
    timer.set('total_turn_ms', timer.elapsed());
    if (!opts.db || answered.turnNumber === undefined) return;
    void recordTurnTimings(opts.db, conversationId, answered.turnNumber, timer.toJSON());
  }

  async function chatCompletions(req: IncomingMessage, res: ServerResponse) {
    // Started the moment the request arrives, so every segment below is measured from the same zero.
    const timer = new TurnTimer();
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
    const progress: TurnProgress = {};
    const speechGap = opts.session?.consumeSpeechGapMs(conversationId);
    if (speechGap !== undefined) timer.set('speech_to_agent_ms', speechGap);
    const id = `chatcmpl-${randomUUID()}`;
    if (body.stream !== true) {
      const answered = await answer(conversationId, userMessage, callId, timer, progress);
      // The customer may have talked over the assistant while the turn ran: there is nobody to answer.
      if (res.destroyed) {
        timer.set('client_closed_ms', timer.elapsed());
        timer.set('delivered', false);
        opts.session?.replyNotDelivered(conversationId);
      } else {
        timer.set('first_write_ms', timer.elapsed());
        timer.set('delivered', true);
        sendJson(res, 200, completionJson(id, answered.text));
      }
      persistTimings(conversationId, answered, timer);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const write = (s: string) => {
      if (!res.writableEnded && !res.destroyed) res.write(s);
    };
    /** Content is what Vapi speaks, so the first one is the server-side stand-in for "time to first audio". */
    const speak = (text: string, at: number = timer.elapsed()) => {
      if (timer.get('first_write_ms') === undefined) timer.set('first_write_ms', at);
      write(sseChunk(id, { content: text }));
    };
    write(sseChunk(id, { role: 'assistant' }));
    // Stay audible on slow turns. The acknowledgement fits what the turn is doing, comes from a fixed library, is
    // transport only and is never stored as the answer.
    let closedEarly = false;
    const ackTimer = setTimeout(() => {
      // Nobody is listening any more: do not speak, advance the phrase rotation or record an acknowledgement.
      if (closedEarly) return;
      const category = chooseAckCategory(progress, userMessage);
      // One instant for both: when the acknowledgement is the first thing written, it *is* the first write.
      const at = timer.elapsed();
      timer.set('ack_ms', at);
      timer.set('ack_category', category);
      speak(acks.pick(conversationId, category), at);
    }, fillerAfter);
    // The response closing before it finished means the connection dropped (for example the customer interrupted).
    res.on('close', () => {
      if (res.writableFinished) return;
      closedEarly = true;
      clearTimeout(ackTimer);
      timer.set('client_closed_ms', timer.elapsed());
    });
    const answered = await answer(conversationId, userMessage, callId, timer, progress);
    clearTimeout(ackTimer);
    timer.set('delivered', !closedEarly);
    if (closedEarly) opts.session?.replyNotDelivered(conversationId);
    speak(answered.text);
    write(sseChunk(id, {}, 'stop'));
    write(SSE_DONE);
    if (!res.writableEnded) res.end();
    persistTimings(conversationId, answered, timer);
  }

  /**
   * A typed turn for a customer who cannot use a microphone (docs/BUILD-PLAN-V3.md V3.12). Same turn path as a voice turn
   * (per-conversation queue, Session Controller, history, budgets), minus the call. Called by the web server only, with
   * the same bearer token as the custom-LLM endpoint; the web server has already authenticated the customer and linked
   * the conversation to them. Not retried automatically: running a turn twice would answer, and bill, twice.
   */
  async function textTurn(req: IncomingMessage, res: ServerResponse) {
    let body: { conversationId?: unknown; message?: unknown };
    try {
      body = (await readJson(req)) as typeof body;
    } catch (error) {
      const tooLarge = error instanceof RangeError;
      return sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'body too large' : 'invalid JSON' });
    }
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(conversationId)) return sendJson(res, 400, { error: 'conversation id required' });
    if (!message) return sendJson(res, 400, { error: 'message required' });
    if (message.length > MAX_TEXT_CHARS) return sendJson(res, 413, { error: 'message too long' });

    const timer = new TurnTimer();
    const answered = await answer(conversationId, message, undefined, timer, {}, true);
    persistTimings(conversationId, answered, timer);
    const ended = opts.session?.phaseOf(conversationId) === 'ended';
    return sendJson(res, 200, { response: answered.text, ended });
  }

  /**
   * Reopens a conversation that ended within the grace period (docs/BUILD-PLAN-V3.md V3.14). Called by the web server
   * after it has authenticated the customer; the customer id it sends is the owner the conversation must belong to.
   */
  async function resumeConversation(req: IncomingMessage, res: ServerResponse) {
    let body: { conversationId?: unknown; customerId?: unknown };
    try {
      body = (await readJson(req)) as typeof body;
    } catch {
      return sendJson(res, 400, { error: 'invalid JSON' });
    }
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
    const customerId = typeof body?.customerId === 'string' && body.customerId ? body.customerId : null;
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(conversationId)) return sendJson(res, 400, { error: 'conversation id required' });
    if (!opts.session && !opts.db) return sendJson(res, 404, { error: 'not found' });
    try {
      const result = opts.session
        ? await opts.session.reopen(conversationId, customerId)
        : await reopenConversation(opts.db!, conversationId, { customerId });
      return sendJson(res, 200, result);
    } catch (error) {
      logTechnical('resume failed', error, conversationId);
      return sendJson(res, 500, { error: 'internal error' });
    }
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
      const message = (payload as { message?: Record<string, unknown> } | null)?.message;
      // The earlier call of a conversation that was resumed: its end-of-call report must not end the conversation again.
      const reportedCall = (message?.call as { id?: unknown } | undefined)?.id;
      const staleConversation = resolveConversationId({ call: message?.call as never });
      if (
        message?.type === 'end-of-call-report' &&
        staleConversation &&
        typeof reportedCall === 'string' &&
        opts.session?.isStaleCallReport(staleConversation, reportedCall)
      ) {
        return sendJson(res, 200, { ok: true });
      }
      const result = await handleVapiEvent(opts.db, payload);
      if (message && result.conversationId) {
        // A call starting: get its agent process ready before the first question. A call ending: let go of it, and
        // forget which acknowledgement phrases it heard.
        if (message.type === 'status-update' && message.status === 'in-progress') {
          opts.warm?.warm(result.conversationId);
        } else if (message.type === 'end-of-call-report') {
          void opts.warm?.release(result.conversationId);
          acks.forget(result.conversationId);
        }
        if (opts.session) await opts.session.handleVapiMessage(result.conversationId, message);
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

      if (req.method === 'GET' && path === '/ready') {
        if (!sameSecret(bearer(req.headers.authorization), opts.apiToken)) {
          return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        }
        let report: ReadyResponse;
        try {
          report = opts.ready
            ? await opts.ready()
            : { ok: true, checks: { mcp: { ok: true }, db: { ok: true } } };
        } catch (error) {
          logTechnical('ready check', error);
          report = {
            ok: false,
            checks: { mcp: { ok: false, error: 'failed' }, db: { ok: false, error: 'failed' } },
          };
        }
        return sendJson(res, report.ok ? 200 : 503, report);
      }

      if (path === '/vapi/events') {
        if (req.method !== 'POST')
          return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
        return await vapiEvents(req, res);
      }

      if (path === '/text-turn') {
        if (!sameSecret(bearer(req.headers.authorization), opts.apiToken)) {
          return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        }
        if (req.method !== 'POST')
          return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
        return await textTurn(req, res);
      }

      if (path === '/resume') {
        if (!sameSecret(bearer(req.headers.authorization), opts.apiToken)) {
          return sendJson(res, 401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
        }
        if (req.method !== 'POST')
          return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
        return await resumeConversation(req, res);
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
  server.on('close', () => {
    opts.session?.dispose();
    void opts.warm?.dispose();
  });
  return server;
}
