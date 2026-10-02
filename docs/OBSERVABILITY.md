# Observability

Every support call can be reconstructed from the database, and every failure leaves a trace there as well as in the
server log.

## What is recorded, and where

| Need (BUILD-PLAN section 35) | Where | Written by |
|---|---|---|
| Conversation start | `conversations` (`started_at`, `channel`) | agent on the first turn, or the Vapi webhook on `in-progress` |
| Conversation end | `conversations` (`ended_at`, `final_status`, **`end_reason`**, `summary`) and a `call_ended` row in `conversation_events` (`endedReason`, `durationSeconds`, `cost`) | Vapi `end-of-call-report` webhook, or the Session Controller when it ends the call first (first recorded `end_reason` wins) |
| Why a session ended | **`conversations.end_reason`**: `user-ended`, `silence-timeout`, `session-timeout`, `agent-ended`, `human-closed`, `low-confidence`, `error` (null when Vapi's reason is unmapped). `final_status` stays the coarse outcome | Session Controller / webhook |
| Session lifecycle events | `conversation_events`: `silence_warning` (`countdown_seconds`), `session_warning` (`seconds_left`), `session_ended` (`end_reason`, `final_status`, `duration_seconds`) | Session Controller, `endConversation` |
| Where a turn's time went | **`conversation_turns.timings`** (JSON: queue, controller, history, retrieval, agent start, model, tools, save, first reply byte, acknowledgement, pre-start) and `vapi_latency_ms` in the `call_ended` event (Vapi's own averages, if its report carries them); see `docs/PERFORMANCE.md` | agent server, `runTurn`, Vapi report |
| Voice interaction | `voice_stats` event, once per call: `interruptions`, `short_interruptions` (under half a second, a rough noise indicator), `undelivered_replies`, `silence_warnings`; `timings.delivered` / `client_closed_ms` per turn. `npm run report` shows them in its **Voice** section | Session Controller, agent server |
| Readiness and retries | Agent `GET /ready` returns per-dependency `ok` and `ms`. The web server logs a line for each automatic retry: `[web] retry operation=<ready, start, link, state-poll or agent-ready> attempt=<1 or 2> outcome=<retrying or failed> class=<transient or permanent> ms=<n>`. A call ended because no customer was linked records a `conversation_events` row `unlinked_call` and `end_reason = error` | agent, web server |
| Human handoff and limits | `conversation_events`: `human_handoff` (`reason`: `escalation` or `limit-reached`), `human_closed` (`closed_by`), `limit_reached` (`kind`, `limit`, `value`; kinds: `agent_calls`, `tool_calls`, `retrievals`, `concurrent_sessions`, `session_rate`, `global_session_rate`); `conversations.support_mode`, `assigned_staff_id`; `end_reason = limit-reached` / `human-closed`. `npm run report` shows them in its **Limits and handoffs** section (see `docs/ABUSE.md`) | Session Controller, web staff routes |
| Last activity | **`conversations.last_activity_at`**, stamped on each stored turn and at session end | agent |
| User and assistant turns | `conversation_turns` (transcript, reply, **`turn_uid`**, **`display_text`**, **`spoken_text`**, `answer_type`, `confidence_note`, **`latency_ms`**, **`cost_usd`**). History and the incremental transcript API prefer `display_text` | agent |
| Retrievals | `retrieval_logs` (query with personal data masked, source titles, summary) | agent retrieval |
| Tool calls | `tool_calls` (`tool_name`, **`purpose`**, `input_summary`, `result_summary`, `status`, `error`, **`duration_ms`**, timestamp, conversation id) | MCP server, for every call |
| Tickets | `support_tickets` (conversation id, status `open`/`in_progress`/`closed`) | MCP `create_support_ticket` / `create_ticket_and_escalation` |
| Escalations | `escalations` (conversation id, required same-conversation `ticket_id`, status, requested time, `contact_preference`: `text_chat` or `callback`) | MCP `create_escalation` |
| Staff lifecycle | Claim, release, close and customer end write one `conversation_events` row each and keep ticket/escalation status aligned | web staff/customer RPCs |
| Errors | `conversation_events` with `event_type = 'error'` and `{source, message}` (message masked and cut to 300 characters); `tool_calls` rows with `status = 'failed'`; JSON lines on stderr | agent (`agent.runTurn`, `vapi.webhook`), MCP |

