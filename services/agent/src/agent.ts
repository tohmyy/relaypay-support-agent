import { readFileSync } from 'node:fs';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveKnowledge, type KbResult } from '../retrieval/retrieve';
import { categoryForTool, type TurnProgress } from './acks';
import { applyGuard } from './guard';
import { recordError } from './observability';
import { ensureConversation, loadHistory, saveTurn } from './history';
import { chatOfferSourceFor, type ContactContext } from './chat-offer';
import { buildPrompt, retrievalQuery } from './prompt';
import { answerJsonSchema, parseAnswer, type AnswerType } from './schema';
import { getSupabase } from './supabase';
import { TurnTimer } from './timing';
import type { WarmPool } from './warm';

export const MCP_SERVER_NAME = 'relaypay';
export const TOOL_NAMES = [
  'lookup_customer',
  'lookup_transaction',
  'lookup_payout',
  'create_support_ticket',
  'create_escalation',
  'log_conversation_event',
] as const;
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const MAX_MESSAGE_CHARS = 2000;
const MAX_TURNS = 6;

const SYSTEM_PROMPT = readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8');

export interface TurnInput {
  conversationId: string;
  userMessage: string;
  /** Stopwatch for this turn, started when the request arrived. A turn run without one times itself. */
  timer?: TurnTimer;
  /** Lets the caller see what the turn is doing (a lookup, a ticket...) to choose a fitting acknowledgement. */
  progress?: TurnProgress;
}

export interface TurnResult {
  response: string;
  answerType: AnswerType;
  sources: string[];
  toolsUsed: string[];
  escalated: boolean;
  /** True only when the create_escalation tool actually succeeded in this turn (the trigger for a human handoff). */
  escalationCreated: boolean;
  /** How the customer chose to be helped, as passed to create_escalation (absent when the model passed none). */
  escalationChannel?: 'text_chat' | 'callback';
  /** A knowledge lookup ran for this turn (counted against the conversation's retrieval budget). */
  retrieved: boolean;
  /** Number of the stored turn, so timings can be attached to it once the reply has gone out. */
  turnNumber: number;
}

/** Everything external is injectable so tests can fake the model, database and retrieval. */
export interface AgentDeps {
  query?: typeof sdkQuery;
  db?: SupabaseClient;
  retrieve?: (
    q: string,
    o: { conversationId: string },
  ) => Promise<{ chunks: KbResult[]; logged?: Promise<void> }>;
  /** Pre-started agent processes (optional). Without it every turn starts its own, exactly as before. */
  warm?: Pick<WarmPool, 'take' | 'warm'>;
  mcpUrl?: string;
  mcpToken?: string;
  model?: string;
  systemPrompt?: string;
  /** Human handoff is on: a signed-in customer is offered a live text chat with a person at escalation. */
  humanHandoff?: boolean;
  /**
   * Looks up which ways of reaching a person may be offered to this caller (the administrator's setting, whether a live text
   * chat is possible, account contact details, whether anyone is online).
   */
  contactContext?: (customerId: string | null, handoffEnabled: boolean) => Promise<ContactContext | undefined>;
}

/** The options for a pre-started agent process for one conversation (same as a cold turn would use). */
export function buildWarmOptions(conversationId: string, deps: AgentDeps = {}) {
  return buildOptions({ ...resolveConfig(deps), conversationId });
}

