import { readFileSync } from 'node:fs';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveKnowledge, type KbResult } from '../retrieval/retrieve';
import { applyGuard } from './guard';
import { ensureConversation, loadHistory, saveTurn } from './history';
import { buildPrompt, retrievalQuery } from './prompt';
import { answerJsonSchema, parseAnswer, type AnswerType } from './schema';
import { getSupabase } from './supabase';

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
}

export interface TurnResult {
  response: string;
  answerType: AnswerType;
  sources: string[];
  toolsUsed: string[];
  escalated: boolean;
}

/** Everything external is injectable so tests can fake the model, database and retrieval. */
export interface AgentDeps {
  query?: typeof sdkQuery;
  db?: SupabaseClient;
  retrieve?: (q: string, o: { conversationId: string }) => Promise<{ chunks: KbResult[] }>;
  mcpUrl?: string;
  mcpToken?: string;
  model?: string;
  systemPrompt?: string;
}

/** The SDK options that keep the agent locked to the six MCP tools. Exported for tests. */
export function buildOptions(cfg: { mcpUrl: string; mcpToken: string; model: string; systemPrompt: string }) {
  return {
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    tools: [] as string[],
    settingSources: [] as never[],
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'http' as const,
        url: cfg.mcpUrl,
        headers: { Authorization: `Bearer ${cfg.mcpToken}` },
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
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
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
  if (!conversationId || conversationId.length > 64) throw new Error('conversationId is required (max 64 chars)');
  if (!userMessage) throw new Error('userMessage is required');
  if (userMessage.length > MAX_MESSAGE_CHARS) {
    throw new Error(`userMessage is too long (max ${MAX_MESSAGE_CHARS} characters)`);
  }

  const cfg = resolveConfig(deps);
  const db = deps.db ?? getSupabase();
  const retrieve = deps.retrieve ?? ((q, o) => retrieveKnowledge(q, o));
  const query = deps.query ?? sdkQuery;

  await ensureConversation(db, conversationId);
  const history = await loadHistory(db, conversationId);
  const knowledge = (await retrieve(retrievalQuery(userMessage, history.turns), { conversationId })).chunks;

  const prompt = buildPrompt({
    conversationId,
    userMessage,
    history: history.turns,
    knowledge,
    escalationRaised: history.escalationRaised,
  });

  // Run the model and watch its tool traffic.
  const toolNames = new Map<string, string>();
  const toolsUsed: string[] = [];
  const internalTexts: string[] = [];
  let escalationCreated = false;
  let structured: unknown;
  let resultText: string | undefined;

  for await (const message of query({ prompt, options: buildOptions(cfg) })) {
    const m = message as { type?: string; structured_output?: unknown; result?: string; is_error?: boolean };
    if (m.type === 'assistant') {
      for (const b of blocksOf(message)) {
        // Skip the SDK's own StructuredOutput pseudo-tool; only report our MCP tools.
        if (b.type === 'tool_use' && b.id && b.name?.startsWith(`mcp__${MCP_SERVER_NAME}__`)) {
          const short = b.name.replace(`mcp__${MCP_SERVER_NAME}__`, '');
          toolNames.set(b.id, short);
          toolsUsed.push(short);
        }
      }
    } else if (m.type === 'user') {
      for (const b of blocksOf(message)) {
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
    }
  }

  const answer = parseAnswer(structured, resultText);
  const guarded = applyGuard({
    response: answer.spoken_response,
    answerType: escalationCreated ? 'escalation' : answer.answer_type,
    internalTexts,
  });

  await saveTurn(db, {
    conversationId,
    turnNumber: history.nextTurnNumber,
    userMessage,
    response: guarded.response,
    answerType: guarded.answerType,
    escalationCreated,
    confidenceNote: guarded.leaked ? 'output guard replaced a response that repeated internal notes' : answer.confidence_note,
  });

  return {
    response: guarded.response,
    answerType: guarded.answerType,
    sources: knowledge.map((k) => k.title),
    toolsUsed,
    escalated: guarded.answerType === 'escalation' || escalationCreated,
  };
}
