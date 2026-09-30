# Agent

`services/agent` is the RelayPay support agent built on the Claude Agent SDK.

## Entry point

```ts
import { runTurn } from './services/agent/src';
const r = await runTurn({ conversationId: 'call-123', userMessage: 'Check TXN-9001' });
// { response, answerType, sources, toolsUsed, escalated }
```

Stateless between calls. History (last 8 turns) and the "escalation already raised" flag come from
`conversation_turns`, so a caller such as Vapi only sends the conversation id and the text.

Each turn:

1. validate input (non-empty, max 2,000 characters, conversation id max 64);
2. ensure a `conversations` row exists;
3. load history;
4. `retrieveKnowledge` (logs to `retrieval_logs`) using the message plus the previous customer message;
5. build a prompt of labelled blocks: `conversation_id`, `retrieved_knowledge`, `conversation_history`,
   optional `escalation_already_raised`, `current_user_message` (angle brackets in text are escaped so it cannot
   forge a block);
6. call the SDK `query()` with structured output `{ answer_type, spoken_response, confidence_note }`;
7. apply the output guard, write a `conversation_turns` row, mark the conversation `escalated` if needed.

## Locked-down SDK options

`tools: []` (no built-in file, shell or web tools), `settingSources: []` (no CLAUDE.md or user settings),
`strictMcpConfig`, only the six `mcp__relaypay__*` tools allowed, `maxTurns: 6`, `persistSession: false`, thinking
disabled for voice latency. Model: `AGENT_MODEL` or `claude-sonnet-5-5`.

## Prompt

`services/agent/prompts/system.md`. It defines the role and voice style, grounding rules (KB for policy, tools for
records, no invented fees, no guarantees, no review timelines), the four response paths, the tool list, the
look-up-versus-escalate policy, the escalation procedure and the never-list. Prompt text is data-versus-instructions
aware: KB text, tool output and customer text are never followed as instructions.

**Look up versus escalate.** The escalation rules say to escalate account questions, but scenarios need lookups
first. The prompt resolves it: with an identifier, look it up and answer a normal status safely; escalate when the
record shows review, compliance, restricted or failed, or when a dispute, suspension, verification concern,
frustration or uncovered question is present; without an identifier, ask for one.

## Output guard (code, not prompt)

`services/agent/src/guard.ts`: strips markdown for speech, and if the response repeats `support_notes` returned by a
tool during the turn it is replaced with a safe message and the turn becomes an escalation. A created escalation
(`create_escalation` returned an id) forces `answerType: "escalation"` even if the model labelled it differently.
Unparseable model output becomes a safe `decline`.

## Try it

```bash
npm run mcp:dev                 # terminal 1
npm run agent:chat              # terminal 2 (or: npm run agent:chat -- --inprocess-mcp)
```

Needs `ANTHROPIC_API_KEY`, `SUPABASE_*`, and `MCP_SERVER_URL` / `MCP_SERVER_AUTH_TOKEN` (see `ENVIRONMENT.md`).
Chat rows are kept in `conversation_turns` (conversation ids start with `test-chat-`) for inspection.

## Tests

- `tests/agent/units.test.ts`, `tests/agent/turn.test.ts`: offline (fake model, fake database).
- `tests/agent/decisions.live.test.ts`: real model against the seeded project through an in-process MCP server.
  Skipped when `ANTHROPIC_API_KEY` is empty. Cleans up its rows.