/** The SDK options that keep the agent locked to the six MCP tools. Exported for tests. */
export function buildOptions(cfg: {
  mcpUrl: string;
  mcpToken: string;
  model: string;
  systemPrompt: string;
  conversationId?: string;
}) {
  return {
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    tools: [] as string[],
    settingSources: [] as never[],
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http' as const,
        url: cfg.mcpUrl,
        // The MCP server uses X-Conversation-Id to tie every tool call to this call in tool_calls.
        headers: {
          Authorization: `Bearer ${cfg.mcpToken}`,
          ...(cfg.conversationId ? { 'X-Conversation-Id': cfg.conversationId } : {}),
        },
      },
    },
    strictMcpConfig: true,
    allowedTools: TOOL_NAMES.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`),
    maxTurns: MAX_TURNS,
    persistSession: false,
    thinking: { type: 'disabled' as const },
    outputFormat: { type: 'json_schema' as const, schema: answerJsonSchema },
  };
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  input?: unknown;
  is_error?: boolean;
  content?: unknown;
}

function blocksOf(message: unknown): Block[] {
  const content = (message as { message?: { content?: unknown } })?.message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function toolResultText(block: Block): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .map((c) =>
        c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '',
      )
      .join('');
  }
  return '';
}

function tryJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveConfig(deps: AgentDeps) {
  const mcpUrl = deps.mcpUrl ?? process.env.MCP_SERVER_URL;
  const mcpToken = deps.mcpToken ?? process.env.MCP_SERVER_AUTH_TOKEN;
  const missing = [
    !deps.query && !process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : null,
    !mcpUrl ? 'MCP_SERVER_URL' : null,
    !mcpToken ? 'MCP_SERVER_AUTH_TOKEN' : null,
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Missing or invalid environment variables: ${missing.join(', ')}`);
  }
  return {
    mcpUrl: mcpUrl!,
    mcpToken: mcpToken!,
    model: deps.model ?? (process.env.AGENT_MODEL || DEFAULT_MODEL),
    systemPrompt: deps.systemPrompt ?? SYSTEM_PROMPT,
  };
}