`timings` was added in V2 Iteration 3 (migration `20261002000009_turn_timings.sql`, nullable, no backfill). Apply it before
running the new agent: the server writes it after each turn.

Bold columns were added in Phase 10 (migration `..._observability.sql`, all nullable), except `end_reason` and
`last_activity_at`, which come from V2 Iteration 1 (migration `20261001000008_session_lifecycle.sql`, nullable, no
backfill). Apply that migration before running the new agent or web code: both read and write those columns.

Every server log line is one JSON object on stderr: `{ts, level, service, event, conversation_id?, message?}`.
Secret-looking fields (`token`, `key`, `secret`, `password`, `authorization`, `cookie`) are dropped and strings are
scrubbed before they are written.

## Looking at a call

```bash
npm run trace -- vapi_<call id>          # time-ordered story of one call
npm run trace -- vapi_<call id> --json   # same, machine readable
npm run report                           # numbers for everything
npm run report -- --since 24h            # or 30m, 7d
```

Example trace:

```
04:19:01.890  customer   "Can you check payout PAY-7002?"
04:19:02.086  start      call started (voice)
04:19:02.547  retrieval  searched "Can you check payout PAY-7002?" -> Payout And Beneficiary Management; ... (4)
04:19:06.118  tool       lookup_payout success 110ms - found PAY-7002, status review required [Look up a payout to report its status]
04:19:09.050  agent      (escalation, 7.2s, $0.013) "Thanks for waiting. That payout is under review, ..."
```

The customer line is placed at the time they spoke (reply time minus latency), so the order reads naturally. The trace
masks emails and long numbers in what it prints even though stored transcripts are kept as spoken.

The report shows conversations by final status, turns by answer type, reply time (p50, p95, max), the model cost
estimate, tickets, escalations, events by type, and per-tool calls with success, not-found and failed counts and
average duration. Use it as testing evidence.

To find problems directly:

```sql
-- slowest replies
select conversation_id, turn_number, latency_ms from conversation_turns order by latency_ms desc nulls last limit 10;
-- failures
select * from conversation_events where event_type = 'error' order by created_at desc;
select * from tool_calls where status = 'failed' order by created_at desc;
```

## Privacy and retention

- **Transcripts are stored verbatim** in `conversation_turns` because reconstruction needs them. If the customer
  types or says their email (for example through the escalation form), it appears in that transcript and in the
  escalation record by design. Treat these tables as personal data.
- **Everything else is scrubbed or id-only.** `tool_calls.input_summary` keeps identifiers and replaces names, emails,
  reasons and summaries with `<provided>`. `result_summary` is built only from ids and statuses (for example
  `found TXN-9001, status processing`). Retrieval queries, stored errors and log lines pass through the masker.
- **The masker is best effort.** It replaces emails with `[email]` and numbers of 9 or more digits with `[number]`.
  Reference ids (`TXN-9001`), dates and short numbers are left alone. It is a safety net, not a guarantee.
- **Never logged**: API keys, tokens, the webhook secret, internal `support_notes`, or raw database errors returned to
  callers.
- **Retention**: nothing is deleted automatically. Decide a retention period before real customers use this, and run a
  scheduled clean-up of old rows (deployment phase). Vapi keeps its own call logs and recordings, which are outside
  this repository.

## Known gaps

- Browser-side problems (for example a refused microphone) are shown to the customer but not reported to the server.
- A call that ends without a webhook (tunnel down) stays open in `conversations` with no `ended_at`; the report shows
  these as "still open".
- Staff see the estimate in the console (Build Plan V3, V3.13): **Est. cost** per conversation in the queue and on the
  conversation page, and **Estimated cost today** (conversations started since midnight UTC). It is the sum of
  `conversation_turns.cost_usd`; Vapi's own `call_ended` cost is not mixed in.
- Model cost is the SDK's estimate, not a bill. Vapi's own cost is stored only as reported in its end-of-call report.
- Running `mcp:dev` and `agent:dev` from before this change do not write the new fields; restart them.
