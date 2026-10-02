# MCP server

`services/mcp` exposes the six support tools over Streamable HTTP (stateless) at `POST /mcp`. `GET /health`
returns `{ok:true}` without auth. Everything else needs `Authorization: Bearer <MCP_SERVER_AUTH_TOKEN>`.

## Run

```bash
npm run mcp:dev     # http://127.0.0.1:4000/mcp (MCP_PORT / MCP_HOST override)
npm run mcp:smoke   # in-process server, calls every tool through an MCP client, cleans up
```

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_SERVER_AUTH_TOKEN` (see `ENVIRONMENT.md`).
The agent connects with `MCP_SERVER_URL` (for local development `http://localhost:4000/mcp`) and the same token.

## Tools

| Tool | Input | Result |
|---|---|---|
| `lookup_customer` | one or more of `customer_id`, `email`, `company_name` (a linked conversation always gets its own account) | `found`, `customer_id`, `company_name`, `plan`, `account_status`, `kyc_status`, `support_notes` |
| `lookup_transaction` | `transaction_id` | `found`, `transaction_id`, `customer_id`, `type`, `status`, `amount` (number), `currency`, `estimated_arrival` (or null), `support_summary` |
| `lookup_payout` | `payout_id` or `transaction_id` | `found`, `payout_id`, `transaction_id`, `customer_id`, `status`, `scheduled_for`, `failure_reason`, `support_summary` (from the linked transaction) |
| `create_support_ticket` | `category`, `priority`, `summary` (conversation from `X-Conversation-Id`) | `ticket_id` (`TKT-000001`), `status: "open"` |
| `create_escalation` | `category`, `reason`, `contact_preference` (`text_chat` / `callback`), `preferred_at` (ISO 8601), `preferred_timezone` (IANA), `preferred_time` (display text) | `escalation_id` (`ESC-000001`), `ticket_id`, `status: "open"`, `callback_at` (callback only), `follow_up_summary` |
| `log_conversation_event` | `conversation_id`, `event_type`, `summary`, optional `metadata` | `logged: true` |

Enums: ticket category `payment|payout|invoice|account|compliance|technical|other`, priority
`low|normal|high|urgent`; escalation category `compliance|account|dispute|payment|other`.

## Behavior

- Input is validated (strict zod schemas) before any database access. Problems return
  `{ error: { code: "invalid_input", message } }` with `isError: true`.
- Missing records return `{ found: false }`. An ambiguous customer match (more than one row) also returns `found: false`.
- Unknown `customer_id` or `ticket_id` on a write returns `reference_not_found`.
- Database failures return `temporarily_unavailable` with a fixed message. The technical error goes to stderr and
  `tool_calls.error`, never to the caller.
- Every call writes a `tool_calls` row (`success`, `not_found`, `failed`). Inputs are summarized: identifiers are
  kept, email, name, reason and summary text are stored as `<provided>`.
- Email and company name match case-insensitively and exactly; `%` and `_` are escaped.
- Metadata for `log_conversation_event` is capped at 4 KB and keys that look like secrets (`token`, `key`,
  `password`, `secret`, `authorization`, `cookie`) are dropped at any depth. Events are stored in the
  `conversation_events` table (added in migration `..._conversation_events.sql`).
- Writes that carry a `conversation_id` create a minimal `conversations` row first if it does not exist yet.

## Identity and callback times (Build Plan V3)

- **Who is asking.** The agent sends `X-Conversation-Id`; for the account tools (`lookup_customer`, `lookup_transaction`,
  `lookup_payout`, `create_support_ticket`, `create_escalation`) the server reads `conversations.customer_id` / `user_id`
  (written by the web app's link, never taken from the model) and scopes the tool to that customer. Another customer's
  transaction or payout is `found: false` (the customer is part of the query itself); `lookup_customer` returns the
  signed-in account whatever was asked. `customer_id`, `user_name`, `user_email` and `ticket_id` are not tool arguments
  any more: if a model still sends them they are dropped and never read. A failed read of the link fails closed.
- **No unlinked fallback.** Every account tool requires a conversation linked to a signed-in customer whose account has a
  name and email (`not_authorized` / `profile_incomplete`, with account-settings guidance), and creates no ticket or
  escalation otherwise. The tool server has no switch for this; only tests and development scripts pass `allowUnlinked`
  to the tool context, and only read-only tools honour it.
- **Contact details.** An escalation stores the account's display name and email (`app_users`), nothing the model supplied.
- **Ticket and escalation are one operation.** `create_escalation` calls `create_ticket_and_escalation` (a database function,
  migration 20261007000017): it reuses the ticket already logged in the conversation or creates one, creates the
  escalation, and a repeat returns the same pair. `create_support_ticket` is once per conversation and summary
  (`create_support_ticket_once`). The request's `X-Conversation-Id` wins over a conversation id typed into tool arguments.
- **Callback time.** Anything that is not a `text_chat` escalation needs a specific `preferred_at`. Without an offset it is wall
  clock in `preferred_timezone` (a timezone is then required). Accepted only if `now - 2 min <= preferred_at <= now + 1
  calendar month` (month measured on the customer's wall clock, so 31 Jan becomes 28 Feb). The error text is safe to give
  back to the model so it can ask the customer again. Stored as `escalations.preferred_at` / `preferred_timezone`
  (migration `..._escalation_preferred_at.sql`) with a readable `preferred_time`.

## Caveats for the agent (Phase 6)

- `lookup_customer` returns internal `support_notes` as the spec requires. The agent must never read them aloud.
- Callers are signed-in customers: lookups are scoped to the customer the conversation is linked to (see above). Treat lookup
  results as support context.
- `create_escalation` cannot set `call_booked`; it stays false until a booking flow exists.
- The requirements doc shows `amount` as a string; the TDD says number. The tool returns a number.

## Tests

`tests/mcp/tools.test.ts` (fake store, validation and failure handling), `tests/mcp/http.test.ts` (auth, tool list,
a real client call), `tests/mcp/live.test.ts` (against Supabase; skipped without credentials; deletes what it creates).

## Conversation attribution

Send `X-Conversation-Id: <conversation id>` (letters, digits, `_ . : -`, max 64) on the MCP connection and every tool
call is written to `tool_calls` with that conversation id, even for tools whose input has no conversation field.
An id inside the tool input wins over the header. Malformed values are ignored. The agent sets this header on every turn.

## Logging

Each call writes a `tool_calls` row with a fixed `purpose`, a `duration_ms`, an `input_summary` that keeps ids and masks free text, and a `result_summary` made only of ids and statuses. Stored errors are scrubbed. See `OBSERVABILITY.md`.
