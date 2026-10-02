# Vapi voice integration

Vapi handles the voice (speech to text, text to speech, call lifecycle). The RelayPay agent keeps all support logic.
Vapi reaches the agent through a **custom LLM** endpoint and reports call events to a webhook.

```
Caller -> Vapi (speech to text) -> POST /chat/completions -> agent (retrieval, MCP tools, guard) -> reply
       <- Vapi (text to speech) <-----------------------------------------------------------------
Vapi -> POST /vapi/events (call started, end-of-call report) -> conversation row updated
```

## The agent server

`npm run agent:dev` starts `services/agent/src/main.ts` on `127.0.0.1:4100` (`AGENT_PORT`, `AGENT_HOST`).

| Route | Auth | Purpose |
|---|---|---|
| `POST /chat/completions` (also `/v1/...`) | `Authorization: Bearer <AGENT_API_TOKEN>` | Vapi custom-LLM endpoint. OpenAI-style request; the last user message is the customer's utterance; Vapi's own system prompt is ignored |
| `POST /vapi/events` | `X-Vapi-Secret: <VAPI_WEBHOOK_SECRET>` | `status-update` creates the conversation; `speech-update` feeds silence detection; `end-of-call-report` sets `ended_at`, `end_reason`, the final status (`escalated` stays, otherwise per the table below) and Vapi's summary. The first recorded `end_reason` wins. Disabled when the secret is unset (silence detection then has no speech events) |
| `GET /health` | none | liveness |

Behavior:

- **Conversation id**: `metadata.conversation_id` (app-supplied, for the web UI) first, then Vapi's `call.id` as
  `vapi_<id>`, then an `X-Conversation-Id` header. Only `[A-Za-z0-9_.:-]` up to 64 characters is accepted. Confirmed
  against real Vapi traffic: requests contain `call.id`, `messages`, `stream: true`, and no app metadata by default.
- **Streaming**: SSE chunks in OpenAI format, ending with `[DONE]`; non-streaming JSON also works.
- **Slow replies**: if a turn takes longer than `ACK_AFTER_MS` (2.5 seconds) the caller hears a short acknowledgement
  that fits what the turn is doing ("I'll check that transaction for you.", "Let me check the payout status.", ...),
  rotating so it does not repeat back to back; "One moment while I check that." remains the fallback when the turn cannot
  be classified (`docs/PERFORMANCE.md`). It is transport only and is not stored as the answer. Turns take roughly 3 to 15
  seconds (the Agent SDK starts a subprocess per turn), so expect pauses on tool lookups; `npm run report` breaks the time
  down. The optional `AGENT_PREWARM=1` starts that subprocess ahead of time.
- **Failures**: any error becomes a short spoken "I'm having trouble right now..." with HTTP 200 so the call never
  goes silent; technical details go to the server log only.
- **Ordering**: turns of one call run one at a time, so a caller interrupting cannot interleave two turns.
- `AGENT_DEBUG=1` logs which fields Vapi sends (never their content).

## Session lifecycle (Build Plan V2, Iteration 1)

The Session Controller (`services/agent/src/session/`) sits on the path above. It is deterministic: no model call
decides when a session ends. State is in-process; the deadline is re-read from `conversations.started_at`.

| What | Behavior | Recorded as |
|---|---|---|
| Silence | `SILENCE_TIMEOUT_SECONDS` (15) of quiet, then a visible `SILENCE_COUNTDOWN_SECONDS` (10) countdown, then the call ends (+1 s grace on the server). Quiet is measured from the end of the assistant's speech or the customer's; not while the assistant is speaking, a turn is being processed, or the escalation contact form is open. The customer speaking cancels it | `end_reason = silence-timeout`, `final_status = abandoned`, events `silence_warning`, `session_ended` |
| Time limit | `SESSION_MAX_SECONDS` (360). Warning event and (if live control is available) a spoken warning at `SESSION_WARNING_SECONDS` (30) before; hard end at the limit. Turns after the deadline get a fixed "session has ended" reply and never reach the model | `end_reason = session-timeout`, `final_status = abandoned`, events `session_warning`, `session_ended` |
| "That's all" | Clear closers ("that's all", "I'm done", "thank you, goodbye", "I don't need anything else") get a fixed goodbye and the call ends once the goodbye has been spoken. Bare thanks ("okay, thanks") gets "anything else?"; a following "no" ends it, anything else carries on. These turns are stored but cost no model call | `end_reason = user-ended`, `final_status = resolved` (abandoned if no turns) |
| Vapi's own end | `end-of-call-report` `endedReason` is mapped: `exceeded-max-duration` → `session-timeout`, `silence-timed-out` → `silence-timeout`, `customer-ended-call` → `user-ended`, `assistant-ended-call*` → `agent-ended`, errors → `error`. An unmapped reason leaves `end_reason` null | |

