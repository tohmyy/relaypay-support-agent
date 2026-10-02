# Performance and latency

Build Plan V2, Iteration 3. The rule from the plan: **measure first, then change the architecture**, and never trade
correctness for speed on account, transaction, financial or compliance questions. This iteration adds measurement, a few
speedups that do not change what the agent says, and spoken acknowledgements that fit what a slow turn is doing. The
agent's answers, system prompt and structured output are untouched.

## What a turn is made of

```
Vapi: customer stops speaking -> speech recognition -> end-of-speech detection        (Vapi measures these)
        |
        v  POST /chat/completions  ------------------------------- request received (zero for everything below)
   queue            waiting behind an earlier turn of the same call
   controller       Session Controller checks (closers, time limit)            no model call
   history          conversation row + last 8 turns + escalation status        2 reads + 1 upsert, in parallel
   retrieval        knowledge search (keyword full-text, one RPC)
   agent start      time to the first message from the agent SDK               process start + handshake
   model + tools    the SDK loop: model thinking, MCP lookups, structured output
   save             writing the turn
        |
        v  reply streamed back; Vapi speaks it (synthesis is Vapi's)
```

## What is recorded

Per model turn, `conversation_turns.timings` (JSON, written after the reply has gone out, so it adds no latency):

| Key | Meaning |
|---|---|
| `total_turn_ms` | Request received to the reply fully written |
| `queue_ms` | Request received to this turn starting (waits behind an earlier turn of the call) |
| `controller_ms` | Session Controller checks before the model |
| `history_ms` | Ensure the conversation row and load history |
| `retrieval_ms` | Knowledge search |
| `sdk_start_ms` | Time to the first message from the agent SDK: process start and handshake (near zero when pre-started) |
| `agent_ms` | The whole SDK loop |
| `mcp_ms`, `tools[]` | Each tool call as the agent sees it (tool use to tool result), and their sum |
| `model_ms` | Derived: `agent_ms - sdk_start_ms - mcp_ms`. Model thinking and writing, including the structured-output step |
| `save_ms` | Writing the turn to the database |
| `first_write_ms` | Request received to the first content written to Vapi. This is the **server-side stand-in for time to first audio**: Vapi still has to synthesise and play it |
| `ack_ms`, `ack_category` | When the spoken acknowledgement went out, and which kind |
| `speech_to_agent_ms` | Customer stopped speaking to request received. **Approximate**: it starts at the `speech-update` webhook's arrival, which has its own delay |
| `prewarmed` | The turn used a pre-started agent process |
| `delivered`, `client_closed_ms` | Whether the reply reached Vapi. `false` means the connection closed first (the customer talked over the assistant mid-turn); `client_closed_ms` is when. The turn itself still finished and was saved |

`conversation_turns.latency_ms` keeps its old meaning (start of the turn to just before the save).
`tool_calls.duration_ms` is still the MCP server's own view of a tool (validation plus the tool, not the bookkeeping write).
Turns answered by the Session Controller itself (closers, an ended session) have no `timings`: they never reach the model.

**What the server cannot see**: speech recognition, end-of-speech detection, speech synthesis and playback. The end-of-call
report is believed to carry Vapi's own averages (`artifact.performanceMetrics`: transcriber, endpointing, model, voice and
turn latency). Those are kept in the `call_ended` event as `vapi_latency_ms` (numbers only). **Confirmed on real calls
(2026-10-02)**: the names match and `npm run report` shows them. A call with no real exchange reports zeros, and so did one
call that had three customer turns, so a zero means "not measured", not "instant".

## Reading it

```bash
npm run report -- --since 1h        # latency breakdown: p50 / p95 / max per piece and its share of turn time
npm run trace -- <conversation id>  # one call, with a breakdown under every agent turn
```

## Baseline

Per the plan, the latency budget is set from measurements, not guessed. **No budget has been set yet.**