/** Handles one customer message: retrieve, ask the model (with MCP tools), guard, record, return. */
export async function runTurn(input: TurnInput, deps: AgentDeps = {}): Promise<TurnResult> {
  const conversationId = input.conversationId?.trim();
  const userMessage = input.userMessage?.trim();
  if (!conversationId || conversationId.length > 64)
    throw new Error('conversationId is required (max 64 chars)');
  if (!userMessage) throw new Error('userMessage is required');
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    throw new Error(`userMessage is too long (max ${MAX_MESSAGE_CHARS} characters)`);
  }

  const startedAt = Date.now();
  const cfg = resolveConfig(deps);
  const db = deps.db ?? getSupabase();
  const retrieve = deps.retrieve ?? ((q, o) => retrieveKnowledge(q, o));
  const query = deps.query ?? sdkQuery;

  try {
    return await handleTurn();
  } catch (error) {
    // A failed turn leaves a trace in the database too; the caller still gets the error.
    await recordError(db, conversationId, 'agent.runTurn', error);
    throw error;
  }

  async function handleTurn(): Promise<TurnResult> {
    const timer = input.timer ?? new TurnTimer();
    const progress = input.progress;

    // The conversation row and the history reads do not depend on each other.
    const [, history] = await timer.span('history_ms', () =>
      Promise.all([ensureConversation(db, conversationId), loadHistory(db, conversationId)]),
    );
    // Which ways of reaching a person may be offered (before any escalation) is looked up alongside the knowledge search,
    // so it adds no waiting; the setting and the account details are cached for a short time.
    const contactPromise: Promise<ContactContext | undefined> = history.escalationRaised
      ? Promise.resolve(undefined)
      : (deps.contactContext ?? ((id, enabled) => chatOfferSourceFor(db).contactFor(id, enabled)))(
          history.customerId,
          Boolean(deps.humanHandoff),
        );
    const [retrieval, contact] = await timer.span('retrieval_ms', () =>
      Promise.all([retrieve(retrievalQuery(userMessage, history.turns), { conversationId }), contactPromise]),
    );
    const knowledge = retrieval.chunks;
    if (progress && knowledge.length > 0) progress.knowledge = true;

    const prompt = buildPrompt({
      conversationId,
      userMessage,
      history: history.turns,
      knowledge,
      escalationRaised: history.escalationRaised,
      contact,
    });

    // Run the model and watch its tool traffic.
    const toolNames = new Map<string, string>();
    const toolsUsed: string[] = [];
    const internalTexts: string[] = [];
    let escalationCreated = false;
    let escalationChannel: 'text_chat' | 'callback' | undefined;
    let structured: unknown;
    let resultText: string | undefined;
    let costUsd: number | undefined;

    // Claimed only now, right before use, so an early failure above cannot strand a running process.
    const warmed = await deps.warm?.take(conversationId);
    timer.set('prewarmed', Boolean(warmed));
    const stream = warmed
      ? warmed.query(prompt)
      : query({ prompt, options: buildOptions({ ...cfg, conversationId }) });
    const loopStart = timer.time();
    const toolStarts = new Map<string, number>();
    let sawFirstMessage = false;

    try {
      for await (const message of stream) {
        if (!sawFirstMessage) {
          // Subprocess start and handshake (near zero when the process was pre-started).
          sawFirstMessage = true;
          timer.set('sdk_start_ms', timer.time() - loopStart);
        }
        const m = message as {
          type?: string;
          structured_output?: unknown;
          result?: string;
          is_error?: boolean;
        };
        if (m.type === 'assistant') {
          for (const b of blocksOf(message)) {
            // Skip the SDK's own StructuredOutput pseudo-tool; only report our MCP tools.
            if (b.type === 'tool_use' && b.id && b.name?.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
              const short = b.name.replace(`mcp__${MCP_SERVER_NAME}__`, '');
              toolNames.set(b.id, short);
              toolsUsed.push(short);
              if (short === 'create_escalation') {
                const choice = (b.input as { contact_preference?: unknown } | undefined)?.contact_preference;
                if (choice === 'text_chat' || choice === 'callback') escalationChannel = choice;
              }
              toolStarts.set(b.id, timer.time());
              // What the model is really doing is the best cue for the acknowledgement.
              if (progress) progress.toolCategory = categoryForTool(short) ?? progress.toolCategory;
            }
          }
        } else if (m.type === 'user') {
          for (const b of blocksOf(message)) {
            if (b.type === 'tool_result' && b.tool_use_id && toolNames.has(b.tool_use_id)) {
              const began = toolStarts.get(b.tool_use_id);
              if (began !== undefined) timer.addTool(toolNames.get(b.tool_use_id)!, timer.time() - began);
            }
            if (b.type !== 'tool_result' || !b.tool_use_id || b.is_error) continue;
            const parsed = tryJson(toolResultText(b));
            const name = toolNames.get(b.tool_use_id);
            if (name === 'lookup_customer' && typeof parsed?.support_notes === 'string') {
              internalTexts.push(parsed.support_notes);
            }
            if (name === 'create_escalation' && typeof parsed?.escalation_id === 'string') {
              escalationCreated = true;
            }
          }
        } else if (m.type === 'result') {
          structured = m.structured_output;
          resultText = m.result;
          if (typeof (m as { total_cost_usd?: unknown }).total_cost_usd === 'number') {
            costUsd = (m as { total_cost_usd: number }).total_cost_usd;
          }
        }
      }
    } finally {
      timer.set('agent_ms', timer.time() - loopStart);
      timer.finishAgent();
      // Start the next turn's process now, while the customer listens to this reply and thinks.
      deps.warm?.warm(conversationId);
    }

    const answer = parseAnswer(structured, resultText);
    const guarded = applyGuard({
      response: answer.spoken_response,
      answerType: escalationCreated ? 'escalation' : answer.answer_type,
      internalTexts,
    });

    await timer.span('save_ms', () =>
      saveTurn(db, {
        conversationId,
        turnNumber: history.nextTurnNumber,
        userMessage,
        response: guarded.response,
        answerType: guarded.answerType,
        escalationCreated,
        latencyMs: Date.now() - startedAt,
        costUsd,
        confidenceNote: guarded.leaked
          ? 'output guard replaced a response that repeated internal notes'
          : answer.confidence_note,
      }),
    );
    // The knowledge log was written while the model worked; make sure it has landed before the turn is over.
    await retrieval.logged;

    return {
      response: guarded.response,
      answerType: guarded.answerType,
      sources: knowledge.map((k) => k.title),
      toolsUsed,
      escalated: guarded.answerType === 'escalation' || escalationCreated,
      escalationCreated,
      escalationChannel: escalationCreated ? escalationChannel : undefined,
      retrieved: true,
      turnNumber: history.nextTurnNumber,
    };
  }
}
