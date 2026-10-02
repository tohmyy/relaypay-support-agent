# Abuse prevention

Build Plan V2, Iteration 10. The goal is that the support agent cannot be cheaply or accidentally used to burn resources or
hold a session open for ever. Every limit is enforced **on the server**; the browser only explains what happened.

## Layers

| Layer | Where it is enforced | Default |
|---|---|---|
| Sign-in | web app, login action | 5 attempts per 15 minutes per email and address (Postgres counter) |
| Session length | agent Session Controller + Vapi `maxDurationSeconds` | 6 minutes |
| Silence | agent Session Controller | 15 s quiet, 10 s countdown |
| Conversation budgets | agent Session Controller (`beforeTurn`) | 30 model turns, 50 tool calls, 30 knowledge lookups |
| Per-turn depth | agent (`maxTurns`) | 6 |
| Concurrent sessions | agent Session Controller; web link route answers early | 1 active voice session per signed-in customer |
| Session creation rate | agent Session Controller; web link route answers early | 8 per hour per signed-in customer |
| Global creation breaker | agent Session Controller | 60 new conversations per 10 minutes, anyone |
| Text chat | web routes, shared limiter | 30 messages/minute/conversation (customer), 60 (staff), 40 typing signals, 60 read signals, 12 presence updates |
| Logging | `conversation_events`, `npm run report` | always |

Set any of the three budgets, the concurrency limit or a rate to `0` to turn it off (`docs/ENVIRONMENT.md`). The defaults are
starting points: tune them after watching normal usage with `npm run report`.

## What happens when a limit is reached

- **Over a conversation budget** (agent turns, tool calls, knowledge lookups): the customer hears a fixed line (no model call).
  A signed-in customer with `HUMAN_HANDOFF=1` is **moved to staff** (`docs/HANDOFF.md`, reason `limit-reached`); everyone
  else hears "This request needs to be continued by a support specialist" and the call ends with
  `end_reason = limit-reached` (`final_status = abandoned`, unless it was already escalated).
- **A second simultaneous call** from the same signed-in customer: the newer call hears "You already have an active support
  conversation" and ends. The older one carries on. The page also learns it straight away from the link request (409
  `active-session`) and shows the same message.
- **Too many sessions** in the window: the call ends politely (`rate-limited` on the page, 429 from the link request).
- **Global breaker**: any new call beyond the cap hears that requests are busy and is ended.

Each of these writes a `limit_reached` event (`kind`, `limit`, `value`).

## How the agent knows who is calling

It does not know from the call itself: Vapi's requests carry the call id and the conversation, no confirmed identity and not
the caller's address. The identity comes from the **link** the signed-in page makes after the call starts
(`conversations.customer_id`). Until it lands (usually a second or two), the per-customer checks have nothing to match, so
they are re-checked on each turn until the customer is known, then once per session. The conversation budgets and the
global breaker do not need identity.

Counters live in memory on the (single) agent instance and are **rebuilt from the tables** (`conversation_turns`,
`tool_calls`, `retrieval_logs`) when a session is first seen after a restart, so a restart does not reset a budget. Tool call
rows can lag slightly when the MCP server writes them in the background, which only makes a rebuilt budget a little generous.

## Web app limiter

The web app runs on several instances, so it cannot count in memory. `rate_limit_hit(key, window, max)` is a Postgres
function (one atomic upsert per hit on `rate_limits`); `lib/auth/rate-limit.ts` calls it. If the database cannot be reached
the chat limits **fail open** (a logged warning), and sign-in falls back to the in-memory counter.

## Monitoring

`npm run report` has a **Limits and handoffs** section: limits reached by kind, sessions ended by a limit, hand-overs by
reason, conversations closed by staff, customers with several sessions, and the heaviest conversations by turns and tool
calls. The raw events are in `conversation_events` (`limit_reached`, `human_handoff`, `human_closed`).

## Known limits

- **Calls that do not come through a signed-in page cannot be limited per person.** The agent never sees the caller's address
  (it sits behind Vapi) and the Vapi public key is in the browser, so a call started directly against it is unlinked: only the
  global breaker and the per-conversation budgets apply. Closing this needs a
  server-issued start token for each call or controls on the Vapi side; neither is built.
- The web link check is a convenience: a customer who calls Vapi directly still meets the agent's checks on their first turn.
- A very short call that never sends a turn is not stopped by the turn-time checks (it ends by silence or the time limit).
- Defaults have not been tuned against real traffic.