### First measurements (2026-10-02): a development session, not a clean baseline

From `npm run report -- --since 3h`: 32 conversations, 64 turns, of which **17 carry timings** (the rest are from before
timings existed). They mix ordinary test calls with the pause/resume experiments, and the window contains 12 error events,
so treat the numbers as indicative only. Agent pre-start was off.

| Piece | p50 | p95 | Share of turn time |
|---|---|---|---|
| Whole turn | 12.0 s | 74.5 s | |
| Queue (waiting behind an earlier turn) | 7.3 s | 56.3 s | 54% |
| Agent start | 0.49 s | **30.3 s** | 26% |
| Model | 3.2 s | 3.9 s | 17% |
| Retrieval | 0.13 s | 0.41 s | 1% |
| History | 0.29 s | 0.34 s | 1% |
| Save | 0.14 s | 0.31 s | 1% |
| First reply byte | 2.5 s | 2.5 s | (always the acknowledgement) |
| Vapi-side turn average (10 calls) | 818 ms | | model 265 ms, voice 503 ms, transcriber 49 ms |

What it says:

1. **Agent start is bimodal.** Usually about half a second, but **30.3 s on two consecutive turns of one call** and 14.5 s on
   the next. Thirty seconds is suspiciously round: it matches the default connection timeout of the agent's tool (MCP)
   server, which would mean the agent waited for a tool server that did not answer and then carried on without it. **This is
   a hypothesis, not a finding**: those turns used no tools, and other turns in the same window called a tool in 270 ms. To
   check: from the machine running the agent, is `MCP_SERVER_URL` reachable quickly every time (a service that sleeps when
   idle, or a cold start, would do this)? Is `AGENT_PREWARM=1` any different?
2. **Queueing, not the model, is the largest share.** When one turn is slow the customer keeps talking, and each new request
   waits behind the unfinished one (31.5 s, then 56.3 s in one call), so delays compound. This is the serialisation problem
   described under "Interruptions" in `docs/VAPI.md`, and the strongest argument for cancelling superseded turns later.
3. **The model itself is fine**: 3.2 s median, 3.9 s at the 95th percentile. Retrieval, history and saving are about 1% of a
   turn together; the earlier safe speedups were not where the time was.
4. **Every timed turn needed the acknowledgement** (first reply byte is always 2.5 s). With a 3.2 s model median that is
   expected; it is not evidence the acknowledgement is firing wrongly.

### Procedure for a clean baseline

1. Make sure migration `20261002000009_turn_timings.sql` is applied and the agent has been restarted.
2. With `AGENT_PREWARM` unset, make 1 or 2 real calls of about 10 turns that cover: a general question, a customer lookup,
   `TXN-9001`, `PAY-7002`, a support ticket, an escalation, and a short "that's all". Do not run the pause experiments in the
   same window.
3. `npm run report -- --since 1h`. Copy the "Latency breakdown" and "Vapi-side averages" lines into the table below.
4. Decide the budget (for example "first reply byte under N seconds") from what you see, and write it down with the date.

| Date | Pre-start | Turns | Whole turn p50 / p95 | Agent start | Model | Tools | Retrieval | History | First reply byte | Vapi-side turn avg |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-02 (mixed session, see above) | off | 17 | 12.0 s / 74.5 s | 0.49 s / 30.3 s | 3.2 s | 0.27 s (9 lookups) | 0.13 s | 0.29 s | 2.5 s | 818 ms |

## Changes that do not alter behaviour

| Change | Why it is safe |
|---|---|
| History reads (turns, status) and the conversation upsert run together | They do not depend on each other; the turn row is still written after the conversation row exists |
| The knowledge-log row is written while the model works (still awaited before the turn ends) | Nothing in the answer needs it; failures are still only logged |
| The MCP server writes the `tool_calls` row after returning the result (`background: true` for the HTTP server only) | Observability row; the model no longer waits for two database writes per tool call. Pending writes are flushed on shutdown |
| Timings are stored after the reply has been written | No added latency; a failed write only logs |