`final_status` stays the coarse outcome; `end_reason` says why. An escalated conversation stays `escalated`.

Three independent layers enforce the time limit: the controller's timer, refusal of turns past the deadline, and
Vapi's own `maxDurationSeconds`, which `vapi:setup` sets to `SESSION_MAX_SECONDS + 10`. `vapi:setup` also subscribes to
`speech-update` and sets Vapi's `silenceTimeoutSeconds` high (600) so Vapi's default does not cut calls before the controller.
The browser also hangs up 3 s after the limit as a last resort; it never decides anything durable.

### Ending a call from the server (needs a live check)

Vapi documents live control through `call.monitor.controlUrl` (`{"type":"end-call"}`, `{"type":"say","content":...,
"endCallAfterSpoken":true}`). The docs do not say whether that URL reaches web-SDK calls or webhook payloads. The
controller therefore uses `monitor.controlUrl` when a webhook carries one, and otherwise falls back to a REST
`DELETE /call/{id}` with `VAPI_API_KEY`, which is **unverified for live web calls**. If neither hangs up, the session is
still marked ended in the database, further turns are refused, and Vapi's `maxDurationSeconds` or the browser ends the
call. To verify: run a call with `AGENT_DEBUG=1`, stay silent, and watch whether the call drops at about 26 s. Record the
result here.

## Pointing your assistant at it

`scripts/vapi/setup.ts` **modifies the assistant in `VAPI_ASSISTANT_ID`**; it never creates one. It changes only the
model (custom LLM at your URL), the webhook (`server`, `serverMessages`), the session-limit backstops
(`maxDurationSeconds`, `silenceTimeoutSeconds`) and attaches a credential; voice, transcriber,
name and greeting stay as you configured them. Before patching it saves the previous model and webhook settings to
`vapi-assistant-backup-<id>.json` (git-ignored) so the change can be undone by hand.

The credential is named `relaypay-agent-<first 8 characters of the assistant id>` and holds `AGENT_API_TOKEN`. The name
is specific to your assistant on purpose: the Vapi organization may be shared, and a generic name could match someone
else's credential.

```bash
# .env.local needs: VAPI_API_KEY, VAPI_ASSISTANT_ID, AGENT_API_TOKEN (16+ chars), VAPI_WEBHOOK_SECRET (8+ chars)
npm run mcp:dev                         # terminal 1 (MCP server, port 4000)
npm run agent:dev                       # terminal 2 (agent server, port 4100)
npm run tunnel                          # terminal 3 (cloudflared; prints https://<random>.trycloudflare.com)
npm run vapi:setup -- --url https://<random>.trycloudflare.com --dry-run   # preview, changes nothing
npm run vapi:setup -- --url https://<random>.trycloudflare.com             # apply
```

A quick tunnel gets a new URL every run, so run `vapi:setup` again each time. Use a stable host (Phase 16) to avoid that.
While the tunnel runs, only the token-protected agent endpoints are reachable from the internet; the MCP server
stays on localhost.

## Testing

- Text check through Vapi itself (no microphone): `POST https://api.vapi.ai/chat` with `assistantId` and `input`
  runs the assistant's LLM, which calls this endpoint.
- Voice check (Scenario 9): with everything above running, open the assistant in the Vapi dashboard and use
  "Talk to assistant", or use the web UI from Phase 9. Then look at `conversation_turns`, `retrieval_logs`,
  `tool_calls` and `conversations` for the call (conversation id `vapi_<call id>`).
- Automated: `tests/agent/server.test.ts`, `tests/agent/vapi.test.ts` and `tests/agent/vapi-setup.test.ts` (offline);
  `tests/agent/vapi.live.test.ts` drives the real endpoint with real Vapi-shaped requests, including the webhook.

## Notes

- Restart `npm run mcp:dev` after pulling new code. An older MCP process still works but does not attach the
  conversation id to `tool_calls` rows.
- Phone numbers are optional in the PRD and not configured here.