`saveTurn` is deliberately **still awaited** before the reply: the next turn's history and turn numbers depend on it, and
it is a single round trip.

## Pre-starting the agent process (off by default)

Every turn starts a fresh agent subprocess (`docs/VAPI.md` notes 3 to 15 s per turn). The SDK can pre-start one
(`startup()`), so `AGENT_PREWARM=1` keeps one ready per live call:

- warmed when the call starts (the `in-progress` status webhook) and again right after each turn, while the customer
  listens and thinks;
- used once, only by its own conversation (the MCP headers carry the conversation id);
- closed when the call ends, or after `PREWARM_TTL_SECONDS` (90) unused; at most `PREWARM_MAX` (8) at once, beyond which
  calls start cold;
- any failure means the turn starts a process itself, exactly as without the feature.

Turn on only after comparing: run the baseline with it off, then on, and compare `agent start` and whole-turn p50 in
`npm run report` ("agent pre-start: on N turns ... off M turns"). Watch the number of agent processes after hanging up.
Whether the handshake includes the MCP connection is not known until measured.

## Acknowledgements ("one moment")

If a reply is not ready after `ACK_AFTER_MS` (2500), the caller hears a short acknowledgement. It replaces the single
fixed sentence. It is transport only (never stored as the answer), comes from a fixed library (no model call), and fits
what the turn is doing:

1. what the model is really doing: a customer, transaction or payout lookup, creating a ticket, escalating;
2. else what the customer said, only where unambiguous: a `TXN-` / `PAY-` / `CUS-` reference, or compliance, KYC,
   verification, restricted, suspended;
3. else, if knowledge was found, a knowledge-base phrase;
4. else the original "One moment while I check that." (and two close variants).

Within a call the phrases rotate deterministically and never repeat back to back; a finished call's rotation is dropped.
The library is `services/agent/src/acks.ts`; a misleading phrase is judged worse than a plain one, so it prefers
"generic" to guessing.

## Deliberately deferred: context memory and reuse (Build Plan V2 sections 22 to 26)

Not built. The plan says to investigate before building, and principle 5 puts correctness first for account-specific,
financial, compliance and transaction questions. What a later pass must respect:

- **Do not reuse an answer** when the transaction differs, the customer context changed, the question is about a specific
  account, policy may have changed, the previous answer was uncertain (a clarification, decline or low-confidence reply),
  or the customer asks for new information ("is it still processing?", "any update?").
- **Tool results have no freshness information**: no `updated_at`, version or fetched-at in `lookup_customer`,
  `lookup_transaction` or `lookup_payout`. Any expiry would have to be tracked by the caller. A status can move (for
  example a normal payout into compliance review), which is exactly where a stale answer would do harm.
- **A follow-up like "what currency is that in?"** could be answered from an earlier `lookup_transaction` (it returns amount
  and currency), but only if "that" resolves to a single known transaction.
- **`lookup_payout` reads twice** (the payout, then its transaction for `support_summary`); the second read is dependent.
- **`tool_calls.result_summary` keeps ids and statuses only**, so a context cannot be rebuilt from the database; it would
  have to live with the conversation (a new column or table).
- **Knowledge-base `version` is hand-edited frontmatter**, so a cache key needs the chunk content or a hash, not just
  `(document_id, version)`. Ingest does not store an updated time.
- **`support_notes`, KYC status, risk wording and `failure_reason` must never be kept as reusable "facts"** (they are
  already blocked from being spoken).
- Calls already bypass the agent, deterministically, for: ending the conversation (the button, "that's all", "goodbye"),
  an ended or expired session, and starting a new conversation (a new call). Nothing more is needed there.
- Conversation-level agent, tool and retrieval budgets belong to Iteration 10 (abuse hardening).
